import { describe, expect, test } from "vitest";
import {
  evaluateFrame,
  evaluateScene,
  evaluateSamples,
  preparePath,
  prepareRibbon,
  prepareTrackField,
  preparedRibbonDistance,
  preparedTrackFieldDistance,
  proceduralDistance,
  ribbonDistance,
  serializeLiquidFrameOutput,
  signedDistanceRaster,
  signedDistanceToPath,
  signedDistanceToPreparedPath,
  trackFieldDistance,
  transformPath,
  validateSampleManifest,
  validateScene,
  validateSceneV2,
  type LiquidSceneV2,
  type LiquidScene,
  type PathCommand,
  type SampleManifest,
} from "../src/index.js";
import expectedData from "../../../shared/golden/capsule-to-a.expected.json" with { type: "json" };
import fullAddySamplesData from "../../../shared/golden/spinner-to-addy.samples.json" with { type: "json" };
import fullAddySceneData from "../../../shared/scenes/spinner-to-addy.v2.json" with { type: "json" };
import samplesData from "../../../shared/golden/capsule-to-a.samples.json" with { type: "json" };
import sceneData from "../../../shared/scenes/capsule-to-a.v1.json" with { type: "json" };

const scene = sceneData as LiquidScene;
const manifest = samplesData as SampleManifest;
const fullAddyScene = fullAddySceneData as LiquidSceneV2;
const fullAddyManifest = fullAddySamplesData as SampleManifest;

const squarePath: PathCommand[] = [
  { type: "M", values: [0, 0] },
  { type: "L", values: [10, 0] },
  { type: "L", values: [10, 10] },
  { type: "L", values: [0, 10] },
  { type: "Z" },
];

const v2Scene: LiquidSceneV2 = {
  schemaVersion: 2,
  id: "generic-v2-test",
  fixtureVersion: 1,
  durationMs: 1000,
  coordinateSpace: { width: 100, height: 100 },
  fillRule: "nonzero",
  tracks: [
    {
      id: "letter-o",
      source: { assetId: "source", shapeId: "o-source", transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }, commands: squarePath },
      target: { assetId: "target", shapeId: "o-target", transform: { translateX: 1, translateY: 2, scaleX: 2, scaleY: 2 }, commands: squarePath },
      timing: { start: 0.2, end: 0.8 },
      components: [
        { id: "outer", kind: "ellipse", operation: "union", groupId: "ink" },
        { id: "counter", kind: "ellipse", operation: "subtract", groupId: "cut" },
      ],
      keyframes: [
        {
          at: 0,
          easing: "linear",
          components: [
            { id: "outer", primitive: { kind: "ellipse", center: { x: 20, y: 20 }, radiusX: 10, radiusY: 12 } },
            { id: "counter", primitive: { kind: "ellipse", center: { x: 20, y: 20 }, radiusX: 3, radiusY: 4 } },
          ],
          material: {
            components: { outer: { opacity: 0.5 }, counter: { opacity: 1 } },
            groups: { ink: { blendRadius: 0 } },
          },
        },
        {
          at: 1,
          easing: "smoothStep",
          components: [
            { id: "outer", primitive: { kind: "ellipse", center: { x: 40, y: 20 }, radiusX: 12, radiusY: 12 } },
            { id: "counter", primitive: { kind: "ellipse", center: { x: 40, y: 20 }, radiusX: 4, radiusY: 4 } },
          ],
          material: {
            components: { outer: { opacity: 1 }, counter: { opacity: 1 } },
            groups: { ink: { blendRadius: 0 } },
          },
        },
      ],
      events: [
        { id: "snap", kind: "step", at: 0.5, componentId: "outer" },
        { id: "release", kind: "release", at: 0.25, end: 0.75, componentId: "counter" },
      ],
    },
    {
      id: "ribbon",
      source: { assetId: "source", shapeId: "ribbon-source", transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }, commands: squarePath },
      target: { assetId: "target", shapeId: "ribbon-target", transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }, commands: squarePath },
      timing: { start: 0, end: 1 },
      components: [
        { id: "stem", kind: "capsule", operation: "union", groupId: "ink" },
        { id: "curve", kind: "ribbon", operation: "union", groupId: "ink" },
      ],
      keyframes: [
        {
          at: 0,
          easing: "linear",
          components: [
            { id: "stem", primitive: { kind: "capsule", start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, radius: 2 } },
            { id: "curve", primitive: { kind: "ribbon", p0: { x: 0, y: 10 }, p1: { x: 10, y: 0 }, p2: { x: 20, y: 20 }, p3: { x: 30, y: 10 }, startRadius: 1, endRadius: 3 } },
          ],
        },
        {
          at: 1,
          easing: "linear",
          components: [
            { id: "stem", primitive: { kind: "capsule", start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, radius: 3 } },
            { id: "curve", primitive: { kind: "ribbon", p0: { x: 0, y: 20 }, p1: { x: 10, y: 10 }, p2: { x: 20, y: 30 }, p3: { x: 30, y: 20 }, startRadius: 2, endRadius: 4 } },
          ],
        },
      ],
    },
  ],
  reducedMotion: { mode: "crossfade", durationMs: 120, fadeStart: 0.25, fadeEnd: 0.75 },
};

function sceneCopy(): LiquidScene {
  return JSON.parse(JSON.stringify(scene)) as LiquidScene;
}

describe("Liquid evaluator", () => {
  test("validates the shared scene and sample manifest", () => {
    expect(() => validateScene(scene)).not.toThrow();
    expect(() => validateSampleManifest(manifest)).not.toThrow();
  });

  test("rejects scene values that violate schema and Swift parity checks", () => {
    const zeroFixtureVersion = { ...sceneCopy(), fixtureVersion: 0 };
    expect(() => validateScene(zeroFixtureVersion)).toThrow(/fixtureVersion/);

    const fractionalFixtureVersion = { ...sceneCopy(), fixtureVersion: 1.5 };
    expect(() => validateScene(fractionalFixtureVersion)).toThrow(/fixtureVersion/);

    const duplicatePoseTimestamp = { ...sceneCopy(), poses: scene.poses.map((pose, index) => index === 1 ? { ...pose, at: 0 } : pose) };
    expect(() => validateScene(duplicatePoseTimestamp)).toThrow(/strictly ordered/);

    const invalidFadeStart = { ...sceneCopy(), reducedMotion: { ...scene.reducedMotion, fadeStart: -0.01 } };
    expect(() => validateScene(invalidFadeStart)).toThrow(/fade bounds/);

    const invalidFadeEnd = { ...sceneCopy(), reducedMotion: { ...scene.reducedMotion, fadeEnd: 1.01 } };
    expect(() => validateScene(invalidFadeEnd)).toThrow(/fade bounds/);

    const zeroLengthFade = { ...sceneCopy(), reducedMotion: { ...scene.reducedMotion, fadeStart: 0.5, fadeEnd: 0.5 } };
    expect(() => validateScene(zeroLengthFade)).toThrow(/fadeStart/);
  });

  test("rejects duplicate sample labels even when progress differs", () => {
    expect(() => validateSampleManifest({
      schemaVersion: 1,
      sceneId: scene.id,
      samples: [
        { label: "same", progress: 0 },
        { label: "same", progress: 1 },
      ],
    })).toThrow(/unique/);
  });

  test("validates endpoint path command grammar before evaluation", () => {
    const base = sceneCopy();
    const lineBeforeMove = { ...base, source: { ...base.source, commands: [{ type: "L", values: [0, 0] }, ...base.source.commands] } } as LiquidScene;
    expect(() => validateScene(lineBeforeMove)).toThrow(/must be M/);

    const lineAfterClose = { ...base, target: { ...base.target, commands: [{ type: "M", values: [0, 0] }, { type: "Z" }, { type: "L", values: [1, 1] }] } } as LiquidScene;
    expect(() => validateScene(lineAfterClose)).toThrow(/must be M/);

    const unclosedContour = { ...base, target: { ...base.target, commands: [{ type: "M", values: [0, 0] }, { type: "L", values: [1, 1] }] } } as LiquidScene;
    expect(() => validateScene(unclosedContour)).toThrow(/close every contour/);

    const moveBeforeClose = { ...base, target: {
      ...base.target,
      commands: [{ type: "M", values: [0, 0] }, { type: "L", values: [1, 1] }, { type: "M", values: [2, 2] }, { type: "Z" }],
    } } as LiquidScene;
    expect(() => validateScene(moveBeforeClose)).toThrow(/follow Z/);

    const multipleSubpaths = { ...base, target: {
      ...base.target,
      commands: [
        { type: "M", values: [0, 0] },
        { type: "L", values: [1, 0] },
        { type: "Z" },
        { type: "M", values: [2, 0] },
        { type: "L", values: [3, 0] },
        { type: "Z" },
      ],
    } } as LiquidScene;
    expect(() => validateScene(multipleSubpaths)).not.toThrow();
    expect(() => evaluateFrame(lineAfterClose, 1)).toThrow(/must be M/);
  });

  test("prepared transformed path distance matches the public convenience API", () => {
    const commands: PathCommand[] = [
      { type: "M", values: [0, 0] },
      { type: "L", values: [10, 0] },
      { type: "L", values: [10, 10] },
      { type: "L", values: [0, 10] },
      { type: "Z" },
    ];
    const transformed = transformPath(commands, { translateX: 20, translateY: 5, scaleX: 2, scaleY: 3 });
    const prepared = preparePath(transformed);
    const point = { x: 30, y: 20 };
    expect(signedDistanceToPreparedPath(point, prepared, "nonzero")).toBeCloseTo(signedDistanceToPath(point, transformed, "nonzero"), 10);
    expect(signedDistanceToPreparedPath({ x: 5, y: 5 }, prepared, "nonzero")).toBeGreaterThan(0);
  });

  test("corner sharpness tightens smooth-union softness", () => {
    const base = evaluateFrame(scene, 0.6);
    const rounded = {
      ...base,
      leftLeg: { start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, radius: 2 },
      rightLeg: { start: { x: 4, y: 0 }, end: { x: 4, y: 10 }, radius: 2 },
      crossbar: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
      bridge: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
      blendRadius: 6,
      targetMix: 0,
      cornerSharpness: 0,
    };
    const sharp = { ...rounded, cornerSharpness: 1 };

    expect(proceduralDistance({ x: 2, y: 5 }, rounded)).toBeCloseTo(-1, 10);
    expect(proceduralDistance({ x: 2, y: 5 }, sharp)).toBeCloseTo(0, 10);
  });

  test("matches golden key phases, bridge release, target mix, and endpoint modes", () => {
    for (const expected of expectedData.keyPoses) {
      const frame = evaluateFrame(scene, expected.progress);
      expect(frame.phase).toBe(expected.phase);
      expect(frame.renderMode).toBe(expected.renderMode);
      expect(frame.bridge.radius).toBeCloseTo(expected.bridgeRadius, 6);
      expect(frame.targetMix).toBeCloseTo(expected.targetMix, 6);
    }
  });

  test("uses active threshold semantics at and after threshold times", () => {
    expect(evaluateFrame(scene, 0.719999).events).toEqual([]);
    expect(evaluateFrame(scene, 0.72).events).toEqual(["adhesionRelease"]);
    expect(evaluateFrame(scene, 0.98).events).toEqual(["adhesionRelease", "endpointLock"]);
  });

  test("clamps seeking and preserves exact endpoint commands", () => {
    const source = evaluateFrame(scene, -1);
    const target = evaluateFrame(scene, 2);
    expect(source.progress).toBe(0);
    expect(source.renderMode).toBe("sourcePath");
    expect(source.endpointCommands).toEqual(scene.source.commands);
    expect(target.progress).toBe(1);
    expect(target.renderMode).toBe("targetPath");
    expect(target.endpointCommands).toEqual(scene.target.commands);
  });

  test("is independent of evaluation order", () => {
    const forward = evaluateSamples(scene, manifest.samples);
    const reverse = evaluateSamples(scene, [...manifest.samples].reverse());
    const shuffled = evaluateSamples(scene, [manifest.samples[4]!, manifest.samples[0]!, manifest.samples[9]!, manifest.samples[2]!]);
    expect(reverse.samples.map((sample) => sample.label)).toEqual([...manifest.samples].reverse().map((sample) => sample.label));
    expect({ ...evaluateFrame(scene, manifest.samples[4]!.progress), label: manifest.samples[4]!.label }).toEqual(shuffled.samples[0]);
    expect(serializeLiquidFrameOutput(forward)).toContain('"sceneId": "capsule-to-a"');
  });

  test("reduced motion returns an authored crossfade with static source geometry", () => {
    const fadeStart = evaluateFrame(scene, scene.reducedMotion.fadeStart, { reducedMotion: true });
    const fadeEnd = evaluateFrame(scene, scene.reducedMotion.fadeEnd, { reducedMotion: true });
    const before = evaluateFrame(scene, 0.1, { reducedMotion: true });
    const middle = evaluateFrame(scene, 0.5, { reducedMotion: true });
    const after = evaluateFrame(scene, 0.9, { reducedMotion: true });
    expect(before.renderMode).toBe("crossfade");
    expect(fadeStart.sourceOpacity).toBe(1);
    expect(fadeStart.targetOpacity).toBe(0);
    expect(before.sourceOpacity).toBe(1);
    expect(middle.sourceOpacity).toBeCloseTo(0.5, 6);
    expect(fadeEnd.sourceOpacity).toBe(0);
    expect(fadeEnd.targetOpacity).toBe(1);
    expect(after.targetOpacity).toBe(1);
    expect(middle.leftLeg).toEqual(evaluateFrame(scene, 0).leftLeg);
  });

  test("evaluates v2 tracks with local progress, exact endpoints, and stable output", () => {
    expect(() => validateSceneV2(v2Scene)).not.toThrow();
    expect(() => validateScene(v2Scene)).not.toThrow();

    const before = evaluateFrame(v2Scene, 0.1);
    const middle = evaluateFrame(v2Scene, 0.5);
    const after = evaluateFrame(v2Scene, 0.9);

    const oBefore = before.tracks.find((track) => track.id === "letter-o");
    const oMiddle = middle.tracks.find((track) => track.id === "letter-o");
    const oAfter = after.tracks.find((track) => track.id === "letter-o");
    expect(oBefore?.localProgress).toBe(0);
    expect(oBefore?.renderMode).toBe("sourcePath");
    expect(oBefore?.endpointCommands).toEqual(v2Scene.tracks[0]!.source.commands);
    expect(oMiddle?.localProgress).toBeCloseTo(0.5, 6);
    expect(oMiddle?.renderMode).toBe("field");
    expect(oMiddle?.endpointCommands).toBeNull();
    expect(oAfter?.localProgress).toBe(1);
    expect(oAfter?.renderMode).toBe("targetPath");
    expect(oAfter?.endpointCommands).toEqual(v2Scene.tracks[0]!.target.commands);

    const output = evaluateScene(v2Scene, [{ label: "mid", progress: 0.5 }]);
    expect(output.schemaVersion).toBe(2);
    expect(output.samples[0]).toEqual({ ...middle, label: "mid" });
    expect(evaluateFrame(v2Scene, 0.5)).toEqual(evaluateFrame(v2Scene, 0.5));
  });

  test("validates the full Addy v2 scene with four exact endpoint tracks", () => {
    expect(fullAddyScene.id).toBe("spinner-to-addy");
    expect(fullAddyScene.coordinateSpace).toEqual({ width: 2973, height: 1568 });
    expect(fullAddyScene.backdrop?.map((shape) => shape.shapeId)).toEqual(["pill"]);
    expect(fullAddyScene.clip?.shapeId).toBe("pill-outer");
    expect(() => validateSceneV2(fullAddyScene)).not.toThrow();
    expect(() => validateScene(fullAddyScene)).not.toThrow();
    expect(() => validateSampleManifest(fullAddyManifest)).not.toThrow();
    expect(fullAddyManifest.sceneId).toBe(fullAddyScene.id);
    expect(fullAddyScene.tracks).toHaveLength(4);
    expect(fullAddyScene.tracks.map((track) => track.source.shapeId)).toEqual(["tick-1", "tick-2", "tick-3", "tick-4"]);
    expect(fullAddyScene.tracks.map((track) => track.target.shapeId)).toEqual([
      "letter-a",
      "letter-d1",
      "letter-d2",
      "letter-y",
    ]);

    const firstFrame = evaluateFrame(fullAddyScene, 0);
    expect(firstFrame.tracks.every((track) => track.source.transform.translateY < -100)).toBe(true);
    const source = firstFrame;
    const target = evaluateFrame(fullAddyScene, 1);
    expect(source.tracks.map((track) => [track.renderMode, track.localProgress])).toEqual([
      ["sourcePath", 0],
      ["sourcePath", 0],
      ["sourcePath", 0],
      ["sourcePath", 0],
    ]);
    expect(target.tracks.map((track) => [track.renderMode, track.localProgress])).toEqual([
      ["targetPath", 1],
      ["targetPath", 1],
      ["targetPath", 1],
      ["targetPath", 1],
    ]);
    for (const [index, track] of target.tracks.entries()) {
      expect(track.endpointCommands).toEqual(fullAddyScene.tracks[index]!.target.commands);
    }

    const output = evaluateScene(fullAddyScene, [{ label: "target", progress: 1 }]);
    expect(output.schemaVersion).toBe(2);
    expect(output.sceneId).toBe("spinner-to-addy");
    expect(output.samples[0]).toEqual({ ...target, label: "target" });
  });

  test("distance rasters match exact path distances everywhere, including off-raster paths", () => {
    const ring: PathCommand[] = [
      ...squarePath,
      { type: "M", values: [3, 3] },
      { type: "L", values: [3, 7] },
      { type: "L", values: [7, 7] },
      { type: "C", values: [7, 5, 7, 4, 7, 3] },
      { type: "Z" },
    ];
    const path = preparePath(ring);
    const offRaster = preparePath(transformPath(ring, { translateX: 0, translateY: -30, scaleX: 1, scaleY: 1 }));
    const mapping = { width: 37, height: 29, scale: 2.5, offsetX: 3.2, offsetY: 1.7 };
    for (const [label, prepared] of [["on", path], ["off", offRaster]] as const) {
      for (const fillRule of ["nonzero", "evenodd"] as const) {
        const raster = signedDistanceRaster(prepared, fillRule, mapping);
        for (let y = 0; y < mapping.height; y += 1) {
          for (let x = 0; x < mapping.width; x += 1) {
            const point = { x: (x + 0.5 - mapping.offsetX) / mapping.scale, y: (y + 0.5 - mapping.offsetY) / mapping.scale };
            const exact = signedDistanceToPreparedPath(point, prepared, fillRule);
            const value = raster[y * mapping.width + x]!;
            expect(Math.sign(value), `${label} ${fillRule} ${x},${y}`).toBe(Math.sign(exact));
            expect(Math.abs(value - exact) * mapping.scale, `${label} ${fillRule} ${x},${y}`).toBeLessThan(0.05);
          }
        }
      }
    }
  });

  test("monotone cubic tracks pass through keyframes with continuous velocity and no overshoot", () => {
    const capsuleAt = (x: number, radius: number) => ({ kind: "capsule" as const, start: { x, y: 10 }, end: { x, y: 20 }, radius });
    const keyframe = (at: number, x: number, radius: number, blendRadius: number) => ({
      at,
      easing: "smoothStep" as const,
      components: [{ id: "stroke", primitive: capsuleAt(x, radius) }],
      material: { groups: { ink: { blendRadius, note: at < 0.5 ? "early" : "late" } } },
    });
    const splineScene: LiquidSceneV2 = {
      ...v2Scene,
      tracks: [{
        ...v2Scene.tracks[0]!,
        timing: { start: 0, end: 1 },
        interpolation: "monotoneCubic",
        components: [{ id: "stroke", kind: "capsule", operation: "union", groupId: "ink" }],
        keyframes: [keyframe(0, 0, 4, 0), keyframe(0.3, 30, 8, 6), keyframe(0.7, 40, 8, 2), keyframe(1, 100, 12, 0)],
        events: [],
      }],
    };
    expect(() => validateSceneV2(splineScene)).not.toThrow();
    const sample = (progress: number) => {
      const track = evaluateFrame(splineScene, progress).tracks[0]!;
      const primitive = track.components[0]!.primitive;
      if (primitive.kind !== "capsule") throw new Error("expected capsule");
      return { x: primitive.start.x, radius: primitive.radius, blend: track.material.groups.ink!.blendRadius as number, note: track.material.groups.ink!.note };
    };

    expect(sample(0.3)).toMatchObject({ x: 30, radius: 8, blend: 6 });
    expect(sample(0.7)).toMatchObject({ x: 40, radius: 8, blend: 2 });

    const h = 1e-4;
    const velocity = (progress: number) => (sample(progress + h).x - sample(progress - h).x) / (2 * h);
    expect(Math.abs(velocity(0.3 - 0.01) - velocity(0.3 + 0.01))).toBeLessThan(20);
    expect(velocity(0.3)).toBeGreaterThan(0);
    expect((sample(h).x - sample(0).x) / h).toBeLessThan(1);
    expect((sample(1).x - sample(1 - h).x) / h).toBeLessThan(1);

    for (let index = 0; index <= 100; index += 1) {
      const progress = index / 100;
      const value = sample(progress);
      if (progress >= 0.3 && progress <= 0.7) expect(value.radius).toBeCloseTo(8, 9);
      expect(value.x).toBeGreaterThanOrEqual(0);
      expect(value.x).toBeLessThanOrEqual(100);
      if (progress > 0 && progress < 1) expect(value.x).toBeGreaterThan(sample(progress - 0.01).x);
    }
    expect(sample(0.2).note).toBe("early");
    expect(sample(0.9).note).toBe("late");

    expect(() => validateSceneV2({ ...splineScene, tracks: [{ ...splineScene.tracks[0]!, interpolation: "bezier" as never }] })).toThrow("interpolation");
  });

  test("validates scene loop regions", () => {
    expect(() => validateSceneV2({ ...v2Scene, loop: { start: 0.4 } })).not.toThrow();
    expect(() => validateSceneV2({ ...v2Scene, loop: { start: 1 } })).toThrow("scene.loop.start");
    expect(() => validateSceneV2({ ...v2Scene, loop: { start: -0.1 } })).toThrow("scene.loop.start");
  });

  test("rigid tracks always show their exact target, moved by placement", () => {
    const [track] = v2Scene.tracks;
    const rigid = { ...v2Scene, tracks: [{ ...track!, rigid: true }] };
    expect(() => validateSceneV2(rigid)).not.toThrow();
    expect(() => validateSceneV2({ ...v2Scene, tracks: [{ ...track!, rigid: "yes" }] })).toThrow("rigid must be a boolean");
    for (const progress of [0, 0.5, 1]) {
      const frame = evaluateFrame(rigid, progress).tracks[0]!;
      expect(frame.renderMode).toBe("targetPath");
      expect(frame.targetOpacity).toBe(1);
      expect(frame.endpointCommands).toEqual(track!.target.commands);
    }
    expect(evaluateFrame(rigid, 0.5, { reducedMotion: true }).tracks[0]!.renderMode).toBe("crossfade");
  });

  test("validates scene markers", () => {
    expect(() => validateSceneV2({ ...v2Scene, markers: [{ id: "intro", at: 0.3 }, { id: "end", at: 1 }] })).not.toThrow();
    expect(() => validateSceneV2({ ...v2Scene, markers: [{ id: "intro", at: 1.2 }] })).toThrow("scene.markers[0].at");
    expect(() => validateSceneV2({ ...v2Scene, markers: [{ id: "", at: 0.2 }] })).toThrow("scene.markers[0].id");
    expect(() => validateSceneV2({ ...v2Scene, markers: [{ id: "a", at: 0.2 }, { id: "a", at: 0.4 }] })).toThrow("scene.markers[1].id");
  });

  test("keeps full Addy motion continuous without authored teleports", () => {
    for (const track of fullAddyScene.tracks) {
      expect(track.interpolation).toBe("monotoneCubic");
      for (let index = 1; index < track.keyframes.length; index += 1) {
        // Catches instant jumps authored as near-duplicate keyframes; sampled springs sit about 0.01 apart.
        expect(track.keyframes[index]!.at - track.keyframes[index - 1]!.at).toBeGreaterThan(0.001);
      }
    }
    const coordinates = (progress: number) => evaluateFrame(fullAddyScene, progress).tracks.map((track) => track.components.flatMap((component) =>
      Object.values(component.primitive).flatMap((value) => typeof value === "number" ? [value] : typeof value === "object" ? [value.x, value.y] : [])));
    // Fine enough that fast but continuous motion (a 150ms tick drop) stays far
    // below the bound, while a teleport (one pose jumping in an instant) does not.
    const steps = 2000;
    let previous = coordinates(0);
    for (let index = 1; index <= steps; index += 1) {
      const next = coordinates(index / steps);
      for (const [trackIndex, values] of next.entries()) {
        const largestMove = Math.max(...values.map((value, valueIndex) => Math.abs(value - previous[trackIndex]![valueIndex]!)));
        expect(largestMove, `track ${trackIndex} at ${index / steps}`).toBeLessThan(fullAddyScene.coordinateSpace.width * 0.012);
      }
      previous = next;
    }
  });

  test("uses v2 step and release semantic event windows", () => {
    expect(evaluateFrame(v2Scene, 0.34).events.map((event) => event.id)).toEqual([]);
    expect(evaluateFrame(v2Scene, 0.35).events.map((event) => event.id)).toEqual(["release"]);
    expect(evaluateFrame(v2Scene, 0.5).events.map((event) => event.id)).toEqual(["snap", "release"]);
    expect(evaluateFrame(v2Scene, 0.65).events.map((event) => event.id)).toEqual(["snap"]);
  });

  test("supports v2 subtract composition for counters and ribbon primitives", () => {
    const frame = evaluateFrame(v2Scene, 0.5);
    const oTrack = frame.tracks.find((track) => track.id === "letter-o");
    const ribbonTrack = frame.tracks.find((track) => track.id === "ribbon");
    expect(oTrack).toBeDefined();
    expect(ribbonTrack).toBeDefined();
    expect(trackFieldDistance({ x: 30, y: 20 }, oTrack!)).toBeGreaterThan(0);
    expect(trackFieldDistance({ x: 24, y: 20 }, oTrack!)).toBeLessThan(0);
    expect(trackFieldDistance({ x: 15, y: 15 }, ribbonTrack!)).toBeLessThan(5);
  });

  test("prepared ribbons flatten fixed cubic segments and match public distance", () => {
    const frame = evaluateFrame(v2Scene, 0.5);
    const ribbonTrack = frame.tracks.find((track) => track.id === "ribbon");
    const ribbon = ribbonTrack?.components.find((component) => component.kind === "ribbon")?.primitive;
    if (!ribbon || ribbon.kind !== "ribbon") throw new Error("Expected ribbon component");

    const prepared = prepareRibbon(ribbon);
    expect(prepared.segments).toHaveLength(32);
    for (const point of [{ x: 15, y: 15 }, { x: 0, y: 0 }, { x: 30, y: 20 }, { x: 19.5, y: 21.25 }]) {
      expect(preparedRibbonDistance(point, prepared)).toBe(ribbonDistance(point, ribbon));
    }
  });

  test("prepared track fields preserve composition and resolved blend radii", () => {
    const frame = evaluateFrame(v2Scene, 0.5);
    const oTrack = frame.tracks.find((track) => track.id === "letter-o");
    const ribbonTrack = frame.tracks.find((track) => track.id === "ribbon");
    if (!oTrack || !ribbonTrack) throw new Error("Expected v2 test tracks");

    const preparedO = prepareTrackField(oTrack);
    const preparedRibbon = prepareTrackField(ribbonTrack);
    expect(preparedO.components.map((component) => [component.id, component.operation, component.blendRadius])).toEqual([
      ["outer", "union", 0],
      ["counter", "subtract", 0],
    ]);
    expect(preparedRibbon.components.map((component) => component.blendRadius)).toEqual([0, 0]);
    for (const point of [{ x: 30, y: 20 }, { x: 24, y: 20 }, { x: 15, y: 15 }, { x: 50, y: 50 }]) {
      expect(preparedTrackFieldDistance(point, preparedO)).toBe(trackFieldDistance(point, oTrack));
      expect(preparedTrackFieldDistance(point, preparedRibbon)).toBe(trackFieldDistance(point, ribbonTrack));
    }
  });

  test("applies v2 reduced motion crossfade without endpoint command passthrough", () => {
    const start = evaluateFrame(v2Scene, 0.25, { reducedMotion: true }).tracks[0]!;
    const middle = evaluateFrame(v2Scene, 0.5, { reducedMotion: true }).tracks[0]!;
    const end = evaluateFrame(v2Scene, 0.75, { reducedMotion: true }).tracks[0]!;
    const source = evaluateFrame(v2Scene, 0).tracks[0]!;
    expect(start.renderMode).toBe("crossfade");
    expect(start.sourceOpacity).toBe(1);
    expect(middle.sourceOpacity).toBeCloseTo(0.5, 6);
    expect(end.targetOpacity).toBe(1);
    expect(middle.endpointCommands).toBeNull();
    expect(middle.components[0]!.primitive).toEqual(source.components[0]!.primitive);
  });

  test("rejects v2 component and event constraints that would break deterministic evaluation", () => {
    const unstableKind = JSON.parse(JSON.stringify(v2Scene));
    unstableKind.tracks[0]!.keyframes[1]!.components = unstableKind.tracks[0]!.keyframes[1]!.components.map((component: { id: string; primitive: unknown }) => component.id === "counter"
      ? { id: "counter", primitive: { kind: "capsule", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, radius: 1 } }
      : component);
    expect(() => validateSceneV2(unstableKind)).toThrow(/stable component definition/);

    const missingComponent = JSON.parse(JSON.stringify(v2Scene));
    missingComponent.tracks[0]!.keyframes[0]!.components = missingComponent.tracks[0]!.keyframes[0]!.components.slice(0, 1);
    expect(() => validateSceneV2(missingComponent)).toThrow(/stable component definitions/);

    const invalidRelease = JSON.parse(JSON.stringify(v2Scene));
    invalidRelease.tracks[0]!.events = [{ id: "bad", kind: "release", at: 0.8, end: 0.7 }];
    expect(() => validateSceneV2(invalidRelease)).toThrow(/end/);
  });
});
