import { applyScenePatch, type ScenePatch } from "./patch.js";
import { loadScene, normalizeScene } from "./scene.js";
import { canonicalSerialize } from "./utils.js";

export interface CliHost {
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, value: string) => Promise<void>;
  readonly stdout: (value: string) => void;
}

function usage(): never {
  throw new Error("Usage: liquid-author <validate|normalize|patch|export> <scene.json> [--patch patch.json] [--out out.json]");
}

export async function runAuthorCli(args: readonly string[], host: CliHost): Promise<void> {
  const [command, scenePath, ...rest] = args;
  if (!command || !scenePath) usage();
  const scene = loadScene(await host.readText(scenePath));
  const outIndex = rest.indexOf("--out");
  const outPath = outIndex >= 0 ? rest[outIndex + 1] : undefined;

  if (command === "validate") {
    host.stdout(`${scene.id} schemaVersion=${scene.schemaVersion} ok\n`);
    return;
  }

  if (command === "normalize" || command === "export") {
    const serialized = canonicalSerialize(normalizeScene(scene));
    if (outPath) await host.writeText(outPath, serialized);
    else host.stdout(serialized);
    return;
  }

  if (command === "patch") {
    const patchIndex = rest.indexOf("--patch");
    const patchPath = patchIndex >= 0 ? rest[patchIndex + 1] : undefined;
    if (!patchPath) usage();
    const patch = JSON.parse(await host.readText(patchPath)) as ScenePatch;
    const serialized = canonicalSerialize(applyScenePatch(scene, patch));
    if (outPath) await host.writeText(outPath, serialized);
    else host.stdout(serialized);
    return;
  }

  usage();
}
