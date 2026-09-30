import type { AnyLiquidScene } from "@liquid/core";
import { canonicalSerialize } from "./utils.js";

export interface AuthoringSnapshot {
  readonly name: string;
  readonly scene: AnyLiquidScene;
  readonly serialized: string;
}

export interface SceneDiff {
  readonly changed: boolean;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly changedPaths: readonly string[];
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function collectPaths(before: unknown, after: unknown, path: string, output: string[]): void {
  if (canonicalSerialize(before) === canonicalSerialize(after)) return;
  if (before === null || after === null || typeof before !== "object" || typeof after !== "object") {
    output.push(path || "$");
    return;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    collectPaths((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key, output);
  }
}

export function diffScenes(before: AnyLiquidScene, after: AnyLiquidScene): SceneDiff {
  const beforeSerialized = canonicalSerialize(before);
  const afterSerialized = canonicalSerialize(after);
  const changedPaths: string[] = [];
  collectPaths(before, after, "", changedPaths);
  return {
    changed: beforeSerialized !== afterSerialized,
    beforeHash: hashString(beforeSerialized),
    afterHash: hashString(afterSerialized),
    changedPaths,
  };
}
