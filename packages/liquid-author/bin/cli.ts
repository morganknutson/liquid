#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { runAuthorCli } from "../src/cli.js";

runAuthorCli(process.argv.slice(2), {
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, value) => writeFile(path, value),
  stdout: (value) => process.stdout.write(value),
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
