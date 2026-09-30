import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_SAMPLES,
  DEFAULT_SCENE,
  DEFAULT_TOLERANCE,
  createParityCommands,
  parseArgs,
  runParity,
} from "./run-parity.mjs";

test("parses defaults and explicit options", () => {
  assert.deepEqual(parseArgs([]), {
    help: false,
    scene: DEFAULT_SCENE,
    samples: DEFAULT_SAMPLES,
    tolerance: DEFAULT_TOLERANCE,
    keepTemp: false,
  });
  assert.deepEqual(parseArgs(["--scene", "scene.json", "--samples", "samples.json", "--tolerance", "0.1", "--keep-temp"]), {
    help: false,
    scene: "scene.json",
    samples: "samples.json",
    tolerance: 0.1,
    keepTemp: true,
  });
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--tolerance", "-1"]), /finite non-negative/);
});

test("creates independent TypeScript, Swift, and comparator commands", () => {
  const commands = createParityCommands(
    { scene: "scene.json", samples: "samples.json", tolerance: 0.25 },
    { typescript: "/tmp/ts.json", swift: "/tmp/swift.json" },
  );

  assert.equal(path.basename(commands[0].args[0]), "dump-ts.mjs");
  assert.deepEqual(commands[0].args.slice(1), ["--scene", "scene.json", "--samples", "samples.json", "--out", "/tmp/ts.json"]);
  assert.deepEqual(commands[1].args, ["run", "LiquidFixtureDump", "scene.json", "samples.json", "/tmp/swift.json"]);
  assert.equal(path.basename(commands[2].args[0]), "compare-parity.mjs");
  assert.deepEqual(commands[2].args.slice(1), ["--tolerance", "0.25", "/tmp/ts.json", "/tmp/swift.json"]);
});

test("runs commands in order and stops on failures", async () => {
  const seen = [];
  await runParity(parseArgs([]), async (command) => {
    seen.push(command.label);
    if (command.label === "TypeScript dump") {
      await writeFile(command.args.at(-1), "{}\n");
    }
    if (command.label === "Swift dump") {
      await writeFile(command.args.at(-1), "{}\n");
    }
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.deepEqual(seen, ["TypeScript dump", "Swift dump", "Parity compare"]);

  await assert.rejects(
    () => runParity(parseArgs([]), async (command) => ({
      status: command.label === "Swift dump" ? 1 : 0,
      stdout: "",
      stderr: "swift failed",
    })),
    /Swift dump failed/,
  );
});
