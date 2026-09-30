import type { EasingName } from "./types.js";

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value < 0 ? 0 : 1;
  return Math.min(1, Math.max(0, value));
}

export function ease(name: EasingName, x: number): number {
  const t = clamp01(x);
  switch (name) {
    case "linear":
      return t;
    case "smoothStep":
      return t * t * (3 - 2 * t);
    case "smootherStep":
      return t * t * t * (t * (6 * t - 15) + 10);
    case "easeInCubic":
      return t * t * t;
    case "easeOutCubic": {
      const inverse = 1 - t;
      return 1 - inverse * inverse * inverse;
    }
  }
}
