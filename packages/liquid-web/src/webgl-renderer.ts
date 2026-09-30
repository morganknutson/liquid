import {
  signedDistanceRasterSteps,
  trackPlacement,
  transformPath,
  preparePath,
  type AnyLiquidFrameSample,
  type AnyLiquidScene,
  type ComponentFrame,
  type LiquidFrameSample,
  type LiquidFrameSampleV2,
  type LiquidScene,
  type LiquidSceneV2,
  type PreparedPath,
  type TrackFrame,
} from "@liquid/core";
import {
  LiquidCanvasRenderer,
  viewportFor,
  type CanvasRenderOptions,
  type ViewportTransform,
} from "./renderer.js";

export type LiquidRendererBackend = "cpu" | "webgl2";
export type LiquidRendererBackendPreference = "auto" | LiquidRendererBackend;

export interface LiquidWebGLCapabilities {
  readonly backend: "webgl2";
  readonly supported: boolean;
  readonly reason?: string;
  readonly maxTracks: number;
  readonly maxComponents: number;
  readonly ribbonSubdivisions: number;
  readonly maxTextureSize: number;
}

interface EndpointPath {
  readonly commands: ReturnType<typeof transformPath>;
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

interface GpuProgram {
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  readonly position: WebGLBuffer;
  readonly uniforms: {
    readonly resolution: WebGLUniformLocation;
    readonly viewport: WebGLUniformLocation;
    readonly opacity: WebGLUniformLocation;
    readonly trackCount: WebGLUniformLocation;
    readonly componentCount: WebGLUniformLocation;
    readonly trackModes: WebGLUniformLocation;
    readonly trackComponentRange: WebGLUniformLocation;
    readonly trackSourceOpacity: WebGLUniformLocation;
    readonly trackTargetOpacity: WebGLUniformLocation;
    readonly trackTargetMix: WebGLUniformLocation;
    readonly trackFieldOpacity: WebGLUniformLocation;
    readonly trackPlacement: WebGLUniformLocation;
    readonly trackOrigin: WebGLUniformLocation;
    readonly componentMeta: WebGLUniformLocation;
    readonly componentA: WebGLUniformLocation;
    readonly componentB: WebGLUniformLocation;
    readonly componentC: WebGLUniformLocation;
    readonly sourceDistances: WebGLUniformLocation;
    readonly targetDistances: WebGLUniformLocation;
  };
}

const MAX_TRACKS = 8;
const MAX_COMPONENTS = 48;
const RIBBON_SUBDIVISIONS = 32;

const vertexShaderSource = `#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `#version 300 es
precision highp float;
precision highp sampler2DArray;

const int MAX_TRACKS = ${MAX_TRACKS};
const int MAX_COMPONENTS = ${MAX_COMPONENTS};
const int RIBBON_SUBDIVISIONS = ${RIBBON_SUBDIVISIONS};

uniform vec2 u_resolution;
uniform vec4 u_viewport;
uniform float u_opacity;
uniform int u_trackCount;
uniform int u_componentCount;
uniform int u_trackModes[MAX_TRACKS];
uniform ivec2 u_trackComponentRange[MAX_TRACKS];
uniform float u_trackSourceOpacity[MAX_TRACKS];
uniform float u_trackTargetOpacity[MAX_TRACKS];
uniform float u_trackTargetMix[MAX_TRACKS];
uniform float u_trackFieldOpacity[MAX_TRACKS];
uniform vec4 u_trackPlacement[MAX_TRACKS];
uniform vec2 u_trackOrigin[MAX_TRACKS];
uniform vec4 u_componentMeta[MAX_COMPONENTS];
uniform vec4 u_componentA[MAX_COMPONENTS];
uniform vec4 u_componentB[MAX_COMPONENTS];
uniform vec4 u_componentC[MAX_COMPONENTS];
uniform sampler2DArray u_sourceDistances;
uniform sampler2DArray u_targetDistances;

out vec4 outColor;

float coverageForDistance(float distance, float scale) {
  return clamp(0.5 - distance * scale, 0.0, 1.0);
}

float sourceOver(float bottom, float top) {
  return top + bottom * (1.0 - top);
}

float smoothUnion(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - (h * h * h * k) / 6.0;
}

float sdCapsule(vec2 point, vec2 a, vec2 b, float radius) {
  vec2 ba = b - a;
  vec2 pa = point - a;
  float lengthSq = dot(ba, ba);
  float h = lengthSq == 0.0 ? 0.0 : clamp(dot(pa, ba) / lengthSq, 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

vec2 cubicPoint(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  float mt = 1.0 - t;
  return mt * mt * mt * p0 + 3.0 * mt * mt * t * p1 + 3.0 * mt * t * t * p2 + t * t * t * p3;
}

float sdRibbon(vec2 point, vec2 p0, vec2 p1, vec2 p2, vec2 p3, float startRadius, float endRadius) {
  float distance = 1.0e20;
  vec2 previous = p0;
  for (int step = 1; step <= RIBBON_SUBDIVISIONS; step++) {
    float startT = float(step - 1) / float(RIBBON_SUBDIVISIONS);
    float endT = float(step) / float(RIBBON_SUBDIVISIONS);
    vec2 next = cubicPoint(p0, p1, p2, p3, endT);
    vec2 segment = next - previous;
    float lengthSq = dot(segment, segment);
    float h = lengthSq == 0.0 ? 0.0 : clamp(dot(point - previous, segment) / lengthSq, 0.0, 1.0);
    float curveT = mix(startT, endT, h);
    float radius = mix(startRadius, endRadius, curveT);
    distance = min(distance, length(point - (previous + segment * h)) - radius);
    previous = next;
  }
  return distance;
}

float sdEllipse(vec2 point, vec2 center, float radiusX, float radiusY, float rotation) {
  vec2 delta = point - center;
  float c = cos(-rotation);
  float s = sin(-rotation);
  vec2 local = abs(vec2(delta.x * c - delta.y * s, delta.x * s + delta.y * c));
  if (radiusX == 0.0 || radiusY == 0.0) return length(delta);
  float normalized = sqrt((local.x / radiusX) * (local.x / radiusX) + (local.y / radiusY) * (local.y / radiusY));
  return (normalized - 1.0) * min(radiusX, radiusY);
}

float componentDistance(int index, vec2 point) {
  vec4 meta = u_componentMeta[index];
  vec4 a = u_componentA[index];
  vec4 b = u_componentB[index];
  vec4 c = u_componentC[index];
  int kind = int(meta.y + 0.5);
  if (kind == 0) return sdCapsule(point, a.xy, a.zw, c.x);
  if (kind == 1) return sdEllipse(point, a.xy, a.z, a.w, b.x);
  return sdRibbon(point, a.xy, a.zw, b.xy, b.zw, c.x, c.y);
}

float fieldDistanceForTrack(int trackIndex, vec2 point) {
  float distance = 1.0e20;
  ivec2 componentRange = u_trackComponentRange[trackIndex];
  for (int offset = 0; offset < MAX_COMPONENTS; offset++) {
    int index = componentRange.x + offset;
    if (index >= componentRange.y || index >= u_componentCount) break;
    vec4 meta = u_componentMeta[index];
    float next = componentDistance(index, point);
    bool subtract = int(meta.z + 0.5) == 1;
    if (distance == 1.0e20) {
      distance = subtract ? -next : next;
    } else if (subtract) {
      distance = max(distance, -next);
    } else {
      distance = smoothUnion(distance, next, meta.w);
    }
  }
  return distance;
}

float endpointDistance(sampler2DArray distances, ivec2 pixel, int trackIndex) {
  return texelFetch(distances, ivec3(pixel, trackIndex), 0).r;
}

// Bilinear lookup at a scene point, for placed tracks whose samples fall
// between the raster's pixel centers.
float endpointDistanceAt(sampler2DArray distances, vec2 point, int trackIndex) {
  vec2 maxPixel = u_resolution - 1.0;
  vec2 f = clamp(point * u_viewport.x + u_viewport.yz - 0.5, vec2(0.0), maxPixel);
  ivec2 p0 = ivec2(floor(f));
  ivec2 p1 = min(p0 + 1, ivec2(maxPixel));
  vec2 t = f - vec2(p0);
  float a = texelFetch(distances, ivec3(p0.x, p0.y, trackIndex), 0).r;
  float b = texelFetch(distances, ivec3(p1.x, p0.y, trackIndex), 0).r;
  float c = texelFetch(distances, ivec3(p0.x, p1.y, trackIndex), 0).r;
  float d = texelFetch(distances, ivec3(p1.x, p1.y, trackIndex), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

void main() {
  float deviceY = u_resolution.y - gl_FragCoord.y;
  vec2 scenePoint = vec2(
    (gl_FragCoord.x - u_viewport.y) / u_viewport.x,
    (deviceY - u_viewport.z) / u_viewport.x
  );
  ivec2 pixel = ivec2(int(floor(gl_FragCoord.x)), int(floor(deviceY)));
  float alpha = 0.0;

  for (int trackIndex = 0; trackIndex < MAX_TRACKS; trackIndex++) {
    if (trackIndex >= u_trackCount) break;
    int mode = u_trackModes[trackIndex];
    vec4 placement = u_trackPlacement[trackIndex];
    bool placed = placement.w > 0.5;
    vec2 origin = u_trackOrigin[trackIndex];
    vec2 point = placed ? origin + (scenePoint - origin - placement.xy) / placement.z : scenePoint;
    float distanceScale = placed ? placement.z : 1.0;
    float sourceDistance = placed ? endpointDistanceAt(u_sourceDistances, point, trackIndex) : endpointDistance(u_sourceDistances, pixel, trackIndex);
    float trackAlpha = 0.0;
    if (mode == 0) {
      trackAlpha = coverageForDistance(sourceDistance * distanceScale, u_viewport.x) * u_trackSourceOpacity[trackIndex] * u_opacity;
    } else if (mode == 2) {
      float targetDistance = placed ? endpointDistanceAt(u_targetDistances, point, trackIndex) : endpointDistance(u_targetDistances, pixel, trackIndex);
      trackAlpha = coverageForDistance(targetDistance * distanceScale, u_viewport.x) * u_trackTargetOpacity[trackIndex] * u_opacity;
    } else if (mode == 3) {
      float targetDistance = placed ? endpointDistanceAt(u_targetDistances, point, trackIndex) : endpointDistance(u_targetDistances, pixel, trackIndex);
      float sourceCoverage = coverageForDistance(sourceDistance * distanceScale, u_viewport.x) * u_trackSourceOpacity[trackIndex];
      float targetCoverage = coverageForDistance(targetDistance * distanceScale, u_viewport.x) * u_trackTargetOpacity[trackIndex];
      trackAlpha = min(1.0, sourceCoverage + targetCoverage) * u_opacity;
    } else {
      float procedural = fieldDistanceForTrack(trackIndex, point);
      float targetMix = u_trackTargetMix[trackIndex];
      float distance = targetMix == 0.0
        ? procedural
        : mix(procedural, placed ? endpointDistanceAt(u_targetDistances, point, trackIndex) : endpointDistance(u_targetDistances, pixel, trackIndex), targetMix);
      trackAlpha = coverageForDistance(distance * distanceScale, u_viewport.x) * u_trackFieldOpacity[trackIndex] * u_opacity;
    }
    alpha = sourceOver(alpha, trackAlpha);
  }

  outColor = vec4(1.0, 1.0, 1.0, clamp(alpha, 0.0, 1.0));
}
`;

function normalizedOpacity(opacity: number | undefined): number {
  return Math.min(1, Math.max(0, opacity ?? 1));
}

function materialNumber(values: Readonly<Record<string, unknown>> | undefined, key: string): number | null {
  const value = values?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trackMaterialNumber(track: TrackFrame, key: string, fallback: number): number {
  return materialNumber(track.material.groups.$track, key) ?? fallback;
}

function componentBlendRadius(component: ComponentFrame, track: TrackFrame, cornerSharpness: number): number {
  const raw = materialNumber(component.material, "blendRadius")
    ?? (component.groupId ? materialNumber(track.material.groups[component.groupId], "blendRadius") : null)
    ?? materialNumber(track.material.groups.$track, "blendRadius")
    ?? 0;
  return Math.max(0, raw * (1 - cornerSharpness));
}

function endpointPath(track: TrackFrame, endpoint: "source" | "target"): EndpointPath {
  const source = endpoint === "source" ? track.source : track.target;
  const commands = transformPath(source.commands, source.transform);
  return { commands, prepared: preparePath(commands) };
}

function trackEndpointCacheKey(scene: LiquidSceneV2, track: TrackFrame, endpoint: "source" | "target", width: number, height: number, viewportPadding: number): string {
  const source = endpoint === "source" ? track.source : track.target;
  return JSON.stringify({
    sceneId: scene.id,
    fixtureVersion: scene.fixtureVersion,
    trackId: track.id,
    endpoint,
    width,
    height,
    viewportPadding,
    coordinateSpace: scene.coordinateSpace,
    fillRule: scene.fillRule,
    source,
  });
}

// Whether any part of an endpoint path lands on the raster. Shapes entirely off
// the raster (such as a shape waiting off-stage) contribute zero coverage.
function endpointVisible(scene: LiquidSceneV2, track: TrackFrame, endpoint: "source" | "target", width: number, height: number, viewportPadding: number): boolean {
  const viewport = viewportFor(scene, width, height, viewportPadding);
  const margin = 2 / viewport.scale;
  const minX = (-viewport.offsetX) / viewport.scale - margin;
  const minY = (-viewport.offsetY) / viewport.scale - margin;
  const maxX = (width - viewport.offsetX) / viewport.scale + margin;
  const maxY = (height - viewport.offsetY) / viewport.scale + margin;
  return endpointPath(track, endpoint).prepared.segments.some(({ a, b }) =>
    Math.max(a.x, b.x) >= minX && Math.min(a.x, b.x) <= maxX && Math.max(a.y, b.y) >= minY && Math.min(a.y, b.y) <= maxY);
}

function* endpointDistanceRasterSteps(scene: LiquidSceneV2, track: TrackFrame, endpoint: "source" | "target", width: number, height: number, viewportPadding: number): Generator<void, Float32Array, void> {
  const viewport = viewportFor(scene, width, height, viewportPadding);
  return yield* signedDistanceRasterSteps(endpointPath(track, endpoint).prepared, scene.fillRule, { width, height, ...viewport });
}

function trackTargetMix(track: TrackFrame): number {
  return Math.min(1, Math.max(0, trackMaterialNumber(track, "targetMix", 0)));
}

function endpointNeeded(track: TrackFrame, endpoint: "source" | "target"): boolean {
  if (track.renderMode === "crossfade") return true;
  if (endpoint === "source") return track.renderMode === "sourcePath";
  return track.renderMode === "targetPath" || (track.renderMode === "field" && trackTargetMix(track) > 0);
}

interface PendingLayerUpload {
  readonly raster: PreparedDistanceRaster;
  readonly layer: number;
  nextRow: number;
}

interface EndpointTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
  readonly layerKeys: string[];
}

// Rasters the scene will need soon are warmed with whatever is left of this
// per-frame target after the frame itself renders (at least the minimum), so
// cheap frames such as the drop-in and the beat do most of the work.
const RASTER_WARM_FRAME_TARGET_MS = 8;
const RASTER_WARM_MIN_MS = 2;

function renderModeValue(mode: TrackFrame["renderMode"]): number {
  if (mode === "sourcePath") return 0;
  if (mode === "field") return 1;
  if (mode === "targetPath") return 2;
  return 3;
}

function componentKindValue(kind: ComponentFrame["kind"]): number {
  if (kind === "capsule") return 0;
  if (kind === "ellipse") return 1;
  return 2;
}

function operationValue(operation: ComponentFrame["operation"]): number {
  return operation === "subtract" ? 1 : 0;
}

function sharedTrackRenderMode(frame: LiquidFrameSampleV2): TrackFrame["renderMode"] | null {
  const [first, ...rest] = frame.tracks;
  if (!first) return null;
  return rest.every((track) => track.renderMode === first.renderMode) ? first.renderMode : null;
}

function frameComponentCount(frame: LiquidFrameSampleV2): number {
  let count = 0;
  for (const track of frame.tracks) count += track.components.length;
  return count;
}

function canUseExact2DEndpoint(frame: LiquidFrameSampleV2): boolean {
  const mode = sharedTrackRenderMode(frame);
  return mode === "sourcePath" || mode === "targetPath" || mode === "crossfade";
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "unknown shader compile failure";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): GpuProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "unknown WebGL program link failure";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  const vao = gl.createVertexArray();
  const position = gl.createBuffer();
  if (!vao || !position) throw new Error("Unable to create WebGL geometry buffers");
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, position);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    program,
    vao,
    position,
    uniforms: {
      resolution: requiredUniform(gl, program, "u_resolution"),
      viewport: requiredUniform(gl, program, "u_viewport"),
      opacity: requiredUniform(gl, program, "u_opacity"),
      trackCount: requiredUniform(gl, program, "u_trackCount"),
      componentCount: requiredUniform(gl, program, "u_componentCount"),
      trackModes: requiredUniform(gl, program, "u_trackModes"),
      trackComponentRange: requiredUniform(gl, program, "u_trackComponentRange"),
      trackSourceOpacity: requiredUniform(gl, program, "u_trackSourceOpacity"),
      trackTargetOpacity: requiredUniform(gl, program, "u_trackTargetOpacity"),
      trackTargetMix: requiredUniform(gl, program, "u_trackTargetMix"),
      trackFieldOpacity: requiredUniform(gl, program, "u_trackFieldOpacity"),
      trackPlacement: requiredUniform(gl, program, "u_trackPlacement"),
      trackOrigin: requiredUniform(gl, program, "u_trackOrigin"),
      componentMeta: requiredUniform(gl, program, "u_componentMeta"),
      componentA: requiredUniform(gl, program, "u_componentA"),
      componentB: requiredUniform(gl, program, "u_componentB"),
      componentC: requiredUniform(gl, program, "u_componentC"),
      sourceDistances: requiredUniform(gl, program, "u_sourceDistances"),
      targetDistances: requiredUniform(gl, program, "u_targetDistances"),
    },
  };
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Missing WebGL uniform ${name}`);
  return location;
}

function createInternalCanvas(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
  const scope = globalThis as typeof globalThis & { OffscreenCanvas?: typeof OffscreenCanvas };
  if (typeof scope.OffscreenCanvas === "function") return new scope.OffscreenCanvas(width, height);
  const document = canvas.ownerDocument ?? globalThis.document;
  if (!document) return null;
  const internal = document.createElement("canvas");
  internal.width = width;
  internal.height = height;
  return internal;
}

function detectCapabilitiesForContext(gl: WebGL2RenderingContext | null): LiquidWebGLCapabilities {
  if (!gl || typeof gl.getParameter !== "function") {
    return {
      backend: "webgl2",
      supported: false,
      reason: "WebGL2 is unavailable",
      maxTracks: MAX_TRACKS,
      maxComponents: MAX_COMPONENTS,
      ribbonSubdivisions: RIBBON_SUBDIVISIONS,
      maxTextureSize: 0,
    };
  }
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxArrayLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  if (maxArrayLayers < MAX_TRACKS * 2) {
    return {
      backend: "webgl2",
      supported: false,
      reason: `WebGL2 texture arrays expose ${maxArrayLayers} layers; ${MAX_TRACKS * 2} are required`,
      maxTracks: MAX_TRACKS,
      maxComponents: MAX_COMPONENTS,
      ribbonSubdivisions: RIBBON_SUBDIVISIONS,
      maxTextureSize,
    };
  }
  return {
    backend: "webgl2",
    supported: true,
    maxTracks: MAX_TRACKS,
    maxComponents: MAX_COMPONENTS,
    ribbonSubdivisions: RIBBON_SUBDIVISIONS,
    maxTextureSize,
  };
}

export class LiquidWebGLRenderer extends LiquidCanvasRenderer {
  readonly capabilities: LiquidWebGLCapabilities;

  #internalCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  #gl: WebGL2RenderingContext | null = null;
  #program: GpuProgram | null = null;
  #sourceTexture: EndpointTexture | null = null;
  #targetTexture: EndpointTexture | null = null;
  #sourceDistanceRasters = new Map<string, PreparedDistanceRaster>();
  #targetDistanceRasters = new Map<string, PreparedDistanceRaster>();
  #rasterTasks = new Map<string, Generator<void, Float32Array, void>>();
  #endpointVisibility = new Map<string, boolean>();
  #pendingUploads: PendingLayerUpload[] = [];

  static readonly maxTracks = MAX_TRACKS;
  static readonly maxComponents = MAX_COMPONENTS;
  static readonly ribbonSubdivisions = RIBBON_SUBDIVISIONS;

  static detectCapabilities(canvas?: HTMLCanvasElement): LiquidWebGLCapabilities {
    const internal = canvas
      ? createInternalCanvas(canvas, 1, 1)
      : typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(1, 1)
        : globalThis.document?.createElement("canvas") ?? null;
    const gl = internal?.getContext("webgl2", { alpha: true, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    const capabilities = detectCapabilitiesForContext(gl);
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
    return capabilities;
  }

  static supportsScene(scene: LiquidSceneV2): boolean {
    if (scene.tracks.length > MAX_TRACKS) return false;
    let components = 0;
    for (const track of scene.tracks) components += track.components.length;
    return components <= MAX_COMPONENTS;
  }

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    this.#internalCanvas = createInternalCanvas(canvas, Math.max(1, canvas.width || 1), Math.max(1, canvas.height || 1));
    this.#gl = this.#internalCanvas?.getContext("webgl2", { alpha: true, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    this.capabilities = detectCapabilitiesForContext(this.#gl);
    if (this.#gl && this.capabilities.supported) {
      try {
        this.#program = createProgram(this.#gl);
      } catch (error) {
        this.capabilities = {
          ...this.capabilities,
          supported: false,
          reason: error instanceof Error ? error.message : "WebGL2 initialization failed",
        };
      }
    }
  }

  override render(scene: LiquidScene, frame: LiquidFrameSample, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  override render(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  override render(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options?: Omit<CanvasRenderOptions, "width" | "height">): void;
  override render(scene: AnyLiquidScene, frame: AnyLiquidFrameSample, options: Omit<CanvasRenderOptions, "width" | "height"> = {}): void {
    if (scene.schemaVersion !== 2) {
      super.render(scene as LiquidScene, frame as LiquidFrameSample, options);
      return;
    }
    const frameV2 = frame as LiquidFrameSampleV2;
    if (!this.capabilities.supported || !this.#gl || !this.#program || !LiquidWebGLRenderer.supportsScene(scene) || frameComponentCount(frameV2) > MAX_COMPONENTS || canUseExact2DEndpoint(frameV2)) {
      super.render(scene, frameV2, options);
      return;
    }

    this.renderFrame(scene, frameV2, options);
  }

  flush(): void {
    this.#gl?.finish();
  }

  override destroy(): void {
    super.destroy();
    const gl = this.#gl;
    if (gl) {
      if (this.#sourceTexture) gl.deleteTexture(this.#sourceTexture.texture);
      if (this.#targetTexture) gl.deleteTexture(this.#targetTexture.texture);
      if (this.#program) {
        gl.deleteBuffer(this.#program.position);
        gl.deleteVertexArray(this.#program.vao);
        gl.deleteProgram(this.#program.program);
      }
    }
    this.#sourceTexture = null;
    this.#targetTexture = null;
    this.#program = null;
    this.#gl = null;
    this.#internalCanvas = null;
    this.#sourceDistanceRasters.clear();
    this.#targetDistanceRasters.clear();
    this.#rasterTasks.clear();
    this.#endpointVisibility.clear();
    this.#pendingUploads = [];
  }

  private renderFrame(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, options: Omit<CanvasRenderOptions, "width" | "height">): void {
    const gl = this.#gl;
    const gpu = this.#program;
    const internalCanvas = this.#internalCanvas;
    if (!gl || !gpu || !internalCanvas) return;

    const frameStart = performance.now();
    const width = Math.max(1, this.canvas.width || 1);
    const height = Math.max(1, this.canvas.height || 1);
    if (internalCanvas.width !== width) internalCanvas.width = width;
    if (internalCanvas.height !== height) internalCanvas.height = height;

    const viewportPadding = Math.max(0, options.viewportPadding ?? 0);
    const viewport = viewportFor(scene, width, height, viewportPadding);
    this.uploadEndpointTextures(scene, frame, width, height, viewportPadding);
    this.uploadUniforms(scene, frame, viewport, gpu, normalizedOpacity(options.opacity), width, height, viewportPadding);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    this.context.clearRect(0, 0, width, height);
    this.beginTrackClip(scene, viewport);
    this.context.drawImage(internalCanvas, 0, 0, width, height);
    this.endTrackClip(scene);
    this.colorizeGpuMask(options.fillStyle ?? "white", width, height);
    this.drawBackdrop(scene, viewport, options.fillStyle ?? "white", normalizedOpacity(options.opacity));
    this.warmTargetRasters(scene, frame, width, height, viewportPadding, Math.max(performance.now() + RASTER_WARM_MIN_MS, frameStart + RASTER_WARM_FRAME_TARGET_MS));
    if (options.debug) this.drawDebug(scene, frame, viewport);
  }

  private colorizeGpuMask(fillStyle: string, width: number, height: number): void {
    this.context.save();
    this.context.globalCompositeOperation = "source-in";
    this.context.fillStyle = fillStyle;
    this.context.fillRect(0, 0, width, height);
    this.context.restore();
  }

  private uploadUniforms(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, viewport: ViewportTransform, gpu: GpuProgram, opacity: number, width: number, height: number, viewportPadding: number): void {
    const gl = this.#gl;
    if (!gl) return;
    const trackModes = new Int32Array(MAX_TRACKS);
    const trackComponentRange = new Int32Array(MAX_TRACKS * 2);
    const sourceOpacity = new Float32Array(MAX_TRACKS);
    const targetOpacity = new Float32Array(MAX_TRACKS);
    const targetMix = new Float32Array(MAX_TRACKS);
    const fieldOpacity = new Float32Array(MAX_TRACKS);
    const placements = new Float32Array(MAX_TRACKS * 4);
    const origins = new Float32Array(MAX_TRACKS * 2);
    const componentMeta = new Float32Array(MAX_COMPONENTS * 4);
    const componentA = new Float32Array(MAX_COMPONENTS * 4);
    const componentB = new Float32Array(MAX_COMPONENTS * 4);
    const componentC = new Float32Array(MAX_COMPONENTS * 4);

    let componentIndex = 0;
    frame.tracks.forEach((track, trackIndex) => {
      const rangeOffset = trackIndex * 2;
      trackComponentRange[rangeOffset] = componentIndex;
      trackModes[trackIndex] = renderModeValue(track.renderMode);
      sourceOpacity[trackIndex] = this.isEndpointVisible(scene, track, "source", width, height, viewportPadding) ? track.sourceOpacity : 0;
      targetOpacity[trackIndex] = this.isEndpointVisible(scene, track, "target", width, height, viewportPadding) ? track.targetOpacity : 0;
      targetMix[trackIndex] = Math.min(1, Math.max(0, trackMaterialNumber(track, "targetMix", 0)));
      fieldOpacity[trackIndex] = Math.min(1, Math.max(0, trackMaterialNumber(track, "opacity", 1)));
      const placement = trackPlacement(track);
      if (placement) {
        placements.set([placement.offsetX, placement.offsetY, placement.scale, 1], trackIndex * 4);
        origins.set([placement.originX, placement.originY], trackIndex * 2);
      }
      const cornerSharpness = Math.min(1, Math.max(0, trackMaterialNumber(track, "cornerSharpness", 0)));
      for (const component of track.components) {
        const offset = componentIndex * 4;
        componentMeta[offset] = trackIndex;
        componentMeta[offset + 1] = componentKindValue(component.kind);
        componentMeta[offset + 2] = operationValue(component.operation);
        componentMeta[offset + 3] = componentBlendRadius(component, track, cornerSharpness);
        const primitive = component.primitive;
        if (primitive.kind === "capsule") {
          componentA[offset] = primitive.start.x;
          componentA[offset + 1] = primitive.start.y;
          componentA[offset + 2] = primitive.end.x;
          componentA[offset + 3] = primitive.end.y;
          componentC[offset] = primitive.radius;
        } else if (primitive.kind === "ellipse") {
          componentA[offset] = primitive.center.x;
          componentA[offset + 1] = primitive.center.y;
          componentA[offset + 2] = primitive.radiusX;
          componentA[offset + 3] = primitive.radiusY;
          componentB[offset] = primitive.rotation ?? 0;
        } else {
          componentA[offset] = primitive.p0.x;
          componentA[offset + 1] = primitive.p0.y;
          componentA[offset + 2] = primitive.p1.x;
          componentA[offset + 3] = primitive.p1.y;
          componentB[offset] = primitive.p2.x;
          componentB[offset + 1] = primitive.p2.y;
          componentB[offset + 2] = primitive.p3.x;
          componentB[offset + 3] = primitive.p3.y;
          componentC[offset] = primitive.startRadius;
          componentC[offset + 1] = primitive.endRadius;
        }
        componentIndex += 1;
      }
      trackComponentRange[rangeOffset + 1] = componentIndex;
    });

    gl.useProgram(gpu.program);
    gl.uniform2f(gpu.uniforms.resolution, this.canvas.width, this.canvas.height);
    gl.uniform4f(gpu.uniforms.viewport, viewport.scale, viewport.offsetX, viewport.offsetY, scene.coordinateSpace.width);
    gl.uniform1f(gpu.uniforms.opacity, opacity);
    gl.uniform1i(gpu.uniforms.trackCount, frame.tracks.length);
    gl.uniform1i(gpu.uniforms.componentCount, componentIndex);
    gl.uniform1iv(gpu.uniforms.trackModes, trackModes);
    gl.uniform2iv(gpu.uniforms.trackComponentRange, trackComponentRange);
    gl.uniform1fv(gpu.uniforms.trackSourceOpacity, sourceOpacity);
    gl.uniform1fv(gpu.uniforms.trackTargetOpacity, targetOpacity);
    gl.uniform1fv(gpu.uniforms.trackTargetMix, targetMix);
    gl.uniform1fv(gpu.uniforms.trackFieldOpacity, fieldOpacity);
    gl.uniform4fv(gpu.uniforms.trackPlacement, placements);
    gl.uniform2fv(gpu.uniforms.trackOrigin, origins);
    gl.uniform4fv(gpu.uniforms.componentMeta, componentMeta);
    gl.uniform4fv(gpu.uniforms.componentA, componentA);
    gl.uniform4fv(gpu.uniforms.componentB, componentB);
    gl.uniform4fv(gpu.uniforms.componentC, componentC);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#sourceTexture?.texture ?? null);
    gl.uniform1i(gpu.uniforms.sourceDistances, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#targetTexture?.texture ?? null);
    gl.uniform1i(gpu.uniforms.targetDistances, 1);
  }

  private uploadEndpointTextures(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, width: number, height: number, viewportPadding: number): void {
    const gl = this.#gl;
    if (!gl) return;
    const sourceRasters = frame.tracks.map((track) => this.endpointRaster(scene, track, "source", width, height, viewportPadding));
    const targetRasters = frame.tracks.map((track) => this.endpointRaster(scene, track, "target", width, height, viewportPadding));
    this.#sourceTexture = this.uploadTextureLayers(this.#sourceTexture, sourceRasters, width, height);
    this.#targetTexture = this.uploadTextureLayers(this.#targetTexture, targetRasters, width, height);

    const activeTrackIds = new Set(frame.tracks.map((track) => track.id));
    for (const trackId of this.#sourceDistanceRasters.keys()) if (!activeTrackIds.has(trackId)) this.#sourceDistanceRasters.delete(trackId);
    for (const trackId of this.#targetDistanceRasters.keys()) if (!activeTrackIds.has(trackId)) this.#targetDistanceRasters.delete(trackId);
  }

  // Uploads only layers whose raster changed. A null raster means the shader will
  // not sample that layer this frame, so whatever it holds is left in place.
  private uploadTextureLayers(existing: EndpointTexture | null, rasters: readonly (PreparedDistanceRaster | null)[], width: number, height: number): EndpointTexture {
    const target = this.ensureEndpointTexture(existing, width, height);
    const gl = this.#gl!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, target.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    rasters.forEach((raster, layer) => {
      if (!raster || target.layerKeys[layer] === raster.key) return;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RED, gl.FLOAT, raster.distances);
      target.layerKeys[layer] = raster.key;
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return target;
  }

  private ensureEndpointTexture(existing: EndpointTexture | null, width: number, height: number): EndpointTexture {
    const gl = this.#gl;
    if (!gl) throw new Error("WebGL2 context has been destroyed");
    let target = existing;
    if (!target || target.width !== width || target.height !== height) {
      const texture = target?.texture ?? gl.createTexture();
      if (!texture) throw new Error("Unable to create WebGL texture");
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, width, height, MAX_TRACKS, 0, gl.RED, gl.FLOAT, null);
      target = { texture, width, height, layerKeys: [] };
      this.#pendingUploads = [];
    }
    return target;
  }

  private isEndpointVisible(scene: LiquidSceneV2, track: TrackFrame, endpoint: "source" | "target", width: number, height: number, viewportPadding: number): boolean {
    const key = trackEndpointCacheKey(scene, track, endpoint, width, height, viewportPadding);
    let visible = this.#endpointVisibility.get(key);
    if (visible === undefined) {
      visible = endpointVisible(scene, track, endpoint, width, height, viewportPadding);
      if (this.#endpointVisibility.size > 64) this.#endpointVisibility.clear();
      this.#endpointVisibility.set(key, visible);
    }
    return visible;
  }

  // Returns the exact raster when this frame samples it, otherwise null, so
  // rasters are only built when a track actually needs them.
  private endpointRaster(scene: LiquidSceneV2, track: TrackFrame, endpoint: "source" | "target", width: number, height: number, viewportPadding: number): PreparedDistanceRaster | null {
    if (!endpointNeeded(track, endpoint) || !this.isEndpointVisible(scene, track, endpoint, width, height, viewportPadding)) return null;
    const cache = endpoint === "source" ? this.#sourceDistanceRasters : this.#targetDistanceRasters;
    const key = trackEndpointCacheKey(scene, track, endpoint, width, height, viewportPadding);
    const cached = cache.get(track.id);
    if (cached?.key === key) return cached;
    const steps = this.#rasterTasks.get(key) ?? endpointDistanceRasterSteps(scene, track, endpoint, width, height, viewportPadding);
    this.#rasterTasks.delete(key);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const raster = { key, width, height, distances: step.value };
    cache.set(track.id, raster);
    return raster;
  }

  // Prepares target rasters for field tracks that have not started blending
  // toward their target yet: builds each raster in slices, then uploads it into
  // its texture layer a few rows at a time, all within a small per-frame budget,
  // so nothing heavy lands on the frame where targetMix first rises.
  private warmTargetRasters(scene: LiquidSceneV2, frame: LiquidFrameSampleV2, width: number, height: number, viewportPadding: number, deadline: number): void {
    if (this.drainPendingUploads(width, height, deadline)) return;
    for (const [layer, track] of frame.tracks.entries()) {
      if (track.renderMode !== "field" || trackTargetMix(track) > 0) continue;
      if (!this.isEndpointVisible(scene, track, "target", width, height, viewportPadding)) continue;
      const key = trackEndpointCacheKey(scene, track, "target", width, height, viewportPadding);
      if (this.#targetDistanceRasters.get(track.id)?.key === key) continue;
      let steps = this.#rasterTasks.get(key);
      if (!steps) {
        steps = endpointDistanceRasterSteps(scene, track, "target", width, height, viewportPadding);
        this.#rasterTasks.set(key, steps);
      }
      while (performance.now() < deadline) {
        const step = steps.next();
        if (step.done) {
          this.#rasterTasks.delete(key);
          const raster = { key, width, height, distances: step.value };
          this.#targetDistanceRasters.set(track.id, raster);
          this.#pendingUploads.push({ raster, layer, nextRow: 0 });
          break;
        }
      }
      if (this.drainPendingUploads(width, height, deadline)) return;
    }
  }

  // Uploads queued rasters in row bands until the deadline. Returns true when
  // the budget ran out.
  private drainPendingUploads(width: number, height: number, deadline: number): boolean {
    const gl = this.#gl;
    if (!gl || this.#pendingUploads.length === 0) return performance.now() >= deadline;
    const texture = this.ensureEndpointTexture(this.#targetTexture, width, height);
    this.#targetTexture = texture;
    const rowsPerBand = Math.max(1, Math.floor(65_536 / width));
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    while (this.#pendingUploads.length > 0 && performance.now() < deadline) {
      const upload = this.#pendingUploads[0]!;
      if (texture.layerKeys[upload.layer] === upload.raster.key) {
        this.#pendingUploads.shift();
        continue;
      }
      const rows = Math.min(rowsPerBand, height - upload.nextRow);
      const start = upload.nextRow * width;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, upload.nextRow, upload.layer, width, rows, 1, gl.RED, gl.FLOAT, upload.raster.distances.subarray(start, start + rows * width));
      upload.nextRow += rows;
      if (upload.nextRow >= height) {
        texture.layerKeys[upload.layer] = upload.raster.key;
        this.#pendingUploads.shift();
      } else {
        // A partially written layer no longer holds whatever raster it held before.
        texture.layerKeys[upload.layer] = "";
      }
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return performance.now() >= deadline;
  }


}
