import { canonicalNumber } from "@liquid/core";

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableValue(value: unknown): unknown {
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

export function canonicalize<T>(value: T): T {
  return stableValue(value) as T;
}

export function canonicalSerialize(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function uniqueSorted<T>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}
