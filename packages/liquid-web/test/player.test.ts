import { beforeAll, describe, expect, test, vi } from "vitest";
import type { LiquidScene, LiquidSceneV2 } from "@liquid/core";
import sceneData from "../../../shared/scenes/capsule-to-a.v1.json" with { type: "json" };
import sceneV2Data from "../../../shared/scenes/spinner-to-ad.v2.json" with { type: "json" };
import waveSceneData from "../../../shared/scenes/addy-logo-wave.v2.json" with { type: "json" };
import { LiquidCanvasPlayer, logicalSizeToBackingSize } from "../src/index.js";

const scene = sceneData as LiquidScene;
const sceneV2 = sceneV2Data as LiquidSceneV2;
const waveScene = waveSceneData as unknown as LiquidSceneV2;

beforeAll(() => {
  vi.stubGlobal("Path2D", class {
    bezierCurveTo(): void {}
    closePath(): void {}
    lineTo(): void {}
    moveTo(): void {}
  });
});

class TestCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "black";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  lineWidth = 1;
  strokeStyle: string | CanvasGradient | CanvasPattern = "black";

  arc(): void {}
  beginPath(): void {}
  clearRect(): void {}
  clip(): void {}
  closePath(): void {}
  fill(): void {}
  fillRect(): void {}
  lineTo(): void {}
  moveTo(): void {}
  restore(): void {}
  save(): void {}
  scale(): void {}
  stroke(): void {}
  strokeRect(): void {}
  translate(): void {}

  createImageData(width: number, height: number): ImageData {
    return {
      width,
      height,
      colorSpace: "srgb",
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(): void {}
}

function testCanvas(logicalWidth: number, logicalHeight: number): HTMLCanvasElement {
  const context = new TestCanvasContext();
  return {
    width: logicalWidth,
    height: logicalHeight,
    clientWidth: logicalWidth,
    clientHeight: logicalHeight,
    getBoundingClientRect: () => ({ width: logicalWidth, height: logicalHeight }),
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
}

function invokeFrame(callback: FrameRequestCallback | null, timestamp: number): void {
  if (!callback) throw new Error("Expected a scheduled animation frame");
  callback(timestamp);
}

function invokeResize(callback: ResizeObserverCallback | null): void {
  if (!callback) throw new Error("Expected a resize callback");
  callback([], {} as ResizeObserver);
}

class TestDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

class TestMediaQuery extends EventTarget {
  matches: boolean;
  media = "(prefers-reduced-motion: reduce)";
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  addListener(listener: (event: MediaQueryListEvent) => void): void {
    this.addEventListener("change", listener as EventListener);
  }

  removeListener(listener: (event: MediaQueryListEvent) => void): void {
    this.removeEventListener("change", listener as EventListener);
  }

  dispatch(matches: boolean): void {
    this.matches = matches;
    const event = new Event("change") as MediaQueryListEvent;
    Object.defineProperty(event, "matches", { value: matches });
    this.dispatchEvent(event);
  }
}

describe("LiquidCanvasPlayer", () => {
  test("computes backing sizes with DPR and maximum dimension caps", () => {
    expect(logicalSizeToBackingSize({ width: 200, height: 100 }, { devicePixelRatio: 3, maxBackingScale: 2 })).toEqual({
      width: 400,
      height: 200,
      scale: 2,
    });
    expect(logicalSizeToBackingSize({ width: 200, height: 100 }, { devicePixelRatio: 2, maxBackingDimension: 150 })).toEqual({
      width: 150,
      height: 75,
      scale: 0.75,
    });
  });

  test("drives deterministic progress from frame timestamps", () => {
    let now = 100;
    let nextFrame: FrameRequestCallback | null = null;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 7;
    });
    const cancelAnimationFrame = vi.fn();
    const player = new LiquidCanvasPlayer(testCanvas(160, 152), scene, {
      autoplay: false,
      initialProgress: 0.25,
      maxBackingDimension: 160,
      now: () => now,
      requestAnimationFrame,
      cancelAnimationFrame,
    });

    player.play();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    invokeFrame(nextFrame, now + scene.durationMs * 0.25);
    expect(player.progress).toBeCloseTo(0.5);

    now += 50;
    player.pause();
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
  });

  test("plays reduced motion over the scene's reduced-motion duration", () => {
    let now = 100;
    let nextFrame: FrameRequestCallback | null = null;
    const player = new LiquidCanvasPlayer(testCanvas(160, 152), scene, {
      autoplay: false,
      loop: false,
      reducedMotion: true,
      maxBackingDimension: 160,
      now: () => now,
      requestAnimationFrame: (callback) => {
        nextFrame = callback;
        return 7;
      },
      cancelAnimationFrame: () => undefined,
    });

    expect(player.durationMs).toBe(scene.reducedMotion.durationMs);
    player.play();
    invokeFrame(nextFrame, now + scene.reducedMotion.durationMs / 2);
    expect(player.progress).toBeCloseTo(0.5);

    now += scene.reducedMotion.durationMs / 2;
    player.setReducedMotion(false);
    expect(player.durationMs).toBe(scene.durationMs);
    invokeFrame(nextFrame, now + scene.durationMs * 0.25);
    expect(player.progress).toBeCloseTo(0.75);
  });

  test("loops scenes with a loop region back to its start, and holds under reduced motion", () => {
    const loopStart = waveScene.loop!.start;
    for (const reducedMotion of [false, true]) {
      let now = 100;
      let nextFrame: FrameRequestCallback | null = null;
      const player = new LiquidCanvasPlayer(testCanvas(160, 84), waveScene, {
        autoplay: false,
        loop: true,
        backend: "cpu",
        reducedMotion,
        maxBackingDimension: 16,
        now: () => now,
        requestAnimationFrame: (callback) => {
          nextFrame = callback;
          return 7;
        },
        cancelAnimationFrame: () => undefined,
      });
      player.play();
      invokeFrame(nextFrame, now + player.durationMs * 1.25);
      if (reducedMotion) {
        expect(player.progress).toBe(1);
        expect(player.isPlaying).toBe(false);
      } else {
        expect(player.progress).toBeCloseTo(loopStart + 0.25, 6);
        expect(player.isPlaying).toBe(true);
      }
      player.destroy();
    }
  });

  test("selects CPU for v1 and falls back cleanly when WebGL2 is unavailable for v2", () => {
    const v1Player = new LiquidCanvasPlayer(testCanvas(160, 152), scene, {
      autoplay: false,
      maxBackingDimension: 160,
    });
    expect(v1Player.requestedBackend).toBe("auto");
    expect(v1Player.chosenBackend).toBe("cpu");
    expect(v1Player.capabilities).toBeNull();

    const v2Player = new LiquidCanvasPlayer(testCanvas(160, 152), sceneV2, {
      autoplay: false,
      backend: "auto",
      maxBackingDimension: 160,
    });
    expect(v2Player.requestedBackend).toBe("auto");
    expect(v2Player.chosenBackend).toBe("cpu");
    expect(v2Player.capabilities?.supported).toBe(false);

    v1Player.destroy();
    v2Player.destroy();
  });

  test("pauses for hidden documents and resumes without jumping progress", () => {
    let now = 200;
    let nextFrame: FrameRequestCallback | null = null;
    const document = new TestDocument();
    const player = new LiquidCanvasPlayer(testCanvas(160, 152), scene, {
      autoplay: false,
      initialProgress: 0.4,
      document: document as unknown as Document,
      maxBackingDimension: 160,
      now: () => now,
      requestAnimationFrame: (callback) => {
        nextFrame = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });

    player.play();
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(player.isPlaying).toBe(false);
    expect(player.progress).toBeCloseTo(0.4);

    now = 900;
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(player.isPlaying).toBe(true);
    invokeFrame(nextFrame, now);
    expect(player.progress).toBeCloseTo(0.4);
  });

  test("observes resize, applies reduced-motion preference, and cleans up lifecycle hooks", () => {
    const observedCanvases: Element[] = [];
    const disconnect = vi.fn();
    let resizeCallback: ResizeObserverCallback | null = null;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe(target: Element): void {
        observedCanvases.push(target);
      }

      unobserve(): void {}

      disconnect(): void {
        disconnect();
      }
    }

    const mediaQuery = new TestMediaQuery(false);
    const canvas = testCanvas(220, 110);
    const player = new LiquidCanvasPlayer(canvas, scene, {
      autoplay: false,
      initialProgress: 0.5,
      maxBackingDimension: 110,
      matchMedia: () => mediaQuery as unknown as MediaQueryList,
      ResizeObserver: TestResizeObserver as unknown as typeof ResizeObserver,
    });

    expect(observedCanvases).toEqual([canvas]);
    expect(player.backingSize).toEqual({ width: 110, height: 55, scale: 0.5 });
    expect(player.reducedMotionEnabled).toBe(false);

    mediaQuery.dispatch(true);
    expect(player.reducedMotionEnabled).toBe(true);
    invokeResize(resizeCallback);
    expect(canvas.width).toBe(110);

    player.destroy();
    expect(player.isDestroyed).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
