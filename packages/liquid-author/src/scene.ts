import { validateScene, validateSceneV1, validateSceneV2, type AnyLiquidScene, type LiquidScene, type LiquidSceneV2 } from "@liquid/core";
import { canonicalize, canonicalSerialize, deepClone } from "./utils.js";

export function loadScene(input: string | unknown): AnyLiquidScene {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  validateScene(parsed);
  return canonicalize(deepClone(parsed));
}

export function cloneScene<T extends AnyLiquidScene>(scene: T): T {
  return canonicalize(deepClone(scene));
}

export function normalizeScene<T extends AnyLiquidScene>(scene: T): T {
  validateScene(scene);
  return canonicalize(deepClone(scene));
}

export function validateAuthoringScene(scene: unknown): asserts scene is AnyLiquidScene {
  validateScene(scene);
}

export function validateAuthoringSceneV1(scene: unknown): asserts scene is LiquidScene {
  validateSceneV1(scene);
}

export function validateAuthoringSceneV2(scene: unknown): asserts scene is LiquidSceneV2 {
  validateSceneV2(scene);
}

export { canonicalSerialize };
