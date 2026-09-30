import type { AnyLiquidScene } from "@liquid/core";
import { applyScenePatch, type ScenePatch } from "./patch.js";
import { cloneScene, loadScene, normalizeScene } from "./scene.js";
import { canonicalSerialize } from "./utils.js";
import { diffScenes, type AuthoringSnapshot, type SceneDiff } from "./diff.js";

export class AuthoringDocument {
  #committed: AnyLiquidScene;
  #working: AnyLiquidScene;
  #snapshots = new Map<string, AuthoringSnapshot>();

  constructor(scene: AnyLiquidScene) {
    this.#committed = normalizeScene(scene);
    this.#working = cloneScene(this.#committed);
  }

  static load(input: string | unknown): AuthoringDocument {
    return new AuthoringDocument(loadScene(input));
  }

  get scene(): AnyLiquidScene {
    return cloneScene(this.#working);
  }

  get committedScene(): AnyLiquidScene {
    return cloneScene(this.#committed);
  }

  get dirty(): boolean {
    return canonicalSerialize(this.#working) !== canonicalSerialize(this.#committed);
  }

  diff(base: "committed" | string = "committed"): SceneDiff {
    const before = base === "committed" ? this.#committed : this.snapshot(base).scene;
    return diffScenes(before, this.#working);
  }

  patch(patch: ScenePatch): AnyLiquidScene {
    this.#working = applyScenePatch(this.#working, patch);
    return this.scene;
  }

  replaceWorking(scene: AnyLiquidScene): void {
    this.#working = normalizeScene(scene);
  }

  commit(name = "committed"): AuthoringSnapshot {
    this.#committed = cloneScene(this.#working);
    return this.snapshot(name);
  }

  resetToCommitted(): AnyLiquidScene {
    this.#working = cloneScene(this.#committed);
    return this.scene;
  }

  snapshot(name: string): AuthoringSnapshot {
    const scene = cloneScene(this.#working);
    const snapshot = { name, scene, serialized: canonicalSerialize(scene) };
    this.#snapshots.set(name, snapshot);
    return snapshot;
  }

  snapshots(): readonly AuthoringSnapshot[] {
    return [...this.#snapshots.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  restoreSnapshot(name: string): AnyLiquidScene {
    const snapshot = this.#snapshots.get(name);
    if (!snapshot) throw new Error(`No snapshot exists with name ${name}`);
    this.#working = cloneScene(snapshot.scene);
    return this.scene;
  }
}

export { diffScenes };
