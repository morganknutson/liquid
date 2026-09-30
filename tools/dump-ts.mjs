#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadCore() {
  return import(pathToFileURL(path.join(repositoryRoot, "packages/liquid-core/dist/index.js")));
}

function usage() {
  return `Usage: node tools/dump-ts.mjs [--scene <path>] [--samples <path>] [--out <path>]\n\nEvaluates shared Liquid samples through @liquid/core public APIs and emits liquid-frame schema JSON.\n`;
}

function parseArgs(argv) {
  const args = {
    scene: "shared/scenes/capsule-to-a.v1.json",
    samples: "shared/golden/capsule-to-a.samples.json",
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--scene" || arg === "--samples" || arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      args[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return args;
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(repositoryRoot, file), "utf8"));
}

export async function dumpTypeScriptFixtures(options) {
  const core = await loadCore();
  const scene = await readJson(options.scene);
  const manifest = await readJson(options.samples);
  core.validateScene(scene);
  core.validateSampleManifest(manifest);
  if (scene.id !== manifest.sceneId) {
    throw new Error(`Sample sceneId ${manifest.sceneId} does not match scene ${scene.id}`);
  }
  return core.serializeLiquidFrameOutput(core.evaluateSamples(scene, manifest.samples));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const output = await dumpTypeScriptFixtures(args);
  if (args.out) await writeFile(path.resolve(repositoryRoot, args.out), output);
  else process.stdout.write(output);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
