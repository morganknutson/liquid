import type {
  AnyLiquidScene,
  Capsule,
  ComponentDefinition,
  ComponentState,
  LiquidScene,
  LiquidSceneV2,
  PathCommand,
  PoseFrame,
  Primitive,
  SampleManifest,
} from "./types.js";

const easings = new Set(["linear", "smoothStep", "smootherStep", "easeInCubic", "easeOutCubic"]);
const interpolations = new Set(["keyframeEasing", "monotoneCubic"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertOptionalString(value: unknown, path: string): asserts value is string | undefined {
  if (value !== undefined) assertString(value, path);
}

function point(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertFinite(value.x, `${path}.x`);
  assertFinite(value.y, `${path}.y`);
}

function capsule(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  point(value.start, `${path}.start`);
  point(value.end, `${path}.end`);
  assertFinite(value.radius, `${path}.radius`);
  if (value.radius < 0) throw new Error(`${path}.radius must be >= 0`);
}

function materialValues(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number") {
      assertFinite(child, `${path}.${key}`);
    } else if (typeof child !== "string" && typeof child !== "boolean") {
      throw new Error(`${path}.${key} must be a finite number, string, or boolean`);
    }
  }
}

function materialMap(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const [key, child] of Object.entries(value)) materialValues(child, `${path}.${key}`);
}

function primitive(value: unknown, path: string): asserts value is Primitive {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (value.kind === "capsule") {
    capsule(value, path);
    return;
  }
  if (value.kind === "ribbon") {
    point(value.p0, `${path}.p0`);
    point(value.p1, `${path}.p1`);
    point(value.p2, `${path}.p2`);
    point(value.p3, `${path}.p3`);
    assertFinite(value.startRadius, `${path}.startRadius`);
    assertFinite(value.endRadius, `${path}.endRadius`);
    if (value.startRadius < 0 || value.endRadius < 0) throw new Error(`${path} radii must be >= 0`);
    return;
  }
  if (value.kind === "ellipse") {
    point(value.center, `${path}.center`);
    assertFinite(value.radiusX, `${path}.radiusX`);
    assertFinite(value.radiusY, `${path}.radiusY`);
    if (value.radiusX < 0 || value.radiusY < 0) throw new Error(`${path} radii must be >= 0`);
    if (value.rotation !== undefined) assertFinite(value.rotation, `${path}.rotation`);
    return;
  }
  throw new Error(`${path}.kind must be capsule, ribbon, or ellipse`);
}

function componentDefinition(value: unknown, path: string): asserts value is ComponentDefinition {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertString(value.id, `${path}.id`);
  if (value.kind !== "capsule" && value.kind !== "ribbon" && value.kind !== "ellipse") {
    throw new Error(`${path}.kind must be capsule, ribbon, or ellipse`);
  }
  if (value.operation !== "union" && value.operation !== "subtract") {
    throw new Error(`${path}.operation must be union or subtract`);
  }
  assertOptionalString(value.groupId, `${path}.groupId`);
}

function componentState(value: unknown, path: string): asserts value is ComponentState {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertString(value.id, `${path}.id`);
  primitive(value.primitive, `${path}.primitive`);
}

function frame(value: unknown, path: string): asserts value is PoseFrame {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  point(value.anchor, `${path}.anchor`);
  capsule(value.leftLeg, `${path}.leftLeg`);
  capsule(value.rightLeg, `${path}.rightLeg`);
  capsule(value.crossbar, `${path}.crossbar`);
  capsule(value.bridge, `${path}.bridge`);
  assertFinite(value.blendRadius, `${path}.blendRadius`);
  assertFinite(value.targetMix, `${path}.targetMix`);
  assertFinite(value.cornerSharpness, `${path}.cornerSharpness`);
  if (value.blendRadius < 0) throw new Error(`${path}.blendRadius must be >= 0`);
  if (value.targetMix < 0 || value.targetMix > 1) throw new Error(`${path}.targetMix must be in 0...1`);
  if (value.cornerSharpness < 0 || value.cornerSharpness > 1) throw new Error(`${path}.cornerSharpness must be in 0...1`);
}

function command(value: unknown, path: string): asserts value is PathCommand {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (value.type !== "M" && value.type !== "L" && value.type !== "C" && value.type !== "Z") {
    throw new Error(`${path}.type must be M, L, C, or Z`);
  }
  if (value.type === "Z") return;
  if (!Array.isArray(value.values)) throw new Error(`${path}.values must be an array`);
  const expected = value.type === "C" ? 6 : 2;
  if (value.values.length !== expected) throw new Error(`${path}.values must contain ${expected} numbers`);
  value.values.forEach((number, index) => assertFinite(number, `${path}.values[${index}]`));
}

function pathCommands(commands: readonly PathCommand[], path: string): void {
  let hasOpenContour = false;
  commands.forEach((item, index) => {
    if (item.type === "M") {
      if (hasOpenContour) {
        throw new Error(`${path}[${index}].type must follow Z before starting another contour`);
      }
      hasOpenContour = true;
      return;
    }
    if (!hasOpenContour) {
      throw new Error(`${path}[${index}].type must be M before ${item.type}`);
    }
    if (item.type === "Z") {
      hasOpenContour = false;
    }
  });
  if (hasOpenContour) throw new Error(`${path} must close every contour with Z`);
}

function endpoint(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertString(value.assetId, `${path}.assetId`);
  assertString(value.shapeId, `${path}.shapeId`);
  if (!isRecord(value.transform)) throw new Error(`${path}.transform must be an object`);
  for (const key of ["translateX", "translateY", "scaleX", "scaleY"] as const) {
    assertFinite(value.transform[key], `${path}.transform.${key}`);
  }
  if (!Array.isArray(value.commands) || value.commands.length < 2) throw new Error(`${path}.commands must contain at least two commands`);
  value.commands.forEach((item, index) => command(item, `${path}.commands[${index}]`));
  pathCommands(value.commands, `${path}.commands`);
}

export function validateSceneV1(value: unknown): asserts value is LiquidScene {
  if (!isRecord(value)) throw new Error("scene must be an object");
  if (value.schemaVersion !== 1) throw new Error("scene.schemaVersion must be 1");
  assertString(value.id, "scene.id");
  assertFinite(value.fixtureVersion, "scene.fixtureVersion");
  if (!Number.isInteger(value.fixtureVersion) || value.fixtureVersion < 1) throw new Error("scene.fixtureVersion must be an integer >= 1");
  assertFinite(value.durationMs, "scene.durationMs");
  if (value.durationMs <= 0) throw new Error("scene.durationMs must be > 0");
  if (!isRecord(value.coordinateSpace)) throw new Error("scene.coordinateSpace must be an object");
  assertFinite(value.coordinateSpace.width, "scene.coordinateSpace.width");
  assertFinite(value.coordinateSpace.height, "scene.coordinateSpace.height");
  if (value.coordinateSpace.width <= 0 || value.coordinateSpace.height <= 0) throw new Error("scene.coordinateSpace must be positive");
  if (value.fillRule !== "nonzero" && value.fillRule !== "evenodd") throw new Error("scene.fillRule must be nonzero or evenodd");
  endpoint(value.source, "scene.source");
  endpoint(value.target, "scene.target");
  if (!Array.isArray(value.phases) || value.phases.length === 0) throw new Error("scene.phases must not be empty");
  let lastEnd = 0;
  value.phases.forEach((phase, index) => {
    if (!isRecord(phase)) throw new Error(`scene.phases[${index}] must be an object`);
    assertString(phase.id, `scene.phases[${index}].id`);
    assertFinite(phase.start, `scene.phases[${index}].start`);
    assertFinite(phase.end, `scene.phases[${index}].end`);
    if (phase.start !== lastEnd || phase.end < phase.start) throw new Error("scene.phases must be ordered and contiguous");
    lastEnd = phase.end;
  });
  if (lastEnd !== 1) throw new Error("scene.phases must end at 1");
  if (!Array.isArray(value.thresholds)) throw new Error("scene.thresholds must be an array");
  value.thresholds.forEach((threshold, index) => {
    if (!isRecord(threshold)) throw new Error(`scene.thresholds[${index}] must be an object`);
    assertString(threshold.id, `scene.thresholds[${index}].id`);
    assertFinite(threshold.at, `scene.thresholds[${index}].at`);
    if (threshold.at < 0 || threshold.at > 1) throw new Error(`scene.thresholds[${index}].at must be in 0...1`);
  });
  if (!Array.isArray(value.poses) || value.poses.length < 2) throw new Error("scene.poses must contain at least two poses");
  let previousAt = -Infinity;
  value.poses.forEach((pose, index) => {
    if (!isRecord(pose)) throw new Error(`scene.poses[${index}] must be an object`);
    assertFinite(pose.at, `scene.poses[${index}].at`);
    if (pose.at < 0 || pose.at > 1 || pose.at <= previousAt) throw new Error("scene.poses must be strictly ordered in 0...1");
    if (typeof pose.easing !== "string" || !easings.has(pose.easing)) throw new Error(`scene.poses[${index}].easing is unsupported`);
    frame(pose.frame, `scene.poses[${index}].frame`);
    previousAt = pose.at;
  });
  const firstPose = value.poses[0];
  const lastPose = value.poses[value.poses.length - 1];
  if (firstPose?.at !== 0 || lastPose?.at !== 1) throw new Error("scene.poses must start at 0 and end at 1");
  if (!isRecord(value.reducedMotion)) throw new Error("scene.reducedMotion must be an object");
  if (value.reducedMotion.mode !== "crossfade") throw new Error("scene.reducedMotion.mode must be crossfade");
  assertFinite(value.reducedMotion.durationMs, "scene.reducedMotion.durationMs");
  assertFinite(value.reducedMotion.fadeStart, "scene.reducedMotion.fadeStart");
  assertFinite(value.reducedMotion.fadeEnd, "scene.reducedMotion.fadeEnd");
  if (value.reducedMotion.durationMs <= 0) throw new Error("scene.reducedMotion.durationMs must be > 0");
  if (value.reducedMotion.fadeStart < 0 || value.reducedMotion.fadeStart > 1 || value.reducedMotion.fadeEnd < 0 || value.reducedMotion.fadeEnd > 1) {
    throw new Error("scene.reducedMotion fade bounds must be in 0...1");
  }
  if (value.reducedMotion.fadeEnd <= value.reducedMotion.fadeStart) throw new Error("scene.reducedMotion fadeStart must be less than fadeEnd");
}

export function validateSceneV2(value: unknown): asserts value is LiquidSceneV2 {
  if (!isRecord(value)) throw new Error("scene must be an object");
  if (value.schemaVersion !== 2) throw new Error("scene.schemaVersion must be 2");
  assertString(value.id, "scene.id");
  assertFinite(value.fixtureVersion, "scene.fixtureVersion");
  if (!Number.isInteger(value.fixtureVersion) || value.fixtureVersion < 1) throw new Error("scene.fixtureVersion must be an integer >= 1");
  assertFinite(value.durationMs, "scene.durationMs");
  if (value.durationMs <= 0) throw new Error("scene.durationMs must be > 0");
  if (!isRecord(value.coordinateSpace)) throw new Error("scene.coordinateSpace must be an object");
  assertFinite(value.coordinateSpace.width, "scene.coordinateSpace.width");
  assertFinite(value.coordinateSpace.height, "scene.coordinateSpace.height");
  if (value.coordinateSpace.width <= 0 || value.coordinateSpace.height <= 0) throw new Error("scene.coordinateSpace must be positive");
  if (value.fillRule !== "nonzero" && value.fillRule !== "evenodd") throw new Error("scene.fillRule must be nonzero or evenodd");
  if (!Array.isArray(value.tracks) || value.tracks.length === 0) throw new Error("scene.tracks must not be empty");
  if (value.backdrop !== undefined) {
    if (!Array.isArray(value.backdrop)) throw new Error("scene.backdrop must be an array");
    value.backdrop.forEach((shape, index) => endpoint(shape, `scene.backdrop[${index}]`));
  }
  if (value.clip !== undefined) endpoint(value.clip, "scene.clip");
  if (value.loop !== undefined) {
    if (!isRecord(value.loop)) throw new Error("scene.loop must be an object");
    assertFinite(value.loop.start, "scene.loop.start");
    if (value.loop.start < 0 || value.loop.start >= 1) throw new Error("scene.loop.start must satisfy 0 <= start < 1");
  }

  const trackIds = new Set<string>();
  value.tracks.forEach((track, trackIndex) => {
    const trackPath = `scene.tracks[${trackIndex}]`;
    if (!isRecord(track)) throw new Error(`${trackPath} must be an object`);
    assertString(track.id, `${trackPath}.id`);
    if (trackIds.has(track.id)) throw new Error(`${trackPath}.id must be unique`);
    trackIds.add(track.id);
    endpoint(track.source, `${trackPath}.source`);
    endpoint(track.target, `${trackPath}.target`);
    if (!isRecord(track.timing)) throw new Error(`${trackPath}.timing must be an object`);
    assertFinite(track.timing.start, `${trackPath}.timing.start`);
    assertFinite(track.timing.end, `${trackPath}.timing.end`);
    if (track.timing.start < 0 || track.timing.start > 1 || track.timing.end < 0 || track.timing.end > 1 || track.timing.end <= track.timing.start) {
      throw new Error(`${trackPath}.timing must satisfy 0 <= start < end <= 1`);
    }
    if (track.interpolation !== undefined && (typeof track.interpolation !== "string" || !interpolations.has(track.interpolation))) {
      throw new Error(`${trackPath}.interpolation must be keyframeEasing or monotoneCubic`);
    }

    if (!Array.isArray(track.components) || track.components.length === 0) throw new Error(`${trackPath}.components must not be empty`);
    const definitions = new Map<string, ComponentDefinition>();
    track.components.forEach((definition, index) => {
      componentDefinition(definition, `${trackPath}.components[${index}]`);
      if (definitions.has(definition.id)) throw new Error(`${trackPath}.components[${index}].id must be unique`);
      definitions.set(definition.id, definition);
    });

    if (!Array.isArray(track.keyframes) || track.keyframes.length < 2) throw new Error(`${trackPath}.keyframes must contain at least two keyframes`);
    let previousAt = -Infinity;
    track.keyframes.forEach((keyframe, keyframeIndex) => {
      const keyframePath = `${trackPath}.keyframes[${keyframeIndex}]`;
      if (!isRecord(keyframe)) throw new Error(`${keyframePath} must be an object`);
      assertFinite(keyframe.at, `${keyframePath}.at`);
      if (keyframe.at < 0 || keyframe.at > 1 || keyframe.at <= previousAt) throw new Error(`${trackPath}.keyframes must be strictly ordered in 0...1`);
      if (typeof keyframe.easing !== "string" || !easings.has(keyframe.easing)) throw new Error(`${keyframePath}.easing is unsupported`);
      if (!Array.isArray(keyframe.components)) throw new Error(`${keyframePath}.components must be an array`);
      if (keyframe.components.length !== definitions.size) throw new Error(`${keyframePath}.components must match stable component definitions`);
      const seenStates = new Set<string>();
      keyframe.components.forEach((state, stateIndex) => {
        componentState(state, `${keyframePath}.components[${stateIndex}]`);
        if (seenStates.has(state.id)) throw new Error(`${keyframePath}.components[${stateIndex}].id must be unique`);
        seenStates.add(state.id);
        const definition = definitions.get(state.id);
        if (!definition) throw new Error(`${keyframePath}.components[${stateIndex}].id must match a component definition`);
        if (state.primitive.kind !== definition.kind) throw new Error(`${keyframePath}.components[${stateIndex}].primitive.kind must match stable component definition`);
      });
      for (const id of definitions.keys()) {
        if (!seenStates.has(id)) throw new Error(`${keyframePath}.components must include stable component ${id}`);
      }
      if (keyframe.material !== undefined) {
        if (!isRecord(keyframe.material)) throw new Error(`${keyframePath}.material must be an object`);
        materialMap(keyframe.material.components, `${keyframePath}.material.components`);
        materialMap(keyframe.material.groups, `${keyframePath}.material.groups`);
      }
      previousAt = keyframe.at;
    });
    if (track.keyframes[0]?.at !== 0 || track.keyframes[track.keyframes.length - 1]?.at !== 1) {
      throw new Error(`${trackPath}.keyframes must start at 0 and end at 1`);
    }

    if (track.events !== undefined) {
      if (!Array.isArray(track.events)) throw new Error(`${trackPath}.events must be an array`);
      const eventIds = new Set<string>();
      track.events.forEach((event, eventIndex) => {
        const eventPath = `${trackPath}.events[${eventIndex}]`;
        if (!isRecord(event)) throw new Error(`${eventPath} must be an object`);
        assertString(event.id, `${eventPath}.id`);
        if (eventIds.has(event.id)) throw new Error(`${eventPath}.id must be unique`);
        eventIds.add(event.id);
        if (event.kind !== "step" && event.kind !== "release") throw new Error(`${eventPath}.kind must be step or release`);
        assertFinite(event.at, `${eventPath}.at`);
        if (event.at < 0 || event.at > 1) throw new Error(`${eventPath}.at must be in 0...1`);
        if (event.componentId !== undefined) {
          assertString(event.componentId, `${eventPath}.componentId`);
          if (!definitions.has(event.componentId)) throw new Error(`${eventPath}.componentId must match a component definition`);
        }
        if (event.kind === "release") {
          assertFinite(event.end, `${eventPath}.end`);
          if (event.end <= event.at || event.end > 1) throw new Error(`${eventPath}.end must be greater than at and <= 1`);
        } else if (event.end !== undefined) {
          throw new Error(`${eventPath}.end is only valid for release events`);
        }
        if (event.payload !== undefined) materialValues(event.payload, `${eventPath}.payload`);
      });
    }
  });

  if (!isRecord(value.reducedMotion)) throw new Error("scene.reducedMotion must be an object");
  if (value.reducedMotion.mode !== "crossfade") throw new Error("scene.reducedMotion.mode must be crossfade");
  assertFinite(value.reducedMotion.durationMs, "scene.reducedMotion.durationMs");
  assertFinite(value.reducedMotion.fadeStart, "scene.reducedMotion.fadeStart");
  assertFinite(value.reducedMotion.fadeEnd, "scene.reducedMotion.fadeEnd");
  if (value.reducedMotion.durationMs <= 0) throw new Error("scene.reducedMotion.durationMs must be > 0");
  if (value.reducedMotion.fadeStart < 0 || value.reducedMotion.fadeStart > 1 || value.reducedMotion.fadeEnd < 0 || value.reducedMotion.fadeEnd > 1) {
    throw new Error("scene.reducedMotion fade bounds must be in 0...1");
  }
  if (value.reducedMotion.fadeEnd <= value.reducedMotion.fadeStart) throw new Error("scene.reducedMotion fadeStart must be less than fadeEnd");
}

export function validateScene(value: unknown): asserts value is AnyLiquidScene {
  if (!isRecord(value)) throw new Error("scene must be an object");
  if (value.schemaVersion === 1) {
    validateSceneV1(value);
    return;
  }
  if (value.schemaVersion === 2) {
    validateSceneV2(value);
    return;
  }
  throw new Error("scene.schemaVersion must be 1 or 2");
}

export function validateSampleManifest(value: unknown): asserts value is SampleManifest {
  if (!isRecord(value)) throw new Error("sample manifest must be an object");
  if (value.schemaVersion !== 1) throw new Error("sample manifest schemaVersion must be 1");
  assertString(value.sceneId, "sample manifest sceneId");
  if (!Array.isArray(value.samples)) throw new Error("sample manifest samples must be an array");
  const labels = new Set<string>();
  value.samples.forEach((sample, index) => {
    if (!isRecord(sample)) throw new Error(`samples[${index}] must be an object`);
    assertString(sample.label, `samples[${index}].label`);
    if (labels.has(sample.label)) throw new Error(`samples[${index}].label must be unique`);
    labels.add(sample.label);
    assertFinite(sample.progress, `samples[${index}].progress`);
    if (sample.progress < 0 || sample.progress > 1) throw new Error(`samples[${index}].progress must be in 0...1`);
  });
}

export function ensureCapsule(value: Capsule): Capsule {
  capsule(value, "capsule");
  return value;
}
