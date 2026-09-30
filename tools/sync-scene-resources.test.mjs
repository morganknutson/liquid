import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { RESOURCE_FILES, RESOURCE_TARGETS, runSyncSceneResources } from "./sync-scene-resources.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

async function makeFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "liquid-resources-"));
  for (const file of RESOURCE_FILES) {
    const absolute = path.join(root, file.source);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `${file.kind}:${file.id}:${file.source}\n`);
  }
  return root;
}

test("scene resource sync writes both npm and Swift targets with one manifest", async () => {
  const root = await makeFixtureRoot();
  const result = await runSyncSceneResources({ repositoryRoot: root });

  assert.equal(result.manifest.files.length, RESOURCE_FILES.length);
  assert.deepEqual(result.manifest.targets.map((target) => target.id), ["npm", "swift"]);

  for (const target of RESOURCE_TARGETS) {
    const manifest = JSON.parse(await readFile(path.join(root, target.root, "resources.manifest.json"), "utf8"));
    assert.equal(manifest.resourceVersion, 1);
    for (const file of RESOURCE_FILES) {
      const copied = await readFile(path.join(root, target.root, file.output), "utf8");
      assert.equal(copied, `${file.kind}:${file.id}:${file.source}\n`);
    }
  }
});

test("scene resource check rejects stale and unexpected outputs", async () => {
  const root = await makeFixtureRoot();
  await runSyncSceneResources({ repositoryRoot: root });

  await writeFile(path.join(root, "packages/liquid-scenes/scenes/capsule-to-a.v1.json"), "stale\n");
  await writeFile(path.join(root, "Sources/LiquidScenes/Resources/assets/old.svg"), "<svg />\n");

  await assert.rejects(
    () => runSyncSceneResources({ repositoryRoot: root, check: true }),
    /scene resources are stale[\s\S]*capsule-to-a\.v1\.json[\s\S]*old\.svg/,
  );
});

test("checked-in scene resources are current", async () => {
  const result = await runSyncSceneResources({ repositoryRoot, check: true });
  assert.equal(result.changed.length, 0);
  assert.equal(result.staleFiles.length, 0);
});

test("npm scene package dry-run packs stable resource paths", async () => {
  const { stdout } = await execFileAsync("npm", ["pack", "--workspace", "@liquid/scenes", "--dry-run", "--json"], {
    cwd: repositoryRoot,
    maxBuffer: 1024 * 1024,
  });
  const [packed] = JSON.parse(stdout);
  const files = new Set(packed.files.map((file) => file.path));
  assert.equal(packed.name, "@liquid/scenes");
  assert.ok(files.has("scenes/capsule-to-a.v1.json"));
  assert.ok(files.has("scenes/spinner-to-ad.v2.json"));
  assert.ok(files.has("scenes/spinner-to-addy.v2.json"));
  assert.ok(files.has("assets/manifest.json"));
  assert.ok(files.has("samples/spinner-to-addy.samples.json"));
  assert.ok(files.has("resources.manifest.json"));
});
