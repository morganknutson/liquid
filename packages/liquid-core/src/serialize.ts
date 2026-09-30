import type { LiquidFrameOutput, LiquidFrameSample, PathCommand } from "./types.js";

export function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number ${value}`);
  }
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalCommand(command: PathCommand): PathCommand {
  if (command.type === "Z") return { type: "Z" };
  if (command.type === "C") {
    return { type: "C", values: command.values.map(canonicalNumber) as [number, number, number, number, number, number] };
  }
  return { type: command.type, values: command.values.map(canonicalNumber) as [number, number] };
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = key === "endpointCommands" && Array.isArray(child)
        ? child.map((command) => canonicalCommand(command as PathCommand))
        : canonicalize(child);
    }
    return output;
  }
  return value;
}

export function canonicalValue<T>(value: T): T {
  return canonicalize(value) as T;
}

export function canonicalSample(sample: LiquidFrameSample): LiquidFrameSample {
  return canonicalValue(sample);
}

export function canonicalOutput(output: LiquidFrameOutput): LiquidFrameOutput {
  return canonicalValue(output);
}

export function serializeLiquidFrameOutput(output: LiquidFrameOutput): string {
  return `${JSON.stringify(canonicalOutput(output), null, 2)}\n`;
}
