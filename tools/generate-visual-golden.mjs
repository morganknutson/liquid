#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateFrame, validateSampleManifest, validateScene } from "@liquid/core";
import { rasterizeFrame } from "@liquid/web";

export const DEFAULT_SCENE = "shared/scenes/capsule-to-a.v1.json";
export const DEFAULT_SAMPLES = "shared/golden/capsule-to-a.samples.json";
export const DEFAULT_OUTPUT = "shared/golden/capsule-to-a.visual.json";
export const DEFAULT_WIDTH = 160;
export const DEFAULT_HEIGHT = 152;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
  return [
    "Usage: node tools/generate-visual-golden.mjs [--scene <path>] [--samples <path>] [--out <path>] [--width <px>] [--height <px>] [--resolution <WxH>] [--check]",
    "",
    "Renders Liquid samples through public @liquid/core and @liquid/web APIs and writes a versioned alpha-mask visual golden.",
    `Default scene: ${DEFAULT_SCENE}`,
    `Default samples: ${DEFAULT_SAMPLES}`,
    `Default output: ${DEFAULT_OUTPUT}`,
    `Default resolution: ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`,
  ].join("\n");
}

export function parseArgs(argv) {
  const parsed = {
    help: false,
    check: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    out: DEFAULT_OUTPUT,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    resolutions: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { ...parsed, help: true };
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }
    if (arg === "--scene" || arg === "--samples" || arg === "--out" || arg === "--width" || arg === "--height" || arg === "--resolution") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      if (arg === "--scene") parsed.scene = value;
      else if (arg === "--samples") parsed.samples = value;
      else if (arg === "--out") parsed.out = value;
      else if (arg === "--width") parsed.width = Number(value);
      else if (arg === "--height") parsed.height = Number(value);
      else parsed.resolutions.push(parseResolution(value));
      index += 1;
      continue;
    }
    if (arg.startsWith("--width=")) {
      parsed.width = Number(arg.slice("--width=".length));
      continue;
    }
    if (arg.startsWith("--height=")) {
      parsed.height = Number(arg.slice("--height=".length));
      continue;
    }
    if (arg.startsWith("--resolution=")) {
      parsed.resolutions.push(parseResolution(arg.slice("--resolution=".length)));
      continue;
    }
    throw new Error(`Unknown option ${arg}`);
  }

  if (!Number.isInteger(parsed.width) || parsed.width <= 0) throw new Error("--width must be a positive integer");
  if (!Number.isInteger(parsed.height) || parsed.height <= 0) throw new Error("--height must be a positive integer");
  return parsed;
}

function parseResolution(value) {
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error("--resolution must use WIDTHxHEIGHT");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("--resolution must use positive integer dimensions");
  }
  return { width, height };
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(repositoryRoot, file), "utf8"));
}

function alphaBuffer(alpha) {
  return Buffer.from(alpha.buffer, alpha.byteOffset, alpha.byteLength);
}

export function encodeAlpha(alpha) {
  return alphaBuffer(alpha).toString("base64");
}

export function alphaSha256(alpha) {
  return createHash("sha256").update(alphaBuffer(alpha)).digest("hex");
}

export function summarizeAlpha(alpha, width, height) {
  let coveredPixels = 0;
  let solidPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index] ?? 0;
    if (value <= 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    coveredPixels += 1;
    if (value === 255) solidPixels += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    coveredPixels,
    solidPixels,
    coverage: Number((coveredPixels / alpha.length).toFixed(8)),
    bounds: coveredPixels === 0 ? null : { minX, minY, maxX, maxY },
  };
}

function sampleMetadata(frame) {
  if ("tracks" in frame) {
    return {
      trackRenderModes: Object.fromEntries(frame.tracks.map((track) => [track.id, track.renderMode])),
      activeEventIds: frame.events.map((event) => event.id),
    };
  }
  return {
    phase: frame.phase,
    renderMode: frame.renderMode,
  };
}

function renderSamples(scene, manifest, width, height) {
  return manifest.samples.map((sample) => {
    const frame = evaluateFrame(scene, sample.progress);
    const mask = rasterizeFrame(scene, frame, { width, height });
    return {
      label: sample.label,
      progress: frame.progress,
      ...sampleMetadata(frame),
      alphaSha256: alphaSha256(mask.alpha),
      alphaBase64: encodeAlpha(mask.alpha),
      ...summarizeAlpha(mask.alpha, mask.width, mask.height),
    };
  });
}

export async function createVisualGolden(options) {
  const scene = await readJson(options.scene);
  const manifest = await readJson(options.samples);
  validateScene(scene);
  validateSampleManifest(manifest);
  if (scene.id !== manifest.sceneId) {
    throw new Error(`Sample sceneId ${manifest.sceneId} does not match scene ${scene.id}`);
  }

  const base = {
    schemaVersion: 1,
    kind: "liquid-alpha-silhouette-golden",
    sceneId: scene.id,
    fixtureVersion: scene.fixtureVersion,
    sourceScene: options.scene,
    sampleManifest: options.samples,
    renderer: {
      evaluator: "@liquid/core",
      rasterizer: "@liquid/web",
      motion: "normal",
      alpha: "unpremultiplied-8-bit",
    },
  };

  if (options.resolutions?.length > 0) {
    return {
      ...base,
      resolutions: options.resolutions.map((resolution) => ({
        width: resolution.width,
        height: resolution.height,
        viewport: "scene-fit-centered",
        samples: renderSamples(scene, manifest, resolution.width, resolution.height),
      })),
    };
  }

  return {
    schemaVersion: base.schemaVersion,
    kind: base.kind,
    sceneId: base.sceneId,
    fixtureVersion: base.fixtureVersion,
    sourceScene: base.sourceScene,
    sampleManifest: base.sampleManifest,
    resolution: {
      width: options.width,
      height: options.height,
      viewport: "scene-fit-centered",
    },
    renderer: base.renderer,
    samples: renderSamples(scene, manifest, options.width, options.height),
  };
}

export function serializeVisualGolden(golden) {
  return `${JSON.stringify(golden, null, 2)}\n`;
}

export async function writeVisualGolden(options) {
  const golden = await createVisualGolden(options);
  const outputPath = path.resolve(repositoryRoot, options.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializeVisualGolden(golden));
  return golden;
}

export async function checkVisualGolden(options) {
  const outputPath = path.resolve(repositoryRoot, options.out);
  const expected = serializeVisualGolden(await createVisualGolden(options));
  let actual;
  try {
    actual = await readFile(outputPath, "utf8");
  } catch (error) {
    throw new Error(`Visual golden is missing at ${options.out}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (actual !== expected) {
    throw new Error(`Visual golden is stale: run npm run visual:generate to update ${options.out}`);
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.check) {
    await checkVisualGolden(options);
    process.stdout.write(`Visual golden is current: ${options.out}\n`);
    return;
  }
  const golden = await writeVisualGolden(options);
  if (golden.resolutions) {
    const count = golden.resolutions.reduce((total, resolution) => total + resolution.samples.length, 0);
    process.stdout.write(`Wrote ${count} visual samples to ${options.out} across ${golden.resolutions.length} resolutions\n`);
  } else {
    process.stdout.write(`Wrote ${golden.samples.length} visual samples to ${options.out} at ${options.width}x${options.height}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
