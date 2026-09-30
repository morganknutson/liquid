export type EasingName = "linear" | "smoothStep" | "smootherStep" | "easeInCubic" | "easeOutCubic";
export type FillRule = "nonzero" | "evenodd";
export type RenderMode = "sourcePath" | "field" | "targetPath" | "crossfade";
export type ComponentKind = "capsule" | "ribbon" | "ellipse";
export type CompositionOperation = "union" | "subtract";
export type SemanticEventKind = "step" | "release";
export type MaterialScalar = number | string | boolean;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Transform {
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export type PathCommand =
  | { readonly type: "M" | "L"; readonly values: readonly [number, number] }
  | { readonly type: "C"; readonly values: readonly [number, number, number, number, number, number] }
  | { readonly type: "Z" };

export interface Endpoint {
  readonly assetId: string;
  readonly shapeId: string;
  readonly transform: Transform;
  readonly commands: readonly PathCommand[];
}

export interface Phase {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface Threshold {
  readonly id: string;
  readonly at: number;
}

export interface Capsule {
  readonly start: Point;
  readonly end: Point;
  readonly radius: number;
}

export interface CubicRibbon {
  readonly p0: Point;
  readonly p1: Point;
  readonly p2: Point;
  readonly p3: Point;
  readonly startRadius: number;
  readonly endRadius: number;
}

export interface Ellipse {
  readonly center: Point;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotation?: number;
}

export type Primitive =
  | ({ readonly kind: "capsule" } & Capsule)
  | ({ readonly kind: "ribbon" } & CubicRibbon)
  | ({ readonly kind: "ellipse" } & Ellipse);

export type MaterialValues = Readonly<Record<string, MaterialScalar>>;

export interface ComponentDefinition {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly operation: CompositionOperation;
  readonly groupId?: string;
}

export interface ComponentState {
  readonly id: string;
  readonly primitive: Primitive;
}

export interface TrackKeyframe {
  readonly at: number;
  readonly easing: EasingName;
  readonly components: readonly ComponentState[];
  readonly material?: {
    readonly components?: Readonly<Record<string, MaterialValues>>;
    readonly groups?: Readonly<Record<string, MaterialValues>>;
  };
}

export type TrackInterpolation = "keyframeEasing" | "monotoneCubic";

export interface TrackTiming {
  readonly start: number;
  readonly end: number;
}

export interface SemanticEvent {
  readonly id: string;
  readonly kind: SemanticEventKind;
  readonly at: number;
  readonly end?: number;
  readonly componentId?: string;
  readonly payload?: Readonly<Record<string, MaterialScalar>>;
}

export interface LiquidTrack {
  readonly id: string;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly timing: TrackTiming;
  readonly interpolation?: TrackInterpolation;
  /**
   * When true, the track always draws its exact target shape, moved by its
   * `$track` placement, instead of a liquid field: for rigid motion of a
   * finished shape, such as letters dropping out of a frame.
   */
  readonly rigid?: boolean;
  readonly components: readonly ComponentDefinition[];
  readonly keyframes: readonly TrackKeyframe[];
  readonly events?: readonly SemanticEvent[];
}

export interface PoseFrame {
  readonly anchor: Point;
  readonly leftLeg: Capsule;
  readonly rightLeg: Capsule;
  readonly crossbar: Capsule;
  readonly bridge: Capsule;
  readonly blendRadius: number;
  readonly targetMix: number;
  readonly cornerSharpness: number;
}

export interface Pose {
  readonly at: number;
  readonly easing: EasingName;
  readonly frame: PoseFrame;
}

export interface ReducedMotion {
  readonly mode: "crossfade";
  readonly durationMs: number;
  readonly fadeStart: number;
  readonly fadeEnd: number;
}

export interface LiquidScene {
  readonly $schema?: string;
  readonly schemaVersion: 1;
  readonly id: string;
  readonly fixtureVersion: number;
  readonly durationMs: number;
  readonly coordinateSpace: Size;
  readonly fillRule: FillRule;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly phases: readonly Phase[];
  readonly thresholds: readonly Threshold[];
  readonly poses: readonly Pose[];
  readonly reducedMotion: ReducedMotion;
}

export interface LiquidSceneV2 {
  readonly $schema?: string;
  readonly schemaVersion: 2;
  readonly id: string;
  readonly fixtureVersion: number;
  readonly durationMs: number;
  readonly coordinateSpace: Size;
  readonly fillRule: FillRule;
  readonly tracks: readonly LiquidTrack[];
  /** Exact vector shapes drawn on every frame beneath the tracks, e.g. a static frame around the motion. */
  readonly backdrop?: readonly Endpoint[];
  /** When present, tracks are only drawn inside this shape (for example so shapes enter from behind a frame). The backdrop is not clipped. */
  readonly clip?: Endpoint;
  /**
   * When present, looping playback wraps back to `start` (normalized progress)
   * instead of 0, so an intro before it plays once. Reduced motion does not loop.
   */
  readonly loop?: { readonly start: number };
  /**
   * Named points in normalized progress that hosts can seek to, for example
   * where the main animation starts after an optional outro.
   */
  readonly markers?: readonly SceneMarker[];
  readonly reducedMotion: ReducedMotion;
}

export interface SceneMarker {
  readonly id: string;
  readonly at: number;
}

export type AnyLiquidScene = LiquidScene | LiquidSceneV2;

export interface EvaluateOptions {
  readonly reducedMotion?: boolean;
}

export interface LiquidFrameSample extends PoseFrame {
  readonly label: string;
  readonly progress: number;
  readonly phase: string;
  readonly events: readonly string[];
  readonly renderMode: RenderMode;
  readonly sourceOpacity: number;
  readonly targetOpacity: number;
  readonly endpointCommands: readonly PathCommand[] | null;
}

export interface LiquidFrameOutput {
  readonly schemaVersion: 1;
  readonly sceneId: string;
  readonly fixtureVersion: number;
  readonly samples: readonly LiquidFrameSample[];
}

export interface ActiveSemanticEvent {
  readonly id: string;
  readonly kind: SemanticEventKind;
  readonly trackId: string;
  readonly at: number;
  readonly end?: number;
  readonly componentId?: string;
  readonly payload?: Readonly<Record<string, MaterialScalar>>;
}

export interface ComponentFrame {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly operation: CompositionOperation;
  readonly groupId?: string;
  readonly primitive: Primitive;
  readonly material: MaterialValues;
}

export interface TrackFrame {
  readonly id: string;
  readonly progress: number;
  readonly localProgress: number;
  readonly renderMode: RenderMode;
  readonly sourceOpacity: number;
  readonly targetOpacity: number;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly endpointCommands: readonly PathCommand[] | null;
  readonly components: readonly ComponentFrame[];
  readonly material: {
    readonly components: Readonly<Record<string, MaterialValues>>;
    readonly groups: Readonly<Record<string, MaterialValues>>;
  };
}

export interface LiquidFrameSampleV2 {
  readonly label: string;
  readonly progress: number;
  readonly events: readonly ActiveSemanticEvent[];
  readonly tracks: readonly TrackFrame[];
}

export interface LiquidFrameOutputV2 {
  readonly schemaVersion: 2;
  readonly sceneId: string;
  readonly fixtureVersion: number;
  readonly samples: readonly LiquidFrameSampleV2[];
}

export type AnyLiquidFrameSample = LiquidFrameSample | LiquidFrameSampleV2;
export type AnyLiquidFrameOutput = LiquidFrameOutput | LiquidFrameOutputV2;

export interface SampleRequest {
  readonly label: string;
  readonly progress: number;
}

export interface SampleManifest {
  readonly schemaVersion: 1;
  readonly sceneId: string;
  readonly samples: readonly SampleRequest[];
}
