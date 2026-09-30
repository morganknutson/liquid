import { preparePath, signedDistanceToPath, signedDistanceToPreparedPath, transformPath, type PreparedPath } from "./path.js";
import type { Capsule, ComponentFrame, CubicRibbon, Ellipse, Endpoint, LiquidFrameSample, LiquidFrameSampleV2, LiquidScene, LiquidSceneV2, PathCommand, Point, Primitive, TrackFrame } from "./types.js";

export const RIBBON_SUBDIVISIONS = 32;

export interface PreparedRibbonSegment {
  readonly a: Point;
  readonly b: Point;
  readonly startT: number;
  readonly endT: number;
}

export interface PreparedRibbon {
  readonly kind: "ribbon";
  readonly segments: readonly PreparedRibbonSegment[];
  readonly startRadius: number;
  readonly endRadius: number;
}

export type PreparedPrimitive =
  | { readonly kind: "capsule"; readonly capsule: Capsule }
  | { readonly kind: "ribbon"; readonly ribbon: PreparedRibbon }
  | { readonly kind: "ellipse"; readonly ellipse: Ellipse };

export interface PrepareTrackFieldOptions {
  readonly cornerSharpness?: number;
  readonly includeTrackBlendFallback?: boolean;
}

export interface PreparedTrackComponent {
  readonly id: string;
  readonly kind: ComponentFrame["kind"];
  readonly operation: ComponentFrame["operation"];
  readonly groupId?: string;
  readonly primitive: PreparedPrimitive;
  readonly blendRadius: number;
}

export interface PreparedTrackField {
  readonly id: string;
  readonly components: readonly PreparedTrackComponent[];
}

export function capsuleDistance(point: Point, capsule: Capsule): number {
  const bax = capsule.end.x - capsule.start.x;
  const bay = capsule.end.y - capsule.start.y;
  const pax = point.x - capsule.start.x;
  const pay = point.y - capsule.start.y;
  const length = bax * bax + bay * bay;
  const h = length === 0 ? 0 : Math.min(1, Math.max(0, (pax * bax + pay * bay) / length));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  return Math.sqrt(dx * dx + dy * dy) - capsule.radius;
}

export function smoothUnion(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * h * k) / 6;
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

export function prepareRibbon(ribbon: CubicRibbon, subdivisions = RIBBON_SUBDIVISIONS): PreparedRibbon {
  const segments: PreparedRibbonSegment[] = [];
  let previous = ribbon.p0;
  for (let step = 1; step <= subdivisions; step += 1) {
    const startT = (step - 1) / subdivisions;
    const endT = step / subdivisions;
    const next = cubicPoint(ribbon.p0, ribbon.p1, ribbon.p2, ribbon.p3, endT);
    segments.push({ a: previous, b: next, startT, endT });
    previous = next;
  }
  return { kind: "ribbon", segments, startRadius: ribbon.startRadius, endRadius: ribbon.endRadius };
}

function segmentDistance(point: Point, a: Point, b: Point): readonly [number, number] {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = point.x - a.x;
  const wy = point.y - a.y;
  const length = vx * vx + vy * vy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / length));
  const x = a.x + vx * t;
  const y = a.y + vy * t;
  const dx = point.x - x;
  const dy = point.y - y;
  return [Math.sqrt(dx * dx + dy * dy), t];
}

export function preparedRibbonDistance(point: Point, ribbon: PreparedRibbon): number {
  let distance = Number.POSITIVE_INFINITY;
  const radiusDelta = ribbon.endRadius - ribbon.startRadius;
  for (const segment of ribbon.segments) {
    const [centerDistance, segmentT] = segmentDistance(point, segment.a, segment.b);
    const curveT = segment.startT + (segment.endT - segment.startT) * segmentT;
    const radius = ribbon.startRadius + radiusDelta * curveT;
    distance = Math.min(distance, centerDistance - radius);
  }
  return distance;
}

export function ribbonDistance(point: Point, ribbon: CubicRibbon, subdivisions = RIBBON_SUBDIVISIONS): number {
  return preparedRibbonDistance(point, prepareRibbon(ribbon, subdivisions));
}

export function ellipseDistance(point: Point, ellipse: Ellipse): number {
  const rotation = -(ellipse.rotation ?? 0);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - ellipse.center.x;
  const dy = point.y - ellipse.center.y;
  const x = Math.abs(dx * cos - dy * sin);
  const y = Math.abs(dx * sin + dy * cos);
  const minRadius = Math.min(ellipse.radiusX, ellipse.radiusY);
  if (ellipse.radiusX === 0 || ellipse.radiusY === 0) return Math.sqrt(dx * dx + dy * dy);
  const normalized = Math.sqrt((x / ellipse.radiusX) ** 2 + (y / ellipse.radiusY) ** 2);
  return (normalized - 1) * minRadius;
}

export function primitiveDistance(point: Point, primitive: Primitive): number {
  if (primitive.kind === "capsule") return capsuleDistance(point, primitive);
  if (primitive.kind === "ribbon") return ribbonDistance(point, primitive);
  return ellipseDistance(point, primitive);
}

export function preparePrimitive(primitive: Primitive): PreparedPrimitive {
  if (primitive.kind === "capsule") return { kind: "capsule", capsule: primitive };
  if (primitive.kind === "ribbon") return { kind: "ribbon", ribbon: prepareRibbon(primitive) };
  return { kind: "ellipse", ellipse: primitive };
}

export function preparedPrimitiveDistance(point: Point, primitive: PreparedPrimitive): number {
  if (primitive.kind === "capsule") return capsuleDistance(point, primitive.capsule);
  if (primitive.kind === "ribbon") return preparedRibbonDistance(point, primitive.ribbon);
  return ellipseDistance(point, primitive.ellipse);
}

function finiteMaterialNumber(values: Readonly<Record<string, unknown>> | undefined, key: string): number | null {
  const value = values?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolvedBlendRadius(component: ComponentFrame, track: TrackFrame, options: PrepareTrackFieldOptions): number {
  const raw = finiteMaterialNumber(component.material, "blendRadius")
    ?? (component.groupId ? finiteMaterialNumber(track.material.groups[component.groupId], "blendRadius") : null)
    ?? (options.includeTrackBlendFallback ? finiteMaterialNumber(track.material.groups.$track, "blendRadius") : null)
    ?? 0;
  const cornerSharpness = Math.min(1, Math.max(0, options.cornerSharpness ?? 0));
  return Math.max(0, raw * (1 - cornerSharpness));
}

export function componentDistance(point: Point, component: ComponentFrame): number {
  return primitiveDistance(point, component.primitive);
}

export function prepareTrackField(track: TrackFrame, options: PrepareTrackFieldOptions = {}): PreparedTrackField {
  return {
    id: track.id,
    components: track.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      operation: component.operation,
      ...(component.groupId === undefined ? {} : { groupId: component.groupId }),
      primitive: preparePrimitive(component.primitive),
      blendRadius: resolvedBlendRadius(component, track, options),
    })),
  };
}

export function preparedTrackFieldDistance(point: Point, track: PreparedTrackField): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const component of track.components) {
    const next = preparedPrimitiveDistance(point, component.primitive);
    if (distance === Number.POSITIVE_INFINITY) {
      distance = component.operation === "subtract" ? -next : next;
      continue;
    }
    if (component.operation === "subtract") {
      distance = Math.max(distance, -next);
    } else {
      distance = smoothUnion(distance, next, component.blendRadius);
    }
  }
  return distance;
}

export function trackFieldDistance(point: Point, track: TrackFrame): number {
  return preparedTrackFieldDistance(point, prepareTrackField(track));
}

export function proceduralDistance(point: Point, frame: LiquidFrameSample): number {
  const blendRadius = frame.blendRadius * (1 - frame.cornerSharpness);
  let distance = Number.POSITIVE_INFINITY;
  if (frame.leftLeg.radius > 0) distance = capsuleDistance(point, frame.leftLeg);
  if (frame.rightLeg.radius > 0) {
    const next = capsuleDistance(point, frame.rightLeg);
    distance = distance === Number.POSITIVE_INFINITY ? next : smoothUnion(distance, next, blendRadius);
  }
  if (frame.crossbar.radius > 0) {
    const next = capsuleDistance(point, frame.crossbar);
    distance = distance === Number.POSITIVE_INFINITY ? next : smoothUnion(distance, next, blendRadius);
  }
  if (frame.bridge.radius > 0) {
    const next = capsuleDistance(point, frame.bridge);
    distance = distance === Number.POSITIVE_INFINITY ? next : smoothUnion(distance, next, blendRadius);
  }
  return distance;
}

export function targetDistance(point: Point, scene: LiquidScene): number {
  return signedDistanceToPath(point, transformPath(scene.target.commands, scene.target.transform), scene.fillRule);
}

export function fieldDistanceWithTargetPath(point: Point, scene: LiquidScene, frame: LiquidFrameSample, targetPath: PreparedPath): number {
  if (frame.targetMix === 0) return proceduralDistance(point, frame);
  if (frame.targetMix === 1) return signedDistanceToPreparedPath(point, targetPath, scene.fillRule);
  const procedural = proceduralDistance(point, frame);
  const target = signedDistanceToPreparedPath(point, targetPath, scene.fillRule);
  return procedural * (1 - frame.targetMix) + target * frame.targetMix;
}

export function prepareSceneTargetPath(scene: LiquidScene): PreparedPath {
  return preparePath(transformPath(scene.target.commands, scene.target.transform));
}

export function fieldDistance(point: Point, scene: LiquidScene, frame: LiquidFrameSample): number {
  return fieldDistanceWithTargetPath(point, scene, frame, prepareSceneTargetPath(scene));
}

/**
 * A rigid move and uniform scale applied to a whole track when it is drawn,
 * read from the numeric `$track` materials `offsetX`, `offsetY`, `scale`,
 * `originX`, and `originY` (defaults 0, 0, 1, 0, 0). The track's shapes,
 * including its exact endpoints, are scaled about the origin and then moved by
 * the offset. Returns null when the track is drawn in place.
 */
export interface TrackPlacement {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
}

export function trackPlacement(track: TrackFrame): TrackPlacement | null {
  const values = track.material.groups.$track;
  const number = (key: string, fallback: number) => finiteMaterialNumber(values, key) ?? fallback;
  const placement = {
    offsetX: number("offsetX", 0),
    offsetY: number("offsetY", 0),
    scale: Math.max(0.000001, number("scale", 1)),
    originX: number("originX", 0),
    originY: number("originY", 0),
  };
  return placement.offsetX === 0 && placement.offsetY === 0 && placement.scale === 1 ? null : placement;
}

/** The point in the track's own space that lands on scene point `point` once placed. */
export function unplacePoint(point: Point, placement: TrackPlacement, into: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  into.x = placement.originX + (point.x - placement.originX - placement.offsetX) / placement.scale;
  into.y = placement.originY + (point.y - placement.originY - placement.offsetY) / placement.scale;
  return into;
}

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

// Bounds of a path's points, including curve control points (so they contain the curve).
function commandBounds(commands: readonly PathCommand[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const command of commands) {
    if (command.type === "Z") continue;
    for (let index = 0; index + 1 < command.values.length; index += 2) {
      const x = command.values[index]!;
      const y = command.values[index + 1]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

const clipBoundsCache = new WeakMap<Endpoint, Bounds | null>();

function endpointBounds(endpoint: Endpoint): Bounds | null {
  return commandBounds(transformPath(endpoint.commands, endpoint.transform));
}

/**
 * True when the track shows an exact endpoint that lies entirely outside the
 * scene's clip, so it paints nothing this frame (for example a shape waiting
 * above a frame, or one that has dropped out of it). Renderers can skip it.
 */
export function trackIsClippedAway(scene: LiquidSceneV2, track: TrackFrame): boolean {
  if (!scene.clip || (track.renderMode !== "sourcePath" && track.renderMode !== "targetPath")) return false;
  let clip = clipBoundsCache.get(scene.clip);
  if (clip === undefined) {
    clip = endpointBounds(scene.clip);
    clipBoundsCache.set(scene.clip, clip);
  }
  const endpoint = endpointBounds(track.renderMode === "sourcePath" ? track.source : track.target);
  if (!clip || !endpoint) return false;
  const placement = trackPlacement(track);
  const place = (value: number, origin: number, offset: number) => placement ? origin + (value - origin) * placement.scale + offset : value;
  const minX = place(endpoint.minX, placement?.originX ?? 0, placement?.offsetX ?? 0);
  const maxX = place(endpoint.maxX, placement?.originX ?? 0, placement?.offsetX ?? 0);
  const minY = place(endpoint.minY, placement?.originY ?? 0, placement?.offsetY ?? 0);
  const maxY = place(endpoint.maxY, placement?.originY ?? 0, placement?.offsetY ?? 0);
  return maxX < clip.minX || minX > clip.maxX || maxY < clip.minY || minY > clip.maxY;
}

/** The frame without tracks that are clipped away entirely (see `trackIsClippedAway`). */
export function framePaintedTracks(scene: LiquidSceneV2, frame: LiquidFrameSampleV2): LiquidFrameSampleV2 {
  const tracks = frame.tracks.filter((track) => !trackIsClippedAway(scene, track));
  return tracks.length === frame.tracks.length ? frame : { ...frame, tracks };
}
