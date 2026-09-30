import { defineAddyLogoElement } from "@liquid/addy-logo";
import fallbackLogoURL from "../../../shared/assets/addy-logo-wordmark.svg?url";

for (const image of document.querySelectorAll<HTMLImageElement>("img[data-fallback]")) image.src = fallbackLogoURL;

defineAddyLogoElement();

const hero = document.querySelector<HTMLElement & { replay(): void }>("#hero");
const status = document.querySelector<HTMLElement>("#status");
hero?.addEventListener("complete", () => {
  if (status) status.textContent = "complete";
  hero.dataset.completed = String(Number(hero.dataset.completed ?? 0) + 1);
});
document.querySelector("#replay")?.addEventListener("click", () => {
  if (status) status.textContent = "playing";
  hero?.replay();
});

const wave = document.querySelector<HTMLElement & { play(): void; pause(): void; replay(): void }>("#wave");
const waveToggle = document.querySelector<HTMLButtonElement>("#wave-toggle");
let wavePaused = false;
waveToggle?.addEventListener("click", () => {
  wavePaused = !wavePaused;
  if (wavePaused) wave?.pause();
  else wave?.play();
  waveToggle.textContent = wavePaused ? "Play wave" : "Pause wave";
});
document.querySelector("#wave-replay")?.addEventListener("click", () => {
  wavePaused = false;
  if (waveToggle) waveToggle.textContent = "Pause wave";
  wave?.replay();
});

const waveWordmark = document.querySelector<HTMLElement & { replay(): void }>("#wave-wordmark");
const waveWordmarkStatus = document.querySelector<HTMLElement>("#wave-wordmark-status");
waveWordmark?.addEventListener("complete", () => {
  if (waveWordmarkStatus) waveWordmarkStatus.textContent = "complete";
  waveWordmark.dataset.completed = String(Number(waveWordmark.dataset.completed ?? 0) + 1);
});
document.querySelector("#wave-wordmark-replay")?.addEventListener("click", () => {
  if (waveWordmarkStatus) waveWordmarkStatus.textContent = "playing";
  waveWordmark?.replay();
});

const replayable = document.querySelector<HTMLElement>("#replayable");
const replayableStatus = document.querySelector<HTMLElement>("#replayable-status");
replayable?.addEventListener("complete", () => {
  if (replayableStatus) replayableStatus.textContent = "complete";
  replayable.dataset.completed = String(Number(replayable.dataset.completed ?? 0) + 1);
});
replayable?.addEventListener("click", () => {
  if (replayableStatus?.textContent === "complete") replayableStatus.textContent = "playing";
});
