import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_ITERATIONS = 3;
export const DEFAULT_WARMUP = 1;
export const DEFAULT_SCALES = [1, 2, 3];
export const DEFAULT_BUDGETS = {
  "capsule-to-a": { "1": 40, "2": 120, "3": 260 },
  "spinner-to-ad": { "1": 240, "2": 900, "3": 2200 },
  "spinner-to-addy": { "1": 1200, "2": 4800, "3": 10800 },
};

export function dimensionsForScale(scene, scale) {
  return {
    width: Math.max(1, Math.round(scene.coordinateSpace.width * scale)),
    height: Math.max(1, Math.round(scene.coordinateSpace.height * scale)),
  };
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

export function enforceBudget(result, budgets = DEFAULT_BUDGETS) {
  const budgetMs = budgets[result.sceneId]?.[String(result.scale)] ?? null;
  if (budgetMs === null) return null;
  if (result.p95Ms <= budgetMs) return null;
  return `${result.sceneId} ${result.scale}x ${result.mode} p95 ${result.p95Ms}ms exceeded budget ${budgetMs}ms`;
}

function parseArgs(argv) {
  const options = {
    iterations: DEFAULT_ITERATIONS,
    warmup: DEFAULT_WARMUP,
    scales: DEFAULT_SCALES,
    sampleLabels: null,
    enforceBudgets: false,
  };
  for (const arg of argv) {
    if (arg === "--enforce-budgets") options.enforceBudgets = true;
    else if (arg.startsWith("--iterations=")) options.iterations = Number(arg.slice("--iterations=".length));
    else if (arg.startsWith("--warmup=")) options.warmup = Number(arg.slice("--warmup=".length));
    else if (arg.startsWith("--scales=")) options.scales = arg.slice("--scales=".length).split(",").map(Number);
    else if (arg.startsWith("--samples=")) options.sampleLabels = arg.slice("--samples=".length).split(",").filter(Boolean);
    else if (arg !== "--json") throw new Error(`Unknown benchmark option ${arg}`);
  }
  if (!Number.isInteger(options.iterations) || options.iterations < 1) throw new Error("--iterations must be a positive integer");
  if (!Number.isInteger(options.warmup) || options.warmup < 0) throw new Error("--warmup must be a non-negative integer");
  if (options.scales.some((scale) => !Number.isFinite(scale) || scale <= 0)) throw new Error("--scales must contain positive numbers");
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadRuntimeModules(repositoryRoot) {
  const coreUrl = pathToFileURL(path.join(repositoryRoot, "packages/liquid-core/dist/index.js")).href;
  const webUrl = pathToFileURL(path.join(repositoryRoot, "packages/liquid-web/dist/index.js")).href;
  try {
    const [core, web] = await Promise.all([import(coreUrl), import(webUrl)]);
    return { evaluateFrame: core.evaluateFrame, rasterizeFrame: web.rasterizeFrame };
  } catch (error) {
    throw new Error(`Unable to load built Liquid web runtime. Run npm run build before benchmark:web. ${error.message}`);
  }
}

function filterSamples(manifest, labels) {
  if (!labels) return manifest.samples;
  const requested = new Set(labels);
  const samples = manifest.samples.filter((sample) => requested.has(sample.label));
  if (samples.length === 0) throw new Error(`No samples matched ${labels.join(", ")}`);
  return samples;
}

function measureSamples({ scene, samples, width, height, evaluateFrame, rasterizeFrame, now }) {
  const durations = [];
  for (const sample of samples) {
    const started = now();
    const frame = evaluateFrame(scene, sample.progress);
    const raster = rasterizeFrame(scene, frame, { width, height });
    const elapsed = now() - started;
    if (raster.width !== width || raster.height !== height) {
      throw new Error(`Raster size mismatch for ${scene.id} ${sample.label}`);
    }
    durations.push(elapsed);
  }
  return durations;
}

export async function runWebBenchmark({
  repositoryRoot,
  iterations = DEFAULT_ITERATIONS,
  warmup = DEFAULT_WARMUP,
  scales = DEFAULT_SCALES,
  sampleLabels = null,
  enforceBudgets = false,
  now = () => performance.now(),
  modules,
} = {}) {
  const root = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const runtime = modules ?? await loadRuntimeModules(root);
  const scenes = [
    {
      scene: await readJson(path.join(root, "shared/scenes/capsule-to-a.v1.json")),
      manifest: await readJson(path.join(root, "shared/golden/capsule-to-a.samples.json")),
    },
    {
      scene: await readJson(path.join(root, "shared/scenes/spinner-to-ad.v2.json")),
      manifest: await readJson(path.join(root, "shared/golden/spinner-to-ad.samples.json")),
    },
    {
      scene: await readJson(path.join(root, "shared/scenes/spinner-to-addy.v2.json")),
      manifest: await readJson(path.join(root, "shared/golden/spinner-to-addy.samples.json")),
    },
  ];
  const results = [];

  for (const { scene, manifest } of scenes) {
    const samples = filterSamples(manifest, sampleLabels);
    for (const scale of scales) {
      const { width, height } = dimensionsForScale(scene, scale);
      const coldDurations = measureSamples({ scene, samples, width, height, ...runtime, now });
      results.push({
        sceneId: scene.id,
        schemaVersion: scene.schemaVersion,
        measuredPath: "evaluateFrame+rasterizeFrame",
        cacheScope: "stateless public API",
        mode: "cold",
        scale,
        width,
        height,
        samples: samples.length,
        iterations: 1,
        ...summarizeDurations(coldDurations),
      });

      for (let index = 0; index < warmup; index += 1) {
        measureSamples({ scene, samples, width, height, ...runtime, now });
      }

      const warmDurations = [];
      for (let index = 0; index < iterations; index += 1) {
        warmDurations.push(...measureSamples({ scene, samples, width, height, ...runtime, now }));
      }
      results.push({
        sceneId: scene.id,
        schemaVersion: scene.schemaVersion,
        measuredPath: "evaluateFrame+rasterizeFrame",
        cacheScope: "stateless public API",
        mode: "warm",
        scale,
        width,
        height,
        samples: samples.length,
        iterations,
        ...summarizeDurations(warmDurations),
      });
    }
  }

  const failures = enforceBudgets ? results.map((result) => enforceBudget(result)).filter(Boolean) : [];
  return {
    schemaVersion: 1,
    runner: "liquid-web-raster",
    measuredUnit: "milliseconds per rasterized frame",
    budgetPolicy: {
      enforced: enforceBudgets,
      metric: "p95Ms",
      defaults: DEFAULT_BUDGETS,
      note: "Budgets are conservative production guardrails and are enforced only with --enforce-budgets.",
    },
    rendererCachePolicy: {
      measured: false,
      note: "The Node benchmark measures the framework-independent public rasterizeFrame path. LiquidCanvasRenderer target-raster caching requires a Canvas/DOM context and is covered by structure tests, not this CLI.",
    },
    options: { iterations, warmup, scales, sampleLabels },
    results,
    failures,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = await runWebBenchmark(options);
  console.log(JSON.stringify(output, null, 2));
  if (output.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
