import { chromium } from "@playwright/test";
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_BROWSER_ITERATIONS = 30;
export const DEFAULT_BROWSER_WARMUP = 8;
export const DEFAULT_MAX_BACKING_DIMENSION = 384;
export const DEFAULT_BROWSER_BUDGET_MS = 16.7;
export const DEFAULT_BROWSER_SCENE = "spinner-to-ad";
export const BROWSER_SCENES = ["spinner-to-ad", "spinner-to-addy"];

const benchmarkClientModuleId = "/benchmark-browser-client.js";

function benchmarkClientModuleSource() {
  return `
import { validateSampleManifest, validateScene } from "@liquid/core";
import {
  spinnerToAdSamplesURL,
  spinnerToAdSceneURL,
  spinnerToAddySamplesURL,
  spinnerToAddySceneURL,
} from "@liquid/scenes";
import { LiquidCanvasPlayer } from "@liquid/web";

const sceneResources = {
  "spinner-to-ad": { sceneURL: spinnerToAdSceneURL, samplesURL: spinnerToAdSamplesURL },
  "spinner-to-addy": { sceneURL: spinnerToAddySceneURL, samplesURL: spinnerToAddySamplesURL },
};

export async function runBrowserBenchmarkClient({
  requestedBackend,
  requestedIterations,
  requestedMaxBackingDimension,
  requestedScene,
  requestedWarmup,
}) {
  const resources = sceneResources[requestedScene];
  if (!resources) throw new Error(\`Unknown browser benchmark scene \${requestedScene}\`);
  const [scene, manifest] = await Promise.all([
    fetch(String(resources.sceneURL)).then((response) => response.json()),
    fetch(String(resources.samplesURL)).then((response) => response.json()),
  ]);
  validateScene(scene);
  validateSampleManifest(manifest);
  if (scene.id !== manifest.sceneId) {
    throw new Error(\`Sample sceneId \${manifest.sceneId} does not match scene \${scene.id}\`);
  }

  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const player = new LiquidCanvasPlayer(canvas, scene, {
    autoplay: false,
    backend: requestedBackend,
    fillStyle: "#ffffff",
    logicalSize: scene.coordinateSpace,
    maxBackingDimension: requestedMaxBackingDimension,
    reducedMotion: false,
  });
  const samples = manifest.samples.map((sample) => sample.progress);
  const flush = () => {
    const renderer = player.renderer;
    if (typeof renderer.flush === "function") renderer.flush();
  };

  for (let index = 0; index < requestedWarmup; index += 1) {
    for (const progress of samples) {
      player.seek(progress);
      flush();
    }
  }

  const durations = [];
  for (let iteration = 0; iteration < requestedIterations; iteration += 1) {
    for (const progress of samples) {
      const started = performance.now();
      player.seek(progress);
      flush();
      durations.push(performance.now() - started);
    }
  }
  const chosenBackend = player.chosenBackend;
  const backingSize = player.backingSize;
  const capabilities = player.capabilities;
  player.destroy();
  canvas.remove();
  return { sceneId: scene.id, samples: samples.length, durations, chosenBackend, backingSize, capabilities };
}
`;
}

export function summarizeDurations(durations) {
  if (durations.length === 0) return { medianMs: 0, p95Ms: 0, minMs: 0, maxMs: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    medianMs: Number(median.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    minMs: Number(sorted[0].toFixed(3)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
  };
}

export function enforceBudget(summary, budgetMs) {
  if (budgetMs === null) return null;
  return summary.p95Ms <= budgetMs ? null : `browser ${summary.backend} warm p95 ${summary.p95Ms}ms exceeded budget ${budgetMs}ms`;
}

export function parseArgs(argv) {
  const options = {
    backend: "auto",
    budgetMs: null,
    enforceBudget: false,
    iterations: DEFAULT_BROWSER_ITERATIONS,
    maxBackingDimension: DEFAULT_MAX_BACKING_DIMENSION,
    scene: DEFAULT_BROWSER_SCENE,
    warmup: DEFAULT_BROWSER_WARMUP,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--enforce-budget") {
      options.enforceBudget = true;
      options.budgetMs = DEFAULT_BROWSER_BUDGET_MS;
    } else if (arg.startsWith("--budget-ms=")) {
      options.budgetMs = Number(arg.slice("--budget-ms=".length));
      options.enforceBudget = true;
    } else if (arg.startsWith("--backend=")) {
      options.backend = arg.slice("--backend=".length);
    } else if (arg.startsWith("--iterations=")) {
      options.iterations = Number(arg.slice("--iterations=".length));
    } else if (arg.startsWith("--warmup=")) {
      options.warmup = Number(arg.slice("--warmup=".length));
    } else if (arg.startsWith("--max-backing-dimension=")) {
      options.maxBackingDimension = Number(arg.slice("--max-backing-dimension=".length));
    } else if (arg.startsWith("--scene=")) {
      options.scene = arg.slice("--scene=".length);
    } else if (arg !== "--json") {
      throw new Error(`Unknown browser benchmark option ${arg}`);
    }
  }
  if (!["auto", "cpu", "webgl2"].includes(options.backend)) throw new Error("--backend must be auto, cpu, or webgl2");
  if (!BROWSER_SCENES.includes(options.scene)) {
    throw new Error(`--scene must be one of ${BROWSER_SCENES.join(", ")}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) throw new Error("--iterations must be a positive integer");
  if (!Number.isInteger(options.warmup) || options.warmup < 0) throw new Error("--warmup must be a non-negative integer");
  if (!Number.isFinite(options.maxBackingDimension) || options.maxBackingDimension < 1) throw new Error("--max-backing-dimension must be a positive number");
  if (options.budgetMs !== null && (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0)) throw new Error("--budget-ms must be a positive number");
  return options;
}

export function helpText() {
  return `Usage: node tools/benchmark-browser.mjs [options]

Options:
  --scene=<scene>                 Scene to benchmark: ${BROWSER_SCENES.join(", ")} (default: ${DEFAULT_BROWSER_SCENE})
  --backend=<backend>             Backend to request: auto, cpu, webgl2 (default: auto)
  --iterations=<count>            Positive warm measurement iteration count (default: ${DEFAULT_BROWSER_ITERATIONS})
  --warmup=<count>                Non-negative warmup iteration count (default: ${DEFAULT_BROWSER_WARMUP})
  --max-backing-dimension=<px>    Positive backing-size cap (default: ${DEFAULT_MAX_BACKING_DIMENSION})
  --enforce-budget                Enforce the default ${DEFAULT_BROWSER_BUDGET_MS}ms p95 budget
  --budget-ms=<ms>                Enforce a custom positive p95 budget
  --json                          Accepted for parity with other benchmark commands
  --help                          Show this help`;
}

async function createBenchmarkServer(repositoryRoot) {
  const server = await createServer({
    root: repositoryRoot,
    configFile: false,
    logLevel: "error",
    plugins: [
      {
        name: "liquid-browser-benchmark-client",
        resolveId(id) {
          return id === benchmarkClientModuleId ? id : null;
        },
        load(id) {
          return id === benchmarkClientModuleId ? benchmarkClientModuleSource() : null;
        },
      },
    ],
    server: { host: "127.0.0.1", port: 0 },
  });
  server.middlewares.use("/benchmark-browser.html", (_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<!doctype html><html><head><title>Liquid Browser Benchmark</title></head><body></body></html>");
  });
  server.middlewares.use("/favicon.ico", (_request, response) => {
    response.statusCode = 204;
    response.end();
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) {
    await server.close();
    throw new Error("Unable to resolve Vite benchmark server URL");
  }
  return { server, url };
}

export async function runBrowserBenchmark({
  repositoryRoot,
  backend = "auto",
  budgetMs = null,
  enforceBudget: shouldEnforceBudget = false,
  iterations = DEFAULT_BROWSER_ITERATIONS,
  maxBackingDimension = DEFAULT_MAX_BACKING_DIMENSION,
  scene = DEFAULT_BROWSER_SCENE,
  warmup = DEFAULT_BROWSER_WARMUP,
  launcher = chromium,
  serverFactory = createBenchmarkServer,
} = {}) {
  const root = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { server, url } = await serverFactory(root);
  const browser = await launcher.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push(location.url ? `${message.text()} (${location.url})` : message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.route("**/benchmark-browser.html", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><head><title>Liquid Browser Benchmark</title></head><body></body></html>",
    }));
    await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto(new URL("benchmark-browser.html", url).href);
    const result = await page.evaluate(async ({ requestedBackend, requestedIterations, requestedMaxBackingDimension, requestedScene, requestedWarmup }) => {
      const { runBrowserBenchmarkClient } = await import("/benchmark-browser-client.js");
      return runBrowserBenchmarkClient({
        requestedBackend,
        requestedIterations,
        requestedMaxBackingDimension,
        requestedScene,
        requestedWarmup,
      });
    }, {
      requestedBackend: backend,
      requestedIterations: iterations,
      requestedMaxBackingDimension: maxBackingDimension,
      requestedScene: scene,
      requestedWarmup: warmup,
    });

    const summary = {
      schemaVersion: 1,
      runner: "liquid-browser-player",
      measuredUnit: "milliseconds per warm player render",
      sceneId: result.sceneId,
      requestedScene: scene,
      requestedBackend: backend,
      backend: result.chosenBackend,
      maxBackingDimension,
      backingSize: result.backingSize,
      samples: result.samples,
      iterations,
      warmup,
      capabilities: result.capabilities,
      consoleErrors,
      ...summarizeDurations(result.durations),
    };
    const budget = shouldEnforceBudget ? budgetMs ?? DEFAULT_BROWSER_BUDGET_MS : null;
    const failure = enforceBudget(summary, budget);
    return {
      ...summary,
      budgetPolicy: {
        enforced: shouldEnforceBudget,
        metric: "p95Ms",
        budgetMs: budget,
      },
      failures: [
        ...(failure ? [failure] : []),
        ...(consoleErrors.length > 0 ? [`browser console reported ${consoleErrors.length} error(s)`] : []),
      ],
    };
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const output = await runBrowserBenchmark(options);
  console.log(JSON.stringify(output, null, 2));
  if (output.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
