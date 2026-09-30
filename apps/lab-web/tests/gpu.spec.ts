import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function loadGpuHarness(page: Page): Promise<{
  capabilities: { supported: boolean; reason?: string };
  autoBackend: string;
  source: CanvasStats;
  field: CanvasStats;
  target: CanvasStats;
  reduced: CanvasStats;
  sourceDiff: SilhouetteDiff;
  targetDiff: SilhouetteDiff;
  fieldDiff: SilhouetteDiff;
  ranged: { gpu: CanvasStats; cpu: CanvasStats; diff: SilhouetteDiff };
  resized: { backing: { width: number; height: number; scale: number }; stats: CanvasStats; backend: string };
  fallbackBackend: string;
}> {
  const repositoryRoot = process.cwd();
  const webModulePath = `/@fs${path.join(repositoryRoot, "packages/liquid-web/src/index.ts")}`;
  const scenePath = `/@fs${path.join(repositoryRoot, "shared/scenes/spinner-to-ad.v2.json")}`;
  return page.evaluate(async ({ modulePath, sceneUrl }) => {
    const [{ LiquidCanvasPlayer, LiquidWebGLRenderer }] = await Promise.all([
      import(modulePath),
    ]);
    const scene = await fetch(sceneUrl).then((response) => response.json());

    const createCanvas = (): HTMLCanvasElement => {
      const canvas = document.createElement("canvas");
      canvas.style.width = `${scene.coordinateSpace.width}px`;
      canvas.style.height = `${scene.coordinateSpace.height}px`;
      document.body.append(canvas);
      return canvas;
    };
    const statsFor = (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing 2D context");
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let covered = 0;
      let alphaSum = 0;
      let signature = 0;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] ?? 0;
        if (alpha > 0) covered += 1;
        alphaSum += alpha;
        signature = (signature + alpha * (((index / 4) % 997) + 1)) % 1_000_000_007;
      }
      return { width: canvas.width, height: canvas.height, covered, alphaSum, signature };
    };
    const diffFor = (a: HTMLCanvasElement, b: HTMLCanvasElement) => {
      const aContext = a.getContext("2d");
      const bContext = b.getContext("2d");
      if (!aContext || !bContext) throw new Error("Missing comparison context");
      const aData = aContext.getImageData(0, 0, a.width, a.height).data;
      const bData = bContext.getImageData(0, 0, b.width, b.height).data;
      let alphaError = 0;
      let differingPixels = 0;
      for (let index = 0; index < aData.length; index += 4) {
        const delta = Math.abs((aData[index + 3] ?? 0) - (bData[index + 3] ?? 0));
        alphaError += delta;
        if (delta > 24) differingPixels += 1;
      }
      const pixels = aData.length / 4;
      return { meanAlphaError: alphaError / pixels, differingRatio: differingPixels / pixels };
    };
    const rectangleCommands = (minX: number, minY: number, maxX: number, maxY: number) => [
      { type: "M", values: [minX, minY] },
      { type: "L", values: [maxX, minY] },
      { type: "L", values: [maxX, maxY] },
      { type: "L", values: [minX, maxY] },
      { type: "Z" },
    ];
    const identityTransform = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 };
    const fieldMaterial = { groups: { $track: { targetMix: 0, cornerSharpness: 0 }, body: { blendRadius: 2 }, cutout: { blendRadius: 0 } } };
    const rangeScene = {
      schemaVersion: 2,
      id: "webgl-range-test",
      fixtureVersion: 1,
      durationMs: 1000,
      coordinateSpace: { width: 128, height: 96 },
      fillRule: "nonzero",
      tracks: [
        {
          id: "outer-subtract-track",
          source: { assetId: "test", shapeId: "range-a-source", transform: identityTransform, commands: rectangleCommands(14, 24, 50, 60) },
          target: { assetId: "test", shapeId: "range-a-target", transform: identityTransform, commands: rectangleCommands(14, 24, 50, 60) },
          timing: { start: 0, end: 1 },
          components: [
            { id: "outer", kind: "ellipse", operation: "union", groupId: "body" },
            { id: "counter", kind: "ellipse", operation: "subtract", groupId: "cutout" },
            { id: "bridge", kind: "ribbon", operation: "union", groupId: "body" },
          ],
          keyframes: [
            {
              at: 0,
              easing: "linear",
              components: [
                { id: "outer", primitive: { kind: "ellipse", center: { x: 32, y: 42 }, radiusX: 20, radiusY: 18 } },
                { id: "counter", primitive: { kind: "ellipse", center: { x: 32, y: 42 }, radiusX: 7, radiusY: 6 } },
                { id: "bridge", primitive: { kind: "ribbon", p0: { x: 44, y: 42 }, p1: { x: 52, y: 36 }, p2: { x: 60, y: 48 }, p3: { x: 68, y: 42 }, startRadius: 3, endRadius: 3 } },
              ],
              material: fieldMaterial,
            },
            {
              at: 1,
              easing: "linear",
              components: [
                { id: "outer", primitive: { kind: "ellipse", center: { x: 32, y: 42 }, radiusX: 20, radiusY: 18 } },
                { id: "counter", primitive: { kind: "ellipse", center: { x: 32, y: 42 }, radiusX: 7, radiusY: 6 } },
                { id: "bridge", primitive: { kind: "ribbon", p0: { x: 44, y: 42 }, p1: { x: 52, y: 36 }, p2: { x: 60, y: 48 }, p3: { x: 68, y: 42 }, startRadius: 3, endRadius: 3 } },
              ],
              material: fieldMaterial,
            },
          ],
        },
        {
          id: "capsule-pair-track",
          source: { assetId: "test", shapeId: "range-b-source", transform: identityTransform, commands: rectangleCommands(66, 20, 94, 70) },
          target: { assetId: "test", shapeId: "range-b-target", transform: identityTransform, commands: rectangleCommands(66, 20, 94, 70) },
          timing: { start: 0, end: 1 },
          components: [
            { id: "stem", kind: "capsule", operation: "union", groupId: "body" },
            { id: "bowl", kind: "ellipse", operation: "union", groupId: "body" },
          ],
          keyframes: [
            {
              at: 0,
              easing: "linear",
              components: [
                { id: "stem", primitive: { kind: "capsule", start: { x: 74, y: 24 }, end: { x: 74, y: 68 }, radius: 6 } },
                { id: "bowl", primitive: { kind: "ellipse", center: { x: 84, y: 48 }, radiusX: 16, radiusY: 18 } },
              ],
              material: fieldMaterial,
            },
            {
              at: 1,
              easing: "linear",
              components: [
                { id: "stem", primitive: { kind: "capsule", start: { x: 74, y: 24 }, end: { x: 74, y: 68 }, radius: 6 } },
                { id: "bowl", primitive: { kind: "ellipse", center: { x: 84, y: 48 }, radiusX: 16, radiusY: 18 } },
              ],
              material: fieldMaterial,
            },
          ],
        },
        {
          id: "tail-track",
          source: { assetId: "test", shapeId: "range-c-source", transform: identityTransform, commands: rectangleCommands(96, 56, 120, 82) },
          target: { assetId: "test", shapeId: "range-c-target", transform: identityTransform, commands: rectangleCommands(96, 56, 120, 82) },
          timing: { start: 0, end: 1 },
          components: [
            { id: "tail", kind: "capsule", operation: "union", groupId: "body" },
          ],
          keyframes: [
            {
              at: 0,
              easing: "linear",
              components: [
                { id: "tail", primitive: { kind: "capsule", start: { x: 104, y: 58 }, end: { x: 118, y: 80 }, radius: 5 } },
              ],
              material: fieldMaterial,
            },
            {
              at: 1,
              easing: "linear",
              components: [
                { id: "tail", primitive: { kind: "capsule", start: { x: 104, y: 58 }, end: { x: 118, y: 80 }, radius: 5 } },
              ],
              material: fieldMaterial,
            },
          ],
        },
      ],
      reducedMotion: { mode: "crossfade", durationMs: 120, fadeStart: 0.1, fadeEnd: 0.9 },
    };

    const capabilities = LiquidWebGLRenderer.detectCapabilities();
    const gpuCanvas = createCanvas();
    const cpuCanvas = createCanvas();
    const gpu = new LiquidCanvasPlayer(gpuCanvas, scene, {
      autoplay: false,
      backend: "auto",
      fillStyle: "#ffffff",
      logicalSize: scene.coordinateSpace,
      maxBackingDimension: 384,
      reducedMotion: false,
    });
    const cpu = new LiquidCanvasPlayer(cpuCanvas, scene, {
      autoplay: false,
      backend: "cpu",
      fillStyle: "#ffffff",
      logicalSize: scene.coordinateSpace,
      maxBackingDimension: 384,
      reducedMotion: false,
    });

    gpu.seek(0);
    cpu.seek(0);
    const source = statsFor(gpuCanvas);
    const sourceDiff = diffFor(gpuCanvas, cpuCanvas);

    gpu.seek(0.5);
    cpu.seek(0.5);
    const field = statsFor(gpuCanvas);
    const fieldDiff = diffFor(gpuCanvas, cpuCanvas);

    gpu.seek(1);
    cpu.seek(1);
    const target = statsFor(gpuCanvas);
    const targetDiff = diffFor(gpuCanvas, cpuCanvas);

    gpu.setReducedMotion(true);
    gpu.seek(0.5);
    const reduced = statsFor(gpuCanvas);

    gpu.setReducedMotion(false);
    gpu.resize({ width: 123, height: 117 });
    gpu.seek(0.5);
    const resized = { backing: gpu.backingSize, stats: statsFor(gpuCanvas), backend: gpu.chosenBackend };

    const rangedGpuCanvas = createCanvas();
    const rangedCpuCanvas = createCanvas();
    const rangedGpu = new LiquidCanvasPlayer(rangedGpuCanvas, rangeScene, {
      autoplay: false,
      backend: "auto",
      fillStyle: "#ffffff",
      logicalSize: rangeScene.coordinateSpace,
      maxBackingDimension: 160,
      reducedMotion: false,
    });
    const rangedCpu = new LiquidCanvasPlayer(rangedCpuCanvas, rangeScene, {
      autoplay: false,
      backend: "cpu",
      fillStyle: "#ffffff",
      logicalSize: rangeScene.coordinateSpace,
      maxBackingDimension: 160,
      reducedMotion: false,
    });
    rangedGpu.seek(0.5);
    rangedCpu.seek(0.5);
    const ranged = {
      gpu: statsFor(rangedGpuCanvas),
      cpu: statsFor(rangedCpuCanvas),
      diff: diffFor(rangedGpuCanvas, rangedCpuCanvas),
    };

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalOffscreenGetContext = typeof OffscreenCanvas === "function" ? OffscreenCanvas.prototype.getContext : null;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(this: HTMLCanvasElement, type: string, options?: unknown): RenderingContext | null {
      if (type === "webgl2") return null;
      return (originalGetContext as unknown as (this: HTMLCanvasElement, type: string, options?: unknown) => RenderingContext | null).call(this, type, options);
    } as typeof HTMLCanvasElement.prototype.getContext;
    if (originalOffscreenGetContext) {
      OffscreenCanvas.prototype.getContext = function patchedOffscreenGetContext(this: OffscreenCanvas, type: OffscreenRenderingContextId, options?: unknown): OffscreenRenderingContext | null {
        if (type === "webgl2") return null;
        return (originalOffscreenGetContext as unknown as (this: OffscreenCanvas, type: OffscreenRenderingContextId, options?: unknown) => OffscreenRenderingContext | null).call(this, type, options);
      } as typeof OffscreenCanvas.prototype.getContext;
    }
    let fallbackBackend = "";
    try {
      const fallback = new LiquidCanvasPlayer(createCanvas(), scene, {
        autoplay: false,
        backend: "auto",
        logicalSize: scene.coordinateSpace,
        maxBackingDimension: 384,
      });
      fallbackBackend = fallback.chosenBackend;
      fallback.destroy();
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      if (originalOffscreenGetContext) OffscreenCanvas.prototype.getContext = originalOffscreenGetContext;
    }

    gpu.destroy();
    cpu.destroy();
    rangedGpu.destroy();
    rangedCpu.destroy();
    gpuCanvas.remove();
    cpuCanvas.remove();
    rangedGpuCanvas.remove();
    rangedCpuCanvas.remove();
    return {
      capabilities,
      autoBackend: gpu.chosenBackend,
      source,
      field,
      target,
      reduced,
      sourceDiff,
      targetDiff,
      fieldDiff,
      ranged,
      resized,
      fallbackBackend,
    };
  }, { modulePath: webModulePath, sceneUrl: scenePath });
}

interface CanvasStats {
  readonly width: number;
  readonly height: number;
  readonly covered: number;
  readonly alphaSum: number;
  readonly signature: number;
}

interface SilhouetteDiff {
  readonly meanAlphaError: number;
  readonly differingRatio: number;
}

test("WebGL2 backend renders v2 fields with CPU-compatible silhouettes and clean fallback", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");

  const result = await loadGpuHarness(page);
  test.skip(!result.capabilities.supported, result.capabilities.reason ?? "WebGL2 unavailable in this browser");

  expect(result.autoBackend).toBe("webgl2");
  expect(result.source.covered).toBeGreaterThan(0);
  expect(result.field.covered).toBeGreaterThan(0);
  expect(result.target.covered).toBeGreaterThan(0);
  expect(result.reduced.covered).toBeGreaterThan(0);
  expect(result.sourceDiff.meanAlphaError).toBeLessThanOrEqual(0.01);
  expect(result.targetDiff.meanAlphaError).toBeLessThanOrEqual(0.01);
  expect(result.fieldDiff.meanAlphaError).toBeLessThanOrEqual(18);
  expect(result.fieldDiff.differingRatio).toBeLessThanOrEqual(0.12);
  expect(result.ranged.gpu.covered).toBeGreaterThan(0);
  expect(result.ranged.cpu.covered).toBeGreaterThan(0);
  expect(result.ranged.diff.meanAlphaError).toBeLessThanOrEqual(14);
  expect(result.ranged.diff.differingRatio).toBeLessThanOrEqual(0.08);
  expect(Math.max(result.resized.backing.width, result.resized.backing.height)).toBeLessThanOrEqual(384);
  expect(result.resized.backend).toBe("webgl2");
  expect(result.resized.stats.covered).toBeGreaterThan(0);
  expect(result.fallbackBackend).toBe("cpu");
  expect(errors).toEqual([]);
});
