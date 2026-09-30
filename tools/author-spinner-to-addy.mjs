#!/usr/bin/env node
// Authoring source for shared/scenes/spinner-to-addy.v2.json.
//
// The scene lives in the coordinate space of the Addy logo artwork
// (shared/assets/addy-logo-ticks.svg and addy-logo-wordmark.svg, 2973x1568):
// the pill outline is a static backdrop, the ticks are the exact source
// endpoints, and the letters are the exact target endpoints, all read from the
// canonical asset manifest. Motion is authored in the original wordmark units
// (528x207) and mapped into the logo space by WORDMARK_TO_LOGO.
//
// The scene opens on the empty pill: the four ticks drop in through its top
// edge (tracks are clipped to the pill), staggered left to right, overshoot and
// spring into place, hold a beat together, and then morph into the wordmark.
// Each letter is a short list of poses. Tracks use monotone cubic interpolation,
// so poses are passed through with continuous velocity and each track starts
// and settles at rest. The final pose is fitted to the target glyph, and the
// targetMix/cornerSharpness ramp runs while the letter settles so the soft
// shape flows into the exact glyph without stopping first.
//
//   node tools/author-spinner-to-addy.mjs            # rewrite the committed scene
//   node tools/author-spinner-to-addy.mjs --check    # fail if the scene is stale
//   node tools/author-spinner-to-addy.mjs --out f.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { roundedRectCommands } from "./canonicalize-assets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scenePath = path.join(root, "shared/scenes/spinner-to-addy.v2.json");
const samplesPath = path.join(root, "shared/golden/spinner-to-addy.samples.json");
const waveScenePath = path.join(root, "shared/scenes/addy-logo-wave.v2.json");
const waveSamplesPath = path.join(root, "shared/golden/addy-logo-wave.samples.json");
const waveWordmarkScenePath = path.join(root, "shared/scenes/addy-logo-wave-wordmark.v2.json");
const waveWordmarkSamplesPath = path.join(root, "shared/golden/addy-logo-wave-wordmark.samples.json");
const replayScenePath = path.join(root, "shared/scenes/addy-logo-wave-wordmark-replay.v2.json");
const replaySamplesPath = path.join(root, "shared/golden/addy-logo-wave-wordmark-replay.samples.json");

const round = (value) => Math.round(value * 10000) / 10000;
const pt = (x, y) => ({ x: round(x), y: round(y) });
const cap = (sx, sy, ex, ey, r) => ({ kind: "capsule", start: pt(sx, sy), end: pt(ex, ey), radius: round(r) });
const rib = ([x0, y0], [x1, y1], [x2, y2], [x3, y3], r0, r1 = r0) => ({
  kind: "ribbon",
  p0: pt(x0, y0),
  p1: pt(x1, y1),
  p2: pt(x2, y2),
  p3: pt(x3, y3),
  startRadius: round(r0),
  endRadius: round(r1),
});
const ell = (cx, cy, rx, ry, rotation = 0) => ({ kind: "ellipse", center: pt(cx, cy), radiusX: round(rx), radiusY: round(ry), rotation: round(rotation) });
const dot = (x, y) => rib([x, y], [x, y], [x, y], [x, y], 0);
const mirrorX = (cx) => (x) => 2 * cx - x;

const manifestPath = path.join(root, "shared/assets/manifest.json");

const DROP_STAGGER_MS = 130;
const DROP_FALL_MS = 250;
// Spring landing after the fall: overshoot below the resting spot while
// squashing, rebound above it while stretching, a small second dip, then rest.
// Each step is [fraction of DROP_SETTLE_MS after the fall (0 to below 1),
// offset in wordmark units (positive is down), vertical scale about the bottom
// cap, stroke radius change].
const DROP_BOUNCE = [
  [0, 18, 0.9, 1.5],
  [0.36, -8, 1.05, -0.6],
  [0.69, 3, 0.98, 0.3],
];
// Time from landing until the tick is at rest; the bounce plays within it.
const DROP_SETTLE_MS = 300;
// Pause with all four ticks at rest before the letters start forming.
const BEAT_MS = 100;
// Scales every letter morph and the stagger between them; lower is quicker.
const MORPH_SPEED = 0.20;
// While a letter forms it drifts outward from the wordmark's center and swells
// a touch. Then, over SETTLE_MS, it lands: it eases from rounded into the exact
// glyph, finishing by SETTLE_SHARPEN_END (fraction of the landing), and from
// SETTLE_RETURN_START a spring (SETTLE_SPRING) carries it back into place and
// back to 100%, just past and back, so the letters settle already sharp.
// SETTLE_PUSH is the outward drift in wordmark units for the outer letters (A
// left, y right; the d's move a third as far) and SETTLE_SWELL the extra scale
// (0.035 = 3.5%).
const SETTLE_MS = 700;
const SETTLE_SHARPEN_END = 0.4;
const SETTLE_RETURN_START = 0.2;
const SETTLE_SPRING = { stiffness: 160, damping: 17 };
const SETTLE_PUSH = 7;
const SETTLE_SWELL = 0.035;
const SETTLE_PUSH_DIRECTION = [-1, -1 / 3, 1 / 3, 1];
// Wordmark units; lifts every tick fully above the pill before it falls.
const DROP_LIFT = 515;

// The logo artwork is the original wordmark scaled and translated into the pill.
const WORDMARK_TO_LOGO = { scale: 3.41332, translateX: 554.541, translateY: 469.989 };
const toWordmark = (x, y) => [(x - WORDMARK_TO_LOGO.translateX) / WORDMARK_TO_LOGO.scale, (y - WORDMARK_TO_LOGO.translateY) / WORDMARK_TO_LOGO.scale];

// Resting bar capsule (wordmark units) for a stadium-shaped tick in logo space.
function barFromTick(bounds) {
  const radius = (bounds.maxX - bounds.minX) / 2;
  const [x, y0] = toWordmark(bounds.minX + radius, bounds.minY + radius);
  const [, y1] = toWordmark(0, bounds.maxY - radius);
  return { x, y0, y1, r: radius / WORDMARK_TO_LOGO.scale };
}

// Letter poses were authored against the original spinner layout. Early poses
// are carried along with the tick's new resting position and blend back to the
// letter-relative poses by the middle of the morph.
function retarget(poses, from, to) {
  const dx = to.x - from.x;
  const dy = (to.y0 + to.y1) / 2 - (from.y0 + from.y1) / 2;
  return poses.map((pose) => {
    const weight = pose.at <= 0.15 ? 1 : Math.max(0, 1 - (pose.at - 0.15) / 0.35);
    return weight === 0 ? pose : { ...pose, shapes: offsetShapes(pose.shapes, dx * weight, dy * weight) };
  });
}

function offsetShapes(shapes, dx, dy) {
  const move = ({ x, y }) => pt(x + dx, y + dy);
  return Object.fromEntries(Object.entries(shapes).map(([id, primitive]) => {
    if (primitive.kind === "capsule") return [id, { ...primitive, start: move(primitive.start), end: move(primitive.end) }];
    if (primitive.kind === "ribbon") return [id, { ...primitive, p0: move(primitive.p0), p1: move(primitive.p1), p2: move(primitive.p2), p3: move(primitive.p3) }];
    return [id, { ...primitive, center: move(primitive.center) }];
  }));
}

// Replaces the resting bar components with the exact tick capsule.
function restOnTick(pose, bar, barComponents) {
  const shapes = { ...pose.shapes };
  for (const id of barComponents) shapes[id] = cap(bar.x, bar.y0, bar.x, bar.y1, bar.r);
  return { ...pose, shapes };
}

const logoPoint = ({ x, y }) => ({
  x: round(x * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateX),
  y: round(y * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateY),
});
const logoLength = (value) => round(value * WORDMARK_TO_LOGO.scale);

function logoPrimitive(primitive) {
  if (primitive.kind === "capsule") return { ...primitive, start: logoPoint(primitive.start), end: logoPoint(primitive.end), radius: logoLength(primitive.radius) };
  if (primitive.kind === "ribbon") {
    return {
      ...primitive,
      p0: logoPoint(primitive.p0),
      p1: logoPoint(primitive.p1),
      p2: logoPoint(primitive.p2),
      p3: logoPoint(primitive.p3),
      startRadius: logoLength(primitive.startRadius),
      endRadius: logoLength(primitive.endRadius),
    };
  }
  return { ...primitive, center: logoPoint(primitive.center), radiusX: logoLength(primitive.radiusX), radiusY: logoLength(primitive.radiusY) };
}

function logoMaterials(groups) {
  const toLogo = {
    blendRadius: logoLength,
    offsetX: logoLength,
    offsetY: logoLength,
    originX: (value) => round(value * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateX),
    originY: (value) => round(value * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateY),
  };
  return Object.fromEntries(Object.entries(groups).map(([group, values]) => [
    group,
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, toLogo[key] ? toLogo[key](value) : value])),
  ]));
}

// Moves a resting bar pose into a drop pose: stretch or squash about the bar's
// bottom cap (keeping its bottom on the floor), widen or thin every stroke, and
// lift the whole pose by dy.
function dropPose(shapes, bar, { sy = 1, dr = 0, dy = 0 }) {
  const move = ({ x, y }) => pt(x, bar.y1 + (y - bar.y1) * sy - dr + dy);
  const radius = (r) => (r > 0 ? round(Math.max(0, r + dr)) : r);
  return Object.fromEntries(Object.entries(shapes).map(([id, primitive]) => {
    if (primitive.kind === "capsule") return [id, { ...primitive, start: move(primitive.start), end: move(primitive.end), radius: radius(primitive.radius) }];
    if (primitive.kind === "ribbon") {
      return [id, { ...primitive, p0: move(primitive.p0), p1: move(primitive.p1), p2: move(primitive.p2), p3: move(primitive.p3), startRadius: radius(primitive.startRadius), endRadius: radius(primitive.endRadius) }];
    }
    return [id, { ...primitive, center: move(primitive.center) }];
  }));
}

// The shared drop-in: tick `index` falls from above the pill, overshoots, and
// springs into its resting pose. `local` maps scene milliseconds to track-local
// progress; a rest keyframe is added when the next motion starts after settling.
function dropPoses({ index, rest, bar, local, nextMs }) {
  const dropStartMs = index * DROP_STAGGER_MS;
  const landMs = dropStartMs + DROP_FALL_MS;
  const poses = [
    { at: local(dropStartMs), shapes: dropPose(rest.shapes, bar, { dy: -DROP_LIFT }), materials: rest.materials },
    // Most of the distance is covered late in the fall, so the tick is still fast when it lands.
    { at: local(dropStartMs + DROP_FALL_MS * 0.72), shapes: dropPose(rest.shapes, bar, { dy: -40, sy: 1.08, dr: -1.2 }), materials: rest.materials },
    ...DROP_BOUNCE.map(([fraction, dy, sy, dr]) => ({ at: local(landMs + fraction * DROP_SETTLE_MS), shapes: dropPose(rest.shapes, bar, { dy, sy, dr }), materials: rest.materials })),
  ];
  if (nextMs > landMs + DROP_SETTLE_MS) {
    poses.push({ at: local(landMs + DROP_SETTLE_MS), shapes: rest.shapes, materials: rest.materials });
  }
  return poses;
}

// Normalized spring response from 0 to 1 over `t` seconds, starting at rest;
// exceeds 1 while overshooting.
function settleResponse(t) {
  const omega = Math.sqrt(SETTLE_SPRING.stiffness);
  const zeta = SETTLE_SPRING.damping / (2 * omega);
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
}

const lerp = (a, b, t) => a + (b - a) * t;

function lerpShapes(from, to, t) {
  const point = (a, b) => pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
  const radius = (a, b) => round(Math.max(0, lerp(a, b, t)));
  return Object.fromEntries(Object.entries(to).map(([id, b]) => {
    const a = from[id];
    if (b.kind === "capsule") return [id, { ...b, start: point(a.start, b.start), end: point(a.end, b.end), radius: radius(a.radius, b.radius) }];
    if (b.kind === "ribbon") {
      return [id, { ...b, p0: point(a.p0, b.p0), p1: point(a.p1, b.p1), p2: point(a.p2, b.p2), p3: point(a.p3, b.p3), startRadius: radius(a.startRadius, b.startRadius), endRadius: radius(a.endRadius, b.endRadius) }];
    }
    return [id, { ...b, center: point(a.center, b.center), radiusX: radius(a.radiusX, b.radiusX), radiusY: radius(a.radiusY, b.radiusY), rotation: round(lerp(a.rotation ?? 0, b.rotation ?? 0, t)) }];
  }));
}

// Blends every numeric material value from the arrival pose to the fitted
// pose's values along `t` (0...1, never overshooting), so sharpening completes
// exactly as the spring settles.
function lerpMaterials(from, to, t) {
  return Object.fromEntries(Object.entries(to).map(([group, values]) => [group, Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const start = from[group]?.[key];
    return [key, typeof value === "number" && typeof start === "number" ? round(lerp(start, value, t)) : value];
  }))]));
}

function shapesCenter(shapes) {
  const xs = [];
  const ys = [];
  for (const primitive of Object.values(shapes)) {
    const reach = primitive.kind === "capsule" ? primitive.radius : primitive.kind === "ribbon" ? Math.max(primitive.startRadius, primitive.endRadius) : 0;
    const points = primitive.kind === "capsule" ? [primitive.start, primitive.end] : primitive.kind === "ribbon" ? [primitive.p0, primitive.p3] : [];
    for (const { x, y } of points) {
      xs.push(x - reach, x + reach);
      ys.push(y - reach, y + reach);
    }
  }
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

// `$track` placement materials (wordmark units; logoMaterials maps them into the
// logo space): `push` 0 is in place, 1 is fully drifted and swollen.
function placementMaterials(slot, center, push) {
  return {
    offsetX: round(SETTLE_PUSH * SETTLE_PUSH_DIRECTION[slot] * push),
    offsetY: 0,
    scale: round(1 + SETTLE_SWELL * push),
    originX: round(center[0]),
    originY: round(center[1]),
  };
}

function withPlacement(materials, slot, center, push) {
  return { ...materials, $track: { ...materials.$track, ...placementMaterials(slot, center, push) } };
}

// Samples the landing: the shape eases continuously from the formed pose into
// the fitted glyph while sharpening, finishing by SETTLE_SHARPEN_END; the
// placement holds, then springs from fully pushed back to rest, just past and
// back, mostly after the letter is sharp.
function settlePoses(arrival, fitted, startMs, local, slot) {
  const samples = Math.round(SETTLE_MS / 20);
  const center = shapesCenter(fitted.shapes);
  const poses = [];
  for (let sample = 1; sample <= samples; sample += 1) {
    const u = sample / samples;
    const last = sample === samples;
    const formed = Math.min(1, u / SETTLE_SHARPEN_END);
    const shape = 1 - (1 - formed) ** 3;
    const sharpen = formed * formed * (3 - 2 * formed);
    const returning = Math.max(0, u - SETTLE_RETURN_START) * SETTLE_MS / 1000;
    const push = last ? 0 : 1 - settleResponse(returning);
    poses.push({
      at: local(startMs + u * SETTLE_MS),
      shapes: last ? fitted.shapes : lerpShapes(arrival.shapes, fitted.shapes, shape),
      materials: withPlacement(lerpMaterials(arrival.materials, fitted.materials, sharpen), slot, center, push),
    });
  }
  return poses;
}

// Forming poses drift outward and swell (eased) toward the arrival pose.
function formingPoses(poses, slot, center, at) {
  const arrivalAt = poses[poses.length - 2].at;
  return poses.slice(0, -1).map((pose) => {
    const t = pose.at / arrivalAt;
    return { ...pose, at: at(pose.at), materials: withPlacement(pose.materials, slot, center, 1 - (1 - t) ** 2) };
  });
}

// A letter's morph in scene time: formation poses (up to the arrival pose)
// scaled by MORPH_SPEED, then SETTLE_MS of spring landing.
function letterTiming(letter, morphStartMs, durationMs) {
  const arrivalAt = letter.poses[letter.poses.length - 2].at;
  const formMs = arrivalAt * durationMs * MORPH_SPEED;
  const at = (fraction) => fraction <= arrivalAt
    ? morphStartMs + (fraction / arrivalAt) * formMs
    : morphStartMs + formMs + ((fraction - arrivalAt) / (1 - arrivalAt)) * SETTLE_MS;
  return { arrivalAt, formEndMs: morphStartMs + formMs, morphEndMs: morphStartMs + formMs + SETTLE_MS, at };
}

// Builds a track from a letter spec. Letter poses and events are authored in
// morph-local time (0 = resting bar, 1 = exact glyph) and placed on the scene
// timeline after the bar's drop.
function track(letter, { index, bar, morphStartMs, durationMs, totalMs }) {
  const { id, components, groups, events, barComponents } = letter;
  const poses = retarget(letter.poses, letter.bar, bar).map((pose, poseIndex) => (poseIndex === 0 ? restOnTick(pose, bar, barComponents) : pose));
  const timing = letterTiming(letter, morphStartMs, durationMs);
  const dropStartMs = index * DROP_STAGGER_MS;
  const spanMs = timing.morphEndMs - dropStartMs;
  const local = (ms) => Math.round(((ms - dropStartMs) / spanMs) * 1e6) / 1e6;
  const morphLocal = (at) => local(timing.at(at));
  const center = shapesCenter(poses[poses.length - 1].shapes);
  const drop = dropPoses({ index, rest: poses[0], bar, local, nextMs: morphStartMs })
    .map((pose) => ({ ...pose, materials: withPlacement(pose.materials, index, center, 0) }));
  const forming = formingPoses(poses, index, center, morphLocal);
  const settle = settlePoses(poses[poses.length - 2], poses[poses.length - 1], timing.formEndMs, local, index);
  const allPoses = [...drop, ...forming, ...settle];
  allPoses.forEach((pose, poseIndex) => {
    const previous = allPoses[poseIndex - 1];
    if (previous && pose.at <= previous.at) {
      throw new Error(`${id}: poses at ${previous.at} and ${pose.at} are out of order. Check that DROP_BOUNCE fractions increase and stay below 1, and that DROP_FALL_MS, DROP_SETTLE_MS, BEAT_MS, and MORPH_SPEED are positive.`);
    }
  });
  const materialGroups = ["$track", ...groups];

  return {
    id,
    timing: { start: round6(dropStartMs / totalMs), end: round6(timing.morphEndMs / totalMs) },
    interpolation: "monotoneCubic",
    components,
    keyframes: allPoses.map(({ at, shapes, materials }) => ({
      at,
      easing: "linear",
      components: components.map((component) => {
        const primitive = shapes[component.id];
        if (!primitive) throw new Error(`${id} pose ${at} is missing ${component.id}`);
        if (primitive.kind !== component.kind) throw new Error(`${id} pose ${at} ${component.id} must be a ${component.kind}`);
        return { id: component.id, primitive: logoPrimitive(primitive) };
      }),
      material: { groups: logoMaterials(Object.fromEntries(materialGroups.map((group) => [group, materials[group]]))) },
    })),
    events: events.map((event) => ({
      ...event,
      at: morphLocal(event.at),
      ...(event.end === undefined ? {} : { end: morphLocal(event.end) }),
    })),
  };
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;

// blend: group blend radii (falls back to $track). sharpen: 0 = soft field,
// 1 = exact glyph; drives targetMix and cornerSharpness together.
function materialsFor(groups, blend, sharpen = 0, cornerSharpness = sharpen) {
  const values = { $track: { blendRadius: blend.$track ?? 0, cornerSharpness: round(cornerSharpness), targetMix: round(sharpen) } };
  for (const group of groups) values[group] = { blendRadius: blend[group] ?? blend.$track ?? 0 };
  return values;
}

// ---------------------------------------------------------------------------
// A: after the beat, the bar gathers into a squash and splits from the bottom
// into two legs, opening the notch between the feet. The crossbar grows
// inward from both legs as two halves that meet in the middle, closing the
// counter by reconnection.

function letterA() {
  const cx = 79.495;
  const m = mirrorX(cx);
  const groups = ["a-body", "a-crossbar"];
  const legs = (sx, sy, ex, ey, r) => ({
    "a-left-leg": cap(sx, sy, ex, ey, r),
    "a-right-leg": cap(m(sx), sy, m(ex), ey, r),
  });
  const crossbar = (sx, ex, y, r) => ({
    "a-crossbar-left": cap(sx, y, ex, y, r),
    "a-crossbar-right": cap(m(sx), y, m(ex), y, r),
  });
  const materials = (...args) => materialsFor(groups, ...args);
  const fitted = { ...legs(75.2, 30.8, 28.4, 143.1, 20.4), ...crossbar(52.5, cx, 116.97, 17.4) };

  return {
    id: "spinner-left-to-a",
    groups,
    bar: { x: cx, y0: 37.5215, y1: 91.7217, r: 27.0996 },
    barComponents: ["a-left-leg", "a-right-leg"],
    components: [
      { id: "a-left-leg", kind: "capsule", operation: "union", groupId: "a-body" },
      { id: "a-right-leg", kind: "capsule", operation: "union", groupId: "a-body" },
      { id: "a-crossbar-left", kind: "capsule", operation: "union", groupId: "a-crossbar" },
      { id: "a-crossbar-right", kind: "capsule", operation: "union", groupId: "a-crossbar" },
    ],
    poses: [
      { at: 0, shapes: { ...legs(cx, 37.5215, cx, 91.7217, 27.0996), ...crossbar(cx, cx, 72, 0) }, materials: materials({ $track: 0 }) },
      { at: 0.12, shapes: { ...legs(cx, 40.6, cx, 85.5, 29.8), ...crossbar(cx, cx, 74, 6) }, materials: materials({ $track: 6 }) },
      { at: 0.26, shapes: { ...legs(77.8, 35.5, 63, 113, 25.4), ...crossbar(72, 72, 95, 10) }, materials: materials({ $track: 10, "a-crossbar": 6 }) },
      { at: 0.42, shapes: { ...legs(76.5, 32.8, 42, 133, 22.2), ...crossbar(50, 57, 112, 12) }, materials: materials({ $track: 9, "a-crossbar": 7 }) },
      { at: 0.55, shapes: { ...legs(75.6, 31.2, 31.5, 140, 20.8), ...crossbar(54, 74.5, 116, 15) }, materials: materials({ $track: 7, "a-crossbar": 9 }, 0.03, 0.08) },
      { at: 1, shapes: fitted, materials: materials({ $track: 0 }, 1) },
    ],
    events: [
      { id: "a-top-pin", kind: "step", at: 0, componentId: "a-left-leg", payload: { intent: "pin" } },
      { id: "a-crossbar-adhesion", kind: "step", at: 0.57, componentId: "a-crossbar-right", payload: { intent: "adhesion" } },
      { id: "a-endpoint-snap", kind: "step", at: 0.7, componentId: "a-left-leg", payload: { intent: "snap-to-target" } },
    ],
  };
}

// ---------------------------------------------------------------------------
// d: the bar slides right to become the stem and drags the bowl out behind it.
// The bowl curls around as a hook and its tip rejoins the stem, which closes
// the counter by reconnection instead of punching a hole.

function letterD({ id, prefix, dx }) {
  const x = (value) => value + dx;
  const stem = `${prefix}-stem`;
  const bowl = `${prefix}-bowl`;
  const body = `${prefix}-body`;
  const shapes = (stemShape, bowlShape) => ({ [stem]: stemShape, [bowl]: bowlShape });
  const materials = (blend, ...args) => materialsFor([body], { $track: blend, [body]: blend }, ...args);
  const bx = 211.9;
  const fitted = shapes(
    cap(x(255.93), 17.23, x(255.93), 143.27, 19.85),
    rib([x(246), 68.03], [x(146.38), 11.75], [x(139.7), 184.75], [x(246), 137.38], 19.19, 19.41),
  );

  return {
    id,
    groups: [body],
    bar: { x: x(bx), y0: 32.2, y1: 131.9, r: 27.1 },
    barComponents: [stem],
    components: [
      { id: stem, kind: "capsule", operation: "union", groupId: body },
      { id: bowl, kind: "ribbon", operation: "union", groupId: body },
    ],
    poses: [
      { at: 0, shapes: shapes(cap(x(bx), 32.2, x(bx), 131.9, 27.1), dot(x(bx), 112)), materials: materials(0) },
      {
        at: 0.14,
        shapes: shapes(cap(x(bx + 3), 33, x(bx + 1), 130, 27.4), rib([x(bx - 2), 116], [x(bx - 4), 120], [x(bx - 2), 124], [x(bx + 2), 124], 14, 12)),
        materials: materials(6),
      },
      {
        at: 0.3,
        shapes: shapes(cap(x(230), 25, x(226), 137, 24), rib([x(198), 114], [x(194), 134], [x(207), 146], [x(226), 139], 22, 20)),
        materials: materials(9),
      },
      {
        at: 0.46,
        shapes: shapes(cap(x(244), 21, x(242), 140, 21.5), rib([x(165), 90], [x(152), 134], [x(190), 156], [x(242), 138], 19, 19.5)),
        materials: materials(9),
      },
      {
        at: 0.6,
        shapes: shapes(cap(x(252), 20, x(251.5), 141, 20.2), rib([x(228), 63], [x(150), 22], [x(141), 178], [x(245), 139], 18.8, 19.2)),
        materials: materials(7, 0.03, 0.08),
      },
      { at: 1, shapes: fitted, materials: materials(0, 1) },
    ],
    events: [
      { id: `${prefix}-stem-pin`, kind: "step", at: 0, componentId: stem, payload: { intent: "pin" } },
      { id: `${prefix}-bowl-adhesion`, kind: "step", at: 0.58, componentId: bowl, payload: { intent: "adhesion" } },
      { id: `${prefix}-endpoint-snap`, kind: "step", at: 0.74, componentId: stem, payload: { intent: "snap-to-target" } },
    ],
  };
}

// ---------------------------------------------------------------------------
// y: the arms unzip from the top as a V, so the notch opens progressively from
// its tip instead of being carved. The bowl is a U whose ends run straight
// down the arm centerlines with the arm radius, and whose centerline curvature
// stays wider than its stroke, so the inner edge of the notch is tangent-
// continuous with the arms and never folds into a point. The descender drips
// from the right arm and curls left underneath the bowl without touching it,
// so the hook stays open. y-crotch-cut stays parked above the letter: a hard
// subtract leaves corners wherever its edge crosses the soft field, so the
// committed motion shapes the notch with the arms and bowl alone.

function letterY() {
  const cx = 470.788;
  const groups = ["y-body", "y-tail", "y-crotch"];
  const materials = (...args) => materialsFor(groups, ...args);
  const parkedCut = ell(471.2, 18, 4, 8);
  const body = (left, right, r, bowlTop, bowlBottom, leftTop, rightTop, rightBottom, cut) => ({
    "y-left-arm": cap(leftTop[0], leftTop[1], left[0], left[1], r),
    "y-right-arm": cap(rightTop[0], rightTop[1], right[0], rightBottom, r),
    "y-bowl": rib([left[0], bowlTop], [left[0], bowlBottom], [right[0], bowlBottom], [right[0], bowlTop], r),
    "y-crotch-cut": cut,
  });
  const fitted = {
    ...body([434.23, 100], [508.09], 19.7, 96, 150.7, [434.23, 58.24], [508.09, 58.36], 150.69, parkedCut),
    "y-descender": rib([508.09, 152.81], [508.15, 184.38], [473.37, 201.25], [435.34, 179.5], 19.46, 16.03),
  };

  return {
    id: "spinner-right-to-y",
    groups,
    bar: { x: cx, y0: 68.122, y1: 122.321, r: 27.1 },
    barComponents: ["y-left-arm", "y-right-arm"],
    components: [
      { id: "y-left-arm", kind: "capsule", operation: "union", groupId: "y-body" },
      { id: "y-right-arm", kind: "capsule", operation: "union", groupId: "y-body" },
      { id: "y-bowl", kind: "ribbon", operation: "union", groupId: "y-body" },
      { id: "y-crotch-cut", kind: "ellipse", operation: "subtract", groupId: "y-crotch" },
      { id: "y-descender", kind: "ribbon", operation: "union", groupId: "y-tail" },
    ],
    poses: [
      {
        at: 0,
        shapes: {
          "y-left-arm": cap(cx, 68.122, cx, 122.321, 27.1),
          "y-right-arm": cap(cx, 68.122, cx, 122.321, 27.1),
          "y-bowl": dot(cx, 118),
          "y-crotch-cut": parkedCut,
          "y-descender": dot(cx, 124),
        },
        materials: materials({ $track: 0 }),
      },
      {
        at: 0.12,
        shapes: {
          "y-left-arm": cap(cx - 1, 70, cx - 1, 120.5, 28.4),
          "y-right-arm": cap(cx + 1, 70, cx + 1, 120.5, 28.4),
          "y-bowl": dot(cx, 118),
          "y-crotch-cut": parkedCut,
          "y-descender": rib([cx + 4, 122], [cx + 5, 126], [cx + 5, 128], [cx + 5, 130], 16, 14),
        },
        materials: materials({ $track: 6 }),
      },
      {
        at: 0.3,
        shapes: {
          "y-left-arm": cap(458, 64, 467, 118, 24),
          "y-right-arm": cap(484, 64, 475, 122, 24),
          "y-bowl": rib([467, 118], [469, 122], [473, 122], [475, 118], 22),
          "y-crotch-cut": parkedCut,
          "y-descender": rib([480, 126], [484, 148], [486, 160], [484, 168], 21, 17),
        },
        materials: materials({ $track: 9, "y-tail": 8 }),
      },
      {
        at: 0.45,
        shapes: {
          ...body([452, 108], [492], 21.5, 100, 146, [443, 62], [499, 62], 136, parkedCut),
          "y-descender": rib([493, 134], [500, 178], [490, 194], [470, 192], 19.5, 17.5),
        },
        materials: materials({ $track: 13, "y-tail": 5 }),
      },
      {
        at: 0.6,
        shapes: {
          ...body([436, 99], [506], 20.1, 96, 151.5, [436, 59.5], [506, 59.5], 146, parkedCut),
          "y-descender": rib([506, 150], [507, 194], [478, 199], [446, 181], 19.4, 16.5),
        },
        materials: materials({ $track: 8, "y-tail": 2 }, 0.03, 0.08),
      },
      { at: 1, shapes: fitted, materials: materials({ $track: 0 }, 1) },
    ],
    events: [
      { id: "y-bottom-pin", kind: "step", at: 0, componentId: "y-descender", payload: { intent: "pin" } },
      { id: "y-arm-release", kind: "release", at: 0.2, end: 0.5, componentId: "y-left-arm", payload: { intent: "release" } },
      { id: "y-arm-adhesion", kind: "step", at: 0.45, componentId: "y-bowl", payload: { intent: "adhesion" } },
      { id: "y-target-relaxation", kind: "step", at: 0.6, componentId: "y-descender", payload: { intent: "target-relaxation" } },
      { id: "y-endpoint-snap", kind: "step", at: 0.74, componentId: "y-right-arm", payload: { intent: "snap-to-target" } },
    ],
  };
}

function commandsOf(asset, ...shapeIds) {
  return shapeIds.flatMap((shapeId) => {
    const subpath = asset.subpaths.find((candidate) => candidate.id === shapeId);
    if (!subpath) throw new Error(`Asset is missing subpath ${shapeId}`);
    return subpath.commands;
  });
}

const identity = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };

function logoEndpoints(manifest) {
  const ticks = manifest.assets["addy-logo-ticks"];
  const wordmark = manifest.assets["addy-logo-wordmark"];
  if (!ticks || !wordmark) throw new Error("Asset manifest is missing the Addy logo artwork; run npm run assets:generate");
  const tick = (shapeId) => ({
    endpoint: { assetId: "addy-logo-ticks", shapeId, transform: { ...identity, translateY: logoLength(-DROP_LIFT) }, commands: commandsOf(ticks, shapeId) },
    bar: barFromTick(ticks.subpaths.find((subpath) => subpath.id === shapeId).bounds),
  });
  const letter = (shapeId, ...subpathIds) => ({ assetId: "addy-logo-wordmark", shapeId, transform: identity, commands: commandsOf(wordmark, ...subpathIds) });
  return {
    backdrop: [{ assetId: "addy-logo-ticks", shapeId: "pill", transform: identity, commands: commandsOf(ticks, "pill-outer", "pill-inner") }],
    // Ticks and letters only draw inside the pill, so the ticks enter through its top edge.
    clip: { assetId: "addy-logo-ticks", shapeId: "pill-outer", transform: identity, commands: commandsOf(ticks, "pill-outer") },
    size: { width: ticks.viewBox[2], height: ticks.viewBox[3] },
    tracks: {
      "spinner-left-to-a": { ...tick("tick-1"), target: letter("letter-a", "letter-a-outer", "letter-a-counter") },
      "spinner-inner-left-to-d1": { ...tick("tick-2"), target: letter("letter-d1", "letter-d1-outer", "letter-d1-counter") },
      "spinner-inner-right-to-d2": { ...tick("tick-3"), target: letter("letter-d2", "letter-d2-outer", "letter-d2-counter") },
      "spinner-right-to-y": { ...tick("tick-4"), target: letter("letter-y", "letter-y") },
    },
  };
}

// Scene timeline. The A starts one beat after the last tick settles; the other
// letters keep the original left-to-right cascade. Offsets and durations are the
// original letter timings, scaled by MORPH_SPEED.
const LAST_TICK_SETTLED_MS = 3 * DROP_STAGGER_MS + DROP_FALL_MS + DROP_SETTLE_MS;
const MORPH_TIMELINE = [
  { letter: () => letterA(), offsetMs: 0, durationMs: 1794 },
  { letter: () => letterD({ id: "spinner-inner-left-to-d1", prefix: "d", dx: 0 }), offsetMs: 368, durationMs: 1932 },
  { letter: () => letterD({ id: "spinner-inner-right-to-d2", prefix: "d2", dx: 131.99 }), offsetMs: 621, durationMs: 1679 },
  { letter: () => letterY(), offsetMs: 828, durationMs: 1472 },
].map(({ letter, offsetMs, durationMs }) => {
  const morphStartMs = Math.round(LAST_TICK_SETTLED_MS + BEAT_MS + offsetMs * MORPH_SPEED);
  return { letter, morphStartMs, durationMs, timing: letterTiming(letter(), morphStartMs, durationMs) };
});

export function authorSpinnerToAddy(manifest) {
  const logo = logoEndpoints(manifest);
  const totalMs = Math.max(...MORPH_TIMELINE.map(({ timing }) => timing.morphEndMs));
  const tracks = MORPH_TIMELINE.map(({ letter, morphStartMs, durationMs }, index) => {
    const spec = letter();
    const endpoints = logo.tracks[spec.id];
    const { id, timing, interpolation, components, keyframes, events } = track(spec, {
      index,
      bar: endpoints.bar,
      morphStartMs,
      durationMs,
      totalMs,
    });
    return { id, source: endpoints.endpoint, target: endpoints.target, timing, interpolation, components, keyframes, events };
  });
  return {
    $schema: "../schema/liquid-scene-v2.schema.json",
    schemaVersion: 2,
    id: "spinner-to-addy",
    fixtureVersion: 2,
    durationMs: totalMs,
    coordinateSpace: logo.size,
    fillRule: "nonzero",
    tracks,
    backdrop: logo.backdrop,
    clip: logo.clip,
    reducedMotion: { mode: "crossfade", durationMs: 180, fadeStart: 0.12, fadeEnd: 0.88 },
  };
}

// ---------------------------------------------------------------------------
// addy-logo-wave: the same drop-in, then Addy's pill wave (BouncingDotsView in
// the Addy app) on loop. Every WAVE_STEP_MS the leftmost pill springs one slot
// left and fades out, the others spring one slot left and resize to their new
// slot's height, and a pooled pill springs in from the right while fading in.
// The spring and the step logic replay the app's exactly, including
// CASpringAnimation's zero-velocity retarget from the current value; the
// sampled curves are stored as monotone cubic keyframes. Slots use the logo's
// tick positions and heights, so the drop lands straight into the wave.

const WAVE_STEP_MS = 700;
const WAVE_SPRING = { mass: 1, stiffness: 180, damping: 18 };
const WAVE_POOL = 6;
// Keyframe spacing when sampling spring curves.
const WAVE_SAMPLE_MS = 700 / 18;
// Pills fade until this opacity, below which they are treated as gone.
const WAVE_HIDDEN_OPACITY = 0.004;

function springValue(from, to, t) {
  const omega = Math.sqrt(WAVE_SPRING.stiffness / WAVE_SPRING.mass);
  const zeta = WAVE_SPRING.damping / (2 * Math.sqrt(WAVE_SPRING.stiffness * WAVE_SPRING.mass));
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return to + (from - to) * decay * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
}

// A channel animated by successive springs, each starting from the channel's
// value at that moment with zero velocity (CASpringAnimation from the
// presentation value). `set` jumps instantly.
class SpringChannel {
  constructor(value) {
    this.segments = [{ startMs: -Infinity, from: value, to: value }];
  }

  valueAt(ms) {
    let segment = this.segments[0];
    for (const candidate of this.segments) if (candidate.startMs <= ms) segment = candidate;
    return segment.startMs === -Infinity ? segment.to : springValue(segment.from, segment.to, (ms - segment.startMs) / 1000);
  }

  springTo(ms, to) {
    this.segments.push({ startMs: ms, from: this.valueAt(ms), to });
  }

  set(ms, value) {
    this.segments.push({ startMs: ms, from: value, to: value });
  }
}

function waveTimeline(bars, steps = 8) {
  const slotX = bars.map((bar) => bar.x);
  const slotHeight = bars.map((bar) => bar.y1 - bar.y0 + 2 * bar.r);
  const spacing = (slotX[3] - slotX[0]) / 3;
  const exitX = slotX[0] - spacing;
  const enterX = slotX[3] + spacing;
  const waveStartMs = LAST_TICK_SETTLED_MS;
  const stepMs = (step) => waveStartMs + step * WAVE_STEP_MS;
  const settlingMs = springSettlingMs();

  const pills = Array.from({ length: WAVE_POOL }, (_, pill) => pill < 4
    ? { x: new SpringChannel(slotX[pill]), height: new SpringChannel(slotHeight[pill]), opacity: new SpringChannel(1), hidden: [] }
    : { x: new SpringChannel(enterX), height: new SpringChannel(slotHeight[3]), opacity: new SpringChannel(0), hidden: [[-Infinity, stepMs(pill - 3)]] });
  let order = [0, 1, 2, 3];
  const queue = [4, 5];
  const returning = [];

  // For the looping wave, steps 1..8: the loop covers steps 2..7 (one full turn
  // of the six-pill pool) and step 8 only settles the last looped step's curves.
  for (let step = 1; step <= steps; step += 1) {
    const ms = stepMs(step);
    while (returning.length && returning[0].readyMs <= ms) queue.push(returning.shift().pill);
    const exiting = order.shift();
    pills[exiting].x.springTo(ms, exitX);
    pills[exiting].opacity.springTo(ms, 0);
    returning.push({ pill: exiting, readyMs: ms + settlingMs + 50 });
    order.forEach((pill, slot) => {
      pills[pill].x.springTo(ms, slotX[slot]);
      pills[pill].height.springTo(ms, slotHeight[slot]);
    });
    const entering = queue.shift();
    const hiddenSince = pills[entering].exitedMs ?? -Infinity;
    if (hiddenSince !== -Infinity) pills[entering].hidden.push([hiddenSince, ms]);
    pills[entering].x.set(ms, enterX);
    pills[entering].height.set(ms, slotHeight[3]);
    pills[entering].opacity.set(ms, 0);
    pills[entering].x.springTo(ms, slotX[3]);
    pills[entering].opacity.springTo(ms, 1);
    pills[exiting].exitedMs = ms + WAVE_STEP_MS;
    order.push(entering);
  }
  return { pills, bars, stepMs, waveStartMs, loopStartMs: stepMs(2), loopEndMs: stepMs(8), exitX, enterX, order, slotX, slotHeight };
}

// CASpringAnimation.settlingDuration for WAVE_SPRING: time until the response
// stays within 0.1% of its travel.
function springSettlingMs() {
  for (let ms = 0; ms < 5000; ms += 1) {
    let settled = true;
    for (let later = ms; later < ms + 400; later += 5) {
      if (Math.abs(springValue(1, 0, later / 1000)) > 0.001) {
        settled = false;
        break;
      }
    }
    if (settled) return ms;
  }
  return 5000;
}

function stadiumCommands(x, y, width, height) {
  return roundedRectCommands(x - width / 2, y - height / 2, width, height, width / 2);
}

export function authorAddyLogoWave(manifest) {
  const logo = logoEndpoints(manifest);
  const tickIds = ["spinner-left-to-a", "spinner-inner-left-to-d1", "spinner-inner-right-to-d2", "spinner-right-to-y"];
  const bars = tickIds.map((id) => logo.tracks[id].bar);
  const timeline = waveTimeline(bars);
  const totalMs = timeline.loopEndMs;
  const radius = bars[0].r;
  const centerY = (bars[0].y0 + bars[0].y1) / 2;
  const pillShape = (x, height) => ({ pill: cap(x, centerY - height / 2 + radius, x, centerY + height / 2 - radius, radius) });
  const materials = (opacity) => ({ $track: { opacity: round(opacity) } });

  const tracks = timeline.pills.map((pill, index) => {
    const isTick = index < 4;
    const trackStartMs = isTick ? index * DROP_STAGGER_MS : 0;
    const local = (ms) => Math.round(((ms - trackStartMs) / (totalMs - trackStartMs)) * 1e6) / 1e6;
    const sampleAt = (ms) => {
      const opacity = Math.min(1, Math.max(0, pill.opacity.valueAt(ms)));
      return { at: local(ms), shapes: pillShape(pill.x.valueAt(ms), pill.height.valueAt(ms)), materials: materials(opacity < WAVE_HIDDEN_OPACITY ? 0 : opacity) };
    };
    const isHidden = (ms) => pill.hidden.some(([from, to]) => ms > from && ms < to);

    const poses = isTick
      ? dropPoses({ index, rest: { shapes: pillShape(bars[index].x, bars[index].y1 - bars[index].y0 + 2 * radius), materials: materials(1) }, bar: bars[index], local, nextMs: timeline.waveStartMs })
      : [{ at: 0, shapes: pillShape(timeline.enterX, bars[3].y1 - bars[3].y0 + 2 * radius), materials: materials(0) }];
    const sampleTimes = new Set([timeline.waveStartMs]);
    for (let step = 1; step < 8; step += 1) {
      for (let sample = 0; sample < WAVE_STEP_MS / WAVE_SAMPLE_MS; sample += 1) sampleTimes.add(timeline.stepMs(step) + sample * WAVE_SAMPLE_MS);
    }
    sampleTimes.add(totalMs);
    for (const [from, to] of pill.hidden) {
      if (from > -Infinity) sampleTimes.add(from);
      sampleTimes.add(to);
    }
    for (const ms of [...sampleTimes].sort((a, b) => a - b)) {
      if (ms < timeline.waveStartMs || isHidden(ms)) continue;
      const pose = sampleAt(ms);
      if (pose.at > poses[poses.length - 1].at) poses.push(pose);
    }
    // Close the loop exactly: the loop end repeats the loop start.
    const loopStart = sampleAt(timeline.loopStartMs);
    poses[poses.length - 1] = { ...loopStart, at: 1 };

    const endX = pill.x.valueAt(timeline.loopStartMs);
    const endHeight = pill.height.valueAt(timeline.loopStartMs);
    const visibleAtEnd = pill.opacity.valueAt(timeline.loopStartMs) > 0.5;
    const tick = logo.tracks[tickIds[Math.min(index, 3)]];
    const endpointTransform = { ...identity, translateY: logoLength(-DROP_LIFT) };
    const logoX = endX * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateX;
    const logoY = centerY * WORDMARK_TO_LOGO.scale + WORDMARK_TO_LOGO.translateY;
    return {
      id: `wave-pill-${index + 1}`,
      source: { ...tick.endpoint, transform: endpointTransform },
      target: visibleAtEnd
        ? { assetId: "addy-logo-wave", shapeId: `wave-pill-${index + 1}-rest`, transform: identity, commands: stadiumCommands(round(logoX), round(logoY), logoLength(2 * radius), logoLength(endHeight)) }
        : { ...tick.endpoint, shapeId: `wave-pill-${index + 1}-hidden`, transform: endpointTransform },
      timing: { start: round6(trackStartMs / totalMs), end: 1 },
      interpolation: "monotoneCubic",
      components: [{ id: "pill", kind: "capsule", operation: "union" }],
      keyframes: validatedPoses(`wave-pill-${index + 1}`, poses).map(({ at, shapes, materials: groups }) => ({
        at,
        easing: "linear",
        components: [{ id: "pill", primitive: logoPrimitive(shapes.pill) }],
        material: { groups: logoMaterials(groups) },
      })),
      events: [],
    };
  });

  return {
    $schema: "../schema/liquid-scene-v2.schema.json",
    schemaVersion: 2,
    id: "addy-logo-wave",
    fixtureVersion: 1,
    durationMs: totalMs,
    coordinateSpace: logo.size,
    fillRule: "nonzero",
    tracks,
    backdrop: logo.backdrop,
    clip: logo.clip,
    loop: { start: round6(timeline.loopStartMs / totalMs) },
    reducedMotion: { mode: "crossfade", durationMs: 180, fadeStart: 0.12, fadeEnd: 0.88 },
  };
}

// ---------------------------------------------------------------------------
// addy-logo-wave-wordmark: the drop-in, WAVE_STEPS_BEFORE_WORDMARK steps of the
// pill wave, then the wordmark. Each letter forms from whichever pill ends up in
// its slot; pills that left the row stay faded out. Letters start on the
// wave's rhythm (when the next step would have fired) and keep the wordmark
// scene's cascade, forming speed, and spring landing.

const WAVE_STEPS_BEFORE_WORDMARK = 3;

export function authorAddyLogoWaveWordmark(manifest) {
  const logo = logoEndpoints(manifest);
  const tickIds = ["spinner-left-to-a", "spinner-inner-left-to-d1", "spinner-inner-right-to-d2", "spinner-right-to-y"];
  const bars = tickIds.map((id) => logo.tracks[id].bar);
  const timeline = waveTimeline(bars, WAVE_STEPS_BEFORE_WORDMARK);
  const wordmarkStartMs = timeline.stepMs(WAVE_STEPS_BEFORE_WORDMARK + 1);
  const radius = bars[0].r;
  const centerY = (bars[0].y0 + bars[0].y1) / 2;
  const barAt = (x, height) => ({ x, y0: centerY - height / 2 + radius, y1: centerY + height / 2 - radius, r: radius });
  const withOpacity = (materials, opacity) => ({ ...materials, $track: { ...materials.$track, opacity: round(opacity) } });

  const letters = MORPH_TIMELINE.map(({ letter, durationMs }, slot) => {
    const spec = letter();
    const morphStartMs = Math.round(wordmarkStartMs + (MORPH_TIMELINE[slot].morphStartMs - MORPH_TIMELINE[0].morphStartMs));
    return { spec, slot, morphStartMs, durationMs, timing: letterTiming(spec, morphStartMs, durationMs) };
  });
  const totalMs = Math.max(...letters.map(({ timing }) => timing.morphEndMs));
  const letterForPill = new Map(timeline.order.map((pill, slot) => [pill, letters[slot]]));

  const tracks = timeline.pills.map((pill, index) => {
    const isTick = index < 4;
    const trackStartMs = isTick ? index * DROP_STAGGER_MS : 0;
    const letter = letterForPill.get(index);
    const endMs = letter ? letter.timing.morphEndMs : totalMs;
    const local = (ms) => Math.round(((ms - trackStartMs) / (endMs - trackStartMs)) * 1e6) / 1e6;
    const tick = logo.tracks[tickIds[Math.min(index, 3)]];
    const endpointTransform = { ...identity, translateY: logoLength(-DROP_LIFT) };
    const source = { ...tick.endpoint, transform: endpointTransform };

    // The shape a pill shows while dropping and waving: a letter's collapsed
    // rest pose on the pill's capsule, or just the capsule for pills that leave.
    const restShapes = (bar) => letter
      ? restOnTick(retarget(letter.spec.poses, letter.spec.bar, bar)[0], bar, letter.spec.barComponents)
      : { shapes: { pill: cap(bar.x, bar.y0, bar.x, bar.y1, bar.r) }, materials: { $track: {} } };
    const waveEndMs = letter ? letter.morphStartMs : totalMs;
    const sampleAt = (ms) => {
      const opacity = Math.min(1, Math.max(0, pill.opacity.valueAt(ms)));
      const rest = restShapes(barAt(pill.x.valueAt(ms), pill.height.valueAt(ms)));
      return { at: local(ms), shapes: rest.shapes, materials: withOpacity(rest.materials, opacity < WAVE_HIDDEN_OPACITY ? 0 : opacity) };
    };

    const poses = isTick
      ? dropPoses({ index, rest: { ...restShapes(bars[index]), materials: withOpacity(restShapes(bars[index]).materials, 1) }, bar: bars[index], local, nextMs: timeline.waveStartMs })
      : [{ ...sampleAt(0), at: 0 }];
    const sampleTimes = new Set([timeline.waveStartMs]);
    for (let ms = timeline.waveStartMs; ms < waveEndMs; ms += WAVE_SAMPLE_MS) sampleTimes.add(ms);
    for (const ms of [...sampleTimes].sort((a, b) => a - b)) {
      if (ms < timeline.waveStartMs || ms > waveEndMs - 5) continue;
      const pose = sampleAt(ms);
      if (pose.at > poses[poses.length - 1].at) poses.push(pose);
    }

    let components = [{ id: "pill", kind: "capsule", operation: "union" }];
    let target = { ...tick.endpoint, shapeId: `wave-pill-${index + 1}-hidden`, transform: endpointTransform };
    let groups = [];
    let events = [];
    if (letter) {
      const { spec, slot, timing } = letter;
      const slotBar = bars[slot];
      const morphPoses = retarget(spec.poses, spec.bar, slotBar).map((pose, poseIndex) => (poseIndex === 0 ? restOnTick(pose, slotBar, spec.barComponents) : pose));
      const morphLocal = (at) => local(timing.at(at));
      const center = shapesCenter(morphPoses[morphPoses.length - 1].shapes);
      for (const pose of poses) pose.materials = withPlacement(pose.materials, slot, center, 0);
      poses.push(...formingPoses(morphPoses, slot, center, morphLocal).map((pose) => ({ ...pose, materials: withOpacity(pose.materials, 1) })));
      poses.push(...settlePoses(morphPoses[morphPoses.length - 2], morphPoses[morphPoses.length - 1], timing.formEndMs, local, slot)
        .map((pose) => ({ ...pose, materials: withOpacity(pose.materials, 1) })));
      components = spec.components;
      target = logo.tracks[tickIds[slot]].target;
      groups = spec.groups;
      events = spec.events.map((event) => ({
        ...event,
        at: morphLocal(event.at),
        ...(event.end === undefined ? {} : { end: morphLocal(event.end) }),
      }));
    } else {
      const last = sampleAt(totalMs);
      if (last.at > poses[poses.length - 1].at) poses.push(last);
    }

    const materialGroups = ["$track", ...groups];
    return {
      id: letter ? `wave-to-${letter.spec.id.replace(/^spinner-.*-to-/, "")}` : `wave-pill-${index + 1}`,
      source,
      target,
      timing: { start: round6(trackStartMs / totalMs), end: round6(endMs / totalMs) },
      interpolation: "monotoneCubic",
      components,
      keyframes: validatedPoses(`wave-wordmark pill ${index + 1}`, poses).map(({ at, shapes, materials }) => ({
        at,
        easing: "linear",
        components: components.map((component) => ({ id: component.id, primitive: logoPrimitive(shapes[component.id]) })),
        material: { groups: logoMaterials(Object.fromEntries(materialGroups.map((group) => [group, materials[group] ?? {}]))) },
      })),
      events,
    };
  });

  return {
    $schema: "../schema/liquid-scene-v2.schema.json",
    schemaVersion: 2,
    id: "addy-logo-wave-wordmark",
    fixtureVersion: 1,
    durationMs: totalMs,
    coordinateSpace: logo.size,
    fillRule: "nonzero",
    tracks,
    backdrop: logo.backdrop,
    clip: logo.clip,
    reducedMotion: { mode: "crossfade", durationMs: 180, fadeStart: 0.12, fadeEnd: 0.88 },
  };
}

export function addyLogoWaveWordmarkSamples() {
  const scene = authorAddyLogoWaveWordmark(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const logo = logoEndpoints(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const timeline = waveTimeline(["spinner-left-to-a", "spinner-inner-left-to-d1", "spinner-inner-right-to-d2", "spinner-right-to-y"].map((id) => logo.tracks[id].bar), WAVE_STEPS_BEFORE_WORDMARK);
  const at = (ms) => Math.round((ms / scene.durationMs) * 1000) / 1000;
  const wordmarkStartMs = timeline.stepMs(WAVE_STEPS_BEFORE_WORDMARK + 1);
  const settleStart = scene.durationMs - SETTLE_MS;
  return {
    schemaVersion: 1,
    sceneId: "addy-logo-wave-wordmark",
    samples: [
      { label: "empty-pill", progress: 0 },
      { label: "ticks-falling", progress: at(DROP_STAGGER_MS + DROP_FALL_MS * 0.6) },
      { label: "wave-rest", progress: at(timeline.waveStartMs + WAVE_STEP_MS * 0.5) },
      { label: "first-step", progress: at(timeline.stepMs(1) + 200) },
      { label: "last-step", progress: at(timeline.stepMs(WAVE_STEPS_BEFORE_WORDMARK) + 300) },
      { label: "letters-forming", progress: at(wordmarkStartMs + (settleStart - wordmarkStartMs) * 0.5) },
      { label: "landing-pop", progress: at(settleStart + 200) },
      { label: "landing-settle", progress: at(settleStart + 420) },
      { label: "endpoint-lock", progress: 1 },
    ],
  };
}

// addy-logo-wave-wordmark-replay: the wave-wordmark animation preceded by an
// exit, played when the finished logo is clicked. The letters drop out through
// the bottom of the pill, staggered from the y back to the A (EXIT_ORDER): each
// lifts a touch (EXIT_LIFT over EXIT_LIFT_MS), then falls with gravity
// (EXIT_FALL_MS). After a short empty beat (EXIT_BEAT_MS) the ticks drop in and
// the whole wave-wordmark animation plays again. Each exit track is rigid: the
// exact glyph, moved by track placement and clipped to the pill. The ticks
// wait above the pill, clipped away, until their own tracks start. The
// "enter" marker is where the wave-wordmark part starts; first plays seek there.
const EXIT_ORDER = ["wave-to-y", "wave-to-d2", "wave-to-d1", "wave-to-a"];
const EXIT_STAGGER_MS = 80;
const EXIT_LIFT = 40;
const EXIT_LIFT_MS = 120;
const EXIT_FALL_MS = 360;
const EXIT_FALL_DISTANCE = 1150;
const EXIT_BEAT_MS = 180;
const EXIT_SAMPLE_MS = 16;

function exitOffset(ms) {
  if (ms <= EXIT_LIFT_MS) {
    const t = ms / EXIT_LIFT_MS;
    return -EXIT_LIFT * (1 - (1 - t) ** 2);
  }
  const t = Math.min(1, (ms - EXIT_LIFT_MS) / EXIT_FALL_MS);
  return -EXIT_LIFT + (EXIT_FALL_DISTANCE + EXIT_LIFT) * t * t;
}

export function authorAddyLogoWaveWordmarkReplay(manifest) {
  const base = authorAddyLogoWaveWordmark(manifest);
  const letterMs = EXIT_LIFT_MS + EXIT_FALL_MS;
  const exitMs = (EXIT_ORDER.length - 1) * EXIT_STAGGER_MS + letterMs + EXIT_BEAT_MS;
  const durationMs = exitMs + base.durationMs;
  const enter = round6(exitMs / durationMs);
  const shift = (value) => round6(enter + value * (1 - enter));

  const exitTracks = EXIT_ORDER.map((id, order) => {
    const letter = base.tracks.find((track) => track.id === id);
    const landed = letter.keyframes[letter.keyframes.length - 1];
    const startMs = order * EXIT_STAGGER_MS;
    const keyframes = [];
    for (let ms = 0; ms < letterMs; ms += EXIT_SAMPLE_MS) keyframes.push(ms);
    keyframes.push(letterMs);
    return {
      id: id.replace(/^wave-to-/, "exit-"),
      source: letter.target,
      target: letter.target,
      timing: { start: round6(startMs / durationMs), end: round6((startMs + letterMs) / durationMs) },
      interpolation: "monotoneCubic",
      rigid: true,
      components: letter.components,
      keyframes: keyframes.map((ms) => ({
        at: round6(ms / letterMs),
        easing: "linear",
        components: landed.components,
        material: {
          ...landed.material,
          groups: { ...landed.material.groups, $track: { ...landed.material.groups.$track, offsetY: round(exitOffset(ms)) } },
        },
      })),
      events: [],
    };
  });

  return {
    ...base,
    id: "addy-logo-wave-wordmark-replay",
    durationMs,
    tracks: [
      ...exitTracks,
      ...base.tracks.map((track) => ({
        ...track,
        timing: { start: shift(track.timing.start), end: shift(track.timing.end) },
      })),
    ],
    markers: [{ id: "enter", at: enter }],
  };
}

export function addyLogoWaveWordmarkReplaySamples() {
  const scene = authorAddyLogoWaveWordmarkReplay(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const enter = scene.markers[0].at;
  const exitMs = enter * scene.durationMs;
  const at = (ms) => Math.round((ms / scene.durationMs) * 1000) / 1000;
  const shifted = (progress) => Math.round((enter + progress * (1 - enter)) * 1000) / 1000;
  const base = addyLogoWaveWordmarkSamples().samples;
  const baseAt = (label) => base.find((sample) => sample.label === label).progress;
  return {
    schemaVersion: 1,
    sceneId: "addy-logo-wave-wordmark-replay",
    samples: [
      { label: "wordmark-before-exit", progress: 0 },
      { label: "y-lifting", progress: at(EXIT_LIFT_MS * 0.8) },
      { label: "y-falling", progress: at(EXIT_LIFT_MS + EXIT_FALL_MS * 0.5) },
      { label: "letters-falling", progress: at(3 * EXIT_STAGGER_MS + EXIT_LIFT_MS + EXIT_FALL_MS * 0.4) },
      { label: "empty-beat", progress: at(exitMs - EXIT_BEAT_MS * 0.5) },
      { label: "ticks-falling", progress: shifted(baseAt("ticks-falling")) },
      { label: "first-step", progress: shifted(baseAt("first-step")) },
      { label: "landing-settle", progress: shifted(baseAt("landing-settle")) },
      { label: "endpoint-lock", progress: 1 },
    ],
  };
}

function validatedPoses(id, poses) {
  poses.forEach((pose, poseIndex) => {
    const previous = poses[poseIndex - 1];
    if (previous && pose.at <= previous.at) throw new Error(`${id}: poses at ${previous.at} and ${pose.at} are out of order.`);
  });
  return poses;
}

export function addyLogoWaveSamples() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const logo = logoEndpoints(manifest);
  const timeline = waveTimeline(["spinner-left-to-a", "spinner-inner-left-to-d1", "spinner-inner-right-to-d2", "spinner-right-to-y"].map((id) => logo.tracks[id].bar));
  const at = (ms) => Math.round((ms / timeline.loopEndMs) * 1000) / 1000;
  return {
    schemaVersion: 1,
    sceneId: "addy-logo-wave",
    samples: [
      { label: "empty-pill", progress: 0 },
      { label: "ticks-falling", progress: at(DROP_STAGGER_MS + DROP_FALL_MS * 0.6) },
      { label: "ticks-bouncing", progress: at(3 * DROP_STAGGER_MS + DROP_FALL_MS + DROP_SETTLE_MS * 0.2) },
      { label: "wave-rest", progress: at(timeline.waveStartMs + WAVE_STEP_MS * 0.5) },
      { label: "first-step-overshoot", progress: at(timeline.stepMs(1) + 300) },
      { label: "loop-start", progress: at(timeline.loopStartMs) },
      { label: "pill-exiting", progress: at(timeline.stepMs(3) + 150) },
      { label: "pill-entering", progress: at(timeline.stepMs(5) + 90) },
      { label: "late-loop", progress: at(timeline.stepMs(7) + 450) },
      { label: "loop-end", progress: 1 },
    ],
  };
}

// Golden sample checkpoints at named moments of the current timeline, so the
// visual golden keeps covering the same beats when timings are tuned.
export function spinnerToAddySamples() {
  const totalMs = Math.max(...MORPH_TIMELINE.map(({ timing }) => timing.morphEndMs));
  const at = (ms) => Math.round((ms / totalMs) * 1000) / 1000;
  const morphAt = (index, fraction) => at(MORPH_TIMELINE[index].timing.at(fraction));
  const lastLandMs = 3 * DROP_STAGGER_MS + DROP_FALL_MS;
  return {
    schemaVersion: 1,
    sceneId: "spinner-to-addy",
    samples: [
      { label: "empty-pill", progress: 0 },
      { label: "ticks-falling", progress: at(DROP_STAGGER_MS + DROP_FALL_MS * 0.6) },
      { label: "ticks-bouncing", progress: at(lastLandMs + DROP_SETTLE_MS * 0.2) },
      { label: "beat", progress: at(LAST_TICK_SETTLED_MS + BEAT_MS * 0.5) },
      { label: "a-gather", progress: morphAt(0, 0.12) },
      { label: "a-crossbar-adhesion", progress: morphAt(0, 0.57) },
      { label: "d1-hook", progress: morphAt(1, 0.46) },
      { label: "y-drip", progress: morphAt(3, 0.6) },
      { label: "sharpening", progress: morphAt(3, 0.85) },
      { label: "endpoint-lock", progress: 1 },
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outputs = [
    [outIndex >= 0 ? path.resolve(args[outIndex + 1]) : scenePath, scenePath, authorSpinnerToAddy(JSON.parse(fs.readFileSync(manifestPath, "utf8")))],
    ...(outIndex >= 0 ? [] : [
      [samplesPath, samplesPath, spinnerToAddySamples()],
      [waveScenePath, waveScenePath, authorAddyLogoWave(JSON.parse(fs.readFileSync(manifestPath, "utf8")))],
      [waveSamplesPath, waveSamplesPath, addyLogoWaveSamples()],
      [waveWordmarkScenePath, waveWordmarkScenePath, authorAddyLogoWaveWordmark(JSON.parse(fs.readFileSync(manifestPath, "utf8")))],
      [waveWordmarkSamplesPath, waveWordmarkSamplesPath, addyLogoWaveWordmarkSamples()],
      [replayScenePath, replayScenePath, authorAddyLogoWaveWordmarkReplay(JSON.parse(fs.readFileSync(manifestPath, "utf8")))],
      [replaySamplesPath, replaySamplesPath, addyLogoWaveWordmarkReplaySamples()],
    ]),
  ];
  for (const [out, committedPath, value] of outputs) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (args.includes("--check")) {
      const committedText = fs.existsSync(committedPath) ? fs.readFileSync(committedPath, "utf8") : "";
      if (text !== committedText) {
        console.error(`${path.relative(root, committedPath)} is stale; run node tools/author-spinner-to-addy.mjs`);
        process.exit(1);
      }
    } else {
      fs.writeFileSync(out, text);
      console.log(`wrote ${path.relative(root, out)}`);
    }
  }
}
