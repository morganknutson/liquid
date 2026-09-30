import { describe, expect, test } from "vitest";
import {
  AuthoringDocument,
  canonicalSerialize,
  cloneScene,
  compileAuthoringDocument,
  insertPose,
  loadScene,
  patchKeyframe,
  patchTrack,
  patchTrackEvent,
  removeKeyframe,
  runAuthorCli,
  validateAuthoringSceneV2,
  type AuthoringDocumentInput,
} from "../src/index.js";
import type { Endpoint, LiquidScene, LiquidSceneV2, PathCommand, Pose } from "@liquid/core";

const commands: PathCommand[] = [
  { type: "M", values: [0, 0] },
  { type: "L", values: [10, 0] },
  { type: "L", values: [10, 10] },
  { type: "L", values: [0, 10] },
  { type: "Z" },
];

const endpoint: Endpoint = {
  assetId: "fixture",
  shapeId: "shape",
  transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
  commands,
};

const zeroCapsule = { start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, radius: 1 };
const pose = (at: number): Pose => ({
  at,
  easing: "linear",
  frame: {
    anchor: { x: 0, y: 0 },
    leftLeg: zeroCapsule,
    rightLeg: zeroCapsule,
    crossbar: zeroCapsule,
    bridge: zeroCapsule,
    blendRadius: 0,
    targetMix: at,
    cornerSharpness: at,
  },
});

const v1Scene: LiquidScene = {
  schemaVersion: 1,
  id: "author-v1",
  fixtureVersion: 1,
  durationMs: 100,
  coordinateSpace: { width: 10, height: 10 },
  fillRule: "nonzero",
  source: endpoint,
  target: endpoint,
  phases: [{ id: "all", start: 0, end: 1 }],
  thresholds: [],
  poses: [pose(0), pose(1)],
  reducedMotion: { mode: "crossfade", durationMs: 20, fadeStart: 0, fadeEnd: 1 },
};

const authoringInput: AuthoringDocumentInput = {
  id: "compiled",
  durationMs: 1000,
  coordinateSpace: { width: 100, height: 100 },
  tracks: [
    {
      id: "track-a",
      source: endpoint,
      target: endpoint,
      components: [
        {
          id: "stem",
          kind: "capsule",
          groupId: "ink",
          from: { kind: "capsule", start: { x: 0, y: 0 }, end: { x: 20, y: 0 }, radius: 4 },
          to: { kind: "capsule", start: { x: 0, y: 0 }, end: { x: 80, y: 0 }, radius: 3 },
        },
      ],
      constraints: [
        { type: "pin", componentId: "stem", point: { x: 2, y: 3 }, at: 0.1 },
        { type: "adhesion", groupId: "ink", radius: 8, at: 0.25 },
        { type: "release", componentId: "stem", at: 0.35, end: 0.5 },
        { type: "step", id: "snap", at: 0.75, componentId: "stem", payload: { locked: true } },
        { type: "materialRamp", target: "component", id: "stem", property: "opacity", from: 0.4, to: 1, start: 0.2, end: 0.8 },
        { type: "overshootSettle", componentId: "stem", axis: "x", amount: 5, at: 0.86, settleAt: 0.94 },
        { type: "stretchLimit", componentId: "stem", maxLength: 50 },
        { type: "snapToTarget", at: 0.98 },
      ],
    },
  ],
};

function capsule(startX: number, endX: number, radius = 1) {
  return { kind: "capsule" as const, start: { x: startX, y: 0 }, end: { x: endX, y: 0 }, radius };
}

function baseCompilerInput(constraints: AuthoringDocumentInput["tracks"][number]["constraints"] = []): AuthoringDocumentInput {
  return {
    id: "compiled-regression",
    durationMs: 1000,
    coordinateSpace: { width: 100, height: 100 },
    tracks: [
      {
        id: "track-regression",
        source: endpoint,
        target: endpoint,
        components: [
          {
            id: "stem",
            kind: "capsule",
            groupId: "ink",
            from: capsule(0, 20, 4),
            to: capsule(80, 100, 2),
          },
          {
            id: "crossbar",
            kind: "capsule",
            groupId: "ink",
            from: capsule(10, 30, 3),
            to: capsule(50, 70, 1),
          },
        ],
        constraints,
      },
    ],
  };
}

describe("@liquid/author", () => {
  test("loads, clones, validates, and canonicalizes scenes deterministically", () => {
    const loaded = loadScene(JSON.stringify(v1Scene));
    const cloned = cloneScene(loaded);
    expect(cloned).toEqual(loaded);
    expect(cloned).not.toBe(loaded);
    expect(canonicalSerialize({ b: 1.23456789, a: -0 })).toBe("{\n  \"a\": 0,\n  \"b\": 1.234568\n}\n");
  });

  test("patches v1 poses without mutating the input scene", () => {
    const next = insertPose(v1Scene, pose(0.5));
    expect(next.poses.map((item) => item.at)).toEqual([0, 0.5, 1]);
    expect(v1Scene.poses.map((item) => item.at)).toEqual([0, 1]);
  });

  test("tracks dirty state, snapshots, diffs, and reset", () => {
    const document = new AuthoringDocument(v1Scene);
    document.snapshot("base");
    document.patch({ op: "insertPose", pose: pose(0.5) });
    expect(document.dirty).toBe(true);
    expect(document.diff().changedPaths.some((path) => path.startsWith("poses."))).toBe(true);
    expect(document.snapshots().map((snapshot) => snapshot.name)).toEqual(["base"]);
    document.resetToCommitted();
    expect(document.dirty).toBe(false);
  });

  test("compiles authoring constraints into pure v2 scene data", () => {
    const scene = compileAuthoringDocument(authoringInput);
    validateAuthoringSceneV2(scene);
    const track = scene.tracks[0];
    expect(track?.events?.map((event) => event.kind)).toEqual(["release", "step"]);
    expect(track?.keyframes.map((keyframe) => keyframe.at)).toEqual([0, 0.1, 0.2, 0.25, 0.8, 0.86, 0.94, 0.98, 1]);
    const finalStem = track?.keyframes.at(-1)?.components[0]?.primitive;
    expect(finalStem?.kind).toBe("capsule");
    if (finalStem?.kind === "capsule") expect(finalStem.end.x).toBe(50);
  });

  test("pins at t=0 without replacing source geometry with target geometry", () => {
    const scene = compileAuthoringDocument(baseCompilerInput([
      { type: "pin", componentId: "stem", point: { x: 2, y: 3 }, at: 0 },
    ]));
    const stem = scene.tracks[0]?.keyframes[0]?.components.find((component) => component.id === "stem")?.primitive;

    expect(stem?.kind).toBe("capsule");
    if (stem?.kind === "capsule") {
      expect(stem.start).toEqual({ x: 2, y: 3 });
      expect(stem.end).toEqual({ x: 20, y: 0 });
      expect(stem.radius).toBe(4);
    }
  });

  test("preserves interpolated geometry when material constraints share a timestamp", () => {
    const scene = compileAuthoringDocument(baseCompilerInput([
      { type: "adhesion", groupId: "ink", radius: 8, at: 0.5 },
      { type: "materialRamp", target: "component", id: "stem", property: "opacity", from: 0.25, to: 1, start: 0.5, end: 0.75 },
    ]));
    const frame = scene.tracks[0]?.keyframes.find((keyframe) => keyframe.at === 0.5);
    const stem = frame?.components.find((component) => component.id === "stem")?.primitive;
    const crossbar = frame?.components.find((component) => component.id === "crossbar")?.primitive;

    expect(frame?.material?.groups?.ink).toEqual({ blendRadius: 8 });
    expect(frame?.material?.components?.stem).toEqual({ opacity: 0.25 });
    expect(stem?.kind).toBe("capsule");
    expect(crossbar?.kind).toBe("capsule");
    if (stem?.kind === "capsule" && crossbar?.kind === "capsule") {
      expect(stem.start.x).toBe(40);
      expect(stem.end.x).toBe(60);
      expect(stem.radius).toBe(3);
      expect(crossbar.start.x).toBe(30);
      expect(crossbar.end.x).toBe(50);
      expect(crossbar.radius).toBe(2);
    }
  });

  test("merges same-timestamp constraints deterministically regardless of input order", () => {
    const constraints = [
      { type: "step" as const, id: "mark", at: 0.4, componentId: "stem", payload: { ready: true } },
      { type: "adhesion" as const, groupId: "ink", radius: 5, at: 0.4 },
      { type: "materialRamp" as const, target: "component" as const, id: "crossbar", property: "opacity", from: 0.2, to: 0.9, start: 0.4, end: 0.9 },
    ];

    const forward = canonicalSerialize(compileAuthoringDocument(baseCompilerInput(constraints)));
    const reverse = canonicalSerialize(compileAuthoringDocument(baseCompilerInput([...constraints].reverse())));

    expect(forward).toBe(reverse);
    const frame = compileAuthoringDocument(baseCompilerInput(constraints)).tracks[0]?.keyframes.find((keyframe) => keyframe.at === 0.4);
    expect(frame?.material).toEqual({
      components: { crossbar: { opacity: 0.2 } },
      groups: { ink: { blendRadius: 5 } },
    });
  });

  test("overshoot and settle preserve unaffected components and material at the same timestamp", () => {
    const scene = compileAuthoringDocument(baseCompilerInput([
      { type: "materialRamp", target: "group", id: "ink", property: "blendRadius", from: 3, to: 0, start: 0.5, end: 0.8 },
      { type: "overshootSettle", componentId: "stem", axis: "x", amount: 6, at: 0.5, settleAt: 0.8 },
    ]));
    const overshoot = scene.tracks[0]?.keyframes.find((keyframe) => keyframe.at === 0.5);
    const settle = scene.tracks[0]?.keyframes.find((keyframe) => keyframe.at === 0.8);
    const overshootStem = overshoot?.components.find((component) => component.id === "stem")?.primitive;
    const overshootCrossbar = overshoot?.components.find((component) => component.id === "crossbar")?.primitive;
    const settleStem = settle?.components.find((component) => component.id === "stem")?.primitive;
    const settleCrossbar = settle?.components.find((component) => component.id === "crossbar")?.primitive;

    expect(overshoot?.material?.groups?.ink).toEqual({ blendRadius: 3 });
    expect(settle?.material?.groups?.ink).toEqual({ blendRadius: 0 });
    expect(overshootStem?.kind).toBe("capsule");
    expect(overshootCrossbar?.kind).toBe("capsule");
    expect(settleStem?.kind).toBe("capsule");
    expect(settleCrossbar?.kind).toBe("capsule");
    if (overshootStem?.kind === "capsule" && overshootCrossbar?.kind === "capsule" && settleStem?.kind === "capsule" && settleCrossbar?.kind === "capsule") {
      expect(overshootStem.start.x).toBe(86);
      expect(overshootStem.end.x).toBe(106);
      expect(overshootCrossbar.start.x).toBe(30);
      expect(overshootCrossbar.end.x).toBe(50);
      expect(settleStem.start.x).toBe(80);
      expect(settleStem.end.x).toBe(100);
      expect(settleCrossbar.start.x).toBe(42);
      expect(settleCrossbar.end.x).toBe(62);
    }
  });

  test("validates authoring constraint ranges, order, ids, and material conflicts", () => {
    expect(() => compileAuthoringDocument(baseCompilerInput([
      { type: "release", componentId: "missing", at: 0.2, end: 0.3 },
    ]))).toThrow(/componentId must match a component/);

    expect(() => compileAuthoringDocument(baseCompilerInput([
      { type: "release", componentId: "stem", at: 0.4, end: 0.4 },
    ]))).toThrow(/end must be greater than at/);

    expect(() => compileAuthoringDocument(baseCompilerInput([
      { type: "materialRamp", target: "group", id: "ink", property: "blendRadius", from: 2, to: 0, start: 0.5, end: 0.7 },
      { type: "adhesion", groupId: "ink", radius: 4, at: 0.5 },
    ]))).toThrow(/conflicts with another material write/);

    expect(() => compileAuthoringDocument(baseCompilerInput([
      { type: "snapToTarget", at: 1.2 },
    ]))).toThrow(/at must be a finite number in 0...1/);
  });

  test("patches and removes v2 keyframes", () => {
    const scene = compileAuthoringDocument(authoringInput);
    const patched = patchKeyframe(scene, "track-a", 0.1, { easing: "easeOutCubic" });
    expect(patched.tracks[0]?.keyframes.find((keyframe) => keyframe.at === 0.1)?.easing).toBe("easeOutCubic");
    const removed = removeKeyframe(patched as LiquidSceneV2, "track-a", 0.1);
    expect(removed.tracks[0]?.keyframes.some((keyframe) => keyframe.at === 0.1)).toBe(false);
  });

  test("patches v2 track timing and component definitions without mutating input", () => {
    const scene = compileAuthoringDocument(authoringInput);
    const original = canonicalSerialize(scene);
    const track = scene.tracks[0]!;
    const patched = patchTrack(scene, "track-a", {
      timing: { start: 0.15, end: 0.9 },
      components: [{ ...track.components[0]!, operation: "subtract", groupId: "cutout" }],
      keyframes: [...track.keyframes].reverse(),
    });

    expect(patched.tracks[0]?.timing).toEqual({ start: 0.15, end: 0.9 });
    expect(patched.tracks[0]?.components[0]).toEqual({ id: "stem", kind: "capsule", operation: "subtract", groupId: "cutout" });
    expect(patched.tracks[0]?.keyframes.map((keyframe) => keyframe.at)).toEqual([...track.keyframes].map((keyframe) => keyframe.at));
    expect(patched.tracks[0]).not.toBe(track);
    expect(canonicalSerialize(scene)).toBe(original);
  });

  test("patches v2 track events through helpers and AuthoringDocument patches", () => {
    const scene = compileAuthoringDocument(authoringInput);
    const direct = patchTrackEvent(scene, "track-a", "stem-release", { at: 0.82, end: 0.91 });
    expect(direct.tracks[0]?.events?.map((event) => event.id)).toEqual(["snap", "stem-release"]);
    expect(direct.tracks[0]?.events?.find((event) => event.id === "stem-release")).toMatchObject({ at: 0.82, end: 0.91 });

    const document = new AuthoringDocument(scene);
    const patched = document.patch({ op: "patchTrackEvent", trackId: "track-a", eventId: "snap", patch: { at: 0.65 } }) as LiquidSceneV2;
    expect(patched.tracks[0]?.events?.map((event) => [event.id, event.at])).toEqual([["stem-release", 0.35], ["snap", 0.65]]);
    expect(document.dirty).toBe(true);
    document.resetToCommitted();
    expect(document.dirty).toBe(false);
  });

  test("rejects invalid v2 track and event patches without mutating input", () => {
    const scene = compileAuthoringDocument(authoringInput);
    const original = canonicalSerialize(scene);

    expect(() => patchTrack(scene, "missing", { timing: { start: 0.1, end: 0.9 } })).toThrow(/No track exists with id missing/);
    expect(() => patchTrack(scene, "track-a", { timing: { start: 0.9, end: 0.2 } })).toThrow(/timing must satisfy/);
    expect(() => patchTrackEvent(scene, "track-a", "missing", { at: 0.2 })).toThrow(/No event exists with id missing/);
    expect(() => patchTrackEvent(scene, "track-a", "snap", { end: 0.8 })).toThrow(/end is only valid for release events/);
    expect(canonicalSerialize(scene)).toBe(original);
  });

  test("runs validate, export, and patch CLI commands through a host", async () => {
    const files = new Map<string, string>([
      ["scene.json", JSON.stringify(v1Scene)],
      ["patch.json", JSON.stringify({ op: "insertPose", pose: pose(0.5) })],
    ]);
    let stdout = "";
    const host = {
      readText: async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error(`Missing ${path}`);
        return value;
      },
      writeText: async (path: string, value: string) => {
        files.set(path, value);
      },
      stdout: (value: string) => {
        stdout += value;
      },
    };

    await runAuthorCli(["validate", "scene.json"], host);
    expect(stdout).toBe("author-v1 schemaVersion=1 ok\n");
    stdout = "";

    await runAuthorCli(["export", "scene.json"], host);
    expect(stdout).toContain("\"schemaVersion\": 1");

    await runAuthorCli(["patch", "scene.json", "--patch", "patch.json", "--out", "patched.json"], host);
    expect(files.get("patched.json")).toContain("\"at\": 0.5");
  });
});
