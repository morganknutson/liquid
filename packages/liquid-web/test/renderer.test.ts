import { describe, expect, test, vi } from "vitest";
import { evaluateFrame, fieldDistance, framePaintedTracks, trackIsClippedAway, signedDistanceRaster, signedDistanceToPreparedPath, type AnyLiquidScene, type LiquidFrameSample, type LiquidFrameSampleV2, type LiquidScene, type LiquidSceneV2, type Point } from "@liquid/core";
import sampleManifestData from "../../../shared/golden/capsule-to-a.samples.json" with { type: "json" };
import sampleManifestFullData from "../../../shared/golden/spinner-to-addy.samples.json" with { type: "json" };
import sampleManifestV2Data from "../../../shared/golden/spinner-to-ad.samples.json" with { type: "json" };
import visualGoldenData from "../../../shared/golden/capsule-to-a.visual.json" with { type: "json" };
import visualGoldenFullData from "../../../shared/golden/spinner-to-addy.visual.json" with { type: "json" };
import visualGoldenV2Data from "../../../shared/golden/spinner-to-ad.visual.json" with { type: "json" };
import sceneData from "../../../shared/scenes/capsule-to-a.v1.json" with { type: "json" };
import sceneFullData from "../../../shared/scenes/spinner-to-addy.v2.json" with { type: "json" };
import sceneReplayData from "../../../shared/scenes/addy-logo-wave-wordmark-replay.v2.json" with { type: "json" };
import waveSceneData from "../../../shared/scenes/addy-logo-wave.v2.json" with { type: "json" };
import sceneV2Data from "../../../shared/scenes/spinner-to-ad.v2.json" with { type: "json" };
import { LiquidCanvasRenderer, LiquidWebGLRenderer, deviceToScene, rasterizeFrame, viewportFor, type RasterResult } from "../src/index.js";

vi.mock("@liquid/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@liquid/core")>();
  return {
    ...actual,
    signedDistanceToPreparedPath: vi.fn(actual.signedDistanceToPreparedPath),
    signedDistanceRaster: vi.fn(actual.signedDistanceRaster),
  };
});

const scene = sceneData as LiquidScene;
const sharedSceneV2 = sceneV2Data as LiquidSceneV2;
const sharedSceneFull = sceneFullData as LiquidSceneV2;
const sampleManifest = sampleManifestData as { sceneId: string; samples: Array<{ label: string; progress: number }> };
const sampleManifestV2 = sampleManifestV2Data as { sceneId: string; samples: Array<{ label: string; progress: number }> };
const sampleManifestFull = sampleManifestFullData as { sceneId: string; samples: Array<{ label: string; progress: number }> };
type VisualGoldenSample = { label: string; progress: number; alphaBase64: string; alphaSha256: string };
type VisualGoldenV2 = {
  sceneId: string;
  fixtureVersion: number;
  resolutions: Array<{ width: number; height: number; samples: VisualGoldenSample[] }>;
};
const visualGolden = visualGoldenData as {
  sceneId: string;
  fixtureVersion: number;
  resolution: { width: number; height: number };
  samples: VisualGoldenSample[];
};
const visualGoldenV2 = visualGoldenV2Data as VisualGoldenV2;
const visualGoldenFull = visualGoldenFullData as VisualGoldenV2;

function alphaAtScenePoint(mask: RasterResult, point: Point, sourceScene: AnyLiquidScene = scene): number {
  const viewport = viewportFor(sourceScene, mask.width, mask.height);
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(point.x * viewport.scale + viewport.offsetX)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(point.y * viewport.scale + viewport.offsetY)));
  return mask.alpha[y * mask.width + x] ?? 0;
}

const rectangleCommands = (minX: number, minY: number, maxX: number, maxY: number) => [
  { type: "M" as const, values: [minX, minY] as const },
  { type: "L" as const, values: [maxX, minY] as const },
  { type: "L" as const, values: [maxX, maxY] as const },
  { type: "L" as const, values: [minX, maxY] as const },
  { type: "Z" as const },
];

const identityTransform = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };

const v2Scene: LiquidSceneV2 = {
  schemaVersion: 2,
  id: "web-v2-test",
  fixtureVersion: 1,
  durationMs: 1000,
  coordinateSpace: { width: 100, height: 100 },
  fillRule: "nonzero",
  tracks: [
    {
      id: "a-track",
      source: { assetId: "test", shapeId: "a-source", transform: identityTransform, commands: rectangleCommands(10, 10, 30, 30) },
      target: { assetId: "test", shapeId: "a-target", transform: identityTransform, commands: rectangleCommands(62, 10, 82, 30) },
      timing: { start: 0, end: 1 },
      components: [
        { id: "outer", kind: "ellipse", operation: "union", groupId: "body" },
        { id: "counter", kind: "ellipse", operation: "subtract", groupId: "cutout" },
        { id: "bridge", kind: "ribbon", operation: "union", groupId: "strand" },
      ],
      keyframes: [
        {
          at: 0,
          easing: "linear",
          components: [
            { id: "outer", primitive: { kind: "ellipse", center: { x: 20, y: 20 }, radiusX: 10, radiusY: 10 } },
            { id: "counter", primitive: { kind: "ellipse", center: { x: 20, y: 20 }, radiusX: 0, radiusY: 0 } },
            { id: "bridge", primitive: { kind: "ribbon", p0: { x: 20, y: 20 }, p1: { x: 25, y: 20 }, p2: { x: 30, y: 20 }, p3: { x: 35, y: 20 }, startRadius: 0, endRadius: 0 } },
          ],
          material: {
            groups: {
              $track: { targetMix: 0, cornerSharpness: 0, blendRadius: 4 },
              body: { blendRadius: 4 },
              strand: { blendRadius: 2 },
            },
          },
        },
        {
          at: 0.5,
          easing: "smoothStep",
          components: [
            { id: "outer", primitive: { kind: "ellipse", center: { x: 46, y: 50 }, radiusX: 24, radiusY: 20 } },
            { id: "counter", primitive: { kind: "ellipse", center: { x: 46, y: 50 }, radiusX: 7, radiusY: 7 } },
            { id: "bridge", primitive: { kind: "ribbon", p0: { x: 20, y: 50 }, p1: { x: 33, y: 40 }, p2: { x: 59, y: 60 }, p3: { x: 72, y: 50 }, startRadius: 3, endRadius: 3 } },
          ],
          material: {
            components: { outer: { blendRadius: 6 } },
            groups: {
              $track: { targetMix: 0.5, cornerSharpness: 0.25, blendRadius: 4 },
              body: { blendRadius: 8 },
              strand: { blendRadius: 2 },
            },
          },
        },
        {
          at: 1,
          easing: "smoothStep",
          components: [
            { id: "outer", primitive: { kind: "ellipse", center: { x: 72, y: 20 }, radiusX: 10, radiusY: 10 } },
            { id: "counter", primitive: { kind: "ellipse", center: { x: 72, y: 20 }, radiusX: 0, radiusY: 0 } },
            { id: "bridge", primitive: { kind: "ribbon", p0: { x: 72, y: 20 }, p1: { x: 72, y: 20 }, p2: { x: 72, y: 20 }, p3: { x: 72, y: 20 }, startRadius: 0, endRadius: 0 } },
          ],
          material: {
            groups: {
              $track: { targetMix: 1, cornerSharpness: 1, blendRadius: 0 },
              body: { blendRadius: 0 },
              strand: { blendRadius: 0 },
            },
          },
        },
      ],
      events: [
        { id: "pin-a", kind: "step", at: 0, componentId: "outer", payload: { intent: "pin" } },
        { id: "release-a", kind: "release", at: 0.45, end: 0.52, componentId: "counter", payload: { intent: "release" } },
        { id: "snap-a", kind: "step", at: 0.98, componentId: "outer", payload: { intent: "snap-to-target" } },
      ],
    },
    {
      id: "d-track",
      source: { assetId: "test", shapeId: "d-source", transform: identityTransform, commands: rectangleCommands(10, 62, 30, 82) },
      target: { assetId: "test", shapeId: "d-target", transform: identityTransform, commands: rectangleCommands(62, 62, 82, 82) },
      timing: { start: 0.5, end: 1 },
      components: [
        { id: "stem", kind: "capsule", operation: "union", groupId: "body" },
      ],
      keyframes: [
        {
          at: 0,
          easing: "linear",
          components: [
            { id: "stem", primitive: { kind: "capsule", start: { x: 20, y: 64 }, end: { x: 20, y: 80 }, radius: 10 } },
          ],
          material: { groups: { $track: { targetMix: 0, cornerSharpness: 0 }, body: { blendRadius: 3 } } },
        },
        {
          at: 1,
          easing: "smoothStep",
          components: [
            { id: "stem", primitive: { kind: "capsule", start: { x: 72, y: 64 }, end: { x: 72, y: 80 }, radius: 10 } },
          ],
          material: { groups: { $track: { targetMix: 1, cornerSharpness: 1 }, body: { blendRadius: 0 } } },
        },
      ],
      events: [
        { id: "pin-d", kind: "step", at: 0, componentId: "stem", payload: { intent: "pin" } },
        { id: "snap-d", kind: "step", at: 0.95, componentId: "stem", payload: { intent: "snap-to-target" } },
      ],
    },
  ],
  reducedMotion: {
    mode: "crossfade",
    durationMs: 120,
    fadeStart: 0.1,
    fadeEnd: 0.9,
  },
};

class TestCanvasContext {
  readonly putImages: ImageData[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "black";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";

  clearRect(): void {}

  createImageData(width: number, height: number): ImageData {
    return {
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(imageData: ImageData): void {
    this.putImages.push(imageData);
  }

  fillRect(): void {}

  restore(): void {}

  save(): void {}
}

function testCanvas(width: number, height: number): HTMLCanvasElement {
  const context = new TestCanvasContext();
  return {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
}

function decodeAlphaBase64(encoded: string): Uint8ClampedArray {
  return Uint8ClampedArray.from(Buffer.from(encoded, "base64"));
}

describe("Liquid web renderer", () => {
  test("maps the authored coordinate space into a stable viewport", () => {
    const viewport = viewportFor(scene, 320, 240);
    expect(viewport.scale).toBeGreaterThan(1);
    expect(viewport.offsetX).toBeGreaterThanOrEqual(0);
    expect(viewport.offsetY).toBeGreaterThanOrEqual(0);
    expect(deviceToScene({ x: viewport.offsetX, y: viewport.offsetY }, viewport)).toEqual({ x: 0, y: 0 });
  });

  test("can reserve scene-space padding without changing canonical geometry", () => {
    const viewport = viewportFor(scene, 320, 240);
    const padded = viewportFor(scene, 320, 240, 24);

    expect(padded.scale).toBeLessThan(viewport.scale);
    expect(padded.offsetX / padded.scale).toBeGreaterThanOrEqual(24);
    expect(padded.offsetY / padded.scale).toBeCloseTo(24, 10);
    expect(deviceToScene({ x: padded.offsetX, y: padded.offsetY }, padded)).toEqual({ x: 0, y: 0 });
  });

  test("produces deterministic non-empty alpha masks for field frames", () => {
    const frame = evaluateFrame(scene, 0.6);
    const first = rasterizeFrame(scene, frame, { width: 96, height: 96 });
    const second = rasterizeFrame(scene, frame, { width: 96, height: 96 });
    expect(first.coverage).toBeGreaterThan(0.05);
    expect(first.coverage).toBeLessThan(0.8);
    expect(first.alpha).toEqual(second.alpha);
  });

  test("field distance blends procedural and target silhouettes", () => {
    const frame = evaluateFrame(scene, 0.9);
    const apexDistance = fieldDistance({ x: 79.495, y: 10 }, scene, frame);
    const outsideDistance = fieldDistance({ x: 150, y: 10 }, scene, frame);
    expect(apexDistance).toBeLessThan(outsideDistance);
  });

  test("rasterizes exact target endpoint with stable coverage", () => {
    const target = rasterizeFrame(scene, evaluateFrame(scene, 1), { width: 128, height: 128 });
    expect(target.coverage).toBeGreaterThan(0.12);
    expect(target.coverage).toBeLessThan(0.6);
  });

  test("applies endpoint transforms before source endpoint rasterization", () => {
    const source = rasterizeFrame(scene, evaluateFrame(scene, 0), { width: 160, height: 152 });
    expect(alphaAtScenePoint(source, { x: 79.495, y: 70 })).toBeGreaterThan(240);
    expect(alphaAtScenePoint(source, { x: 27.1, y: 70 })).toBeLessThan(16);
  });

  test("crossfade rasterization blends transformed endpoint alpha masks", () => {
    const frame = evaluateFrame(scene, 0.5, { reducedMotion: true });
    const mask = rasterizeFrame(scene, frame, { width: 160, height: 152 });
    expect(alphaAtScenePoint(mask, { x: 79.495, y: 70 })).toBeGreaterThanOrEqual(120);
    expect(alphaAtScenePoint(mask, { x: 79.495, y: 70 })).toBeLessThanOrEqual(136);
    expect(alphaAtScenePoint(mask, { x: 10, y: 140 })).toBeGreaterThanOrEqual(120);
    expect(alphaAtScenePoint(mask, { x: 10, y: 140 })).toBeLessThanOrEqual(136);
  });

  test("uses transformed target paths prepared once for field rasterization", () => {
    const transformedScene: LiquidScene = {
      ...scene,
      target: {
        ...scene.target,
        transform: { translateX: 40, translateY: 0, scaleX: 1, scaleY: 1 },
      },
    };
    const frame: LiquidFrameSample = {
      ...evaluateFrame(transformedScene, 0.98),
      renderMode: "field",
      targetMix: 1,
    };
    const mask = rasterizeFrame(transformedScene, frame, { width: 220, height: 152 });
    expect(alphaAtScenePoint(mask, { x: 119.5, y: 30 }, transformedScene)).toBeGreaterThan(0);
    expect(alphaAtScenePoint(mask, { x: 79.5, y: 30 }, transformedScene)).toBeLessThan(24);
  });

  test("reuses renderer target distance rasters until dimensions or target geometry change", () => {
    const rasterSpy = vi.mocked(signedDistanceRaster);
    rasterSpy.mockClear();
    const canvas = testCanvas(12, 10);
    const renderer = new LiquidCanvasRenderer(canvas);
    const frame: LiquidFrameSample = {
      ...evaluateFrame(scene, 0.6),
      renderMode: "field",
      targetMix: 0.5,
    };

    renderer.render(scene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(1);

    renderer.render(scene, { ...frame, bridge: { ...frame.bridge, radius: frame.bridge.radius * 0.5 } });
    expect(rasterSpy).toHaveBeenCalledTimes(1);

    canvas.width = 13;
    renderer.render(scene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(2);

    const shiftedTargetScene: LiquidScene = {
      ...scene,
      target: {
        ...scene.target,
        transform: { translateX: 4, translateY: 0, scaleX: 1, scaleY: 1 },
      },
    };
    renderer.render(shiftedTargetScene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(3);
  });

  test("skips renderer target distance work when field targetMix is zero", () => {
    const distanceSpy = vi.mocked(signedDistanceToPreparedPath);
    distanceSpy.mockClear();
    const renderer = new LiquidCanvasRenderer(testCanvas(12, 10));
    const frame: LiquidFrameSample = {
      ...evaluateFrame(scene, 0.4),
      renderMode: "field",
      targetMix: 0,
    };

    renderer.render(scene, frame);
    expect(distanceSpy).not.toHaveBeenCalled();
  });

  test("rasterizes v2 tracks with deterministic endpoint compositing and local timing", () => {
    const sourceFrame = evaluateFrame(v2Scene, 0);
    const source = rasterizeFrame(v2Scene, sourceFrame, { width: 100, height: 100 });
    expect(sourceFrame.tracks.map((track) => [track.id, track.renderMode, track.localProgress])).toEqual([
      ["a-track", "sourcePath", 0],
      ["d-track", "sourcePath", 0],
    ]);
    expect(alphaAtScenePoint(source, { x: 20, y: 20 }, v2Scene)).toBeGreaterThan(240);
    expect(alphaAtScenePoint(source, { x: 72, y: 20 }, v2Scene)).toBeLessThan(16);
    expect(alphaAtScenePoint(source, { x: 20, y: 72 }, v2Scene)).toBeGreaterThan(240);

    const targetFrame = evaluateFrame(v2Scene, 1);
    const target = rasterizeFrame(v2Scene, targetFrame, { width: 100, height: 100 });
    expect(targetFrame.tracks.map((track) => [track.id, track.renderMode, track.localProgress])).toEqual([
      ["a-track", "targetPath", 1],
      ["d-track", "targetPath", 1],
    ]);
    expect(alphaAtScenePoint(target, { x: 72, y: 20 }, v2Scene)).toBeGreaterThan(240);
    expect(alphaAtScenePoint(target, { x: 72, y: 72 }, v2Scene)).toBeGreaterThan(240);
  });

  test("renders v2 generic fields with subtractive ellipses, ribbons, and $track target relaxation", () => {
    const frame = evaluateFrame(v2Scene, 0.5);
    const proceduralFrame: LiquidFrameSampleV2 = {
      ...frame,
      tracks: frame.tracks.map((track) => track.id === "a-track"
        ? { ...track, material: { ...track.material, groups: { ...track.material.groups, $track: { ...track.material.groups.$track, targetMix: 0 } } } }
        : track),
    };
    const targetRelaxedFrame: LiquidFrameSampleV2 = {
      ...frame,
      tracks: frame.tracks.map((track) => track.id === "a-track"
        ? { ...track, material: { ...track.material, groups: { ...track.material.groups, $track: { ...track.material.groups.$track, targetMix: 1 } } } }
        : track),
    };
    const mask = rasterizeFrame(v2Scene, proceduralFrame, { width: 100, height: 100 });
    const relaxedMask = rasterizeFrame(v2Scene, targetRelaxedFrame, { width: 100, height: 100 });
    const trackFrame = frame.tracks[0] as LiquidFrameSampleV2["tracks"][number];
    expect(trackFrame.material.groups.$track?.targetMix).toBe(0.5);
    expect(trackFrame.components.map((component) => component.kind)).toEqual(["ellipse", "ellipse", "ribbon"]);
    expect(frame.events.map((event) => event.id)).toContain("release-a");
    expect(alphaAtScenePoint(mask, { x: 46, y: 56 }, v2Scene)).toBeLessThan(80);
    expect(alphaAtScenePoint(mask, { x: 28, y: 50 }, v2Scene)).toBeGreaterThan(80);
    expect(alphaAtScenePoint(relaxedMask, { x: 72, y: 20 }, v2Scene)).toBeGreaterThan(0);
  });

  test("reuses v2 target distance rasters per track until target geometry changes", () => {
    const rasterSpy = vi.mocked(signedDistanceRaster);
    rasterSpy.mockClear();
    const canvas = testCanvas(10, 10);
    const renderer = new LiquidCanvasRenderer(canvas);
    const evaluatedFrame = evaluateFrame(v2Scene, 0.5);
    const frame: LiquidFrameSampleV2 = {
      ...evaluatedFrame,
      tracks: evaluatedFrame.tracks.filter((track) => track.id === "a-track"),
    };

    renderer.render(v2Scene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(1);

    renderer.render(v2Scene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(1);

    canvas.width = 11;
    renderer.render(v2Scene, frame);
    expect(rasterSpy).toHaveBeenCalledTimes(2);
  });

  test("matches the shared visual alpha golden for every normal-motion sample", () => {
    expect(visualGolden.sceneId).toBe(scene.id);
    expect(visualGolden.fixtureVersion).toBe(scene.fixtureVersion);
    expect(visualGolden.samples.map((sample) => sample.label)).toEqual(sampleManifest.samples.map((sample) => sample.label));

    for (const sample of sampleManifest.samples) {
      const expected = visualGolden.samples.find((entry) => entry.label === sample.label && entry.progress === sample.progress);
      expect(expected, `missing visual golden sample ${sample.label}`).toBeDefined();
      if (!expected) continue;

      const frame = evaluateFrame(scene, sample.progress);
      const mask = rasterizeFrame(scene, frame, visualGolden.resolution);
      const expectedAlpha = decodeAlphaBase64(expected.alphaBase64);
      expect(mask.alpha, sample.label).toEqual(expectedAlpha);
    }
  });

  test("matches the shared v2 visual alpha golden at both committed resolutions", () => {
    expect(visualGoldenV2.sceneId).toBe(sharedSceneV2.id);
    expect(visualGoldenV2.fixtureVersion).toBe(sharedSceneV2.fixtureVersion);
    expect(visualGoldenV2.resolutions.map((resolution) => [resolution.width, resolution.height])).toEqual([
      [132, 52],
      [264, 104],
    ]);

    for (const resolution of visualGoldenV2.resolutions) {
      expect(resolution.samples.map((sample) => sample.label)).toEqual(sampleManifestV2.samples.map((sample) => sample.label));

      for (const sample of sampleManifestV2.samples) {
        const expected = resolution.samples.find((entry) => entry.label === sample.label && entry.progress === sample.progress);
        expect(expected, `missing v2 visual golden sample ${sample.label} at ${resolution.width}x${resolution.height}`).toBeDefined();
        if (!expected) continue;

        const frame = evaluateFrame(sharedSceneV2, sample.progress);
        const mask = rasterizeFrame(sharedSceneV2, frame, { width: resolution.width, height: resolution.height });
        const expectedAlpha = decodeAlphaBase64(expected.alphaBase64);
        expect(mask.alpha, `${sample.label} ${resolution.width}x${resolution.height}`).toEqual(expectedAlpha);
      }
    }
  });

  test("draws placed tracks moved and scaled, the same as moving and scaling their shapes", () => {
    const waveScene = waveSceneData as unknown as LiquidSceneV2;
    const evaluated = evaluateFrame(waveScene, waveScene.loop!.start);
    const track = evaluated.tracks.find((candidate) => candidate.id === "wave-pill-2")!;
    const capsule = track.components[0]!.primitive as { start: { x: number; y: number }; end: { x: number; y: number }; radius: number };
    const placement = { offsetX: 180, offsetY: -60, scale: 1.4, originX: capsule.start.x, originY: (capsule.start.y + capsule.end.y) / 2 };
    const move = ({ x, y }: { x: number; y: number }) => ({
      x: placement.originX + (x - placement.originX) * placement.scale + placement.offsetX,
      y: placement.originY + (y - placement.originY) * placement.scale + placement.offsetY,
    });
    const placed = { ...evaluated, tracks: [{ ...track, material: { ...track.material, groups: { ...track.material.groups, $track: { ...track.material.groups.$track, ...placement } } } }] };
    const moved = {
      ...evaluated,
      tracks: [{ ...track, components: [{ ...track.components[0]!, primitive: { ...capsule, kind: "capsule" as const, start: move(capsule.start), end: move(capsule.end), radius: capsule.radius * placement.scale } }] }],
    };
    const scene = { ...waveScene, backdrop: [] };
    const a = rasterizeFrame(scene, placed as LiquidFrameSampleV2, { width: 160, height: 84 }).alpha;
    const b = rasterizeFrame(scene, moved as LiquidFrameSampleV2, { width: 160, height: 84 }).alpha;
    let maxDelta = 0;
    for (let index = 0; index < a.length; index += 1) maxDelta = Math.max(maxDelta, Math.abs(a[index]! - b[index]!));
    expect(a.some((value) => value > 0)).toBe(true);
    expect(maxDelta).toBeLessThanOrEqual(1);
  });

  test("fades field tracks by their $track opacity", () => {
    const waveScene = waveSceneData as unknown as LiquidSceneV2;
    const evaluated = evaluateFrame(waveScene, waveScene.loop!.start);
    const frame = { ...evaluated, tracks: evaluated.tracks.filter((track) => track.id === "wave-pill-2") };
    expect(frame.tracks[0]?.renderMode).toBe("field");
    const withOpacity = (opacity: number): LiquidFrameSampleV2 => ({
      ...frame,
      tracks: frame.tracks.map((track) => ({
        ...track,
        material: { ...track.material, groups: { ...track.material.groups, $track: { ...track.material.groups.$track, opacity } } },
      })),
    });
    const full = rasterizeFrame(waveScene, withOpacity(1), { width: 120, height: 64 });
    const half = rasterizeFrame(waveScene, withOpacity(0.5), { width: 120, height: 64 });
    const none = rasterizeFrame({ ...waveScene, backdrop: [] }, withOpacity(0), { width: 120, height: 64 });
    expect(Math.max(...full.alpha)).toBe(255);
    const pill = frame.tracks[0]!.components[0]!.primitive as { start: { x: number } };
    const pillCenter = 32 * 120 + Math.floor((pill.start.x / 2973) * 120);
    expect(full.alpha[pillCenter]).toBe(255);
    expect(half.alpha[pillCenter]).toBeGreaterThanOrEqual(127);
    expect(half.alpha[pillCenter]).toBeLessThanOrEqual(128);
    expect(Math.max(...none.alpha)).toBe(0);
  });

  test("clips tracks to the scene clip so dropping ticks never show above the pill", () => {
    const padding = 600;
    const width = 120;
    const height = 80;
    // Sweep the opening so the check follows the drop timing, whatever it is tuned to.
    let leakedWithoutClip = false;
    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 50;
      const mask = rasterizeFrame(sharedSceneFull, evaluateFrame(sharedSceneFull, progress), { width, height, viewportPadding: padding });
      const viewport = viewportFor(sharedSceneFull, width, height, padding);
      const pillTop = Math.floor(viewport.offsetY) - 1;
      expect(pillTop).toBeGreaterThan(0);
      for (let y = 0; y < pillTop; y += 1) {
        for (let x = 0; x < width; x += 1) expect(mask.alpha[y * width + x], `${progress} ${x},${y}`).toBe(0);
      }
      if (leakedWithoutClip) continue;
      const unclipped = rasterizeFrame({ ...sharedSceneFull, clip: undefined } as unknown as LiquidSceneV2, evaluateFrame(sharedSceneFull, progress), { width, height, viewportPadding: padding });
      if (unclipped.alpha.slice(0, pillTop * width).some((value) => value > 0)) leakedWithoutClip = true;
    }
    expect(leakedWithoutClip, "the sweep should include ticks falling above the pill").toBe(true);
  });

  test("matches the shared full Addy visual alpha golden at both committed resolutions", () => {
    expect(visualGoldenFull.sceneId).toBe(sharedSceneFull.id);
    expect(visualGoldenFull.fixtureVersion).toBe(sharedSceneFull.fixtureVersion);
    expect(sharedSceneFull.tracks.map((track) => track.target.shapeId)).toEqual(["letter-a", "letter-d1", "letter-d2", "letter-y"]);
    expect(visualGoldenFull.resolutions.map((resolution) => [resolution.width, resolution.height])).toEqual([
      [132, 70],
      [264, 139],
    ]);

    for (const resolution of visualGoldenFull.resolutions) {
      expect(resolution.samples.map((sample) => sample.label)).toEqual(sampleManifestFull.samples.map((sample) => sample.label));

      for (const sample of sampleManifestFull.samples) {
        const expected = resolution.samples.find((entry) => entry.label === sample.label && entry.progress === sample.progress);
        expect(expected, `missing full Addy visual golden sample ${sample.label} at ${resolution.width}x${resolution.height}`).toBeDefined();
        if (!expected) continue;

        const frame = evaluateFrame(sharedSceneFull, sample.progress);
        const mask = rasterizeFrame(sharedSceneFull, frame, { width: resolution.width, height: resolution.height });
        const expectedAlpha = decodeAlphaBase64(expected.alphaBase64);
        expect(mask.alpha, `${sample.label} ${resolution.width}x${resolution.height}`).toEqual(expectedAlpha);
      }
    }
  });

  test("skips tracks clipped away entirely, so the replay logo fits the GPU on every frame", () => {
    const scene = sceneReplayData as unknown as LiquidSceneV2;
    expect(scene.tracks.length).toBeGreaterThan(8);
    expect(LiquidWebGLRenderer.supportsScene(scene)).toBe(true);
    const enter = scene.markers![0]!.at;
    // Letters at rest are painted; once they have dropped out of the pill they are not.
    const resting = evaluateFrame(scene, 0).tracks.find((track) => track.id === "exit-y")!;
    const dropped = evaluateFrame(scene, enter).tracks.find((track) => track.id === "exit-y")!;
    expect(trackIsClippedAway(scene, resting)).toBe(false);
    expect(trackIsClippedAway(scene, dropped)).toBe(true);
    for (let step = 0; step <= 200; step += 1) {
      const painted = framePaintedTracks(scene, evaluateFrame(scene, step / 200));
      expect(painted.tracks.length).toBeLessThanOrEqual(8);
    }
  });
});
