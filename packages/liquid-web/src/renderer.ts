import {
  fieldDistanceWithTargetPath,
  preparePath,
  prepareTrackField,
  preparedTrackFieldDistance,
  proceduralDistance,
  signedDistanceRaster,
  signedDistanceToPreparedPath,
  framePaintedTracks,
  trackPlacement,
  unplacePoint,
  type TrackPlacement,
  transformPath,
  type AnyLiquidFrameSample,
  type AnyLiquidScene,
  type Capsule,
  type ComponentFrame,
  type LiquidFrameSample,
  type LiquidFrameSampleV2,
  type LiquidScene,
  type LiquidSceneV2,
  type PathCommand,
  type Point,
  type PreparedPath,
  type PreparedTrackField,
  type TrackFrame,
} from "@liquid/core";

export interface RasterOptions {
  readonly width: number;
  readonly height: number;
  readonly opacity?: number;
  readonly viewportPadding?: number;
}

export interface RasterResult {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8ClampedArray;
  readonly coverage: number;
}

export interface CanvasRenderOptions extends RasterOptions {
  readonly debug?: boolean;
  readonly fillStyle?: string;
  readonly sourceStyle?: string;
  readonly targetStyle?: string;
}

export interface ViewportTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function viewportFor(scene: AnyLiquidScene, width: number, height: number, viewportPadding = 0): ViewportTransform {
  const padding = Math.max(0, viewportPadding);
  const scale = Math.min(
    width / (scene.coordinateSpace.width + padding * 2),
    height / (scene.coordinateSpace.height + padding * 2),
  );
  return {
    scale,
    offsetX: (width - scene.coordinateSpace.width * scale) / 2,
    offsetY: (height - scene.coordinateSpace.height * scale) / 2,
  };
}

export function deviceToScene(point: Point, viewport: ViewportTransform): Point {
  return {
    x: (point.x - viewport.offsetX) / viewport.scale,
    y: (point.y - viewport.offsetY) / viewport.scale,
  };
}

function alphaForDistance(distance: number, scale: number, opacity: number): number {
  return Math.round(coverageForDistance(distance, scale) * 255 * opacity);
}

function coverageForDistance(distance: number, scale: number): number {
  return Math.min(1, Math.max(0, 0.5 - distance * scale));
}

function normalizedOpacity(opacity: number | undefined): number {
  return Math.min(1, Math.max(0, opacity ?? 1));
}

interface EndpointPath {
  readonly commands: readonly PathCommand[];
  readonly prepared: PreparedPath;
}

interface PreparedDistanceRaster {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly distances: Float32Array;
}

interface MutablePoint {
  x: number;
  y: number;
}

function endpointPath(endpoint: LiquidScene["source"]): EndpointPath {
  const commands = transformPath(endpoint.commands, endpoint.transform);
  return { commands, prepared: preparePath(commands) };
}

function endpointCacheKey(scene: LiquidScene, width: number, height: number, viewportPadding: number): string {
  return JSON.stringify({
    sceneId: scene.id,
    fixtureVersion: scene.fixtureVersion,
    width,
    height,
    viewportPadding,
    coordinateSpace: scene.coordinateSpace,
    fillRule: scene.fillRule,
    target: scene.target,
  });
}

function prepareTargetDistanceRaster(scene: LiquidScene, width: number, height: number, viewportPadding: number): PreparedDistanceRaster {
  const viewport = viewportFor(scene, width, height, viewportPadding);
  const distances = signedDistanceRaster(endpointPath(scene.target).prepared, scene.fillRule, { width, height, ...viewport });
  return { key: endpointCacheKey(scene, width, height, viewportPadding), width, height, distances };
}

function trackTargetCacheKey(scene: LiquidSceneV2, track: TrackFrame, width: number, height: number, viewportPadding: number): string {
  return JSON.stringify({
    sceneId: scene.id,
    fixtureVersion: scene.fixtureVersion,
    trackId: track.id,
    width,
    height,
    viewportPadding,
    coordinateSpace: scene.coordinateSpace,
    fillRule: scene.fillRule,
    target: track.target,
  });
}

function prepareTrackTargetDistanceRaster(scene: LiquidSceneV2, track: TrackFrame, width: number, height: number, viewportPadding: number): PreparedDistanceRaster {
  const viewport = viewportFor(scene, width, height, viewportPadding);
  const distances = signedDistanceRaster(endpointPath(track.target).prepared, scene.fillRule, { width, height, ...viewport });
  return { key: trackTargetCacheKey(scene, track, width, height, viewportPadding), width, height, distances };
}

function materialNumber(values: Readonly<Record<string, unknown>> | undefined, key: string): number | null {
  const value = values?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trackMaterialNumber(track: TrackFrame, key: string, fallback: number): number {
  return materialNumber(track.material.groups.$track, key) ?? fallback;
}

function sourceOverAlpha(bottom: number, top: number): number {
  const bottomCoverage = bottom / 255;
  const topCoverage = top / 255;
  return Math.round((topCoverage + bottomCoverage * (1 - topCoverage)) * 255);
}

interface PreparedRenderableTrack {
  readonly track: TrackFrame;
  readonly targetMix: number;
  readonly cornerSharpness: number;
  /** `$track.opacity` (default 1): fades a track while it is drawn as a field. */
  readonly fieldOpacity: number;
  /** Rigid move and scale of the whole track, or null when drawn in place. */
  readonly placement: TrackPlacement | null;
  readonly field: PreparedTrackField | null;
}

function prepareRenderableTracks(frame: LiquidFrameSampleV2): PreparedRenderableTrack[] {
  return frame.tracks.map((track) => {
    const targetMix = Math.min(1, Math.max(0, trackMaterialNumber(track, "targetMix", 0)));
    const cornerSharpness = Math.min(1, Math.max(0, trackMaterialNumber(track, "cornerSharpness", 0)));
    return {
      track,
      targetMix,
      cornerSharpness,
      fieldOpacity: Math.min(1, Math.max(0, trackMaterialNumber(track, "opacity", 1))),
      placement: trackPlacement(track),
      field: track.renderMode === "field"
        ? prepareTrackField(track, { cornerSharpness, includeTrackBlendFallback: true })
        : null,
    };
  });
}

function rasterizeFrameWithDistanceRaster(
  scene: LiquidScene,
  frame: LiquidFrameSample,
  options: RasterOptions,
  targetDistanceRaster: PreparedDistanceRaster | null,
): RasterResult {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const opacity = normalizedOpacity(options.opacity);
  const viewport = viewportFor(scene, width, height, options.viewportPadding);
  let source: EndpointPath | null = null;
  let target: EndpointPath | null = null;
  const sourcePath = (): EndpointPath => {
    source ??= endpointPath(scene.source);
    return source;
  };
  const targetPath = (): EndpointPath => {
    target ??= endpointPath(scene.target);
    return target;
  };
  const alpha = new Uint8ClampedArray(width * height);
  const scenePoint: MutablePoint = { x: 0, y: 0 };
  const inverseScale = 1 / viewport.scale;
  let covered = 0;

  for (let y = 0; y < height; y += 1) {
    const sceneY = (y + 0.5 - viewport.offsetY) * inverseScale;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sceneX = (x + 0.5 - viewport.offsetX) * inverseScale;
      const alphaValue = (() => {
        if (frame.renderMode === "crossfade") {
          scenePoint.x = sceneX;
          scenePoint.y = sceneY;
          const sourceCoverage = coverageForDistance(signedDistanceToPreparedPath(scenePoint, sourcePath().prepared, scene.fillRule), viewport.scale) * frame.sourceOpacity;
          const targetCoverage = coverageForDistance(signedDistanceToPreparedPath(scenePoint, targetPath().prepared, scene.fillRule), viewport.scale) * frame.targetOpacity;
          return Math.round(Math.min(1, sourceCoverage + targetCoverage) * 255 * opacity);
        }
        const distance = (() => {
          if (frame.renderMode === "targetPath") {
            scenePoint.x = sceneX;
            scenePoint.y = sceneY;
            return signedDistanceToPreparedPath(scenePoint, targetPath().prepared, scene.fillRule);
          }
          if (frame.renderMode === "sourcePath") {
            scenePoint.x = sceneX;
            scenePoint.y = sceneY;
            return signedDistanceToPreparedPath(scenePoint, sourcePath().prepared, scene.fillRule);
          }
          if (frame.targetMix === 0) {
            scenePoint.x = sceneX;
            scenePoint.y = sceneY;
            return proceduralDistance(scenePoint, frame);
          }
          if (targetDistanceRaster) {
            const targetDistance = targetDistanceRaster.distances[index] ?? Number.POSITIVE_INFINITY;
            if (frame.targetMix === 1) return targetDistance;
            scenePoint.x = sceneX;
            scenePoint.y = sceneY;
            return proceduralDistance(scenePoint, frame) * (1 - frame.targetMix) + targetDistance * frame.targetMix;
          }
          scenePoint.x = sceneX;
          scenePoint.y = sceneY;
          return fieldDistanceWithTargetPath(scenePoint, scene, frame, targetPath().prepared);
        })();
        const frameOpacity = frame.renderMode === "targetPath" ? frame.targetOpacity : frame.renderMode === "sourcePath" ? frame.sourceOpacity : 1;
        return alphaForDistance(distance, viewport.scale, opacity * frameOpacity);
      })();
      alpha[index] = alphaValue;
      if (alphaValue > 0) covered += 1;
    }
  }

  return { width, height, alpha, coverage: covered / alpha.length };
}

// Bilinearly samples a distance raster at an arbitrary scene point (used for
// placed tracks, whose samples fall between the raster's pixel centers).
export function sampleRasterAtScenePoint(raster: { readonly width: number; readonly height: number; readonly distances: Float32Array }, point: Point, viewport: ViewportTransform): number {
  const fx = Math.min(raster.width - 1, Math.max(0, point.x * viewport.scale + viewport.offsetX - 0.5));
  const fy = Math.min(raster.height - 1, Math.max(0, point.y * viewport.scale + viewport.offsetY - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => raster.distances[y * raster.width + x]!;
  const top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * tx;
  return top + (bottom - top) * ty;
}

// Coverage (0...1) of the scene clip shape at every pixel, or null when the scene has no clip.
function prepareClipCoverage(scene: LiquidSceneV2, width: number, height: number, viewportPadding: number): Float32Array | null {
  if (!scene.clip) return null;
  const viewport = viewportFor(scene, width, height, viewportPadding);
  const distances = signedDistanceRaster(endpointPath(scene.clip).prepared, scene.fillRule, { width, height, ...viewport });
  const coverage = new Float32Array(distances.length);
  for (let index = 0; index < distances.length; index += 1) coverage[index] = coverageForDistance(distances[index]!, viewport.scale);
  return coverage;
}

function rasterizeFrameV2WithDistanceRasters(
  scene: LiquidSceneV2,
  frame: LiquidFrameSampleV2,
  options: RasterOptions,
  targetDistanceRasters: ReadonlyMap<string, PreparedDistanceRaster>,
  includeBackdrop = true,
  clipCoverage: Float32Array | null = prepareClipCoverage(scene, Math.max(1, Math.floor(options.width)), Math.max(1, Math.floor(options.height)), options.viewportPadding ?? 0),
): RasterResult {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const opacity = normalizedOpacity(options.opacity);
  const viewport = viewportFor(scene, width, height, options.viewportPadding);
  const alpha = new Uint8ClampedArray(width * height);
  const scenePoint: MutablePoint = { x: 0, y: 0 };
  const inverseScale = 1 / viewport.scale;
  const endpointPaths = new Map<string, EndpointPath>();
  const preparedTracks = prepareRenderableTracks(frame);
  const backdropPaths = includeBackdrop ? (scene.backdrop ?? []).map(endpointPath) : [];
  const placedPoint: MutablePoint = { x: 0, y: 0 };
  const pathFor = (track: TrackFrame, endpoint: "source" | "target"): EndpointPath => {
    const cacheKey = `${track.id}:${endpoint}`;
    const cached = endpointPaths.get(cacheKey);
    if (cached) return cached;
    const prepared = endpointPath(endpoint === "source" ? track.source : track.target);
    endpointPaths.set(cacheKey, prepared);
    return prepared;
  };

  for (let y = 0; y < height; y += 1) {
    const sceneY = (y + 0.5 - viewport.offsetY) * inverseScale;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sceneX = (x + 0.5 - viewport.offsetX) * inverseScale;
      scenePoint.x = sceneX;
      scenePoint.y = sceneY;
      let combinedAlpha = 0;

      for (const preparedTrack of preparedTracks) {
        const track = preparedTrack.track;
        const placement = preparedTrack.placement;
        // Placed tracks are sampled where the visible point came from in the
        // track's own space; their distances scale back up by the placement.
        const point = placement ? unplacePoint(scenePoint, placement, placedPoint) : scenePoint;
        const distanceScale = placement ? placement.scale : 1;
        let trackAlpha: number;
        if (track.renderMode === "crossfade") {
          const sourceCoverage = coverageForDistance(signedDistanceToPreparedPath(point, pathFor(track, "source").prepared, scene.fillRule) * distanceScale, viewport.scale) * track.sourceOpacity;
          const targetCoverage = coverageForDistance(signedDistanceToPreparedPath(point, pathFor(track, "target").prepared, scene.fillRule) * distanceScale, viewport.scale) * track.targetOpacity;
          trackAlpha = Math.round(Math.min(1, sourceCoverage + targetCoverage) * 255 * opacity);
        } else {
          let distance: number;
          if (track.renderMode === "sourcePath") {
            distance = signedDistanceToPreparedPath(point, pathFor(track, "source").prepared, scene.fillRule);
          } else if (track.renderMode === "targetPath") {
            distance = signedDistanceToPreparedPath(point, pathFor(track, "target").prepared, scene.fillRule);
          } else {
            const targetMix = preparedTrack.targetMix;
            const field = preparedTrack.field;
            if (!field) {
              distance = Number.POSITIVE_INFINITY;
            } else if (targetMix === 0) {
              distance = preparedTrackFieldDistance(point, field);
            } else {
              const targetRaster = targetDistanceRasters.get(track.id);
              const targetDistance = targetRaster
                ? placement ? sampleRasterAtScenePoint(targetRaster, point, viewport) : targetRaster.distances[index]!
                : signedDistanceToPreparedPath(point, pathFor(track, "target").prepared, scene.fillRule);
              if (targetMix === 1) {
                distance = targetDistance;
              } else {
                const procedural = preparedTrackFieldDistance(point, field);
                distance = procedural * (1 - targetMix) + targetDistance * targetMix;
              }
            }
          }
          distance *= distanceScale;

          const trackOpacity = track.renderMode === "targetPath" ? track.targetOpacity : track.renderMode === "sourcePath" ? track.sourceOpacity : preparedTrack.fieldOpacity;
          trackAlpha = alphaForDistance(distance, viewport.scale, opacity * trackOpacity);
        }
        combinedAlpha = sourceOverAlpha(combinedAlpha, trackAlpha);
      }
      if (clipCoverage) combinedAlpha = Math.round(combinedAlpha * clipCoverage[index]!);
      for (const backdropPath of backdropPaths) {
        const backdropDistance = signedDistanceToPreparedPath(scenePoint, backdropPath.prepared, scene.fillRule);
        combinedAlpha = sourceOverAlpha(combinedAlpha, alphaForDistance(backdropDistance, viewport.scale, opacity));
      }

      alpha[index] = combinedAlpha;
    }
  }

  let covered = 0;
  for (const value of alpha) if (value > 0) covered += 1;
  return { width, height, alpha, coverage: covered / alpha.length };
}

export function rasterizeFrame(scene: LiquidScene, frame: LiquidFrameSample, options: RasterOptions): RasterResult;
export function rasterizeFrame(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, options: RasterOptions): RasterResult;
export function rasterizeFrame(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options: RasterOptions): RasterResult;
export function rasterizeFrame(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options: RasterOptions): RasterResult {
  if (scene.schemaVersion === 1) return rasterizeFrameWithDistanceRaster(scene, frame as LiquidFrameSample, options, null);
  return rasterizeFrameV2WithDistanceRasters(scene, frame as LiquidFrameSampleV2, options, new Map());
}

// Applies a track placement to path commands: scale about the origin, then move.
function placePath(commands: readonly PathCommand[], placement: TrackPlacement): PathCommand[] {
  return transformPath(commands, {
    scaleX: placement.scale,
    scaleY: placement.scale,
    translateX: placement.originX * (1 - placement.scale) + placement.offsetX,
    translateY: placement.originY * (1 - placement.scale) + placement.offsetY,
  });
}

function path2dFor(commands: readonly PathCommand[]): Path2D {
  const path = new Path2D();
  for (const command of commands) {
    if (command.type === "M") path.moveTo(command.values[0], command.values[1]);
    else if (command.type === "L") path.lineTo(command.values[0], command.values[1]);
    else if (command.type === "C") path.bezierCurveTo(...command.values);
    else path.closePath();
  }
  return path;
}

// True when every track shows an exact endpoint (each on its source or target
// path, or all crossfading), so the frame can be drawn as vector paths.
export function frameUsesExactEndpoints(frame: LiquidFrameSampleV2): boolean {
  if (frame.tracks.length === 0) return false;
  if (frame.tracks.every((track) => track.renderMode === "crossfade")) return true;
  return frame.tracks.every((track) => track.renderMode === "sourcePath" || track.renderMode === "targetPath");
}

export class LiquidCanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  #imageData: ImageData | null = null;
  #targetDistanceRaster: PreparedDistanceRaster | null = null;
  #trackTargetDistanceRasters = new Map<string, PreparedDistanceRaster>();
  #clipCoverage: { readonly key: string; readonly coverage: Float32Array } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("LiquidCanvasRenderer requires a 2D canvas context");
    this.canvas = canvas;
    this.context = context;
  }

  render(scene: LiquidScene, frame: LiquidFrameSample, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  render(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  render(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  render(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options: Omit<CanvasRenderOptions, "width" | "height"> = {}): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const viewportPadding = Math.max(0, options.viewportPadding ?? 0);
    const viewport = viewportFor(scene, width, height, viewportPadding);
    this.context.clearRect(0, 0, width, height);
    if (scene.schemaVersion === 2) {
      const frameV2 = framePaintedTracks(scene, frame as LiquidFrameSampleV2);
      const opacity = normalizedOpacity(options.opacity);
      if (frameUsesExactEndpoints(frameV2)) {
        this.beginTrackClip(scene, viewport);
        for (const track of frameV2.tracks) {
          const mode = track.renderMode;
          const placement = trackPlacement(track);
          const place = (commands: readonly PathCommand[]) => placement ? placePath(commands, placement) : commands;
          if (mode === "sourcePath" || mode === "crossfade") {
            const sourceCommands = place(transformPath(track.source.commands, track.source.transform));
            this.drawPath(sourceCommands, viewport, options.sourceStyle ?? options.fillStyle ?? "white", track.sourceOpacity * opacity, scene.fillRule);
          }
          if (mode === "targetPath" || mode === "crossfade") {
            const targetCommands = place(transformPath(track.target.commands, track.target.transform));
            this.drawPath(targetCommands, viewport, options.targetStyle ?? options.fillStyle ?? "white", track.targetOpacity * opacity, scene.fillRule);
          }
        }
        this.endTrackClip(scene);
        this.drawBackdrop(scene, viewport, options.fillStyle ?? "white", opacity);
        if (options.debug) this.drawDebug(scene, frameV2, viewport);
        return;
      }
      const targetDistanceRasters = this.trackTargetDistanceRasters(scene, frameV2, width, height, viewportPadding);
      const rasterOptions: RasterOptions = {
        width,
        height,
        viewportPadding,
        ...(options.opacity === undefined ? {} : { opacity: options.opacity }),
      };
      const mask = rasterizeFrameV2WithDistanceRasters(scene, frameV2, rasterOptions, targetDistanceRasters, false, this.clipCoverage(scene, width, height, viewportPadding));
      this.drawMask(mask, options.fillStyle ?? "white", width, height);
      this.drawBackdrop(scene, viewport, options.fillStyle ?? "white", normalizedOpacity(options.opacity));
      if (options.debug) this.drawDebug(scene, frameV2, viewport);
      return;
    }

    const frameV1 = frame as LiquidFrameSample;
    let sourceCommands: readonly PathCommand[] | null = null;
    let targetCommands: readonly PathCommand[] | null = null;
    const sourcePathCommands = (): readonly PathCommand[] => {
      sourceCommands ??= transformPath(scene.source.commands, scene.source.transform);
      return sourceCommands;
    };
    const targetPathCommands = (): readonly PathCommand[] => {
      targetCommands ??= transformPath(scene.target.commands, scene.target.transform);
      return targetCommands;
    };

    const opacity = normalizedOpacity(options.opacity);
    if (frameV1.renderMode === "sourcePath") {
      this.drawPath(sourcePathCommands(), viewport, options.fillStyle ?? "white", frameV1.sourceOpacity * opacity, scene.fillRule);
    } else if (frameV1.renderMode === "targetPath") {
      this.drawPath(targetPathCommands(), viewport, options.fillStyle ?? "white", frameV1.targetOpacity * opacity, scene.fillRule);
    } else if (frameV1.renderMode === "crossfade") {
      this.drawPath(sourcePathCommands(), viewport, options.sourceStyle ?? "white", frameV1.sourceOpacity * opacity, scene.fillRule);
      this.drawPath(targetPathCommands(), viewport, options.targetStyle ?? "white", frameV1.targetOpacity * opacity, scene.fillRule);
    } else {
      const targetDistanceRaster = frameV1.targetMix === 0 ? null : this.targetDistanceRaster(scene, width, height, viewportPadding);
      const mask = rasterizeFrameWithDistanceRaster(scene, frameV1, { width, height, opacity, viewportPadding }, targetDistanceRaster);
      this.drawMask(mask, options.fillStyle ?? "white", width, height);
    }

    if (options.debug) this.drawDebug(scene, frameV1, viewport);
  }

  private targetDistanceRaster(scene: LiquidScene, width: number, height: number, viewportPadding: number): PreparedDistanceRaster {
    const key = endpointCacheKey(scene, width, height, viewportPadding);
    if (this.#targetDistanceRaster?.key !== key) {
      this.#targetDistanceRaster = prepareTargetDistanceRaster(scene, width, height, viewportPadding);
    }
    return this.#targetDistanceRaster;
  }

  private trackTargetDistanceRasters(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, width: number, height: number, viewportPadding: number): ReadonlyMap<string, PreparedDistanceRaster> {
    const activeKeys = new Set<string>();
    for (const track of frame.tracks) {
      if (track.renderMode !== "field" || trackMaterialNumber(track, "targetMix", 0) === 0) continue;
      const key = trackTargetCacheKey(scene, track, width, height, viewportPadding);
      activeKeys.add(key);
      if (this.#trackTargetDistanceRasters.get(track.id)?.key !== key) {
        this.#trackTargetDistanceRasters.set(track.id, prepareTrackTargetDistanceRaster(scene, track, width, height, viewportPadding));
      }
    }
    for (const [trackId, raster] of this.#trackTargetDistanceRasters) {
      if (!activeKeys.has(raster.key)) this.#trackTargetDistanceRasters.delete(trackId);
    }
    return this.#trackTargetDistanceRasters;
  }

  private clipCoverage(scene: LiquidSceneV2, width: number, height: number, viewportPadding: number): Float32Array | null {
    if (!scene.clip) return null;
    const key = JSON.stringify({ clip: scene.clip, fillRule: scene.fillRule, coordinateSpace: scene.coordinateSpace, width, height, viewportPadding });
    if (this.#clipCoverage?.key !== key) this.#clipCoverage = { key, coverage: prepareClipCoverage(scene, width, height, viewportPadding)! };
    return this.#clipCoverage.coverage;
  }

  /** Restricts subsequent drawing to the scene's clip shape, if it has one. Pair with endTrackClip. */
  beginTrackClip(scene: LiquidSceneV2, viewport: ViewportTransform): void {
    if (!scene.clip) return;
    this.context.save();
    this.context.translate(viewport.offsetX, viewport.offsetY);
    this.context.scale(viewport.scale, viewport.scale);
    this.context.clip(path2dFor(transformPath(scene.clip.commands, scene.clip.transform)), scene.fillRule);
    this.context.scale(1 / viewport.scale, 1 / viewport.scale);
    this.context.translate(-viewport.offsetX, -viewport.offsetY);
  }

  endTrackClip(scene: LiquidSceneV2): void {
    if (scene.clip) this.context.restore();
  }

  /** Draws the scene's static backdrop shapes as exact vectors over whatever has been rendered. */
  drawBackdrop(scene: LiquidSceneV2, viewport: ViewportTransform, fillStyle: string, opacity: number): void {
    for (const shape of scene.backdrop ?? []) {
      this.drawPath(transformPath(shape.commands, shape.transform), viewport, fillStyle, opacity, scene.fillRule);
    }
  }

  drawPath(commands: readonly PathCommand[], viewport: ViewportTransform, fillStyle: string, opacity: number, fillRule: CanvasFillRule): void {
    this.context.save();
    this.context.translate(viewport.offsetX, viewport.offsetY);
    this.context.scale(viewport.scale, viewport.scale);
    this.context.globalAlpha = opacity;
    this.context.fillStyle = fillStyle;
    this.context.fill(path2dFor(commands), fillRule);
    this.context.restore();
  }

  private colorizeMask(fillStyle: string, width: number, height: number): void {
    this.context.save();
    this.context.globalCompositeOperation = "source-in";
    this.context.fillStyle = fillStyle;
    this.context.fillRect(0, 0, width, height);
    this.context.restore();
  }

  private drawMask(mask: RasterResult, fillStyle: string, width: number, height: number): void {
    if (!this.#imageData || this.#imageData.width !== width || this.#imageData.height !== height) {
      this.#imageData = this.context.createImageData(width, height);
    }
    for (let index = 0; index < mask.alpha.length; index += 1) {
      const offset = index * 4;
      this.#imageData.data[offset] = 255;
      this.#imageData.data[offset + 1] = 255;
      this.#imageData.data[offset + 2] = 255;
      this.#imageData.data[offset + 3] = mask.alpha[index] ?? 0;
    }
    this.context.putImageData(this.#imageData, 0, 0);
    this.colorizeMask(fillStyle, width, height);
  }

  drawDebug(scene: LiquidScene, frame: LiquidFrameSample, viewport: ViewportTransform): void;
  drawDebug(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, viewport: ViewportTransform): void;
  drawDebug(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, viewport: ViewportTransform): void {
    this.context.save();
    this.context.translate(viewport.offsetX, viewport.offsetY);
    this.context.scale(viewport.scale, viewport.scale);
    this.context.lineWidth = 1 / viewport.scale;
    this.context.strokeStyle = "rgba(125, 211, 252, 0.9)";
    this.context.fillStyle = "rgba(250, 204, 21, 0.95)";
    if (scene.schemaVersion === 1) {
      const frameV1 = frame as LiquidFrameSample;
      for (const capsule of [frameV1.leftLeg, frameV1.rightLeg, frameV1.crossbar, frameV1.bridge]) {
        if (capsule.radius <= 0) continue;
        this.drawDebugCapsule(capsule, viewport);
      }
      this.context.beginPath();
      this.context.arc(frameV1.anchor.x, frameV1.anchor.y, 2.5 / viewport.scale, 0, Math.PI * 2);
      this.context.fill();
    } else {
      for (const track of (frame as LiquidFrameSampleV2).tracks) {
        for (const component of track.components) this.drawDebugComponent(component, viewport);
      }
    }
    this.context.strokeStyle = "rgba(255, 255, 255, 0.2)";
    this.context.strokeRect(0, 0, scene.coordinateSpace.width, scene.coordinateSpace.height);
    this.context.restore();
  }

  private drawDebugCapsule(capsule: Capsule, viewport: ViewportTransform): void {
    if (capsule.radius <= 0) return;
    this.context.beginPath();
    this.context.moveTo(capsule.start.x, capsule.start.y);
    this.context.lineTo(capsule.end.x, capsule.end.y);
    this.context.stroke();
    this.context.beginPath();
    this.context.arc(capsule.start.x, capsule.start.y, Math.max(1.5 / viewport.scale, capsule.radius), 0, Math.PI * 2);
    this.context.stroke();
  }

  private drawDebugComponent(component: ComponentFrame, viewport: ViewportTransform): void {
    const primitive = component.primitive;
    if (primitive.kind === "capsule") {
      this.drawDebugCapsule(primitive, viewport);
    } else if (primitive.kind === "ribbon") {
      this.context.beginPath();
      this.context.moveTo(primitive.p0.x, primitive.p0.y);
      this.context.bezierCurveTo(primitive.p1.x, primitive.p1.y, primitive.p2.x, primitive.p2.y, primitive.p3.x, primitive.p3.y);
      this.context.stroke();
    } else {
      this.context.save();
      this.context.translate(primitive.center.x, primitive.center.y);
      this.context.rotate(primitive.rotation ?? 0);
      this.context.beginPath();
      this.context.ellipse(0, 0, primitive.radiusX, primitive.radiusY, 0, 0, Math.PI * 2);
      this.context.stroke();
      this.context.restore();
    }
  }

  destroy(): void {
    this.#imageData = null;
    this.#targetDistanceRaster = null;
    this.#trackTargetDistanceRasters.clear();
    this.#clipCoverage = null;
  }
}
