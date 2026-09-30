import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RESOURCE_VERSION = 1;

export const RESOURCE_FILES = [
  { kind: "scene", id: "capsule-to-a", source: "shared/scenes/capsule-to-a.v1.json", output: "scenes/capsule-to-a.v1.json" },
  { kind: "scene", id: "spinner-to-ad", source: "shared/scenes/spinner-to-ad.v2.json", output: "scenes/spinner-to-ad.v2.json" },
  { kind: "scene", id: "spinner-to-addy", source: "shared/scenes/spinner-to-addy.v2.json", output: "scenes/spinner-to-addy.v2.json" },
  { kind: "scene", id: "addy-logo-wave", source: "shared/scenes/addy-logo-wave.v2.json", output: "scenes/addy-logo-wave.v2.json" },
  { kind: "scene", id: "addy-logo-wave-wordmark", source: "shared/scenes/addy-logo-wave-wordmark.v2.json", output: "scenes/addy-logo-wave-wordmark.v2.json" },
  { kind: "scene", id: "addy-logo-wave-wordmark-replay", source: "shared/scenes/addy-logo-wave-wordmark-replay.v2.json", output: "scenes/addy-logo-wave-wordmark-replay.v2.json" },
  { kind: "sampleManifest", id: "capsule-to-a", source: "shared/golden/capsule-to-a.samples.json", output: "samples/capsule-to-a.samples.json" },
  { kind: "sampleManifest", id: "spinner-to-ad", source: "shared/golden/spinner-to-ad.samples.json", output: "samples/spinner-to-ad.samples.json" },
  { kind: "sampleManifest", id: "spinner-to-addy", source: "shared/golden/spinner-to-addy.samples.json", output: "samples/spinner-to-addy.samples.json" },
  { kind: "sampleManifest", id: "addy-logo-wave", source: "shared/golden/addy-logo-wave.samples.json", output: "samples/addy-logo-wave.samples.json" },
  { kind: "sampleManifest", id: "addy-logo-wave-wordmark", source: "shared/golden/addy-logo-wave-wordmark.samples.json", output: "samples/addy-logo-wave-wordmark.samples.json" },
  { kind: "sampleManifest", id: "addy-logo-wave-wordmark-replay", source: "shared/golden/addy-logo-wave-wordmark-replay.samples.json", output: "samples/addy-logo-wave-wordmark-replay.samples.json" },
  { kind: "assetManifest", id: "assets", source: "shared/assets/manifest.json", output: "assets/manifest.json" },
  { kind: "asset", id: "addy-a", source: "shared/assets/addy-a.svg", output: "assets/addy-a.svg" },
  { kind: "asset", id: "addy-spinner", source: "shared/assets/addy-spinner.svg", output: "assets/addy-spinner.svg" },
  { kind: "asset", id: "addy-wordmark", source: "shared/assets/addy-wordmark.svg", output: "assets/addy-wordmark.svg" },
  { kind: "asset", id: "addy-logo-ticks", source: "shared/assets/addy-logo-ticks.svg", output: "assets/addy-logo-ticks.svg" },
  { kind: "asset", id: "addy-logo-wordmark", source: "shared/assets/addy-logo-wordmark.svg", output: "assets/addy-logo-wordmark.svg" },
];

export const RESOURCE_TARGETS = [
  { id: "npm", root: "packages/liquid-scenes" },
  { id: "swift", root: "Sources/LiquidScenes/Resources" },
];

const MANIFEST_FILE = "resources.manifest.json";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sortByPath(a, b) {
  return a.localeCompare(b);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(root) {
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files.sort(sortByPath);
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function readResourceEntries(repositoryRoot) {
  const entries = [];
  for (const file of RESOURCE_FILES) {
    const absoluteSource = path.join(repositoryRoot, file.source);
    const bytes = await readFile(absoluteSource);
    entries.push({
      kind: file.kind,
      id: file.id,
      source: file.source,
      output: file.output,
      bytes,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  return entries;
}

function createResourceManifest(entries) {
  return {
    schemaVersion: 1,
    resourceVersion: RESOURCE_VERSION,
    generatedBy: "tools/sync-scene-resources.mjs",
    targets: RESOURCE_TARGETS.map((target) => ({ id: target.id, root: target.root })),
    files: entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      source: entry.source,
      output: entry.output,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
    })),
  };
}

async function expectedOutputs(repositoryRoot) {
  const outputs = new Set();
  for (const target of RESOURCE_TARGETS) {
    for (const file of RESOURCE_FILES) {
      outputs.add(path.join(repositoryRoot, target.root, file.output));
    }
    outputs.add(path.join(repositoryRoot, target.root, MANIFEST_FILE));
  }
  return outputs;
}

async function staleOutputFiles(repositoryRoot) {
  const expected = await expectedOutputs(repositoryRoot);
  const roots = RESOURCE_TARGETS.flatMap((target) => [
    path.join(repositoryRoot, target.root, "scenes"),
    path.join(repositoryRoot, target.root, "samples"),
    path.join(repositoryRoot, target.root, "assets"),
  ]);
  const manifestPaths = RESOURCE_TARGETS.map((target) => path.join(repositoryRoot, target.root, MANIFEST_FILE));
  const existing = [
    ...manifestPaths.filter((file) => expected.has(file)),
    ...((await Promise.all(roots.map(listFiles))).flat()),
  ];
  return existing.filter((file) => !expected.has(file));
}

async function compareOrWrite(filePath, bytes, check) {
  const existing = await readFile(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.equals(bytes)) return null;
  if (check) return filePath;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return filePath;
}

export async function runSyncSceneResources({ repositoryRoot, check = false } = {}) {
  const root = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const entries = await readResourceEntries(root);
  const manifestBytes = Buffer.from(serializeManifest(createResourceManifest(entries)));
  const changed = [];

  for (const target of RESOURCE_TARGETS) {
    for (const entry of entries) {
      const output = path.join(root, target.root, entry.output);
      const stale = await compareOrWrite(output, entry.bytes, check);
      if (stale) changed.push(path.relative(root, stale));
    }
    const manifestOutput = path.join(root, target.root, MANIFEST_FILE);
    const stale = await compareOrWrite(manifestOutput, manifestBytes, check);
    if (stale) changed.push(path.relative(root, stale));
  }

  const staleFiles = (await staleOutputFiles(root)).map((file) => path.relative(root, file));
  if (check && (changed.length > 0 || staleFiles.length > 0)) {
    const details = [
      ...changed.map((file) => `stale: ${file}`),
      ...staleFiles.map((file) => `unexpected: ${file}`),
    ].join("\n");
    throw new Error(`scene resources are stale; run npm run resources:generate\n${details}`);
  }

  return {
    changed,
    staleFiles,
    manifest: createResourceManifest(entries),
  };
}

async function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await runSyncSceneResources({ repositoryRoot, check: process.argv.includes("--check") });
  if (!process.argv.includes("--check")) {
    console.log(`Synced ${RESOURCE_FILES.length} resources to ${RESOURCE_TARGETS.length} targets.`);
    console.log(`Updated ${result.changed.length} files.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
