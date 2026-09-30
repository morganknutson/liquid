import type { LiquidSceneV2 } from "@liquid/core";
import { spinnerToAdSceneURL } from "@liquid/scenes";
import { LiquidCanvasPlayer } from "@liquid/web";

const canvas = document.querySelector<HTMLCanvasElement>("#example");
if (!canvas) throw new Error("Missing example canvas");

const scene = await fetch(spinnerToAdSceneURL).then((response) => response.json()) as LiquidSceneV2;
const reducedMotionToggle = document.querySelector<HTMLInputElement>("#reduced-motion");
const backendOutput = document.querySelector<HTMLOutputElement>("#backend");

const player = new LiquidCanvasPlayer(canvas, scene, {
  autoplay: true,
  backend: "auto",
  fillStyle: "#f8fafc",
  maxBackingDimension: 384,
  reducedMotion: reducedMotionToggle?.checked ? true : "system",
});

if (backendOutput) {
  const capacity = player.capabilities
    ? ` (${player.capabilities.maxTracks} tracks, ${player.capabilities.maxComponents} components)`
    : "";
  backendOutput.value = `backend: ${player.chosenBackend}${capacity}`;
}

reducedMotionToggle?.addEventListener("change", () => {
  player.setReducedMotion(reducedMotionToggle.checked ? true : "system");
});
