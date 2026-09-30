import type { Capsule, ComponentState, CubicRibbon, Ellipse, MaterialScalar, MaterialValues, Point, PoseFrame, Primitive } from "./types.js";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function point(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function capsule(a: Capsule, b: Capsule, t: number): Capsule {
  return {
    start: point(a.start, b.start, t),
    end: point(a.end, b.end, t),
    radius: lerp(a.radius, b.radius, t),
  };
}

function ribbon(a: CubicRibbon, b: CubicRibbon, t: number): CubicRibbon {
  return {
    p0: point(a.p0, b.p0, t),
    p1: point(a.p1, b.p1, t),
    p2: point(a.p2, b.p2, t),
    p3: point(a.p3, b.p3, t),
    startRadius: lerp(a.startRadius, b.startRadius, t),
    endRadius: lerp(a.endRadius, b.endRadius, t),
  };
}

function ellipse(a: Ellipse, b: Ellipse, t: number): Ellipse {
  return {
    center: point(a.center, b.center, t),
    radiusX: lerp(a.radiusX, b.radiusX, t),
    radiusY: lerp(a.radiusY, b.radiusY, t),
    rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, t),
  };
}

function scalar(a: MaterialScalar | undefined, b: MaterialScalar | undefined, t: number): MaterialScalar {
  if (typeof a === "number" && typeof b === "number") return lerp(a, b, t);
  if (b === undefined) return a ?? 0;
  if (a === undefined) return b;
  return t < 1 ? a : b;
}

export function interpolatePrimitive(a: Primitive, b: Primitive, t: number): Primitive {
  if (a.kind !== b.kind) throw new Error(`Cannot interpolate ${a.kind} to ${b.kind}`);
  if (a.kind === "capsule" && b.kind === "capsule") return { kind: "capsule", ...capsule(a, b, t) };
  if (a.kind === "ribbon" && b.kind === "ribbon") return { kind: "ribbon", ...ribbon(a, b, t) };
  if (a.kind === "ellipse" && b.kind === "ellipse") return { kind: "ellipse", ...ellipse(a, b, t) };
  throw new Error("Unsupported primitive kind");
}

export function interpolateMaterial(a: MaterialValues = {}, b: MaterialValues = {}, t: number): MaterialValues {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const output: Record<string, MaterialScalar> = {};
  for (const key of [...keys].sort()) output[key] = scalar(a[key], b[key], t);
  return output;
}

export function interpolateComponentState(a: ComponentState, b: ComponentState, t: number): ComponentState {
  if (a.id !== b.id) throw new Error(`Cannot interpolate component ${a.id} to ${b.id}`);
  return { id: a.id, primitive: interpolatePrimitive(a.primitive, b.primitive, t) };
}

export function interpolateFrame(a: PoseFrame, b: PoseFrame, t: number): PoseFrame {
  return {
    anchor: point(a.anchor, b.anchor, t),
    leftLeg: capsule(a.leftLeg, b.leftLeg, t),
    rightLeg: capsule(a.rightLeg, b.rightLeg, t),
    crossbar: capsule(a.crossbar, b.crossbar, t),
    bridge: capsule(a.bridge, b.bridge, t),
    blendRadius: lerp(a.blendRadius, b.blendRadius, t),
    targetMix: lerp(a.targetMix, b.targetMix, t),
    cornerSharpness: lerp(a.cornerSharpness, b.cornerSharpness, t),
  };
}
