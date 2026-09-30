import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  boundsForCommands,
  createManifest,
  parsePath,
  runCanonicalizeAssets,
  serializeManifest,
} from "./canonicalize-assets.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizes relative, horizontal, and vertical commands", () => {
  const commands = parsePath("M1 2h3v4l-3 0z");
  assert.deepEqual(commands, [
    { type: "M", values: [1, 2] },
    { type: "L", values: [4, 2] },
    { type: "L", values: [4, 6] },
    { type: "L", values: [1, 6] },
    { type: "Z" },
  ]);
  assert.deepEqual(boundsForCommands(commands), {
    minX: 1,
    minY: 2,
    maxX: 4,
    maxY: 6,
    width: 3,
    height: 4,
  });
});

test("rejects unsupported path syntax", () => {
  assert.throws(() => parsePath("M 0 0 Q 1 1 2 2"), /Unsupported SVG command Q/);
});

test("identifies the visual left bar by geometry, not serialization order", async () => {
  const manifest = await createManifest(repositoryRoot);
  const spinner = manifest.assets["addy-spinner"];
  assert.equal(manifest.sourceShape.subpathIndex, 2);
  assert.equal(spinner.subpaths[2].id, "bar-left");
  assert.deepEqual(spinner.subpaths[2].bounds, {
    minX: 0,
    minY: 22.8516,
    maxX: 54.1992,
    maxY: 131.251,
    width: 54.1992,
    height: 108.3994,
  });
});

test("isolated A matches the wordmark A after its vertical translation", async () => {
  const manifest = await createManifest(repositoryRoot);
  const isolated = manifest.assets["addy-a"].subpaths.slice(0, 2);
  const wordmark = manifest.assets["addy-wordmark"].subpaths.slice(0, 2);
  const translate = (command) => command.type === "Z"
    ? command
    : {
        type: command.type,
        values: command.values.map((value, index) => value + (index % 2 === 0 ? 0 : -10.4219)),
      };

  for (let subpath = 0; subpath < isolated.length; subpath += 1) {
    const translated = wordmark[subpath].commands.map(translate);
    assert.equal(translated.length, isolated[subpath].commands.length);
    for (let command = 0; command < translated.length; command += 1) {
      assert.equal(translated[command].type, isolated[subpath].commands[command].type);
      const actual = translated[command].values ?? [];
      const expected = isolated[subpath].commands[command].values ?? [];
      assert.equal(actual.length, expected.length);
      actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 0.001));
    }
  }
});

test("assigns semantic ids to the full Addy wordmark subpaths", async () => {
  const manifest = await createManifest(repositoryRoot);
  assert.deepEqual(manifest.assets["addy-wordmark"].subpaths.map((subpath) => subpath.id), [
    "letter-a-outer",
    "letter-a-counter",
    "letter-d1-outer",
    "letter-d1-counter",
    "letter-d2-outer",
    "letter-d2-counter",
    "letter-y",
  ]);
});

test("manifest generation is reproducible", async () => {
  const generated = serializeManifest(await createManifest(repositoryRoot));
  const existing = await readFile(path.join(repositoryRoot, "shared/assets/manifest.json"), "utf8");
  assert.equal(generated, existing);
});

test("reusable canonicalize runner supports check mode", async () => {
  const result = await runCanonicalizeAssets({ repositoryRoot, check: true });
  assert.equal(result.changed, false);
  assert.equal(result.output, path.join(repositoryRoot, "shared/assets/manifest.json"));
});
