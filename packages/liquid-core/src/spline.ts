import type { ComponentState, MaterialScalar, MaterialValues, Primitive, TrackKeyframe } from "./types.js";

// Monotone cubic Hermite interpolation (PCHIP) across a track's keyframes.
// Values pass through every keyframe without overshoot, velocity is continuous
// at interior keyframes, and the first and last keyframes are reached at rest.

export interface SplineSegment {
  readonly index: number;
  readonly u: number;
}

export function splineSegment(keyframes: readonly TrackKeyframe[], progress: number): SplineSegment {
  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    if (!previous || !next) throw new Error("Invalid keyframe list");
    if (progress <= next.at) {
      const span = next.at - previous.at;
      return { index, u: span <= 0 ? 1 : (progress - previous.at) / span };
    }
  }
  return { index: keyframes.length - 1, u: 1 };
}

type Channel = (keyframeIndex: number) => number | null;

function tangent(keyframes: readonly TrackKeyframe[], channel: Channel, index: number): number {
  if (index <= 0 || index >= keyframes.length - 1) return 0;
  const previous = channel(index - 1);
  const current = channel(index);
  const next = channel(index + 1);
  if (previous === null || current === null || next === null) return 0;
  const h0 = keyframes[index]!.at - keyframes[index - 1]!.at;
  const h1 = keyframes[index + 1]!.at - keyframes[index]!.at;
  const d0 = (current - previous) / h0;
  const d1 = (next - current) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

function hermite(keyframes: readonly TrackKeyframe[], channel: Channel, segment: SplineSegment, y0: number, y1: number): number {
  const { index, u } = segment;
  const h = keyframes[index]!.at - keyframes[index - 1]!.at;
  const m0 = tangent(keyframes, channel, index - 1);
  const m1 = tangent(keyframes, channel, index);
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
}

function primitiveValues(primitive: Primitive): number[] {
  if (primitive.kind === "capsule") return [primitive.start.x, primitive.start.y, primitive.end.x, primitive.end.y, primitive.radius];
  if (primitive.kind === "ribbon") {
    return [
      primitive.p0.x, primitive.p0.y, primitive.p1.x, primitive.p1.y,
      primitive.p2.x, primitive.p2.y, primitive.p3.x, primitive.p3.y,
      primitive.startRadius, primitive.endRadius,
    ];
  }
  return [primitive.center.x, primitive.center.y, primitive.radiusX, primitive.radiusY, primitive.rotation ?? 0];
}

function primitiveFromValues(kind: Primitive["kind"], v: readonly number[]): Primitive {
  if (kind === "capsule") return { kind, start: { x: v[0]!, y: v[1]! }, end: { x: v[2]!, y: v[3]! }, radius: v[4]! };
  if (kind === "ribbon") {
    return {
      kind,
      p0: { x: v[0]!, y: v[1]! },
      p1: { x: v[2]!, y: v[3]! },
      p2: { x: v[4]!, y: v[5]! },
      p3: { x: v[6]!, y: v[7]! },
      startRadius: v[8]!,
      endRadius: v[9]!,
    };
  }
  return { kind, center: { x: v[0]!, y: v[1]! }, radiusX: v[2]!, radiusY: v[3]!, rotation: v[4]! };
}

export function splineComponentState(keyframes: readonly TrackKeyframe[], componentId: string, segment: SplineSegment): ComponentState {
  const values = keyframes.map((keyframe) => {
    const state = keyframe.components.find((candidate) => candidate.id === componentId);
    if (!state) throw new Error(`Missing keyframe state for component ${componentId}`);
    return primitiveValues(state.primitive);
  });
  const kind = keyframes[segment.index]!.components.find((candidate) => candidate.id === componentId)!.primitive.kind;
  const output = values[segment.index]!.map((_, channelIndex) => {
    const channel: Channel = (keyframeIndex) => values[keyframeIndex]![channelIndex]!;
    return hermite(keyframes, channel, segment, values[segment.index - 1]![channelIndex]!, values[segment.index]![channelIndex]!);
  });
  return { id: componentId, primitive: primitiveFromValues(kind, output) };
}

type MaterialSectionName = "components" | "groups";

function materialValue(keyframe: TrackKeyframe, section: MaterialSectionName, id: string, key: string): MaterialScalar | undefined {
  return keyframe.material?.[section]?.[id]?.[key];
}

export function splineMaterialSection(keyframes: readonly TrackKeyframe[], section: MaterialSectionName, segment: SplineSegment): Readonly<Record<string, MaterialValues>> {
  const previous = keyframes[segment.index - 1]!.material?.[section] ?? {};
  const next = keyframes[segment.index]!.material?.[section] ?? {};
  const output: Record<string, MaterialValues> = {};
  for (const id of [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort()) {
    const a = previous[id] ?? {};
    const b = next[id] ?? {};
    const values: Record<string, MaterialScalar> = {};
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const y0 = a[key];
      const y1 = b[key];
      if (typeof y0 === "number" && typeof y1 === "number") {
        const channel: Channel = (keyframeIndex) => {
          const value = materialValue(keyframes[keyframeIndex]!, section, id, key);
          return typeof value === "number" ? value : null;
        };
        values[key] = hermite(keyframes, channel, segment, y0, y1);
      } else if (y1 === undefined) {
        values[key] = y0 ?? 0;
      } else if (y0 === undefined) {
        values[key] = y1;
      } else {
        values[key] = segment.u < 1 ? y0 : y1;
      }
    }
    output[id] = values;
  }
  return output;
}
