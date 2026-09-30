import type { LiquidSceneV2 } from "@liquid/core";
import { addyLogoWaveSceneURL, addyLogoWaveWordmarkSceneURL, spinnerToAddySceneURL } from "@liquid/scenes";
import { LiquidCanvasPlayer, LiquidWebGLRenderer, type ReducedMotionSetting } from "@liquid/web";

/** Size of the Addy logo artwork (pill, ticks, and wordmark) in scene units. */
export const ADDY_LOGO_WIDTH = 2973;
export const ADDY_LOGO_HEIGHT = 1568;
export const ADDY_LOGO_ASPECT_RATIO = ADDY_LOGO_WIDTH / ADDY_LOGO_HEIGHT;

/**
 * When playback starts: once the logo is scrolled into view, immediately after
 * the scene loads, or only when `play()` is called.
 */
export type AddyLogoAutoplay = "visible" | "immediate" | "none";

/**
 * Which animation plays after the ticks drop into the pill: `"wordmark"` flows
 * into the Addy wordmark and holds; `"wave"` runs Addy's pill wave, looping
 * until paused; `"wave-wordmark"` waves three times and then flows into the wordmark.
 */
export type AddyLogoVariant = "wordmark" | "wave" | "wave-wordmark";

const variantSceneURLs: Readonly<Record<AddyLogoVariant, URL>> = {
  wordmark: spinnerToAddySceneURL,
  wave: addyLogoWaveSceneURL,
  "wave-wordmark": addyLogoWaveWordmarkSceneURL,
};

export interface AddyLogoOptions {
  /** Defaults to `"wordmark"`. */
  readonly variant?: AddyLogoVariant;
  /** Any CSS color. Defaults to the container's computed `color`, like `currentColor`. */
  readonly color?: string;
  /** Defaults to `"visible"`. */
  readonly autoplay?: AddyLogoAutoplay;
  /**
   * Loop playback. The wave variant loops its wave after the drop-in and
   * defaults to `true`; the wordmark variant defaults to `false`.
   */
  readonly loop?: boolean;
  /** Defaults to `"system"`, which follows `prefers-reduced-motion` (a short fade in). */
  readonly reducedMotion?: ReducedMotionSetting;
  /** Accessible name for the logo. Defaults to `"Addy"`. */
  readonly label?: string;
  /** Fraction of the logo that must be visible before `"visible"` autoplay starts. Defaults to `0.5`. */
  readonly visibilityThreshold?: number;
  /** A preloaded scene. By default the bundled scene is fetched once and shared. */
  readonly scene?: LiquidSceneV2;
  /** Where to fetch the scene from when `scene` is not given. */
  readonly sceneURL?: string | URL;
  /** Called each time a non-looping play reaches its end (the wordmark). */
  readonly onComplete?: () => void;
}

export interface AddyLogoHandle {
  readonly canvas: HTMLCanvasElement;
  /** Resolves once the scene is loaded and the first frame is drawn. */
  readonly ready: Promise<LiquidCanvasPlayer>;
  play(): void;
  pause(): void;
  /** Plays again from the empty pill. */
  replay(): void;
  seek(progress: number): void;
  /** Updates the fill color; with no argument, re-reads the container's computed `color`. */
  setColor(color?: string): void;
  destroy(): void;
}

// WebGL renders the field on the GPU, so it can afford a sharp backing store;
// the CPU fallback rasterizes every pixel and is capped lower to stay smooth.
const WEBGL_MAX_BACKING_DIMENSION = 2048;
const CPU_MAX_BACKING_DIMENSION = 640;

const sceneCache = new Map<string, Promise<LiquidSceneV2>>();

function loadScene(url: string | URL): Promise<LiquidSceneV2> {
  const key = String(url);
  let scene = sceneCache.get(key);
  if (!scene) {
    scene = fetch(key).then((response) => {
      if (!response.ok) throw new Error(`Failed to load the Addy logo scene (${response.status})`);
      return response.json() as Promise<LiquidSceneV2>;
    });
    scene.catch(() => sceneCache.delete(key));
    sceneCache.set(key, scene);
  }
  return scene;
}

/**
 * Renders the animated Addy logo into `container`, which should be sized by its
 * width; the canvas keeps the artwork's aspect ratio. Any existing children are
 * treated as a static fallback (for example the logo SVG) and hidden once the
 * first frame is drawn.
 */
export function mountAddyLogo(container: HTMLElement, options: AddyLogoOptions = {}): AddyLogoHandle {
  const document = container.ownerDocument;
  const view = document.defaultView ?? globalThis;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", options.label ?? "Addy");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.aspectRatio = `${ADDY_LOGO_WIDTH} / ${ADDY_LOGO_HEIGHT}`;
  canvas.hidden = true;
  const fallback = [...container.children].filter((child): child is HTMLElement => child instanceof view.HTMLElement && !child.hidden);
  container.append(canvas);

  let player: LiquidCanvasPlayer | null = null;
  let destroyed = false;
  let explicitColor = options.color;
  let intersection: IntersectionObserver | null = null;
  let completionFrame: number | null = null;
  let pendingPlay = false;
  const colorScheme = view.matchMedia?.("(prefers-color-scheme: dark)") ?? null;

  const resolveColor = () => explicitColor ?? (view.getComputedStyle(container).color || "black");
  const onColorSchemeChange = () => {
    if (!explicitColor) player?.setFillStyle(resolveColor());
  };

  const variant = options.variant ?? "wordmark";
  const loop = options.loop ?? variant === "wave";

  const watchCompletion = () => {
    if (loop || !options.onComplete || completionFrame !== null) return;
    const check = () => {
      completionFrame = null;
      if (!player || destroyed) return;
      if (player.isPlaying) {
        completionFrame = view.requestAnimationFrame(check);
      } else if (player.progress >= 1) {
        options.onComplete?.();
      }
    };
    completionFrame = view.requestAnimationFrame(check);
  };

  const startPlayback = () => {
    if (!player) {
      pendingPlay = true;
      return;
    }
    player.play();
    watchCompletion();
  };

  const defaultSceneURL = variantSceneURLs[variant];
  const ready = (options.scene ? Promise.resolve(options.scene) : loadScene(options.sceneURL ?? defaultSceneURL)).then((scene) => {
    if (destroyed) throw new Error("The Addy logo was destroyed before it finished loading");
    const webgl = LiquidWebGLRenderer.detectCapabilities(canvas).supported;
    canvas.hidden = false;
    player = new LiquidCanvasPlayer(canvas, scene, {
      autoplay: false,
      loop,
      backend: "auto",
      fillStyle: resolveColor(),
      reducedMotion: options.reducedMotion ?? "system",
      maxBackingScale: 2,
      maxBackingDimension: webgl ? WEBGL_MAX_BACKING_DIMENSION : CPU_MAX_BACKING_DIMENSION,
      observeResize: true,
    });
    for (const element of fallback) element.hidden = true;
    colorScheme?.addEventListener?.("change", onColorSchemeChange);

    const autoplay = options.autoplay ?? "visible";
    if (pendingPlay || autoplay === "immediate") {
      startPlayback();
    } else if (autoplay === "visible") {
      if (typeof view.IntersectionObserver === "function") {
        intersection = new view.IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          intersection?.disconnect();
          intersection = null;
          startPlayback();
        }, { threshold: options.visibilityThreshold ?? 0.5 });
        intersection.observe(canvas);
      } else {
        startPlayback();
      }
    }
    return player;
  });
  ready.catch(() => {
    canvas.hidden = true;
  });

  return {
    canvas,
    ready,
    play: startPlayback,
    pause() {
      pendingPlay = false;
      player?.pause();
    },
    replay() {
      if (!player) {
        pendingPlay = true;
        return;
      }
      player.restart();
      watchCompletion();
    },
    seek(progress) {
      player?.seek(progress);
    },
    setColor(color) {
      explicitColor = color;
      player?.setFillStyle(resolveColor());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      intersection?.disconnect();
      if (completionFrame !== null) view.cancelAnimationFrame(completionFrame);
      colorScheme?.removeEventListener?.("change", onColorSchemeChange);
      player?.destroy();
      canvas.remove();
      for (const element of fallback) element.hidden = false;
    },
  };
}

const booleanAttribute = (element: Element, name: string) => element.hasAttribute(name) && element.getAttribute(name) !== "false";

/**
 * Registers `<addy-logo>` (or `tagName`). Attributes: `variant` (`wordmark` |
 * `wave` | `wave-wordmark`), `color`, `autoplay` (`visible` | `immediate` | `none`), `loop`
 * (the wave loops unless `loop="false"`), and `label`. Children are shown
 * as a fallback until the animation is ready. The element fires a `complete`
 * event when a non-looping play reaches the wordmark and exposes `play()`,
 * `pause()`, and `replay()`. Safe to call more than once and during SSR.
 */
export function defineAddyLogoElement(tagName = "addy-logo"): void {
  if (typeof customElements === "undefined" || customElements.get(tagName)) return;

  class AddyLogoElement extends HTMLElement {
    static readonly observedAttributes = ["color"];
    #handle: AddyLogoHandle | null = null;

    connectedCallback(): void {
      if (this.#handle) return;
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>:host{display:block;aspect-ratio:${ADDY_LOGO_WIDTH}/${ADDY_LOGO_HEIGHT}}:host([hidden]){display:none}.stage{width:100%;height:100%}</style><div class="stage" part="stage"><slot></slot></div>`;
      // mountAddyLogo treats the slot (and so the element's children) as the fallback.
      const stage = root.querySelector<HTMLElement>(".stage")!;
      const autoplay = this.getAttribute("autoplay");
      const color = this.getAttribute("color");
      const label = this.getAttribute("label");
      const requestedVariant = this.getAttribute("variant");
      const variant: AddyLogoVariant = requestedVariant === "wave" || requestedVariant === "wave-wordmark" ? requestedVariant : "wordmark";
      this.#handle = mountAddyLogo(stage, {
        variant,
        autoplay: autoplay === "immediate" || autoplay === "none" ? autoplay : "visible",
        ...(this.hasAttribute("loop") ? { loop: booleanAttribute(this, "loop") } : {}),
        ...(color ? { color } : {}),
        ...(label ? { label } : {}),
        onComplete: () => this.dispatchEvent(new Event("complete")),
      });
    }

    disconnectedCallback(): void {
      this.#handle?.destroy();
      this.#handle = null;
      if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    }

    attributeChangedCallback(name: string, _previous: string | null, next: string | null): void {
      if (name === "color") this.#handle?.setColor(next ?? undefined);
    }

    play(): void {
      this.#handle?.play();
    }

    pause(): void {
      this.#handle?.pause();
    }

    replay(): void {
      this.#handle?.replay();
    }
  }

  customElements.define(tagName, AddyLogoElement);
}
