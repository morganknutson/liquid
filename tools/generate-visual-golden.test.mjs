import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_HEIGHT,
  DEFAULT_OUTPUT,
  DEFAULT_SAMPLES,
  DEFAULT_SCENE,
  DEFAULT_WIDTH,
  checkVisualGolden,
  createVisualGolden,
  parseArgs,
  serializeVisualGolden,
  summarizeAlpha,
  writeVisualGolden,
} from "./generate-visual-golden.mjs";

test("parses defaults and explicit visual options", () => {
  assert.deepEqual(parseArgs([]), {
    help: false,
    check: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    out: DEFAULT_OUTPUT,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    resolutions: [],
  });
  assert.deepEqual(parseArgs(["--scene", "scene.json", "--samples", "samples.json", "--out", "visual.json", "--width", "12", "--height=8", "--resolution", "24x16", "--resolution=48x32", "--check"]), {
    help: false,
    check: true,
    scene: "scene.json",
    samples: "samples.json",
    out: "visual.json",
    width: 12,
    height: 8,
    resolutions: [{ width: 24, height: 16 }, { width: 48, height: 32 }],
  });
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--width", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--height", "1.5"]), /positive integer/);
  assert.throws(() => parseArgs(["--resolution", "12"]), /WIDTHxHEIGHT/);
});

test("summarizes alpha masks deterministically", () => {
  const summary = summarizeAlpha(Uint8ClampedArray.from([0, 255, 1, 0, 128, 0]), 3, 2);
  assert.deepEqual(summary, {
    coveredPixels: 3,
    solidPixels: 1,
    coverage: 0.5,
    bounds: { minX: 1, minY: 0, maxX: 2, maxY: 1 },
  });
});

test("generates stable sample masks and detects stale output", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "liquid-visual-"));
  const out = path.join(directory, "visual.json");
  const options = {
    help: false,
    check: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    out,
    width: 24,
    height: 24,
    resolutions: [],
  };

  try {
    const first = await createVisualGolden(options);
    const second = await createVisualGolden(options);
    assert.equal(serializeVisualGolden(first), serializeVisualGolden(second));
    assert.equal(first.samples.length, 12);
    assert.ok(first.samples.every((sample) => sample.alphaBase64.length > 0));

    await writeVisualGolden(options);
    assert.equal(await checkVisualGolden(options), true);

    const written = await readFile(out, "utf8");
    await writeFile(out, written.replace(first.samples[0].alphaSha256, "0".repeat(64)));
    await assert.rejects(() => checkVisualGolden(options), /stale/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generates multi-resolution visual goldens", async () => {
  const first = await createVisualGolden({
    help: false,
    check: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    out: DEFAULT_OUTPUT,
    width: 24,
    height: 24,
    resolutions: [{ width: 12, height: 12 }, { width: 16, height: 14 }],
  });
  const second = await createVisualGolden({
    help: false,
    check: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    out: DEFAULT_OUTPUT,
    width: 24,
    height: 24,
    resolutions: [{ width: 12, height: 12 }, { width: 16, height: 14 }],
  });

  assert.equal(serializeVisualGolden(first), serializeVisualGolden(second));
  assert.equal(first.resolutions.length, 2);
  assert.equal(first.resolutions[0].samples.length, 12);
  assert.equal(first.resolutions[1].width, 16);
});
