import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TOLERANCE,
  compareParity,
  parseArgs,
  validateEvaluatorOutput,
} from "./compare-parity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryRoot, "tools/compare-parity.mjs");

function clone(value) {
  return structuredClone(value);
}

function command(type, values) {
  return values === undefined ? { type } : { type, values };
}

function endpoint(shapeId) {
  return {
    assetId: "addy-wordmark",
    shapeId,
    transform: { translateX: 1, translateY: 2, scaleX: 1, scaleY: 1 },
    commands: [
      command("M", [0, 0]),
      command("L", [10, 0]),
      command("C", [12, 0, 16, 4, 16, 8]),
      command("Z"),
    ],
  };
}

function sample(overrides = {}) {
  return {
    label: "source",
    progress: 0,
    phase: "sourceHold",
    events: [],
    renderMode: "sourcePath",
    sourceOpacity: 1,
    targetOpacity: 0,
    anchor: { x: 79.495, y: 27.0996 },
    leftLeg: {
      start: { x: 79.495, y: 27.0996 },
      end: { x: 79.495, y: 81.2998 },
      radius: 27.0996,
    },
    rightLeg: {
      start: { x: 79.495, y: 27.0996 },
      end: { x: 79.495, y: 81.2998 },
      radius: 27.0996,
    },
    crossbar: {
      start: { x: 79.495, y: 70 },
      end: { x: 79.495, y: 70 },
      radius: 0,
    },
    bridge: {
      start: { x: 79.495, y: 88 },
      end: { x: 79.495, y: 88 },
      radius: 0,
    },
    blendRadius: 0,
    targetMix: 0,
    cornerSharpness: 0,
    endpointCommands: [
      command("M", [27.0996, 22.8516]),
      command("L", [54.1992, 104.15]),
      command("Z"),
    ],
    ...overrides,
  };
}

function output(samples = [sample()]) {
  return {
    schemaVersion: 1,
    sceneId: "capsule-to-a",
    fixtureVersion: 1,
    samples,
  };
}

function component(id, overrides = {}) {
  return {
    id,
    kind: "capsule",
    operation: "union",
    groupId: "a-body",
    primitive: {
      kind: "capsule",
      start: { x: 12, y: 20 },
      end: { x: 18, y: 80 },
      radius: 6,
    },
    material: {
      blendRadius: 4,
      mode: "goo",
      visible: true,
    },
    ...overrides,
  };
}

function ellipseComponent(id) {
  return component(id, {
    kind: "ellipse",
    operation: "subtract",
    groupId: "counter",
    primitive: {
      kind: "ellipse",
      center: { x: 30, y: 42 },
      radiusX: 8,
      radiusY: 5,
      rotation: 0.25,
    },
  });
}

function track(id, overrides = {}) {
  return {
    id,
    progress: 0.5,
    localProgress: 0.6,
    renderMode: "field",
    sourceOpacity: 1,
    targetOpacity: 0,
    source: endpoint(`${id}-source`),
    target: endpoint(`${id}-target`),
    endpointCommands: null,
    components: [
      component(`${id}-stem`),
      ellipseComponent(`${id}-counter`),
    ],
    material: {
      components: {
        [`${id}-stem`]: { blendRadius: 4, opacity: 1 },
      },
      groups: {
        "$track": { targetMix: 0.35, cornerSharpness: 0.2 },
      },
    },
    ...overrides,
  };
}

function v2Sample(overrides = {}) {
  return {
    label: "middle",
    progress: 0.5,
    events: [
      {
        id: "release-a",
        kind: "release",
        trackId: "a-track",
        at: 0.45,
        end: 0.7,
        componentId: "a-track-stem",
        payload: { threshold: 0.5, armed: true, mode: "release" },
      },
    ],
    tracks: [track("a-track"), track("d-track")],
    ...overrides,
  };
}

function v2Output(samples = [v2Sample()]) {
  return {
    schemaVersion: 2,
    sceneId: "spinner-to-ad",
    fixtureVersion: 1,
    samples,
  };
}

test("accepts equal evaluator outputs", () => {
  const result = compareParity(output(), output());
  assert.equal(result.ok, true);
  assert.equal(result.tolerance, DEFAULT_TOLERANCE);
  assert.deepEqual(result.differences, []);
});

test("tolerates recursive continuous numeric drift within tolerance", () => {
  const expected = output();
  const actual = clone(expected);
  actual.samples[0].leftLeg.start.x += 0.0000005;
  actual.samples[0].bridge.radius += 0.0000005;
  actual.samples[0].targetMix += 0.0000005;

  assert.equal(compareParity(expected, actual).ok, true);
});

test("reports continuous numeric drift beyond tolerance with sample context", () => {
  const expected = output();
  const actual = clone(expected);
  actual.samples[0].leftLeg.start.x += 0.000002;

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.equal(result.differences[0].path, "$.samples[0].leftLeg.start.x");
  assert.equal(result.differences[0].sample.label, "source");
  assert.equal(result.differences[0].sample.progress, 0);
  assert.equal(result.differences[0].sample.phase, "sourceHold");
});

test("compares endpoint command structure exactly and numeric leaves with tolerance", () => {
  const expected = output();
  const actual = clone(expected);
  actual.samples[0].endpointCommands[1].values[0] += 0.0000005;
  assert.equal(compareParity(expected, actual).ok, true);

  actual.samples[0].endpointCommands[1].type = "C";
  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.match(result.differences[0].path, /endpointCommands/);
});

test("compares metadata exactly", () => {
  const expected = output();
  const actual = output();
  actual.sceneId = "other-scene";
  actual.fixtureVersion = 2;

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.equal(result.differences[0].path, "$.sceneId");
  assert.equal(result.differences[1].path, "$.fixtureVersion");
});

test("handles sample order independently", () => {
  const first = sample({ label: "source", progress: 0 });
  const second = sample({
    label: "target",
    progress: 1,
    phase: "endpointLock",
    events: ["adhesionRelease", "endpointLock"],
    renderMode: "targetPath",
    sourceOpacity: 0,
    targetOpacity: 1,
    targetMix: 1,
  });

  const result = compareParity(output([first, second]), output([second, first]));
  assert.equal(result.ok, true);
});

test("reports missing and unexpected samples by identity", () => {
  const expected = output([
    sample({ label: "source", progress: 0 }),
    sample({ label: "target", progress: 1, phase: "endpointLock", renderMode: "targetPath" }),
  ]);
  const actual = output([sample({ label: "source", progress: 0 })]);

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.equal(result.differences[0].path, "$.samples");
  assert.match(result.differences[0].message, /Missing sample label="target" progress=1 phase="endpointLock"/);
});

test("rejects duplicate sample labels", () => {
  const duplicate = output([sample(), sample()]);
  const errors = validateEvaluatorOutput(duplicate, "actual");

  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Duplicate sample label/);
  assert.equal(errors[0].path, "$.actual.samples[1]");
});

test("rejects duplicate sample labels when progress differs", () => {
  const duplicate = output([sample({ label: "same", progress: 0 }), sample({ label: "same", progress: 1 })]);
  const errors = validateEvaluatorOutput(duplicate, "actual");

  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Duplicate sample label/);
  assert.equal(errors[0].sample.label, "same");
  assert.equal(errors[0].sample.progress, 1);
});

test("rejects invalid and non-finite values", () => {
  const invalid = output();
  invalid.samples[0].targetMix = Infinity;
  invalid.samples[0].progress = 1.5;

  const errors = validateEvaluatorOutput(invalid, "actual");
  assert.ok(errors.some((error) => error.path === "$.actual.samples[0].targetMix" && /finite number/.test(error.message)));
  assert.ok(errors.some((error) => error.path === "$.actual.samples[0].progress" && /range/.test(error.message)));
});

test("accepts v2 output with numeric drift inside tolerance", () => {
  const expected = v2Output();
  const actual = clone(expected);
  actual.samples[0].tracks[0].source.transform.translateX += 0.0000005;
  actual.samples[0].tracks[0].components[0].primitive.start.x += 0.0000005;
  actual.samples[0].tracks[0].components[0].material.blendRadius += 0.0000005;
  actual.samples[0].tracks[0].material.groups.$track.targetMix += 0.0000005;
  actual.samples[0].events[0].payload.threshold += 0.0000005;

  assert.equal(compareParity(expected, actual).ok, true);
});

test("reports v2 numeric drift with sample and track context", () => {
  const expected = v2Output();
  const actual = clone(expected);
  actual.samples[0].tracks[0].components[0].primitive.radius += 0.000002;

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.equal(result.differences[0].path, "$.samples[0].tracks[0].components[0].primitive.radius");
  assert.equal(result.differences[0].sample.label, "middle");
  assert.equal(result.differences[0].track.id, "a-track");
});

test("reports missing v2 tracks by identity", () => {
  const expected = v2Output();
  const actual = clone(expected);
  actual.samples[0].tracks.pop();

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.ok(result.differences.some((difference) => /Missing track id "d-track"/.test(difference.message)));
});

test("reports missing v2 components by identity", () => {
  const expected = v2Output();
  const actual = clone(expected);
  actual.samples[0].tracks[0].components.pop();

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.ok(result.differences.some((difference) => /Missing component id "a-track-counter"/.test(difference.message)));
});

test("reports missing v2 material keys exactly", () => {
  const expected = v2Output();
  const actual = clone(expected);
  delete actual.samples[0].tracks[0].material.groups.$track;

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.ok(result.differences.some((difference) => difference.path.endsWith(".material.groups") && /object keys/.test(difference.message)));
});

test("compares v2 exact metadata and identity fields", () => {
  const expected = v2Output();
  const actual = clone(expected);
  actual.sceneId = "other-scene";
  actual.samples[0].tracks[0].renderMode = "targetPath";
  actual.samples[0].tracks[0].components[0].operation = "subtract";
  actual.samples[0].tracks[0].source.shapeId = "other-shape";
  actual.samples[0].events[0].id = "other-event";

  const result = compareParity(expected, actual);
  assert.equal(result.ok, false);
  assert.ok(result.differences.some((difference) => difference.path === "$.sceneId"));
  assert.ok(result.differences.some((difference) => difference.path.endsWith(".renderMode")));
  assert.ok(result.differences.some((difference) => difference.path.endsWith(".operation")));
  assert.ok(result.differences.some((difference) => difference.path.endsWith(".source.shapeId")));
  assert.ok(result.differences.some((difference) => difference.path.endsWith(".events[0].id")));
});

test("rejects duplicate v2 sample labels", () => {
  const duplicate = v2Output([v2Sample({ label: "same", progress: 0 }), v2Sample({ label: "same", progress: 1 })]);
  const errors = validateEvaluatorOutput(duplicate, "actual");

  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /Duplicate sample label/);
  assert.equal(errors[0].sample.label, "same");
});

test("rejects malformed and mixed schema outputs", () => {
  const malformed = v2Output();
  delete malformed.samples[0].tracks[0].components[0].primitive.kind;
  const errors = validateEvaluatorOutput(malformed, "actual");
  assert.ok(errors.some((error) => error.path.endsWith(".primitive.kind")));

  const mixed = compareParity(output(), v2Output());
  assert.equal(mixed.ok, false);
  assert.equal(mixed.differences[0].path, "$.schemaVersion");
});

test("keeps v1 comparison behavior independent of sample order", () => {
  const expected = output([
    sample({ label: "source", progress: 0 }),
    sample({ label: "target", progress: 1, phase: "endpointLock", renderMode: "targetPath", endpointCommands: null }),
  ]);
  const actual = output([
    sample({ label: "target", progress: 1, phase: "endpointLock", renderMode: "targetPath", endpointCommands: null }),
    sample({ label: "source", progress: 0 }),
  ]);

  assert.equal(compareParity(expected, actual).ok, true);
});

test("parses tolerance and help options", () => {
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.deepEqual(parseArgs(["--tolerance", "0.01", "a.json", "b.json"]), {
    help: false,
    tolerance: 0.01,
    expectedPath: "a.json",
    actualPath: "b.json",
  });
  assert.throws(() => parseArgs(["--tolerance", "-1", "a.json", "b.json"]), /finite non-negative/);
});

test("CLI exits nonzero and prints JSON differences on mismatch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "liquid-parity-"));
  try {
    const expectedPath = path.join(directory, "expected.json");
    const actualPath = path.join(directory, "actual.json");
    const expected = output();
    const actual = clone(expected);
    actual.samples[0].endpointCommands[0].values[0] = 1;
    await writeFile(expectedPath, `${JSON.stringify(expected)}\n`);
    await writeFile(actualPath, `${JSON.stringify(actual)}\n`);

    const mismatch = spawnSync(process.execPath, [cliPath, expectedPath, actualPath], { encoding: "utf8" });
    assert.equal(mismatch.status, 1);
    const parsed = JSON.parse(mismatch.stderr);
    assert.equal(parsed.ok, false);
    assert.match(parsed.differences[0].path, /endpointCommands/);

    const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--tolerance/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
