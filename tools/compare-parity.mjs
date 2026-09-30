import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const DEFAULT_TOLERANCE = 0.000001;

const renderModes = new Set(["sourcePath", "field", "targetPath", "crossfade"]);
const commandTypes = new Set(["M", "L", "C", "Z"]);
const componentKinds = new Set(["capsule", "ribbon", "ellipse"]);
const operations = new Set(["union", "subtract"]);
const eventKinds = new Set(["step", "release"]);

const topLevelKeys = ["schemaVersion", "sceneId", "fixtureVersion", "samples"];
const v1SampleKeys = [
  "label",
  "progress",
  "phase",
  "events",
  "renderMode",
  "sourceOpacity",
  "targetOpacity",
  "anchor",
  "leftLeg",
  "rightLeg",
  "crossbar",
  "bridge",
  "blendRadius",
  "targetMix",
  "cornerSharpness",
  "endpointCommands",
];
const v2SampleKeys = ["label", "progress", "events", "tracks"];
const pointKeys = ["x", "y"];
const transformKeys = ["translateX", "translateY", "scaleX", "scaleY"];
const capsuleKeys = ["kind", "start", "end", "radius"];
const ribbonKeys = ["kind", "p0", "p1", "p2", "p3", "startRadius", "endRadius"];
const ellipseKeys = ["kind", "center", "radiusX", "radiusY", "rotation"];
const v1CapsuleKeys = ["start", "end", "radius"];
const commandKeys = ["type", "values"];
const endpointKeys = ["assetId", "shapeId", "transform", "commands"];
const eventKeys = ["id", "kind", "trackId", "at", "end", "componentId", "payload"];
const trackKeys = [
  "id",
  "progress",
  "localProgress",
  "renderMode",
  "sourceOpacity",
  "targetOpacity",
  "source",
  "target",
  "endpointCommands",
  "components",
  "material",
];
const componentKeys = ["id", "kind", "operation", "groupId", "primitive", "material"];
const trackMaterialKeys = ["components", "groups"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describe(value) {
  if (typeof value === "number" && Object.is(value, -0)) {
    return "-0";
  }
  return value;
}

function pathForProperty(base, key) {
  return `${base}.${key}`;
}

function pathForIndex(base, index) {
  return `${base}[${index}]`;
}

function sampleContext(sample) {
  if (!isPlainObject(sample)) {
    return undefined;
  }
  const context = {
    label: sample.label,
    progress: sample.progress,
  };
  if ("phase" in sample) {
    context.phase = sample.phase;
  }
  return context;
}

function trackContext(track) {
  if (!isPlainObject(track)) {
    return undefined;
  }
  return {
    id: track.id,
    progress: track.progress,
    localProgress: track.localProgress,
    renderMode: track.renderMode,
  };
}

function sampleDescription(sample) {
  const context = sampleContext(sample);
  if (!context) {
    return "sample";
  }
  const phase = "phase" in context ? ` phase=${JSON.stringify(context.phase)}` : "";
  return `sample label=${JSON.stringify(context.label)} progress=${JSON.stringify(context.progress)}${phase}`;
}

function createDifference(path, message, expected, actual, sample, track) {
  return {
    path,
    message,
    expected: describe(expected),
    actual: describe(actual),
    ...(sample ? { sample: sampleContext(sample) } : {}),
    ...(track ? { track: trackContext(track) } : {}),
  };
}

function validateObjectKeys(value, allowed, required, path, errors, sample, track) {
  if (!isPlainObject(value)) {
    errors.push(createDifference(path, "Expected object", "object", Array.isArray(value) ? "array" : typeof value, sample, track));
    return false;
  }

  for (const key of required) {
    if (!(key in value)) {
      errors.push(createDifference(pathForProperty(path, key), "Missing required property", "present", "missing", sample, track));
    }
  }

  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      errors.push(createDifference(pathForProperty(path, key), "Unexpected property", "absent", "present", sample, track));
    }
  }
  return true;
}

function validateFiniteNumber(value, path, errors, sample, track, range) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(createDifference(path, "Expected finite number", "finite number", value, sample, track));
    return;
  }
  if (range && (value < range.min || value > range.max)) {
    errors.push(createDifference(path, `Expected number in range [${range.min}, ${range.max}]`, range, value, sample, track));
  }
}

function validateInteger(value, path, errors, sample, track, minimum) {
  if (!Number.isInteger(value)) {
    errors.push(createDifference(path, "Expected integer", "integer", value, sample, track));
    return;
  }
  if (minimum !== undefined && value < minimum) {
    errors.push(createDifference(path, `Expected integer >= ${minimum}`, `>= ${minimum}`, value, sample, track));
  }
}

function validateString(value, path, errors, sample, track) {
  if (typeof value !== "string") {
    errors.push(createDifference(path, "Expected string", "string", value, sample, track));
  }
}

function validateBoolean(value, path, errors, sample, track) {
  if (typeof value !== "boolean") {
    errors.push(createDifference(path, "Expected boolean", "boolean", value, sample, track));
  }
}

function validateEnum(value, allowed, path, message, errors, sample, track) {
  if (!allowed.has(value)) {
    errors.push(createDifference(path, message, [...allowed], value, sample, track));
  }
}

function validatePoint(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, pointKeys, pointKeys, path, errors, sample, track)) {
    return;
  }
  validateFiniteNumber(value.x, pathForProperty(path, "x"), errors, sample, track);
  validateFiniteNumber(value.y, pathForProperty(path, "y"), errors, sample, track);
}

function validateTransform(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, transformKeys, transformKeys, path, errors, sample, track)) {
    return;
  }
  for (const key of transformKeys) {
    validateFiniteNumber(value[key], pathForProperty(path, key), errors, sample, track);
  }
}

function validateV1Capsule(value, path, errors, sample) {
  if (!validateObjectKeys(value, v1CapsuleKeys, v1CapsuleKeys, path, errors, sample)) {
    return;
  }
  validatePoint(value.start, pathForProperty(path, "start"), errors, sample);
  validatePoint(value.end, pathForProperty(path, "end"), errors, sample);
  validateFiniteNumber(value.radius, pathForProperty(path, "radius"), errors, sample);
}

function validateCommand(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, commandKeys, ["type"], path, errors, sample, track)) {
    return;
  }
  if (!commandTypes.has(value.type)) {
    errors.push(createDifference(pathForProperty(path, "type"), "Expected path command type M, L, C, or Z", [...commandTypes], value.type, sample, track));
  }
  const expectedLength = value.type === "M" || value.type === "L" ? 2 : value.type === "C" ? 6 : value.type === "Z" ? 0 : undefined;
  if (value.type === "Z") {
    if ("values" in value) {
      errors.push(createDifference(pathForProperty(path, "values"), "Expected Z command to omit values", "absent", value.values, sample, track));
    }
    return;
  }
  if (!Array.isArray(value.values)) {
    errors.push(createDifference(pathForProperty(path, "values"), "Expected array of finite numbers", "array", value.values, sample, track));
    return;
  }
  if (expectedLength !== undefined && value.values.length !== expectedLength) {
    errors.push(createDifference(pathForProperty(path, "values"), `Expected ${expectedLength} command values`, expectedLength, value.values.length, sample, track));
  }
  value.values.forEach((number, index) => validateFiniteNumber(number, pathForIndex(pathForProperty(path, "values"), index), errors, sample, track));
}

function validateCommandArray(value, path, errors, sample, track, nullable = false) {
  if (nullable && value === null) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(createDifference(path, nullable ? "Expected command array or null" : "Expected command array", nullable ? "array|null" : "array", value, sample, track));
    return;
  }
  value.forEach((command, index) => validateCommand(command, pathForIndex(path, index), errors, sample, track));
}

function validateEndpoint(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, endpointKeys, endpointKeys, path, errors, sample, track)) {
    return;
  }
  validateString(value.assetId, pathForProperty(path, "assetId"), errors, sample, track);
  validateString(value.shapeId, pathForProperty(path, "shapeId"), errors, sample, track);
  validateTransform(value.transform, pathForProperty(path, "transform"), errors, sample, track);
  validateCommandArray(value.commands, pathForProperty(path, "commands"), errors, sample, track);
}

function validateCapsulePrimitive(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, capsuleKeys, capsuleKeys, path, errors, sample, track)) {
    return;
  }
  if (value.kind !== "capsule") {
    errors.push(createDifference(pathForProperty(path, "kind"), "Expected capsule primitive kind", "capsule", value.kind, sample, track));
  }
  validatePoint(value.start, pathForProperty(path, "start"), errors, sample, track);
  validatePoint(value.end, pathForProperty(path, "end"), errors, sample, track);
  validateFiniteNumber(value.radius, pathForProperty(path, "radius"), errors, sample, track);
}

function validateRibbonPrimitive(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, ribbonKeys, ribbonKeys, path, errors, sample, track)) {
    return;
  }
  if (value.kind !== "ribbon") {
    errors.push(createDifference(pathForProperty(path, "kind"), "Expected ribbon primitive kind", "ribbon", value.kind, sample, track));
  }
  for (const key of ["p0", "p1", "p2", "p3"]) {
    validatePoint(value[key], pathForProperty(path, key), errors, sample, track);
  }
  validateFiniteNumber(value.startRadius, pathForProperty(path, "startRadius"), errors, sample, track);
  validateFiniteNumber(value.endRadius, pathForProperty(path, "endRadius"), errors, sample, track);
}

function validateEllipsePrimitive(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, ellipseKeys, ["kind", "center", "radiusX", "radiusY"], path, errors, sample, track)) {
    return;
  }
  if (value.kind !== "ellipse") {
    errors.push(createDifference(pathForProperty(path, "kind"), "Expected ellipse primitive kind", "ellipse", value.kind, sample, track));
  }
  validatePoint(value.center, pathForProperty(path, "center"), errors, sample, track);
  validateFiniteNumber(value.radiusX, pathForProperty(path, "radiusX"), errors, sample, track);
  validateFiniteNumber(value.radiusY, pathForProperty(path, "radiusY"), errors, sample, track);
  if ("rotation" in value) {
    validateFiniteNumber(value.rotation, pathForProperty(path, "rotation"), errors, sample, track);
  }
}

function validatePrimitive(value, path, errors, sample, track) {
  if (!isPlainObject(value)) {
    errors.push(createDifference(path, "Expected primitive object", "object", Array.isArray(value) ? "array" : typeof value, sample, track));
    return;
  }
  if (value.kind === "capsule") validateCapsulePrimitive(value, path, errors, sample, track);
  else if (value.kind === "ribbon") validateRibbonPrimitive(value, path, errors, sample, track);
  else if (value.kind === "ellipse") validateEllipsePrimitive(value, path, errors, sample, track);
  else errors.push(createDifference(pathForProperty(path, "kind"), "Expected primitive kind capsule, ribbon, or ellipse", [...componentKinds], value.kind, sample, track));
}

function validateMaterialValues(value, path, errors, sample, track) {
  if (!isPlainObject(value)) {
    errors.push(createDifference(path, "Expected material values object", "object", Array.isArray(value) ? "array" : typeof value, sample, track));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = pathForProperty(path, key);
    if (typeof child === "number") validateFiniteNumber(child, childPath, errors, sample, track);
    else if (typeof child === "string") validateString(child, childPath, errors, sample, track);
    else if (typeof child === "boolean") validateBoolean(child, childPath, errors, sample, track);
    else errors.push(createDifference(childPath, "Expected material scalar number, string, or boolean", "number|string|boolean", child, sample, track));
  }
}

function validateMaterialMap(value, path, errors, sample, track) {
  if (!isPlainObject(value)) {
    errors.push(createDifference(path, "Expected material map object", "object", Array.isArray(value) ? "array" : typeof value, sample, track));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateMaterialValues(child, pathForProperty(path, key), errors, sample, track);
  }
}

function validateComponent(value, path, errors, sample, track) {
  if (!validateObjectKeys(value, componentKeys, ["id", "kind", "operation", "primitive", "material"], path, errors, sample, track)) {
    return;
  }
  validateString(value.id, pathForProperty(path, "id"), errors, sample, track);
  validateEnum(value.kind, componentKinds, pathForProperty(path, "kind"), "Expected component kind capsule, ribbon, or ellipse", errors, sample, track);
  validateEnum(value.operation, operations, pathForProperty(path, "operation"), "Expected component operation union or subtract", errors, sample, track);
  if ("groupId" in value) {
    validateString(value.groupId, pathForProperty(path, "groupId"), errors, sample, track);
  }
  validatePrimitive(value.primitive, pathForProperty(path, "primitive"), errors, sample, track);
  if (isPlainObject(value.primitive) && componentKinds.has(value.kind) && value.primitive.kind !== value.kind) {
    errors.push(createDifference(pathForProperty(path, "primitive.kind"), "Expected primitive kind to match component kind", value.kind, value.primitive.kind, sample, track));
  }
  validateMaterialValues(value.material, pathForProperty(path, "material"), errors, sample, track);
}

function validateEvent(value, path, errors, sample) {
  if (!validateObjectKeys(value, eventKeys, ["id", "kind", "trackId", "at"], path, errors, sample)) {
    return;
  }
  validateString(value.id, pathForProperty(path, "id"), errors, sample);
  validateEnum(value.kind, eventKinds, pathForProperty(path, "kind"), "Expected event kind step or release", errors, sample);
  validateString(value.trackId, pathForProperty(path, "trackId"), errors, sample);
  validateFiniteNumber(value.at, pathForProperty(path, "at"), errors, sample, undefined, { min: 0, max: 1 });
  if ("end" in value) {
    validateFiniteNumber(value.end, pathForProperty(path, "end"), errors, sample, undefined, { min: 0, max: 1 });
  }
  if ("componentId" in value) {
    validateString(value.componentId, pathForProperty(path, "componentId"), errors, sample);
  }
  if ("payload" in value) {
    validateMaterialValues(value.payload, pathForProperty(path, "payload"), errors, sample);
  }
}

function duplicateIdErrors(items, sideName, path, sample, track, entityName) {
  const seen = new Map();
  const errors = [];
  items.forEach((item, index) => {
    if (!isPlainObject(item) || typeof item.id !== "string") {
      return;
    }
    const existing = seen.get(item.id);
    if (existing) {
      errors.push(createDifference(pathForIndex(path, index), `Duplicate ${entityName} id ${JSON.stringify(item.id)}`, "unique id", item.id, sample, track));
      errors.push(createDifference(pathForIndex(path, existing.index), `First occurrence of duplicate ${entityName} id ${JSON.stringify(item.id)}`, "unique id", item.id, sample, track));
      return;
    }
    seen.set(item.id, { item, index, sideName });
  });
  return errors;
}

function validateTrack(value, path, errors, sample) {
  const track = isPlainObject(value) ? value : undefined;
  if (!validateObjectKeys(value, trackKeys, trackKeys, path, errors, sample, track)) {
    return;
  }
  validateString(value.id, pathForProperty(path, "id"), errors, sample, track);
  validateFiniteNumber(value.progress, pathForProperty(path, "progress"), errors, sample, track, { min: 0, max: 1 });
  validateFiniteNumber(value.localProgress, pathForProperty(path, "localProgress"), errors, sample, track, { min: 0, max: 1 });
  validateEnum(value.renderMode, renderModes, pathForProperty(path, "renderMode"), "Expected valid render mode", errors, sample, track);
  validateFiniteNumber(value.sourceOpacity, pathForProperty(path, "sourceOpacity"), errors, sample, track, { min: 0, max: 1 });
  validateFiniteNumber(value.targetOpacity, pathForProperty(path, "targetOpacity"), errors, sample, track, { min: 0, max: 1 });
  validateEndpoint(value.source, pathForProperty(path, "source"), errors, sample, track);
  validateEndpoint(value.target, pathForProperty(path, "target"), errors, sample, track);
  validateCommandArray(value.endpointCommands, pathForProperty(path, "endpointCommands"), errors, sample, track, true);

  if (!Array.isArray(value.components)) {
    errors.push(createDifference(pathForProperty(path, "components"), "Expected components array", "array", value.components, sample, track));
  } else {
    value.components.forEach((component, index) => validateComponent(component, pathForIndex(pathForProperty(path, "components"), index), errors, sample, track));
    errors.push(...duplicateIdErrors(value.components, "output", pathForProperty(path, "components"), sample, track, "component"));
  }

  if (validateObjectKeys(value.material, trackMaterialKeys, trackMaterialKeys, pathForProperty(path, "material"), errors, sample, track)) {
    validateMaterialMap(value.material.components, pathForProperty(pathForProperty(path, "material"), "components"), errors, sample, track);
    validateMaterialMap(value.material.groups, pathForProperty(pathForProperty(path, "material"), "groups"), errors, sample, track);
  }
}

function validateV1Sample(value, path, errors) {
  const sample = isPlainObject(value) ? value : undefined;
  if (!validateObjectKeys(value, v1SampleKeys, v1SampleKeys, path, errors, sample)) {
    return;
  }

  validateString(value.label, pathForProperty(path, "label"), errors, sample);
  validateFiniteNumber(value.progress, pathForProperty(path, "progress"), errors, sample, undefined, { min: 0, max: 1 });
  validateString(value.phase, pathForProperty(path, "phase"), errors, sample);

  if (!Array.isArray(value.events)) {
    errors.push(createDifference(pathForProperty(path, "events"), "Expected string array", "array", value.events, sample));
  } else {
    value.events.forEach((event, index) => validateString(event, pathForIndex(pathForProperty(path, "events"), index), errors, sample));
  }

  validateEnum(value.renderMode, renderModes, pathForProperty(path, "renderMode"), "Expected valid render mode", errors, sample);
  validateFiniteNumber(value.sourceOpacity, pathForProperty(path, "sourceOpacity"), errors, sample, undefined, { min: 0, max: 1 });
  validateFiniteNumber(value.targetOpacity, pathForProperty(path, "targetOpacity"), errors, sample, undefined, { min: 0, max: 1 });
  validatePoint(value.anchor, pathForProperty(path, "anchor"), errors, sample);
  validateV1Capsule(value.leftLeg, pathForProperty(path, "leftLeg"), errors, sample);
  validateV1Capsule(value.rightLeg, pathForProperty(path, "rightLeg"), errors, sample);
  validateV1Capsule(value.crossbar, pathForProperty(path, "crossbar"), errors, sample);
  validateV1Capsule(value.bridge, pathForProperty(path, "bridge"), errors, sample);
  validateFiniteNumber(value.blendRadius, pathForProperty(path, "blendRadius"), errors, sample);
  validateFiniteNumber(value.targetMix, pathForProperty(path, "targetMix"), errors, sample);
  validateFiniteNumber(value.cornerSharpness, pathForProperty(path, "cornerSharpness"), errors, sample);
  validateCommandArray(value.endpointCommands, pathForProperty(path, "endpointCommands"), errors, sample, undefined, true);
}

function validateV2Sample(value, path, errors) {
  const sample = isPlainObject(value) ? value : undefined;
  if (!validateObjectKeys(value, v2SampleKeys, v2SampleKeys, path, errors, sample)) {
    return;
  }

  validateString(value.label, pathForProperty(path, "label"), errors, sample);
  validateFiniteNumber(value.progress, pathForProperty(path, "progress"), errors, sample, undefined, { min: 0, max: 1 });

  if (!Array.isArray(value.events)) {
    errors.push(createDifference(pathForProperty(path, "events"), "Expected event array", "array", value.events, sample));
  } else {
    value.events.forEach((event, index) => validateEvent(event, pathForIndex(pathForProperty(path, "events"), index), errors, sample));
  }

  if (!Array.isArray(value.tracks)) {
    errors.push(createDifference(pathForProperty(path, "tracks"), "Expected tracks array", "array", value.tracks, sample));
  } else {
    if (value.tracks.length === 0) {
      errors.push(createDifference(pathForProperty(path, "tracks"), "Expected at least one track", "non-empty array", value.tracks, sample));
    }
    value.tracks.forEach((track, index) => validateTrack(track, pathForIndex(pathForProperty(path, "tracks"), index), errors, sample));
    errors.push(...duplicateIdErrors(value.tracks, "output", pathForProperty(path, "tracks"), sample, undefined, "track"));
  }
}

export function sampleKey(sample) {
  return JSON.stringify(sample.label);
}

function indexSamples(samples, sideName) {
  const byKey = new Map();
  const duplicates = [];

  samples.forEach((sample, index) => {
    const key = sampleKey(sample);
    const existing = byKey.get(key);
    if (existing) {
      duplicates.push(createDifference(
        `$.${sideName}.samples[${index}]`,
        `Duplicate sample label ${JSON.stringify(sample.label)}`,
        "unique label",
        sampleDescription(sample),
        sample,
      ));
      duplicates.push(createDifference(
        `$.${sideName}.samples[${existing.index}]`,
        `First occurrence of duplicate sample label ${JSON.stringify(existing.sample.label)}`,
        "unique label",
        sampleDescription(existing.sample),
        existing.sample,
      ));
      return;
    }
    byKey.set(key, { sample, index });
  });

  return { byKey, duplicates };
}

export function validateEvaluatorOutput(output, sideName = "output") {
  const errors = [];
  if (!validateObjectKeys(output, topLevelKeys, topLevelKeys, `$.${sideName}`, errors)) {
    return errors;
  }

  if (output.schemaVersion !== 1 && output.schemaVersion !== 2) {
    errors.push(createDifference(`$.${sideName}.schemaVersion`, "Expected schemaVersion 1 or 2", "1|2", output.schemaVersion));
  }
  validateString(output.sceneId, `$.${sideName}.sceneId`, errors);
  validateInteger(output.fixtureVersion, `$.${sideName}.fixtureVersion`, errors, undefined, undefined, 1);

  if (!Array.isArray(output.samples)) {
    errors.push(createDifference(`$.${sideName}.samples`, "Expected samples array", "array", output.samples));
    return errors;
  }
  if (output.samples.length === 0) {
    errors.push(createDifference(`$.${sideName}.samples`, "Expected at least one sample", "non-empty array", output.samples));
  }
  if (output.schemaVersion === 1) {
    output.samples.forEach((sample, index) => validateV1Sample(sample, pathForIndex(`$.${sideName}.samples`, index), errors));
  } else if (output.schemaVersion === 2) {
    output.samples.forEach((sample, index) => validateV2Sample(sample, pathForIndex(`$.${sideName}.samples`, index), errors));
  }

  if (errors.length === 0) {
    const { duplicates } = indexSamples(output.samples, sideName);
    errors.push(...duplicates);
  }
  return errors;
}

function compareExact(path, expected, actual, differences, sample, message = "Expected exact match", track) {
  if (!isDeepStrictEqual(expected, actual)) {
    differences.push(createDifference(path, message, expected, actual, sample, track));
  }
}

function compareValue(path, expected, actual, tolerance, differences, sample, track) {
  if (typeof expected === "number" || typeof actual === "number") {
    if (typeof expected !== "number" || typeof actual !== "number") {
      differences.push(createDifference(path, "Expected matching numeric field", expected, actual, sample, track));
      return;
    }
    const delta = Math.abs(expected - actual);
    if (delta > tolerance) {
      differences.push({
        ...createDifference(path, `Numeric difference ${delta} exceeds tolerance ${tolerance}`, expected, actual, sample, track),
        delta,
        tolerance,
      });
    }
    return;
  }

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      differences.push(createDifference(path, "Expected matching array field", expected, actual, sample, track));
      return;
    }
    if (expected.length !== actual.length) {
      differences.push(createDifference(path, "Expected arrays to have the same length", expected.length, actual.length, sample, track));
    }
    const sharedLength = Math.min(expected.length, actual.length);
    for (let index = 0; index < sharedLength; index += 1) {
      compareValue(pathForIndex(path, index), expected[index], actual[index], tolerance, differences, sample, track);
    }
    return;
  }

  if (isPlainObject(expected) || isPlainObject(actual)) {
    if (!isPlainObject(expected) || !isPlainObject(actual)) {
      differences.push(createDifference(path, "Expected matching object field", expected, actual, sample, track));
      return;
    }
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (!isDeepStrictEqual(expectedKeys, actualKeys)) {
      differences.push(createDifference(path, "Expected object keys to match exactly", expectedKeys, actualKeys, sample, track));
    }
    for (const key of expectedKeys) {
      if (!(key in actual)) continue;
      compareValue(pathForProperty(path, key), expected[key], actual[key], tolerance, differences, sample, track);
    }
    return;
  }

  if (expected !== actual) {
    differences.push(createDifference(path, "Expected exact scalar match", expected, actual, sample, track));
  }
}

function indexById(items) {
  return new Map(items.map((item, index) => [item.id, { item, index }]));
}

function compareIdentityArray(path, expectedItems, actualItems, tolerance, differences, sample, entityName, compareItem, track) {
  const expectedIds = expectedItems.map((item) => item.id);
  const actualIds = actualItems.map((item) => item.id);
  if (!isDeepStrictEqual(expectedIds, actualIds)) {
    differences.push(createDifference(path, `Expected ${entityName} id order to match exactly`, expectedIds, actualIds, sample, track));
  }

  const expectedIndex = indexById(expectedItems);
  const actualIndex = indexById(actualItems);
  for (const id of expectedIds) {
    const expectedEntry = expectedIndex.get(id);
    const actualEntry = actualIndex.get(id);
    if (!actualEntry) {
      differences.push(createDifference(path, `Missing ${entityName} id ${JSON.stringify(id)} in actual output`, id, "missing", sample, track ?? expectedEntry?.item));
      continue;
    }
    compareItem(expectedEntry, actualEntry, tolerance, differences);
  }
  for (const id of actualIds) {
    if (!expectedIndex.has(id)) {
      const actualEntry = actualIndex.get(id);
      differences.push(createDifference(path, `Unexpected ${entityName} id ${JSON.stringify(id)} in actual output`, "missing", id, sample, track ?? actualEntry?.item));
    }
  }
}

function compareV1Sample(expectedEntry, actualEntry, tolerance, differences) {
  const expected = expectedEntry.sample;
  const actual = actualEntry.sample;
  const basePath = `$.samples[${actualEntry.index}]`;
  const sample = {
    label: expected.label,
    progress: expected.progress,
    phase: actual.phase,
  };

  for (const key of v1SampleKeys) {
    compareValue(pathForProperty(basePath, key), expected[key], actual[key], tolerance, differences, sample);
  }
}

function compareMaterialMap(path, expected, actual, tolerance, differences, sample, track) {
  compareValue(path, expected, actual, tolerance, differences, sample, track);
}

function compareComponent(expectedEntry, actualEntry, tolerance, differences, sample, track, componentArrayPath) {
  const expected = expectedEntry.item;
  const actual = actualEntry.item;
  const basePath = pathForIndex(componentArrayPath, actualEntry.index);
  compareValue(pathForProperty(basePath, "id"), expected.id, actual.id, tolerance, differences, sample, track);
  compareValue(pathForProperty(basePath, "kind"), expected.kind, actual.kind, tolerance, differences, sample, track);
  compareValue(pathForProperty(basePath, "operation"), expected.operation, actual.operation, tolerance, differences, sample, track);
  compareValue(pathForProperty(basePath, "groupId"), expected.groupId, actual.groupId, tolerance, differences, sample, track);
  compareValue(pathForProperty(basePath, "primitive"), expected.primitive, actual.primitive, tolerance, differences, sample, track);
  compareMaterialMap(pathForProperty(basePath, "material"), expected.material, actual.material, tolerance, differences, sample, track);
}

function compareTrack(expectedEntry, actualEntry, tolerance, differences, sample, trackArrayPath) {
  const expected = expectedEntry.item;
  const actual = actualEntry.item;
  const basePath = pathForIndex(trackArrayPath, actualEntry.index);
  const track = actual;

  for (const key of ["id", "progress", "localProgress", "renderMode", "sourceOpacity", "targetOpacity", "source", "target", "endpointCommands"]) {
    compareValue(pathForProperty(basePath, key), expected[key], actual[key], tolerance, differences, sample, track);
  }
  const componentsPath = pathForProperty(basePath, "components");
  compareIdentityArray(
    componentsPath,
    expected.components,
    actual.components,
    tolerance,
    differences,
    sample,
    "component",
    (expectedComponent, actualComponent, childTolerance, childDifferences) => compareComponent(expectedComponent, actualComponent, childTolerance, childDifferences, sample, track, componentsPath),
    track,
  );
  compareMaterialMap(pathForProperty(basePath, "material"), expected.material, actual.material, tolerance, differences, sample, track);
}

function compareV2Sample(expectedEntry, actualEntry, tolerance, differences) {
  const expected = expectedEntry.sample;
  const actual = actualEntry.sample;
  const basePath = `$.samples[${actualEntry.index}]`;
  const sample = {
    label: expected.label,
    progress: expected.progress,
  };

  compareValue(pathForProperty(basePath, "label"), expected.label, actual.label, tolerance, differences, sample);
  compareValue(pathForProperty(basePath, "progress"), expected.progress, actual.progress, tolerance, differences, sample);
  compareValue(pathForProperty(basePath, "events"), expected.events, actual.events, tolerance, differences, sample);
  const tracksPath = pathForProperty(basePath, "tracks");
  compareIdentityArray(
    tracksPath,
    expected.tracks,
    actual.tracks,
    tolerance,
    differences,
    sample,
    "track",
    (expectedTrack, actualTrack, childTolerance, childDifferences) => compareTrack(expectedTrack, actualTrack, childTolerance, childDifferences, sample, tracksPath),
  );
}

export function compareParity(expected, actual, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("Tolerance must be a finite non-negative number");
  }

  const validationErrors = [
    ...validateEvaluatorOutput(expected, "expected"),
    ...validateEvaluatorOutput(actual, "actual"),
  ];
  if (validationErrors.length > 0) {
    return { ok: false, tolerance, differences: validationErrors };
  }

  const differences = [];
  compareExact("$.schemaVersion", expected.schemaVersion, actual.schemaVersion, differences, undefined, "Expected matching schemaVersion outputs");
  compareExact("$.sceneId", expected.sceneId, actual.sceneId, differences, undefined, "Expected sceneId match");
  compareExact("$.fixtureVersion", expected.fixtureVersion, actual.fixtureVersion, differences, undefined, "Expected fixtureVersion match");

  if (expected.schemaVersion !== actual.schemaVersion) {
    return { ok: false, tolerance, differences };
  }

  const expectedIndex = indexSamples(expected.samples, "expected").byKey;
  const actualIndex = indexSamples(actual.samples, "actual").byKey;
  const expectedKeys = [...expectedIndex.keys()].sort();
  const actualKeys = [...actualIndex.keys()].sort();
  const compareSample = expected.schemaVersion === 2 ? compareV2Sample : compareV1Sample;

  for (const key of expectedKeys) {
    if (!actualIndex.has(key)) {
      const { sample } = expectedIndex.get(key);
      differences.push(createDifference("$.samples", `Missing ${sampleDescription(sample)} in actual output`, sampleDescription(sample), "missing", sample));
      continue;
    }
    compareSample(expectedIndex.get(key), actualIndex.get(key), tolerance, differences);
  }
  for (const key of actualKeys) {
    if (!expectedIndex.has(key)) {
      const { sample } = actualIndex.get(key);
      differences.push(createDifference("$.samples", `Unexpected ${sampleDescription(sample)} in actual output`, "missing", sampleDescription(sample), sample));
    }
  }

  return { ok: differences.length === 0, tolerance, differences };
}

export async function loadJson(filePath) {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON: ${error.message}`);
  }
}

export function parseArgs(argv) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  let tolerance = DEFAULT_TOLERANCE;
  const paths = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--tolerance") {
      const raw = args[index + 1];
      if (raw === undefined) {
        throw new Error("--tolerance requires a numeric value");
      }
      tolerance = Number(raw);
      index += 1;
    } else if (arg.startsWith("--tolerance=")) {
      tolerance = Number(arg.slice("--tolerance=".length));
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}`);
    } else {
      paths.push(arg);
    }
  }

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("--tolerance must be a finite non-negative number");
  }
  if (paths.length !== 2) {
    throw new Error("Expected exactly two evaluator-output JSON paths");
  }
  return { help: false, tolerance, expectedPath: paths[0], actualPath: paths[1] };
}

export function usage() {
  return [
    "Usage: node tools/compare-parity.mjs [--tolerance <number>] <expected.json> <actual.json>",
    "",
    "Compares two Liquid evaluator-output JSON files without depending on either runtime.",
    "Schema, identity fields, strings, booleans, nulls, object keys, and array structure must match exactly.",
    "Every evaluated numeric leaf is compared with an absolute tolerance.",
    "",
    `Default tolerance: ${DEFAULT_TOLERANCE}`,
  ].join("\n");
}

export function formatComparisonResult(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }

  const expected = await loadJson(parsed.expectedPath);
  const actual = await loadJson(parsed.actualPath);
  const result = compareParity(expected, actual, { tolerance: parsed.tolerance });
  if (!result.ok) {
    io.stderr.write(formatComparisonResult(result));
    return 1;
  }
  io.stdout.write(formatComparisonResult(result));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
