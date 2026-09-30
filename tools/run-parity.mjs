#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_SCENE = "shared/scenes/capsule-to-a.v1.json";
export const DEFAULT_SAMPLES = "shared/golden/capsule-to-a.samples.json";
export const DEFAULT_TOLERANCE = 0.000001;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function usage() {
  return [
    "Usage: node tools/run-parity.mjs [--scene <path>] [--samples <path>] [--tolerance <number>] [--keep-temp]",
    "",
    "Generates independent TypeScript and Swift Liquid evaluator dumps, then compares them.",
    `Default scene: ${DEFAULT_SCENE}`,
    `Default samples: ${DEFAULT_SAMPLES}`,
    `Default tolerance: ${DEFAULT_TOLERANCE}`,
  ].join("\n");
}

export function parseArgs(argv) {
  const parsed = {
    help: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    tolerance: DEFAULT_TOLERANCE,
    keepTemp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      return { ...parsed, help: true };
    }
    if (arg === "--keep-temp") {
      parsed.keepTemp = true;
      continue;
    }
    if (arg === "--scene" || arg === "--samples" || arg === "--tolerance") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--scene") parsed.scene = value;
      else if (arg === "--samples") parsed.samples = value;
      else parsed.tolerance = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--tolerance=")) {
      parsed.tolerance = Number(arg.slice("--tolerance=".length));
      continue;
    }
    throw new Error(`Unknown option ${arg}`);
  }

  if (!Number.isFinite(parsed.tolerance) || parsed.tolerance < 0) {
    throw new Error("--tolerance must be a finite non-negative number");
  }
  return parsed;
}

function displayCommand(command) {
  return [command.executable, ...command.args].join(" ");
}

export function createParityCommands(options, outputPaths) {
  return [
    {
      label: "TypeScript dump",
      executable: process.execPath,
      args: [
        "tools/dump-ts.mjs",
        "--scene",
        options.scene,
        "--samples",
        options.samples,
        "--out",
        outputPaths.typescript,
      ],
    },
    {
      label: "Swift dump",
      executable: "swift",
      args: [
        "run",
        "LiquidFixtureDump",
        options.scene,
        options.samples,
        outputPaths.swift,
      ],
    },
    {
      label: "Parity compare",
      executable: process.execPath,
      args: [
        "tools/compare-parity.mjs",
        "--tolerance",
        String(options.tolerance),
        outputPaths.typescript,
        outputPaths.swift,
      ],
    },
  ];
}

export function runCommand(command, cwd = repositoryRoot) {
  return new Promise((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: 1, stdout, stderr: error.message });
    });
    child.on("close", (status) => {
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

export async function runParity(options, runner = runCommand) {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "liquid-parity-"));
  const outputs = {
    typescript: path.join(tempDirectory, "typescript.json"),
    swift: path.join(tempDirectory, "swift.json"),
  };
  const commands = createParityCommands(options, outputs);
  const commandResults = [];

  try {
    for (const command of commands) {
      const result = await runner(command, repositoryRoot);
      commandResults.push({ command, result });
      if (result.status !== 0) {
        const detail = result.stderr || result.stdout || `exit code ${result.status}`;
        throw new Error(`${command.label} failed: ${displayCommand(command)}\n${detail}`);
      }
    }
    return {
      ok: true,
      tempDirectory,
      outputs,
      commands,
      stdout: commandResults.map(({ result }) => result.stdout).join(""),
    };
  } finally {
    if (!options.keepTemp) {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await runParity(options);
  process.stdout.write(result.stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
