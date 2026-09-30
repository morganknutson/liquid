import assert from "node:assert/strict";
import test from "node:test";

import { dimensionsForScale, enforceBudget, runWebBenchmark, summarizeDurations } from "./benchmark.mjs";

test("benchmark statistics are deterministic and nearest-rank p95", () => {
  assert.deepEqual(summarizeDurations([5, 1, 2, 100]), {
    medianMs: 2,
    p95Ms: 100,
    minMs: 1,
    maxMs: 100,
  });
});

test("benchmark dimensions preserve scene coordinate aspect by scale", () => {
  assert.deepEqual(dimensionsForScale({ coordinateSpace: { width: 10.4, height: 5.2 } }, 3), {
    width: 31,
    height: 16,
  });
});

test("budget enforcement reports p95 failures", () => {
  assert.equal(enforceBudget({ sceneId: "capsule-to-a", scale: 1, mode: "warm", p95Ms: 41 }, { "capsule-to-a": { "1": 40 } }), "capsule-to-a 1x warm p95 41ms exceeded budget 40ms");
  assert.equal(enforceBudget({ sceneId: "capsule-to-a", scale: 1, mode: "warm", p95Ms: 39 }, { "capsule-to-a": { "1": 40 } }), null);
});

test("web benchmark runner supports injected runtimes without wall-clock assertions", async () => {
  let tick = 0;
  const output = await runWebBenchmark({
    iterations: 2,
    warmup: 0,
    scales: [1],
    now: () => tick++,
    modules: {
      evaluateFrame: (scene, progress) => ({ label: "", progress, sceneId: scene.id }),
      rasterizeFrame: (_scene, _frame, options) => ({ width: options.width, height: options.height, alpha: new Uint8ClampedArray(options.width * options.height), coverage: 0 }),
    },
  });

  assert.equal(output.results.length, 6);
  assert.deepEqual(output.results.map((result) => `${result.sceneId}:${result.mode}`), [
    "capsule-to-a:cold",
    "capsule-to-a:warm",
    "spinner-to-ad:cold",
    "spinner-to-ad:warm",
    "spinner-to-addy:cold",
    "spinner-to-addy:warm",
  ]);
  assert.deepEqual(new Set(output.results.map((result) => result.measuredPath)), new Set(["evaluateFrame+rasterizeFrame"]));
  assert.deepEqual(new Set(output.results.map((result) => result.cacheScope)), new Set(["stateless public API"]));
  assert.equal(output.rendererCachePolicy.measured, false);
  assert.match(output.rendererCachePolicy.note, /LiquidCanvasRenderer/);
  assert.equal(output.results[1].iterations, 2);
  assert.equal(output.failures.length, 0);
});
