import { clamp01, ease } from "./easing.js";
import { interpolateComponentState, interpolateFrame, interpolateMaterial } from "./interpolate.js";
import { canonicalSample, canonicalValue } from "./serialize.js";
import { splineComponentState, splineMaterialSection, splineSegment } from "./spline.js";
import type {
  ActiveSemanticEvent,
  AnyLiquidFrameOutput,
  AnyLiquidFrameSample,
  AnyLiquidScene,
  ComponentFrame,
  LiquidFrameOutput,
  LiquidFrameOutputV2,
  LiquidFrameSample,
  LiquidFrameSampleV2,
  LiquidScene,
  LiquidSceneV2,
  LiquidTrack,
  MaterialValues,
  Pose,
  PoseFrame,
  Primitive,
  SampleRequest,
  TrackFrame,
  TrackKeyframe,
} from "./types.js";
import { validateScene, validateSceneV1, validateSceneV2 } from "./validate.js";

const EVENT_EPSILON = 1e-9;

function phaseFor(scene: LiquidScene, progress: number): string {
  const phase = scene.phases.find((item, index) => progress >= item.start && (progress < item.end || (progress === 1 && index === scene.phases.length - 1)));
  if (!phase) throw new Error(`No phase covers progress ${progress}`);
  return phase.id;
}

function eventsFor(scene: LiquidScene, progress: number): readonly string[] {
  return scene.thresholds.filter((threshold) => threshold.at <= progress).map((threshold) => threshold.id);
}

function posePair(scene: LiquidScene, progress: number): readonly [Pose, Pose, number] {
  for (let index = 1; index < scene.poses.length; index += 1) {
    const previous = scene.poses[index - 1];
    const next = scene.poses[index];
    if (!previous || !next) throw new Error("Invalid pose list");
    if (progress <= next.at) {
      const span = next.at - previous.at;
      const local = span <= 0 ? 1 : (progress - previous.at) / span;
      return [previous, next, ease(next.easing, local)];
    }
  }
  const last = scene.poses[scene.poses.length - 1];
  if (!last) throw new Error("Invalid pose list");
  return [last, last, 1];
}

function frameAt(scene: LiquidScene, progress: number): PoseFrame {
  const [previous, next, local] = posePair(scene, progress);
  return interpolateFrame(previous.frame, next.frame, local);
}

function reducedOpacity(scene: LiquidScene, progress: number): Pick<LiquidFrameSample, "sourceOpacity" | "targetOpacity"> {
  const { fadeStart, fadeEnd } = scene.reducedMotion;
  const local = clamp01((progress - fadeStart) / (fadeEnd - fadeStart));
  return { sourceOpacity: 1 - local, targetOpacity: local };
}

function evaluateFrameV1(scene: LiquidScene, progress: number, options: EvaluateOptions = {}): LiquidFrameSample {
  validateSceneV1(scene);
  const t = clamp01(progress);
  const baseFrame = options.reducedMotion ? scene.poses[0]?.frame : frameAt(scene, t);
  if (!baseFrame) throw new Error("Scene contains no poses");
  const opacity = options.reducedMotion ? reducedOpacity(scene, t) : { sourceOpacity: t === 1 ? 0 : 1, targetOpacity: t === 0 ? 0 : t === 1 ? 1 : 0 };
  const renderMode = options.reducedMotion ? "crossfade" : t === 0 ? "sourcePath" : t === 1 ? "targetPath" : "field";
  const endpointCommands = !options.reducedMotion && t === 0
    ? scene.source.commands
    : !options.reducedMotion && t === 1
      ? scene.target.commands
      : null;

  return canonicalSample({
    label: "",
    progress: t,
    phase: phaseFor(scene, t),
    events: eventsFor(scene, t),
    renderMode,
    sourceOpacity: opacity.sourceOpacity,
    targetOpacity: opacity.targetOpacity,
    endpointCommands,
    ...baseFrame,
  });
}

export interface EvaluateOptions {
  readonly reducedMotion?: boolean;
}

function keyframePair(track: LiquidTrack, progress: number): readonly [TrackKeyframe, TrackKeyframe, number] {
  for (let index = 1; index < track.keyframes.length; index += 1) {
    const previous = track.keyframes[index - 1];
    const next = track.keyframes[index];
    if (!previous || !next) throw new Error("Invalid keyframe list");
    if (progress <= next.at) {
      const span = next.at - previous.at;
      const local = span <= 0 ? 1 : (progress - previous.at) / span;
      return [previous, next, ease(next.easing, local)];
    }
  }
  const last = track.keyframes[track.keyframes.length - 1];
  if (!last) throw new Error("Invalid keyframe list");
  return [last, last, 1];
}

function mapById<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function materialRecord(a: Readonly<Record<string, MaterialValues>> = {}, b: Readonly<Record<string, MaterialValues>> = {}, t: number): Readonly<Record<string, MaterialValues>> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const output: Record<string, MaterialValues> = {};
  for (const key of [...keys].sort()) output[key] = interpolateMaterial(a[key], b[key], t);
  return output;
}

function trackLocalProgress(track: LiquidTrack, progress: number): number {
  return clamp01((progress - track.timing.start) / (track.timing.end - track.timing.start));
}

function reducedOpacityV2(scene: LiquidSceneV2, progress: number): Pick<TrackFrame, "sourceOpacity" | "targetOpacity"> {
  const { fadeStart, fadeEnd } = scene.reducedMotion;
  const local = clamp01((progress - fadeStart) / (fadeEnd - fadeStart));
  return { sourceOpacity: 1 - local, targetOpacity: local };
}

function activeEventsForTrack(track: LiquidTrack, progress: number): ActiveSemanticEvent[] {
  const local = trackLocalProgress(track, progress);
  return (track.events ?? []).filter((event) => {
    if (event.kind === "step") return local + EVENT_EPSILON >= event.at;
    return local + EVENT_EPSILON >= event.at && local < (event.end ?? event.at) - EVENT_EPSILON;
  }).map((event) => canonicalValue({
    id: event.id,
    kind: event.kind,
    trackId: track.id,
    at: event.at,
    ...(event.end === undefined ? {} : { end: event.end }),
    ...(event.componentId === undefined ? {} : { componentId: event.componentId }),
    ...(event.payload === undefined ? {} : { payload: event.payload }),
  }));
}

interface InterpolatedTrackState {
  readonly primitive: (componentId: string) => Primitive;
  readonly componentMaterials: Readonly<Record<string, MaterialValues>>;
  readonly groupMaterials: Readonly<Record<string, MaterialValues>>;
}

function easedTrackState(track: LiquidTrack, progress: number): InterpolatedTrackState {
  const [previous, next, local] = keyframePair(track, progress);
  const previousStates = mapById(previous.components);
  const nextStates = mapById(next.components);
  return {
    primitive: (componentId) => {
      const previousState = previousStates.get(componentId);
      const nextState = nextStates.get(componentId);
      if (!previousState || !nextState) throw new Error(`Missing keyframe state for component ${componentId}`);
      return interpolateComponentState(previousState, nextState, local).primitive;
    },
    componentMaterials: materialRecord(previous.material?.components, next.material?.components, local),
    groupMaterials: materialRecord(previous.material?.groups, next.material?.groups, local),
  };
}

function splineTrackState(track: LiquidTrack, progress: number): InterpolatedTrackState {
  const segment = splineSegment(track.keyframes, progress);
  return {
    primitive: (componentId) => splineComponentState(track.keyframes, componentId, segment).primitive,
    componentMaterials: splineMaterialSection(track.keyframes, "components", segment),
    groupMaterials: splineMaterialSection(track.keyframes, "groups", segment),
  };
}

function evaluateTrackFrame(scene: LiquidSceneV2, track: LiquidTrack, progress: number, options: EvaluateOptions): TrackFrame {
  const localProgress = trackLocalProgress(track, progress);
  const reduced = options.reducedMotion === true;
  const sampledProgress = reduced ? 0 : localProgress;
  const interpolated = track.interpolation === "monotoneCubic"
    ? splineTrackState(track, sampledProgress)
    : easedTrackState(track, sampledProgress);
  const { componentMaterials, groupMaterials } = interpolated;
  const opacity = reduced
    ? reducedOpacityV2(scene, progress)
    : { sourceOpacity: localProgress === 1 ? 0 : 1, targetOpacity: localProgress === 0 ? 0 : localProgress === 1 ? 1 : 0 };
  const renderMode = reduced ? "crossfade" : localProgress === 0 ? "sourcePath" : localProgress === 1 ? "targetPath" : "field";
  const endpointCommands = !reduced && localProgress === 0
    ? track.source.commands
    : !reduced && localProgress === 1
      ? track.target.commands
      : null;
  const components: ComponentFrame[] = track.components.map((definition) => ({
    id: definition.id,
    kind: definition.kind,
    operation: definition.operation,
    ...(definition.groupId === undefined ? {} : { groupId: definition.groupId }),
    primitive: interpolated.primitive(definition.id),
    material: componentMaterials[definition.id] ?? {},
  }));

  return canonicalValue({
    id: track.id,
    progress,
    localProgress,
    renderMode,
    sourceOpacity: opacity.sourceOpacity,
    targetOpacity: opacity.targetOpacity,
    source: track.source,
    target: track.target,
    endpointCommands,
    components,
    material: {
      components: componentMaterials,
      groups: groupMaterials,
    },
  });
}

export function evaluateFrame(scene: LiquidScene, progress: number, options?: EvaluateOptions): LiquidFrameSample;
export function evaluateFrame(scene: LiquidSceneV2, progress: number, options?: EvaluateOptions): LiquidFrameSampleV2;
export function evaluateFrame(scene: AnyLiquidScene, progress: number, options: EvaluateOptions = {}): AnyLiquidFrameSample {
  if (scene.schemaVersion === 1) return evaluateFrameV1(scene, progress, options);
  validateSceneV2(scene);
  const t = clamp01(progress);
  const tracks = scene.tracks.map((track) => evaluateTrackFrame(scene, track, t, options));
  return canonicalValue({
    label: "",
    progress: t,
    events: scene.tracks.flatMap((track) => activeEventsForTrack(track, t)),
    tracks,
  });
}

export function evaluateSample(scene: LiquidScene, sample: SampleRequest, options?: EvaluateOptions): LiquidFrameSample;
export function evaluateSample(scene: LiquidSceneV2, sample: SampleRequest, options?: EvaluateOptions): LiquidFrameSampleV2;
export function evaluateSample(scene: AnyLiquidScene, sample: SampleRequest, options: EvaluateOptions = {}): AnyLiquidFrameSample {
  return canonicalValue({ ...evaluateFrame(scene as LiquidSceneV2, sample.progress, options), label: sample.label }) as AnyLiquidFrameSample;
}

export function evaluateSamples(scene: LiquidScene, samples: readonly SampleRequest[], options?: EvaluateOptions): LiquidFrameOutput;
export function evaluateSamples(scene: LiquidSceneV2, samples: readonly SampleRequest[], options?: EvaluateOptions): LiquidFrameOutputV2;
export function evaluateSamples(scene: AnyLiquidScene, samples: readonly SampleRequest[], options: EvaluateOptions = {}): AnyLiquidFrameOutput {
  validateScene(scene);
  if (scene.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      sceneId: scene.id,
      fixtureVersion: scene.fixtureVersion,
      samples: samples.map((sample) => evaluateSample(scene, sample, options)),
    };
  }
  return {
    schemaVersion: 1,
    sceneId: scene.id,
    fixtureVersion: scene.fixtureVersion,
    samples: samples.map((sample) => evaluateSample(scene, sample, options)),
  };
}

export const evaluateScene = evaluateSamples;
