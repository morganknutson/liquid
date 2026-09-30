import type {
  Capsule,
  ComponentDefinition,
  ComponentState,
  CubicRibbon,
  EasingName,
  Ellipse,
  Endpoint,
  LiquidSceneV2,
  MaterialScalar,
  MaterialValues,
  Point,
  Primitive,
  ReducedMotion,
  SemanticEvent,
  TrackKeyframe,
} from "@liquid/core";
import { validateSceneV2 } from "@liquid/core";
import { canonicalize, deepClone } from "./utils.js";

export type Constraint =
  | { readonly type: "pin"; readonly componentId: string; readonly point: Point; readonly at?: number }
  | { readonly type: "adhesion"; readonly groupId: string; readonly radius: number; readonly at: number }
  | { readonly type: "release"; readonly componentId: string; readonly at: number; readonly end: number }
  | { readonly type: "step"; readonly id: string; readonly at: number; readonly componentId?: string; readonly payload?: Readonly<Record<string, MaterialScalar>> }
  | { readonly type: "materialRamp"; readonly target: "component" | "group"; readonly id: string; readonly property: string; readonly from: MaterialScalar; readonly to: MaterialScalar; readonly start: number; readonly end: number }
  | { readonly type: "overshootSettle"; readonly componentId: string; readonly axis: "x" | "y"; readonly amount: number; readonly at: number; readonly settleAt: number }
  | { readonly type: "stretchLimit"; readonly componentId: string; readonly maxLength: number }
  | { readonly type: "snapToTarget"; readonly at: number; readonly targetMix?: number; readonly cornerSharpness?: number };

export interface AuthoringComponent {
  readonly id: string;
  readonly kind: ComponentDefinition["kind"];
  readonly operation?: ComponentDefinition["operation"];
  readonly groupId?: string;
  readonly from: Primitive;
  readonly to: Primitive;
}

export interface AuthoringTrack {
  readonly id: string;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly timing?: { readonly start: number; readonly end: number };
  readonly components: readonly AuthoringComponent[];
  readonly constraints?: readonly Constraint[];
}

export interface AuthoringDocumentInput {
  readonly id: string;
  readonly fixtureVersion?: number;
  readonly durationMs: number;
  readonly coordinateSpace: { readonly width: number; readonly height: number };
  readonly fillRule?: "nonzero" | "evenodd";
  readonly reducedMotion?: ReducedMotion;
  readonly tracks: readonly AuthoringTrack[];
}

function zeroEndpoint(id: string): Endpoint {
  const commands = [
    { type: "M", values: [0, 0] },
    { type: "L", values: [1, 0] },
    { type: "L", values: [1, 1] },
    { type: "L", values: [0, 1] },
    { type: "Z" },
  ] as const;
  return {
    assetId: "authoring",
    shapeId: id,
    transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
    commands,
  };
}

type KeyframeMaterial = NonNullable<TrackKeyframe["material"]>;
type MaterialSection = NonNullable<KeyframeMaterial["components"]>;

const easingRank: Readonly<Record<EasingName, number>> = {
  linear: 0,
  smoothStep: 1,
  smootherStep: 2,
  easeInCubic: 3,
  easeOutCubic: 4,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertProgress(value: unknown, path: string): asserts value is number {
  if (!finite(value) || value < 0 || value > 1) throw new Error(`${path} must be a finite number in 0...1`);
}

function assertPositive(value: unknown, path: string, allowZero = false): asserts value is number {
  if (!finite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${path} must be ${allowZero ? ">= 0" : "> 0"}`);
}

function assertNonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be a non-empty string`);
}

function assertMaterialScalar(value: unknown, path: string): asserts value is MaterialScalar {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number, string, or boolean`);
    return;
  }
  if (typeof value !== "string" && typeof value !== "boolean") throw new Error(`${path} must be a finite number, string, or boolean`);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolatePoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function interpolateCapsule(a: Capsule, b: Capsule, t: number): Capsule {
  return {
    start: interpolatePoint(a.start, b.start, t),
    end: interpolatePoint(a.end, b.end, t),
    radius: lerp(a.radius, b.radius, t),
  };
}

function interpolateRibbon(a: CubicRibbon, b: CubicRibbon, t: number): CubicRibbon {
  return {
    p0: interpolatePoint(a.p0, b.p0, t),
    p1: interpolatePoint(a.p1, b.p1, t),
    p2: interpolatePoint(a.p2, b.p2, t),
    p3: interpolatePoint(a.p3, b.p3, t),
    startRadius: lerp(a.startRadius, b.startRadius, t),
    endRadius: lerp(a.endRadius, b.endRadius, t),
  };
}

function interpolateEllipse(a: Ellipse, b: Ellipse, t: number): Ellipse {
  return {
    center: interpolatePoint(a.center, b.center, t),
    radiusX: lerp(a.radiusX, b.radiusX, t),
    radiusY: lerp(a.radiusY, b.radiusY, t),
    rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, t),
  };
}

function interpolatePrimitive(a: Primitive, b: Primitive, t: number): Primitive {
  if (a.kind !== b.kind) throw new Error(`Cannot interpolate ${a.kind} to ${b.kind}`);
  if (a.kind === "capsule" && b.kind === "capsule") return { kind: "capsule", ...interpolateCapsule(a, b, t) };
  if (a.kind === "ribbon" && b.kind === "ribbon") return { kind: "ribbon", ...interpolateRibbon(a, b, t) };
  if (a.kind === "ellipse" && b.kind === "ellipse") return { kind: "ellipse", ...interpolateEllipse(a, b, t) };
  throw new Error("Unsupported primitive kind");
}

function primitiveWithPoint(primitive: Primitive, point: Point): Primitive {
  if (primitive.kind === "capsule") return { ...primitive, start: { ...point } };
  if (primitive.kind === "ellipse") return { ...primitive, center: { ...point } };
  return { ...primitive, p0: { ...point } };
}

function offsetPrimitive(primitive: Primitive, axis: "x" | "y", amount: number): Primitive {
  const move = (point: Point): Point => axis === "x" ? { x: point.x + amount, y: point.y } : { x: point.x, y: point.y + amount };
  if (primitive.kind === "capsule") return { ...primitive, start: move(primitive.start), end: move(primitive.end) };
  if (primitive.kind === "ellipse") return { ...primitive, center: move(primitive.center) };
  return { ...primitive, p0: move(primitive.p0), p1: move(primitive.p1), p2: move(primitive.p2), p3: move(primitive.p3) };
}

function capStretch(primitive: Primitive, maxLength: number): Primitive {
  if (primitive.kind !== "capsule") return primitive;
  const dx = primitive.end.x - primitive.start.x;
  const dy = primitive.end.y - primitive.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= maxLength || length === 0) return primitive;
  const scale = maxLength / length;
  return {
    ...primitive,
    end: { x: primitive.start.x + dx * scale, y: primitive.start.y + dy * scale },
  };
}

function keyframe(at: number, easing: EasingName, components: readonly ComponentState[]): TrackKeyframe {
  return { at, easing, components: components.map((component) => deepClone(component)) };
}

function stateMap(states: readonly ComponentState[]): Map<string, ComponentState> {
  return new Map(states.map((state) => [state.id, state]));
}

function statesFromMap(componentOrder: readonly string[], states: ReadonlyMap<string, ComponentState>): ComponentState[] {
  return componentOrder.map((id) => {
    const state = states.get(id);
    if (!state) throw new Error(`Compiler expected component state for ${id}`);
    return deepClone(state);
  });
}

function strongerEasing(a: EasingName, b: EasingName): EasingName {
  return easingRank[b] > easingRank[a] ? b : a;
}

class TrackTimeline {
  private readonly frames = new Map<number, TrackKeyframe>();

  public constructor(
    private readonly componentOrder: readonly string[],
    private readonly fromStates: readonly ComponentState[],
    private readonly toStates: readonly ComponentState[],
  ) {
    this.frames.set(0, keyframe(0, "linear", fromStates));
    this.frames.set(1, keyframe(1, "smootherStep", toStates));
  }

  public ensure(at: number, easing: EasingName): TrackKeyframe {
    const existing = this.frames.get(at);
    if (existing) {
      this.frames.set(at, { ...existing, easing: strongerEasing(existing.easing, easing) });
      return this.frames.get(at) ?? existing;
    }
    const frame = keyframe(at, easing, this.sampleStates(at));
    this.frames.set(at, frame);
    return frame;
  }

  public setComponents(at: number, easing: EasingName, states: readonly ComponentState[]): void {
    const frame = this.ensure(at, easing);
    this.frames.set(at, { ...frame, components: states.map((state) => deepClone(state)) });
  }

  public patchComponent(at: number, easing: EasingName, componentId: string, primitive: Primitive): void {
    const frame = this.ensure(at, easing);
    const states = stateMap(frame.components);
    const current = states.get(componentId);
    if (!current) throw new Error(`Compiler expected component ${componentId}`);
    states.set(componentId, { ...current, primitive: deepClone(primitive) });
    this.frames.set(at, { ...frame, components: statesFromMap(this.componentOrder, states) });
  }

  public materialAt(at: number, easing: EasingName, target: "component" | "group", id: string, property: string, value: MaterialScalar): void {
    const frame = this.ensure(at, easing);
    const section = target === "component" ? "components" : "groups";
    const material: KeyframeMaterial = frame.material ?? {};
    const existingSection: MaterialSection = material[section] ?? {};
    const existingValues = existingSection[id] ?? {};
    const nextMaterial: KeyframeMaterial = {
      ...material,
      [section]: {
        ...existingSection,
        [id]: { ...existingValues, [property]: value },
      },
    };
    this.frames.set(at, { ...frame, material: nextMaterial });
  }

  public build(): TrackKeyframe[] {
    return [...this.frames.values()].sort((a, b) => a.at - b.at);
  }

  private sampleStates(at: number): ComponentState[] {
    const from = stateMap(this.fromStates);
    const to = stateMap(this.toStates);
    return this.componentOrder.map((id) => {
      const start = from.get(id);
      const end = to.get(id);
      if (!start || !end) throw new Error(`Compiler expected component ${id}`);
      return { id, primitive: interpolatePrimitive(start.primitive, end.primitive, at) };
    });
  }
}

function validateInput(input: AuthoringDocumentInput): void {
  assertNonEmpty(input.id, "input.id");
  if (input.fixtureVersion !== undefined) assertPositive(input.fixtureVersion, "input.fixtureVersion");
  assertPositive(input.durationMs, "input.durationMs");
  assertPositive(input.coordinateSpace.width, "input.coordinateSpace.width");
  assertPositive(input.coordinateSpace.height, "input.coordinateSpace.height");
  if (input.fillRule !== undefined && input.fillRule !== "nonzero" && input.fillRule !== "evenodd") throw new Error("input.fillRule must be nonzero or evenodd");
  if (!Array.isArray(input.tracks) || input.tracks.length === 0) throw new Error("input.tracks must not be empty");

  const trackIds = new Set<string>();
  input.tracks.forEach((track, trackIndex) => validateTrack(track, trackIndex, trackIds));
}

function validateTrack(track: AuthoringTrack, trackIndex: number, trackIds: Set<string>): void {
  const trackPath = `input.tracks[${trackIndex}]`;
  assertNonEmpty(track.id, `${trackPath}.id`);
  if (trackIds.has(track.id)) throw new Error(`${trackPath}.id must be unique`);
  trackIds.add(track.id);
  if (track.timing !== undefined) {
    assertProgress(track.timing.start, `${trackPath}.timing.start`);
    assertProgress(track.timing.end, `${trackPath}.timing.end`);
    if (track.timing.end <= track.timing.start) throw new Error(`${trackPath}.timing must satisfy start < end`);
  }
  if (!Array.isArray(track.components) || track.components.length === 0) throw new Error(`${trackPath}.components must not be empty`);

  const componentIds = new Set<string>();
  const groupIds = new Set<string>();
  track.components.forEach((component, componentIndex) => {
    const componentPath = `${trackPath}.components[${componentIndex}]`;
    assertNonEmpty(component.id, `${componentPath}.id`);
    if (componentIds.has(component.id)) throw new Error(`${componentPath}.id must be unique`);
    componentIds.add(component.id);
    if (component.groupId !== undefined) {
      assertNonEmpty(component.groupId, `${componentPath}.groupId`);
      groupIds.add(component.groupId);
    }
    if (component.from.kind !== component.kind) throw new Error(`${componentPath}.from.kind must match component kind`);
    if (component.to.kind !== component.kind) throw new Error(`${componentPath}.to.kind must match component kind`);
  });

  validateConstraints(track.constraints ?? [], trackPath, componentIds, groupIds);
}

function validateConstraintMaterialWrite(
  materialWrites: Set<string>,
  at: number,
  target: "component" | "group",
  id: string,
  property: string,
  path: string,
): void {
  const key = `${at}:${target}:${id}:${property}`;
  if (materialWrites.has(key)) throw new Error(`${path} conflicts with another material write at the same timestamp`);
  materialWrites.add(key);
}

function validateConstraints(
  constraints: readonly Constraint[],
  trackPath: string,
  componentIds: ReadonlySet<string>,
  groupIds: ReadonlySet<string>,
): void {
  const eventIds = new Set<string>();
  const materialWrites = new Set<string>();
  constraints.forEach((constraint, index) => {
    const path = `${trackPath}.constraints[${index}]`;
    if (constraint.type === "pin") {
      if (!componentIds.has(constraint.componentId)) throw new Error(`${path}.componentId must match a component`);
      if (constraint.at !== undefined) assertProgress(constraint.at, `${path}.at`);
      if (!finite(constraint.point.x) || !finite(constraint.point.y)) throw new Error(`${path}.point must contain finite x and y`);
      return;
    }
    if (constraint.type === "adhesion") {
      if (!groupIds.has(constraint.groupId)) throw new Error(`${path}.groupId must match a component group`);
      assertProgress(constraint.at, `${path}.at`);
      assertPositive(constraint.radius, `${path}.radius`, true);
      validateConstraintMaterialWrite(materialWrites, constraint.at, "group", constraint.groupId, "blendRadius", path);
      return;
    }
    if (constraint.type === "release") {
      if (!componentIds.has(constraint.componentId)) throw new Error(`${path}.componentId must match a component`);
      assertProgress(constraint.at, `${path}.at`);
      assertProgress(constraint.end, `${path}.end`);
      if (constraint.end <= constraint.at) throw new Error(`${path}.end must be greater than at`);
      return;
    }
    if (constraint.type === "step") {
      assertNonEmpty(constraint.id, `${path}.id`);
      if (eventIds.has(constraint.id)) throw new Error(`${path}.id must be unique`);
      eventIds.add(constraint.id);
      assertProgress(constraint.at, `${path}.at`);
      if (constraint.componentId !== undefined && !componentIds.has(constraint.componentId)) throw new Error(`${path}.componentId must match a component`);
      for (const [key, value] of Object.entries(constraint.payload ?? {})) assertMaterialScalar(value, `${path}.payload.${key}`);
      return;
    }
    if (constraint.type === "materialRamp") {
      assertNonEmpty(constraint.id, `${path}.id`);
      if (constraint.target === "component" && !componentIds.has(constraint.id)) throw new Error(`${path}.id must match a component`);
      if (constraint.target === "group" && !groupIds.has(constraint.id)) throw new Error(`${path}.id must match a component group`);
      assertNonEmpty(constraint.property, `${path}.property`);
      assertProgress(constraint.start, `${path}.start`);
      assertProgress(constraint.end, `${path}.end`);
      if (constraint.end <= constraint.start) throw new Error(`${path}.end must be greater than start`);
      assertMaterialScalar(constraint.from, `${path}.from`);
      assertMaterialScalar(constraint.to, `${path}.to`);
      validateConstraintMaterialWrite(materialWrites, constraint.start, constraint.target, constraint.id, constraint.property, path);
      validateConstraintMaterialWrite(materialWrites, constraint.end, constraint.target, constraint.id, constraint.property, path);
      return;
    }
    if (constraint.type === "overshootSettle") {
      if (!componentIds.has(constraint.componentId)) throw new Error(`${path}.componentId must match a component`);
      if (!finite(constraint.amount)) throw new Error(`${path}.amount must be finite`);
      assertProgress(constraint.at, `${path}.at`);
      assertProgress(constraint.settleAt, `${path}.settleAt`);
      if (constraint.settleAt <= constraint.at) throw new Error(`${path}.settleAt must be greater than at`);
      return;
    }
    if (constraint.type === "stretchLimit") {
      if (!componentIds.has(constraint.componentId)) throw new Error(`${path}.componentId must match a component`);
      assertPositive(constraint.maxLength, `${path}.maxLength`, true);
      return;
    }
    if (constraint.type === "snapToTarget") {
      assertProgress(constraint.at, `${path}.at`);
      if (constraint.targetMix !== undefined) assertProgress(constraint.targetMix, `${path}.targetMix`);
      if (constraint.cornerSharpness !== undefined) assertProgress(constraint.cornerSharpness, `${path}.cornerSharpness`);
    }
  });
}

export function compileAuthoringDocument(input: AuthoringDocumentInput): LiquidSceneV2 {
  validateInput(input);
  const tracks = input.tracks.map((track) => {
    const definitions: ComponentDefinition[] = track.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      operation: component.operation ?? "union",
      ...(component.groupId === undefined ? {} : { groupId: component.groupId }),
    }));
    const constraints = [...(track.constraints ?? [])].sort((a, b) => {
      const aAt = "at" in a && typeof a.at === "number" ? a.at : 0;
      const bAt = "at" in b && typeof b.at === "number" ? b.at : 0;
      return aAt - bAt || a.type.localeCompare(b.type);
    });
    const fromStates = track.components.map((component) => ({ id: component.id, primitive: deepClone(component.from) }));
    const toStates = track.components.map((component) => {
      const stretch = constraints.find((constraint) => constraint.type === "stretchLimit" && constraint.componentId === component.id);
      const primitive = stretch?.type === "stretchLimit" ? capStretch(component.to, stretch.maxLength) : component.to;
      return { id: component.id, primitive: deepClone(primitive) };
    });
    const timeline = new TrackTimeline(track.components.map((component) => component.id), fromStates, toStates);
    const events: SemanticEvent[] = [];

    for (const constraint of constraints) {
      if (constraint.type === "pin") {
        const at = constraint.at ?? 0;
        const frame = timeline.ensure(at, "linear");
        const state = frame.components.find((candidate) => candidate.id === constraint.componentId);
        if (!state) throw new Error(`Compiler expected component ${constraint.componentId}`);
        timeline.patchComponent(at, "linear", constraint.componentId, primitiveWithPoint(state.primitive, constraint.point));
      } else if (constraint.type === "adhesion") {
        timeline.materialAt(constraint.at, "smoothStep", "group", constraint.groupId, "blendRadius", constraint.radius);
      } else if (constraint.type === "release") {
        const duplicateReleaseCount = events.filter((event) => event.kind === "release" && event.componentId === constraint.componentId).length;
        events.push({
          id: duplicateReleaseCount === 0 ? `${constraint.componentId}-release` : `${constraint.componentId}-release-${duplicateReleaseCount + 1}`,
          kind: "release",
          at: constraint.at,
          end: constraint.end,
          componentId: constraint.componentId,
        });
      } else if (constraint.type === "step") {
        events.push({
          id: constraint.id,
          kind: "step",
          at: constraint.at,
          ...(constraint.componentId === undefined ? {} : { componentId: constraint.componentId }),
          ...(constraint.payload === undefined ? {} : { payload: constraint.payload }),
        });
      } else if (constraint.type === "materialRamp") {
        timeline.materialAt(constraint.start, "linear", constraint.target, constraint.id, constraint.property, constraint.from);
        timeline.materialAt(constraint.end, "smoothStep", constraint.target, constraint.id, constraint.property, constraint.to);
      } else if (constraint.type === "overshootSettle") {
        const target = toStates.find((state) => state.id === constraint.componentId);
        if (!target) throw new Error(`Compiler expected component ${constraint.componentId}`);
        timeline.patchComponent(constraint.at, "easeOutCubic", constraint.componentId, offsetPrimitive(target.primitive, constraint.axis, constraint.amount));
        timeline.patchComponent(constraint.settleAt, "smoothStep", constraint.componentId, target.primitive);
      } else if (constraint.type === "snapToTarget") {
        timeline.setComponents(constraint.at, "smootherStep", toStates);
        timeline.materialAt(constraint.at, "smootherStep", "group", "$track", "targetMix", constraint.targetMix ?? 1);
        timeline.materialAt(constraint.at, "smootherStep", "group", "$track", "cornerSharpness", constraint.cornerSharpness ?? 1);
      }
    }

    return canonicalize({
      id: track.id,
      source: track.source ?? zeroEndpoint(`${track.id}-source`),
      target: track.target ?? zeroEndpoint(`${track.id}-target`),
      timing: track.timing ?? { start: 0, end: 1 },
      components: definitions,
      keyframes: timeline.build(),
      ...(events.length === 0 ? {} : { events: events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)) }),
    });
  });

  const scene = canonicalize({
    schemaVersion: 2,
    id: input.id,
    fixtureVersion: input.fixtureVersion ?? 1,
    durationMs: input.durationMs,
    coordinateSpace: input.coordinateSpace,
    fillRule: input.fillRule ?? "nonzero",
    tracks,
    reducedMotion: input.reducedMotion ?? { mode: "crossfade", durationMs: Math.max(1, Math.round(input.durationMs * 0.1)), fadeStart: 0.15, fadeEnd: 0.85 },
  } satisfies LiquidSceneV2);
  validateSceneV2(scene);
  return scene;
}
