import assert from "node:assert/strict";
import test from "node:test";

import { enforceBudget, helpText, parseArgs, runBrowserBenchmark, summarizeDurations } from "./benchmark-browser.mjs";

test("browser benchmark statistics use nearest-rank p95", () => {
  assert.deepEqual(summarizeDurations([9, 2, 4, 100]), {
    medianMs: 4,
    p95Ms: 100,
    minMs: 2,
    maxMs: 100,
  });
});

test("browser benchmark parses scene, backend, and budget options", () => {
  assert.deepEqual(parseArgs(["--scene=spinner-to-addy", "--backend=webgl2", "--iterations=3", "--warmup=2", "--budget-ms=12.5", "--max-backing-dimension=256"]), {
    backend: "webgl2",
    budgetMs: 12.5,
    enforceBudget: true,
    iterations: 3,
    maxBackingDimension: 256,
    scene: "spinner-to-addy",
    warmup: 2,
  });
  assert.throws(() => parseArgs(["--backend=metal"]), /--backend/);
  assert.throws(() => parseArgs(["--scene=spinner-to-a"]), /--scene must be one of spinner-to-ad, spinner-to-addy/);
  assert.match(helpText(), /--scene=<scene>/);
  assert.match(helpText(), /spinner-to-addy/);
});

test("browser benchmark budget enforcement reports p95 failures", () => {
  assert.equal(enforceBudget({ backend: "webgl2", p95Ms: 17 }, 16.7), "browser webgl2 warm p95 17ms exceeded budget 16.7ms");
  assert.equal(enforceBudget({ backend: "webgl2", p95Ms: 15 }, 16.7), null);
  assert.equal(enforceBudget({ backend: "webgl2", p95Ms: 99 }, null), null);
});

test("browser benchmark supports injected browser and server harnesses", async () => {
  const closed = { browser: false, server: false };
  const output = await runBrowserBenchmark({
    backend: "auto",
    budgetMs: 10,
    enforceBudget: true,
    iterations: 2,
    maxBackingDimension: 128,
    scene: "spinner-to-addy",
    warmup: 1,
    serverFactory: async () => ({
      url: "http://127.0.0.1:1234/",
      server: { close: async () => { closed.server = true; } },
    }),
    launcher: {
      launch: async () => ({
        newPage: async () => ({
          on: () => {},
          route: async () => {},
          goto: async () => {},
          evaluate: async (callback, payload) => {
            assert.equal(payload.requestedScene, "spinner-to-addy");
            return {
              sceneId: "spinner-to-addy",
              samples: 2,
              durations: [1, 2, 3, 4],
              chosenBackend: "webgl2",
              backingSize: { width: 128, height: 122, scale: 1 },
              capabilities: { backend: "webgl2", supported: true, maxTracks: 8, maxComponents: 48, ribbonSubdivisions: 32, maxTextureSize: 4096 },
            };
          },
        }),
        close: async () => { closed.browser = true; },
      }),
    },
  });

  assert.equal(output.runner, "liquid-browser-player");
  assert.equal(output.requestedScene, "spinner-to-addy");
  assert.equal(output.sceneId, "spinner-to-addy");
  assert.equal(output.backend, "webgl2");
  assert.equal(output.p95Ms, 4);
  assert.deepEqual(output.failures, []);
  assert.deepEqual(closed, { browser: true, server: true });
});
