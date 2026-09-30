import { evaluateFrame, type AnyLiquidScene } from "@liquid/core";
import { LiquidCanvasRenderer, type CanvasRenderOptions } from "./renderer.js";
import { LiquidWebGLRenderer, type LiquidRendererBackend, type LiquidRendererBackendPreference, type LiquidWebGLCapabilities } from "./webgl-renderer.js";

export interface LogicalSize {
  readonly width: number;
  readonly height: number;
}

export interface BackingSize extends LogicalSize {
  readonly scale: number;
}

export interface BackingSizeOptions {
  readonly backingScale?: number;
  readonly devicePixelRatio?: number;
  readonly maxBackingScale?: number;
  readonly maxBackingDimension?: number;
}

export type ReducedMotionSetting = boolean | "system";

export interface LiquidCanvasPlayerOptions extends Omit<CanvasRenderOptions, "width" | "height"> {
  readonly autoplay?: boolean;
  readonly backend?: LiquidRendererBackendPreference;
  readonly loop?: boolean;
  readonly initialProgress?: number;
  readonly reducedMotion?: ReducedMotionSetting;
  readonly backingScale?: number;
  readonly maxBackingScale?: number;
  readonly maxBackingDimension?: number;
  readonly observeResize?: boolean;
  readonly logicalSize?: LogicalSize;
  readonly now?: () => number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly document?: Document;
  readonly matchMedia?: (query: string) => MediaQueryList;
  readonly ResizeObserver?: typeof ResizeObserver;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function logicalSizeToBackingSize(logicalSize: LogicalSize, options: BackingSizeOptions = {}): BackingSize {
  const logicalWidth = finitePositive(logicalSize.width, 1);
  const logicalHeight = finitePositive(logicalSize.height, 1);
  const requestedScale = options.backingScale ?? Math.min(
    finitePositive(options.devicePixelRatio, 1),
    finitePositive(options.maxBackingScale, 2),
  );
  const dimensionCap = options.maxBackingDimension;
  const cappedScale = dimensionCap !== undefined && Number.isFinite(dimensionCap) && dimensionCap > 0
    ? Math.min(requestedScale, dimensionCap / Math.max(logicalWidth, logicalHeight))
    : requestedScale;
  const scale = finitePositive(cappedScale, 1);
  return {
    width: Math.max(1, Math.floor(logicalWidth * scale)),
    height: Math.max(1, Math.floor(logicalHeight * scale)),
    scale,
  };
}

export class LiquidCanvasPlayer {
  readonly canvas: HTMLCanvasElement;
  readonly scene: AnyLiquidScene;
  readonly renderer: LiquidCanvasRenderer;
  readonly requestedBackend: LiquidRendererBackendPreference;
  readonly chosenBackend: LiquidRendererBackend;
  readonly capabilities: LiquidWebGLCapabilities | null;

  #progress: number;
  #isPlaying = false;
  #isDestroyed = false;
  #loop: boolean;
  #reducedMotion: ReducedMotionSetting;
  #renderOptions: Omit<CanvasRenderOptions, "width" | "height">;
  #backingScale: number | undefined;
  #maxBackingScale: number;
  #maxBackingDimension: number;
  #logicalSize: LogicalSize | undefined;
  #backingSize: BackingSize;
  #startedAt = 0;
  #rafHandle: number | null = null;
  #wasPlayingBeforeHidden = false;
  #resizeObserver: ResizeObserver | null = null;
  #mediaQuery: MediaQueryList | null = null;
  #systemPrefersReducedMotion = false;

  readonly #now: () => number;
  readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly #cancelAnimationFrame: (handle: number) => void;
  readonly #document: Document | null;

  constructor(canvas: HTMLCanvasElement, scene: AnyLiquidScene, options: LiquidCanvasPlayerOptions = {}) {
    this.canvas = canvas;
    this.scene = scene;
    this.requestedBackend = options.backend ?? "auto";
    const rendererSelection = selectRenderer(canvas, scene, this.requestedBackend);
    this.renderer = rendererSelection.renderer;
    this.chosenBackend = rendererSelection.backend;
    this.capabilities = rendererSelection.capabilities;
    this.#progress = clamp01(options.initialProgress ?? 0);
    this.#loop = options.loop ?? true;
    this.#reducedMotion = options.reducedMotion ?? "system";
    this.#renderOptions = renderOptionsFrom(options);
    this.#backingScale = options.backingScale;
    this.#maxBackingScale = finitePositive(options.maxBackingScale, 2);
    this.#maxBackingDimension = finitePositive(options.maxBackingDimension, 384);
    this.#logicalSize = options.logicalSize;
    this.#backingSize = { width: Math.max(1, canvas.width || 1), height: Math.max(1, canvas.height || 1), scale: 1 };

    const globalScope = globalThis as typeof globalThis & {
      requestAnimationFrame?: (callback: FrameRequestCallback) => number;
      cancelAnimationFrame?: (handle: number) => void;
      matchMedia?: (query: string) => MediaQueryList;
      ResizeObserver?: typeof ResizeObserver;
    };
    this.#now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
    this.#requestAnimationFrame = options.requestAnimationFrame ?? globalScope.requestAnimationFrame?.bind(globalScope) ?? fallbackRequestAnimationFrame;
    this.#cancelAnimationFrame = options.cancelAnimationFrame ?? globalScope.cancelAnimationFrame?.bind(globalScope) ?? fallbackCancelAnimationFrame;
    this.#document = options.document ?? globalThis.document ?? null;

    const matchMedia = options.matchMedia ?? globalScope.matchMedia?.bind(globalScope);
    if (matchMedia) {
      this.#mediaQuery = matchMedia(reducedMotionQuery);
      this.#systemPrefersReducedMotion = this.#mediaQuery.matches;
      addMediaListener(this.#mediaQuery, this.#handleReducedMotionChange);
    }

    if (this.#document) {
      this.#document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    }

    const ResizeObserverConstructor = options.ResizeObserver ?? globalScope.ResizeObserver;
    if (options.observeResize !== false && ResizeObserverConstructor) {
      this.#resizeObserver = new ResizeObserverConstructor(this.#handleResize);
      this.#resizeObserver.observe(canvas);
    }

    this.resize(this.#logicalSize);
    this.#primeRenderer();
    this.render();
    if (options.autoplay ?? true) this.play();
  }

  get progress(): number {
    return this.#progress;
  }

  get isPlaying(): boolean {
    return this.#isPlaying;
  }

  get isDestroyed(): boolean {
    return this.#isDestroyed;
  }

  get backingSize(): BackingSize {
    return this.#backingSize;
  }

  /** Playback length: the scene's reduced-motion duration while reduced motion is on. */
  get durationMs(): number {
    return this.reducedMotionEnabled ? this.scene.reducedMotion.durationMs : this.scene.durationMs;
  }

  get reducedMotionEnabled(): boolean {
    return this.#reducedMotion === "system" ? this.#systemPrefersReducedMotion : this.#reducedMotion;
  }

  play(): void {
    if (this.#isDestroyed || this.#isPlaying) return;
    this.#isPlaying = true;
    this.#startedAt = this.#now() - this.#progress * this.durationMs;
    this.#scheduleFrame();
  }

  pause(): void {
    if (!this.#isPlaying) return;
    this.#isPlaying = false;
    this.#cancelFrame();
  }

  seek(progress: number): void {
    if (this.#isDestroyed) return;
    this.#progress = clamp01(progress);
    if (this.#isPlaying) this.#startedAt = this.#now() - this.#progress * this.durationMs;
    this.render();
  }

  restart(): void {
    if (this.#isDestroyed) return;
    this.#progress = 0;
    this.#startedAt = this.#now();
    this.render();
    if (!this.#isPlaying) this.play();
  }

  resize(logicalSize?: LogicalSize): BackingSize {
    if (logicalSize !== undefined) this.#logicalSize = logicalSize;
    const measured = this.#logicalSize ?? measureCanvas(this.canvas);
    const baseBackingOptions = {
      devicePixelRatio: globalThis.devicePixelRatio,
      maxBackingScale: this.#maxBackingScale,
      maxBackingDimension: this.#maxBackingDimension,
    };
    const backingOptions: BackingSizeOptions = this.#backingScale === undefined
      ? baseBackingOptions
      : { ...baseBackingOptions, backingScale: this.#backingScale };
    const backingSize = logicalSizeToBackingSize(measured, backingOptions);
    this.#backingSize = backingSize;
    if (this.canvas.width !== backingSize.width) this.canvas.width = backingSize.width;
    if (this.canvas.height !== backingSize.height) this.canvas.height = backingSize.height;
    return backingSize;
  }

  setReducedMotion(setting: ReducedMotionSetting): void {
    if (this.#isDestroyed) return;
    this.#reducedMotion = setting;
    if (this.#isPlaying) this.#startedAt = this.#now() - this.#progress * this.durationMs;
    this.render();
  }

  setFillStyle(fillStyle: string): void {
    if (this.#isDestroyed) return;
    this.#renderOptions = { ...this.#renderOptions, fillStyle };
    this.render();
  }

  render(): void {
    if (this.#isDestroyed) return;
    if (this.scene.schemaVersion === 1) {
      this.renderer.render(this.scene, evaluateFrame(this.scene, this.#progress, { reducedMotion: this.reducedMotionEnabled }), this.#renderOptions);
    } else {
      this.renderer.render(this.scene, evaluateFrame(this.scene, this.#progress, { reducedMotion: this.reducedMotionEnabled }), this.#renderOptions);
    }
  }

  destroy(): void {
    if (this.#isDestroyed) return;
    this.pause();
    this.#isDestroyed = true;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    if (this.#document) this.#document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    if (this.#mediaQuery) removeMediaListener(this.#mediaQuery, this.#handleReducedMotionChange);
    this.#mediaQuery = null;
    this.renderer.destroy();
  }

  // GPU drivers defer pipeline and texture setup to the first real draw, which
  // would otherwise land on the first moving frame. Draw one mid-scene frame
  // up front; the caller renders the real frame in the same task, so it never paints.
  #primeRenderer(): void {
    if (this.chosenBackend !== "webgl2" || this.scene.schemaVersion !== 2) return;
    this.renderer.render(this.scene, evaluateFrame(this.scene, 0.5), this.#renderOptions);
    (this.renderer as LiquidWebGLRenderer).flush();
  }

  readonly #tick = (timestamp: number): void => {
    if (!this.#isPlaying || this.#isDestroyed) return;
    const elapsed = Math.max(0, timestamp - this.#startedAt);
    const loopStart = this.#loopStart();
    if (loopStart !== null) {
      const duration = this.durationMs;
      this.#progress = elapsed < duration
        ? elapsed / duration
        : loopStart + ((elapsed - duration) % ((1 - loopStart) * duration)) / duration;
    } else {
      this.#progress = clamp01(elapsed / this.durationMs);
      if (this.#progress >= 1) this.#isPlaying = false;
    }
    this.render();
    if (this.#isPlaying) this.#scheduleFrame();
  };

  // Where looping playback wraps to, or null when playback should not loop.
  // Scenes with a loop region replay it after their intro; reduced motion holds.
  #loopStart(): number | null {
    if (!this.#loop) return null;
    if (this.scene.schemaVersion !== 2 || !this.scene.loop) return 0;
    return this.reducedMotionEnabled ? null : this.scene.loop.start;
  }

  readonly #handleResize = (): void => {
    if (this.#isDestroyed) return;
    this.resize();
    this.render();
  };

  readonly #handleVisibilityChange = (): void => {
    if (!this.#document || this.#isDestroyed) return;
    if (this.#document.visibilityState === "hidden") {
      this.#wasPlayingBeforeHidden = this.#isPlaying;
      this.pause();
    } else if (this.#wasPlayingBeforeHidden) {
      this.#wasPlayingBeforeHidden = false;
      this.play();
    }
  };

  readonly #handleReducedMotionChange = (event: MediaQueryListEvent): void => {
    this.#systemPrefersReducedMotion = event.matches;
    if (this.#reducedMotion !== "system") return;
    if (this.#isPlaying) this.#startedAt = this.#now() - this.#progress * this.durationMs;
    this.render();
  };

  #scheduleFrame(): void {
    if (this.#rafHandle !== null) return;
    this.#rafHandle = this.#requestAnimationFrame((timestamp) => {
      this.#rafHandle = null;
      this.#tick(timestamp);
    });
  }

  #cancelFrame(): void {
    if (this.#rafHandle === null) return;
    this.#cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
  }
}

function renderOptionsFrom(options: LiquidCanvasPlayerOptions): Omit<CanvasRenderOptions, "width" | "height"> {
  const { debug, fillStyle, opacity, sourceStyle, targetStyle } = options;
  return {
    ...(debug !== undefined ? { debug } : {}),
    ...(fillStyle !== undefined ? { fillStyle } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(sourceStyle !== undefined ? { sourceStyle } : {}),
    ...(targetStyle !== undefined ? { targetStyle } : {}),
  };
}

function selectRenderer(
  canvas: HTMLCanvasElement,
  scene: AnyLiquidScene,
  requested: LiquidRendererBackendPreference,
): { renderer: LiquidCanvasRenderer; backend: LiquidRendererBackend; capabilities: LiquidWebGLCapabilities | null } {
  if (requested === "cpu" || scene.schemaVersion !== 2) {
    return { renderer: new LiquidCanvasRenderer(canvas), backend: "cpu", capabilities: null };
  }

  const capabilities = LiquidWebGLRenderer.detectCapabilities(canvas);
  if (!capabilities.supported || !LiquidWebGLRenderer.supportsScene(scene)) {
    return { renderer: new LiquidCanvasRenderer(canvas), backend: "cpu", capabilities };
  }

  const renderer = new LiquidWebGLRenderer(canvas);
  if (!renderer.capabilities.supported) {
    renderer.destroy();
    return { renderer: new LiquidCanvasRenderer(canvas), backend: "cpu", capabilities: renderer.capabilities };
  }
  return { renderer, backend: "webgl2", capabilities: renderer.capabilities };
}

function measureCanvas(canvas: HTMLCanvasElement): LogicalSize {
  const rect = canvas.getBoundingClientRect?.();
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const width = canvas.clientWidth || canvas.width || 1;
  const height = canvas.clientHeight || canvas.height || 1;
  return { width, height };
}

function fallbackRequestAnimationFrame(callback: FrameRequestCallback): number {
  return Number(setTimeout(() => callback(globalThis.performance?.now() ?? Date.now()), 16));
}

function fallbackCancelAnimationFrame(handle: number): void {
  clearTimeout(handle);
}

function addMediaListener(query: MediaQueryList, listener: (event: MediaQueryListEvent) => void): void {
  if (query.addEventListener) query.addEventListener("change", listener);
  else query.addListener(listener);
}

function removeMediaListener(query: MediaQueryList, listener: (event: MediaQueryListEvent) => void): void {
  if (query.removeEventListener) query.removeEventListener("change", listener);
  else query.removeListener(listener);
}
