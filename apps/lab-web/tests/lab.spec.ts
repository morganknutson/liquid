import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "node:path";
import fullAddySceneData from "../../../shared/scenes/spinner-to-addy.v2.json" with { type: "json" };

// The y-track tests edit the pose where the arms have parted and the bowl has
// joined them. Timings come from the scene so tuning the animation's timing in
// tools/author-spinner-to-addy.mjs does not break these tests.
const yTrackBaseline = fullAddySceneData.tracks.find((track) => track.id === "spinner-right-to-y")!;
const yFormIndex = yTrackBaseline.keyframes.findIndex((keyframe) =>
  keyframe.components.some((component) => component.id === "y-left-arm" && "start" in component.primitive && component.primitive.start.x === 2069.2287));
if (yFormIndex < 0) throw new Error("The y arms-parted pose moved; update the y-left-arm start.x lookup in lab.spec.ts");
const yFormKeyframe = yTrackBaseline.keyframes[yFormIndex]!;
const yFormNextAt = yTrackBaseline.keyframes[yFormIndex + 1]!.at;
const Y_FORM_AT = String(yFormKeyframe.at);
const Y_FORM_MOVED_AT = Math.round(((yFormKeyframe.at + yFormNextAt) / 2) * 1000) / 1000;
const Y_FORM_SCRUB = String(Math.round((yTrackBaseline.timing.start + ((yFormKeyframe.at + yFormNextAt) / 2) * (yTrackBaseline.timing.end - yTrackBaseline.timing.start)) * 1000) / 1000);
const yEventAt = (id: string) => yTrackBaseline.events!.find((event) => event.id === id)!.at;
const Y_BETWEEN_RELEASE_AND_ADHESION = String(Math.round(((yEventAt("y-arm-release") + yEventAt("y-arm-adhesion")) / 2) * 1000) / 1000);
const yFormPrimitive = (id: string) => yFormKeyframe.components.find((component) => component.id === id)!.primitive as unknown as Record<string, { x: number; y: number }>;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    if (!(input instanceof HTMLInputElement)) throw new Error("Range target is not an input");
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setNumber(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    if (!(input instanceof HTMLInputElement)) throw new Error("Number target is not an input");
    input.value = nextValue;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function exportedScene(page: Page): Promise<any> {
  await page.locator("#export-json").click();
  return JSON.parse(await page.locator("#export-output").inputValue());
}

async function canvasStats(page: Page): Promise<{ covered: number; pixels: number; signature: number }> {
  return page.locator("#liquid-canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Liquid canvas is not a canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing canvas context");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let covered = 0;
    let signature = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] ?? 0;
      if (alpha > 0) covered += 1;
      signature = (signature + alpha * (((index / 4) % 997) + 1)) % 1_000_000_007;
    }
    return { covered, pixels: data.length / 4, signature };
  });
}

async function canvasEdgeCoverage(page: Page): Promise<{ top: number; right: number; bottom: number; left: number }> {
  return page.locator("#liquid-canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Liquid canvas is not a canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing canvas context");
    const { width, height } = canvas;
    const data = context.getImageData(0, 0, width, height).data;
    const covered = (x: number, y: number): boolean => (data[(y * width + x) * 4 + 3] ?? 0) > 0;
    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (let x = 0; x < width; x += 1) {
      if (covered(x, 0)) top += 1;
      if (covered(x, height - 1)) bottom += 1;
    }
    for (let y = 0; y < height; y += 1) {
      if (covered(0, y)) left += 1;
      if (covered(width - 1, y)) right += 1;
    }
    return { top, right, bottom, left };
  });
}

async function backingStats(page: Page): Promise<{
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  cssRatio: number;
  backingRatio: number;
  dataWidth: string | undefined;
  dataHeight: string | undefined;
  scale: number;
  maxDimension: number;
  backend: string | undefined;
  backendReason: string | undefined;
  webglSupported: boolean;
  webglSceneSupported: boolean;
  viewportPadding: number;
}> {
  return page.locator("#liquid-canvas").evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Liquid canvas is not a canvas");
    const rect = canvas.getBoundingClientRect();
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      cssRatio: rect.width / rect.height,
      backingRatio: canvas.width / canvas.height,
      dataWidth: canvas.dataset.backingWidth,
      dataHeight: canvas.dataset.backingHeight,
      scale: Number(canvas.dataset.backingScale ?? 0),
      maxDimension: Number(canvas.dataset.maxBackingDimension ?? 0),
      backend: canvas.dataset.backend,
      backendReason: canvas.dataset.backendReason,
      webglSupported: canvas.dataset.webglSupported === "true",
      webglSceneSupported: canvas.dataset.webglSceneSupported === "true",
      viewportPadding: Number(canvas.dataset.viewportPadding ?? 0),
    };
  });
}

test("renders named samples without console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.locator("#liquid-canvas")).toBeVisible();

  const samples = [
    ["source", "0"],
    ["anticipation", "0.2"],
    ["before-adhesion-release", "0.719999"],
    ["at-adhesion-release", "0.72"],
    ["endpoint-lock", "0.98"],
    ["target", "1"],
  ] as const;

  for (const [label, progress] of samples) {
    await setRange(page, "#scrub", progress);
    await expect(page.locator("#phase")).not.toHaveText("");
    const stats = await canvasStats(page);
    expect.soft(stats.covered, label).toBeGreaterThan(stats.pixels * 0.01);
  }

  expect(errors).toEqual([]);
});

test("switches to the v2 scene and renders source, field, target, and crossfade modes", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.locator("#scene-select option")).toHaveText([
    "Capsule to A",
    "Spinner to Addy",
    "Spinner to A+d study",
  ]);
  await page.locator("#scene-select").selectOption("v2");

  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-schema-version", "2");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-scene-id", "spinner-to-addy");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-track-count", "4");
  await expect(page.locator("#v2-track option")).toHaveCount(4);

  await setRange(page, "#scrub", "0");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "sourcePath");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-exact-endpoint", "source");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend", "cpu");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend-reason", "exact-endpoint");
  expect((await backingStats(page)).maxDimension).toBe(2048);
  expect((await canvasStats(page)).covered).toBeGreaterThan(0);

  await setRange(page, "#scrub", "0.5");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "field");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-track-render-modes", /field/);
  await expect(page.locator("#phase")).toContainText(":field");
  const fieldBacking = await backingStats(page);
  if (fieldBacking.webglSupported && fieldBacking.webglSceneSupported) {
    await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend", "webgl2");
    await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend-reason", "field");
  } else {
    await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend", "cpu");
    await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend-reason", "webgl-unavailable");
  }
  expect((await canvasStats(page)).covered).toBeGreaterThan(0);

  await setRange(page, "#scrub", "1");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "targetPath");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-exact-endpoint", "target");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend", "cpu");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend-reason", "exact-endpoint");
  expect((await backingStats(page)).maxDimension).toBe(2048);

  await setRange(page, "#scrub", "0.5");
  await page.locator("#reduced").check();
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "crossfade");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-track-render-modes", "crossfade,crossfade,crossfade,crossfade");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend", "cpu");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-backend-reason", "exact-endpoint");
  expect((await backingStats(page)).maxDimension).toBe(2048);
  expect((await canvasStats(page)).covered).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("v2 structured morph inspector edits the y track exactly and reset cleanly", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await setRange(page, "#scrub", "0.7");

  await expect(page.locator("#v2-track-context")).toContainText("spinner-right-to-y");
  await expect(page.locator("#v2-component option")).toHaveCount(5);

  const baseline = await exportedScene(page);
  await page.locator("#v2-solo-track").check();
  await page.locator("#v2-target-overlay").check();
  await expect(page.locator("#dirty")).toHaveText("clean");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-preview-solo-track", "true");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-preview-target-overlay", "true");
  expect(await exportedScene(page)).toEqual(baseline);

  await page.locator("#v2-component").selectOption("y-left-arm");
  await page.locator("#v2-keyframe").selectOption(Y_FORM_AT);
  await setNumber(page, "#v2-primitive-end-x", "451.25");
  await setNumber(page, "#v2-primitive-end-y", "113.5");

  await page.locator("#v2-component").selectOption("y-bowl");
  await setNumber(page, "#v2-primitive-p0-x", "447.5");
  await setNumber(page, "#v2-primitive-p2-y", "149.25");
  await setNumber(page, "#v2-primitive-startRadius", "15.25");
  await setNumber(page, "#v2-primitive-endRadius", "19.25");

  await page.locator("#v2-component").selectOption("y-descender");
  await setNumber(page, "#v2-primitive-p1-x", "462.25");
  await setNumber(page, "#v2-primitive-p2-y", "134.75");
  await setNumber(page, "#v2-primitive-startRadius", "10.5");
  await setNumber(page, "#v2-primitive-endRadius", "4.25");

  await page.locator("#v2-component").selectOption("y-crotch-cut");
  await setNumber(page, "#v2-primitive-radiusX", "4.5");
  await setNumber(page, "#v2-primitive-radiusY", "6.25");
  await setNumber(page, "#v2-primitive-rotation", "0.12");
  await page.locator("#v2-component-operation").selectOption("union");
  await setNumber(page, "#v2-keyframe-at", String(Y_FORM_MOVED_AT));
  await page.locator("#v2-keyframe-easing").selectOption("easeInCubic");
  await page.locator("#v2-component-group").fill("y-tail");
  await page.locator("#v2-component-group").dispatchEvent("change");

  await page.locator("#v2-material-scope").selectOption("group:$track");
  await setNumber(page, "#v2-material-target-mix", "0.27");
  await setNumber(page, "#v2-material-corner-sharpness", "0.38");
  await page.locator("#v2-material-scope").selectOption("group:y-body");
  await setNumber(page, "#v2-material-blend-radius", "6.75");
  await page.locator("#v2-material-scope").selectOption("group:y-tail");
  await setNumber(page, "#v2-material-blend-radius", "5.5");

  await setNumber(page, "#v2-track-start", "0.34");
  await setNumber(page, "#v2-track-end", "0.96");
  await page.locator("#v2-event").selectOption("y-arm-release");
  await setNumber(page, "#v2-event-at", "0.22");
  await setNumber(page, "#v2-event-end", "0.4");
  await setNumber(page, "#v2-scene-duration", "2400");
  await setNumber(page, "#v2-reduced-duration", "210");
  await setNumber(page, "#v2-reduced-fade-start", "0.15");
  await setNumber(page, "#v2-reduced-fade-end", "0.9");

  const edited = await exportedScene(page);
  const yTrack = edited.tracks.find((track: any) => track.id === "spinner-right-to-y");
  const movedKeyframe = yTrack.keyframes.find((keyframe: any) => keyframe.at === Y_FORM_MOVED_AT);
  const state = (id: string) => movedKeyframe.components.find((component: any) => component.id === id);
  const definition = (id: string) => yTrack.components.find((component: any) => component.id === id);
  const release = yTrack.events.find((event: any) => event.id === "y-arm-release");

  expect(edited.durationMs).toBe(2400);
  expect(edited.reducedMotion).toMatchObject({ durationMs: 210, fadeStart: 0.15, fadeEnd: 0.9 });
  expect(yTrack.timing).toEqual({ start: 0.34, end: 0.96 });
  expect(movedKeyframe.easing).toBe("easeInCubic");
  expect(state("y-left-arm").primitive.end).toEqual({ x: 451.25, y: 113.5 });
  expect(state("y-bowl").primitive).toMatchObject({
    p0: { x: 447.5, y: yFormPrimitive("y-bowl").p0!.y },
    p2: { x: yFormPrimitive("y-bowl").p2!.x, y: 149.25 },
    startRadius: 15.25,
    endRadius: 19.25,
  });
  expect(state("y-crotch-cut").primitive).toMatchObject({ radiusX: 4.5, radiusY: 6.25, rotation: 0.12 });
  expect(state("y-descender").primitive).toMatchObject({
    p1: { x: 462.25, y: yFormPrimitive("y-descender").p1!.y },
    p2: { x: yFormPrimitive("y-descender").p2!.x, y: 134.75 },
    startRadius: 10.5,
    endRadius: 4.25,
  });
  expect(definition("y-crotch-cut")).toMatchObject({ kind: "ellipse", operation: "union", groupId: "y-tail" });
  expect(movedKeyframe.material.groups.$track).toMatchObject({ targetMix: 0.27, cornerSharpness: 0.38 });
  expect(movedKeyframe.material.groups["y-body"]).toMatchObject({ blendRadius: 6.75 });
  expect(movedKeyframe.material.groups["y-tail"]).toMatchObject({ blendRadius: 5.5 });
  expect(release).toMatchObject({ kind: "release", at: 0.22, end: 0.4 });
  await expect(page.locator("#dirty")).toHaveText("dirty");
  await expect(page.locator("#export-output")).toHaveAttribute("data-changed", "true");

  await setNumber(page, "#v2-keyframe-at", "1");
  await expect(page.locator("#v2-edit-error")).toBeVisible();
  await expect(page.locator("#v2-edit-error")).toContainText("keyframes");
  expect(await exportedScene(page)).toEqual(edited);

  await page.locator("#reset-committed").click();
  await expect(page.locator("#dirty")).toHaveText("clean");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-fixture-stable", "true");
  expect(await exportedScene(page)).toEqual(baseline);
  expect(errors).toEqual([]);
});

test("v2 material scope semantics and numeric validation preserve rejected drafts", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await page.locator("#v2-component").selectOption("y-crotch-cut");
  await page.locator("#v2-keyframe").selectOption(Y_FORM_AT);
  const baseline = await exportedScene(page);

  await expect(page.locator("#v2-material-track-note")).toContainText("track-only");
  await page.locator("#v2-material-scope").selectOption("group:$track");
  await expect(page.locator("#v2-material-target-mix")).toBeEnabled();
  await expect(page.locator("#v2-material-corner-sharpness")).toBeEnabled();

  await page.locator("#v2-material-scope").selectOption("group:y-body");
  await expect(page.locator("#v2-material-blend-radius")).toBeEnabled();
  await expect(page.locator("#v2-material-target-mix")).toBeDisabled();
  await expect(page.locator("#v2-material-corner-sharpness")).toBeDisabled();
  await setNumber(page, "#v2-material-target-mix", "0.47");
  await expect(page.locator("#v2-edit-error")).toContainText("targetMix is only honored on group $track");
  await expect(page.locator("#dirty")).toHaveText("clean");
  expect(await exportedScene(page)).toEqual(baseline);

  await setNumber(page, "#v2-material-blend-radius", "-1");
  await expect(page.locator("#v2-edit-error")).toContainText("blend radius must be >= 0");
  await expect(page.locator("#v2-material-blend-radius")).toHaveValue("-1");
  expect(await exportedScene(page)).toEqual(baseline);

  await setNumber(page, "#v2-material-blend-radius", "6.25");
  await expect(page.locator("#v2-edit-error")).toBeHidden();
  await expect(page.locator("#v2-material-blend-radius")).toHaveValue("6.25");
  await expect(page.locator("#dirty")).toHaveText("dirty");

  await setNumber(page, "#v2-primitive-radiusX", "-4");
  await expect(page.locator("#v2-edit-error")).toContainText("radiusX must be >= 0");
  await expect(page.locator("#v2-primitive-radiusX")).toHaveValue("-4");
  const afterValidBlend = await exportedScene(page);
  expect(afterValidBlend.tracks.find((track: any) => track.id === "spinner-right-to-y").keyframes.find((keyframe: any) => keyframe.at === yFormKeyframe.at).material.groups["y-body"].blendRadius).toBe(6.25);

  await setNumber(page, "#v2-scene-duration", "0");
  await expect(page.locator("#v2-edit-error")).toContainText("scene duration must be > 0");
  await expect(page.locator("#v2-scene-duration")).toHaveValue("0");
  expect(await exportedScene(page)).toEqual(afterValidBlend);
  expect(errors).toEqual([]);
});

test("v2 focused primitive drafts survive scrub renders until committed", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await page.locator("#v2-component").selectOption("y-crotch-cut");
  await page.locator("#v2-keyframe").selectOption(Y_FORM_AT);

  await page.locator("#v2-primitive-radiusX").focus();
  await page.locator("#v2-primitive-radiusX").fill("47.125");
  await setRange(page, "#scrub", "0.7");
  await expect(page.locator("#v2-primitive-radiusX")).toHaveValue("47.125");
  await expect(page.locator("#dirty")).toHaveText("clean");

  await page.locator("#v2-primitive-radiusX").dispatchEvent("change");
  await expect(page.locator("#v2-edit-error")).toBeHidden();
  const edited = await exportedScene(page);
  const yTrack = edited.tracks.find((track: any) => track.id === "spinner-right-to-y");
  const keyframe = yTrack.keyframes.find((candidate: any) => candidate.at === yFormKeyframe.at);
  expect(keyframe.components.find((component: any) => component.id === "y-crotch-cut").primitive.radiusX).toBe(47.125);
  expect(errors).toEqual([]);
});

test("v2 event edits use canonical sort order for export and selection", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await page.locator("#v2-event").selectOption("y-target-relaxation");
  await setNumber(page, "#v2-event-at", Y_BETWEEN_RELEASE_AND_ADHESION);

  const edited = await exportedScene(page);
  const yTrack = edited.tracks.find((track: any) => track.id === "spinner-right-to-y");
  expect(yTrack.events.map((event: any) => event.id)).toEqual([
    "y-bottom-pin",
    "y-arm-release",
    "y-target-relaxation",
    "y-arm-adhesion",
    "y-endpoint-snap",
  ]);
  await expect(page.locator("#v2-event")).toHaveValue("y-target-relaxation");
  await expect(page.locator("#v2-event option")).toHaveText([
    "y-bottom-pin (step)",
    "y-arm-release (release)",
    "y-target-relaxation (step)",
    "y-arm-adhesion (step)",
    "y-endpoint-snap (step)",
  ]);
  expect(errors).toEqual([]);
});

test("v2 y preview signatures respond independently to group and component blend", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await page.locator("#debug").check();
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await page.locator("#v2-component").selectOption("y-bowl");
  await page.locator("#v2-keyframe").selectOption(Y_FORM_AT);
  await setRange(page, "#scrub", Y_FORM_SCRUB);
  await page.locator("#v2-solo-track").check();
  await expect(page.locator("#dirty")).toHaveText("clean");
  const baseline = await canvasStats(page);

  await page.locator("#v2-material-scope").selectOption("group:y-body");
  await setNumber(page, "#v2-material-blend-radius", "1");
  const groupTuned = await canvasStats(page);
  expect(groupTuned.covered).toBeGreaterThan(0);
  expect(groupTuned.signature).not.toBe(baseline.signature);

  await page.locator("#reset-committed").click();
  await page.locator("#debug").check();
  await page.locator("#v2-track").selectOption("spinner-right-to-y");
  await page.locator("#v2-component").selectOption("y-bowl");
  await page.locator("#v2-keyframe").selectOption(Y_FORM_AT);
  await setRange(page, "#scrub", Y_FORM_SCRUB);
  await page.locator("#v2-solo-track").check();
  const reset = await canvasStats(page);
  expect(reset.signature).toBe(baseline.signature);

  await page.locator("#v2-material-scope").selectOption("component:y-bowl");
  await setNumber(page, "#v2-material-blend-radius", "1");
  const componentTuned = await canvasStats(page);
  expect(componentTuned.covered).toBeGreaterThan(0);
  expect(componentTuned.signature).not.toBe(reset.signature);
  expect(componentTuned.signature).not.toBe(groupTuned.signature);
  await expect(page.locator("#v2-material-target-mix")).toBeDisabled();
  await expect(page.locator("#v2-material-corner-sharpness")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("v2 can upsert at scrubbed local progress and switch scenes without console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");

  await page.locator("#scene-select").selectOption("ad-study");
  await page.locator("#v2-track").selectOption("spinner-inner-left-to-d1");
  await setRange(page, "#scrub", "0.59");
  await page.locator("#v2-upsert-keyframe").click();
  await page.locator("#export-json").click();
  await expect(page.locator("#dirty")).toHaveText("dirty");
  await expect(page.locator("#export-output")).toHaveValue(/"at": 0.5/);
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-selected-track-id", "spinner-inner-left-to-d1");

  await page.locator("#scene-select").selectOption("v1");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-schema-version", "1");
  await expect(page.locator("#v1-authoring-controls")).toBeVisible();
  await expect(page.locator("#v2-authoring-controls")).toBeHidden();
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-committed-fixture-stable", "true");

  await page.locator("#scene-select").selectOption("ad-study");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-schema-version", "2");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-scene-id", "spinner-to-ad");
  await expect(page.locator("#dirty")).toHaveText("dirty");
  expect(errors).toEqual([]);
});

test("keeps the CPU backing canvas bounded and aspect preserving", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.locator("#liquid-canvas")).toBeVisible();

  const backing = await backingStats(page);

  expect(backing.backend).toBe("cpu");
  expect(backing.maxDimension).toBe(384);
  expect(Math.max(backing.width, backing.height)).toBeLessThanOrEqual(384);
  expect(backing.width).toBeGreaterThan(1);
  expect(backing.height).toBeGreaterThan(1);
  expect(backing.scale).toBeGreaterThan(0);
  expect(backing.backingRatio).toBeCloseTo(backing.cssRatio, 2);
  expect(backing.dataWidth).toBe(String(backing.width));
  expect(backing.dataHeight).toBe(String(backing.height));
  expect(errors).toEqual([]);
});

test("uses a sharper bounded WebGL backing for supported v2 field playback", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const v2SceneRatio = (2973 + 48) / (1568 + 48);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");

  await setRange(page, "#scrub", "0");
  const exactSourceBacking = await backingStats(page);
  expect(exactSourceBacking.backend).toBe("cpu");
  expect(exactSourceBacking.backendReason).toBe("exact-endpoint");
  expect(exactSourceBacking.maxDimension).toBe(2048);
  if (Math.max(exactSourceBacking.cssWidth, exactSourceBacking.cssHeight) > 512) {
    expect(Math.max(exactSourceBacking.width, exactSourceBacking.height)).toBeGreaterThan(512);
  }

  await setRange(page, "#scrub", "0.5");

  const backing = await backingStats(page);
  test.skip(!backing.webglSupported || !backing.webglSceneSupported, "WebGL2 unavailable in this browser");

  expect(backing.backend).toBe("webgl2");
  expect(backing.backendReason).toBe("field");
  expect(backing.maxDimension).toBe(512);
  expect(backing.viewportPadding).toBe(24);
  expect(Math.max(backing.width, backing.height)).toBeGreaterThan(384);
  expect(Math.max(backing.width, backing.height)).toBeLessThanOrEqual(512);
  expect(backing.scale).toBeGreaterThan(0);
  expect(backing.scale).toBeLessThanOrEqual(2);
  expect(backing.cssRatio).toBeCloseTo(v2SceneRatio, 2);
  expect(backing.backingRatio).toBeCloseTo(backing.cssRatio, 1);
  expect(backing.dataWidth).toBe(String(backing.width));
  expect(backing.dataHeight).toBe(String(backing.height));
  expect(errors).toEqual([]);
});

test("falls back to CPU metadata when WebGL2 is unavailable", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(this: HTMLCanvasElement, type: string, options?: unknown): RenderingContext | null {
      if (type === "webgl2") return null;
      return (originalGetContext as unknown as (this: HTMLCanvasElement, type: string, options?: unknown) => RenderingContext | null).call(this, type, options);
    } as typeof HTMLCanvasElement.prototype.getContext;

    const originalOffscreenGetContext = typeof OffscreenCanvas === "function" ? OffscreenCanvas.prototype.getContext : null;
    if (originalOffscreenGetContext) {
      OffscreenCanvas.prototype.getContext = function patchedOffscreenGetContext(this: OffscreenCanvas, type: OffscreenRenderingContextId, options?: unknown): OffscreenRenderingContext | null {
        if (type === "webgl2") return null;
        return (originalOffscreenGetContext as unknown as (this: OffscreenCanvas, type: OffscreenRenderingContextId, options?: unknown) => OffscreenRenderingContext | null).call(this, type, options);
      } as typeof OffscreenCanvas.prototype.getContext;
    }
  });

  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");
  await setRange(page, "#scrub", "0.5");

  const backing = await backingStats(page);
  expect(backing.backend).toBe("cpu");
  expect(backing.backendReason).toBe("webgl-unavailable");
  expect(backing.webglSupported).toBe(false);
  expect(backing.webglSceneSupported).toBe(true);
  expect(backing.maxDimension).toBe(512);
  expect(Math.max(backing.width, backing.height)).toBeLessThanOrEqual(512);
  expect(backing.cssRatio).toBeCloseTo((2973 + 48) / (1568 + 48), 2);
  expect(backing.backingRatio).toBeCloseTo(backing.cssRatio, 1);
  expect((await canvasStats(page)).covered).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("keeps the full Addy silhouette inside its padded viewport", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await page.locator("#scene-select").selectOption("v2");

  for (const progress of ["0", "0.2", "0.4", "0.6", "0.8", "0.98", "1"]) {
    await setRange(page, "#scrub", progress);
    expect(await canvasEdgeCoverage(page), `progress ${progress}`).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  }

  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-viewport-padding", "24");
  expect(errors).toEqual([]);
});

test("authoring controls persist a working scene and reset to committed", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await setRange(page, "#scrub", "0.6");

  const baseline = await canvasStats(page);
  await setRange(page, "#leg-separation", "18");
  await setRange(page, "#goo-strength", "0.2");
  await setRange(page, "#bridge-thickness", "0");
  await setRange(page, "#crossbar-thickness", "1.8");
  await setRange(page, "#target-bias", "0.22");

  const tuned = await canvasStats(page);
  expect(tuned.signature).not.toBe(baseline.signature);
  await expect(page.locator("#leg-separation-value")).toHaveText("+18.0");
  await expect(page.locator("#goo-strength-value")).toHaveText("0.20x");
  await expect(page.locator("#bridge-thickness-value")).toHaveText("0.00x");
  await expect(page.locator("#crossbar-thickness-value")).toHaveText("1.80x");
  await expect(page.locator("#target-bias-value")).toHaveText("+0.22");
  await expect(page.locator("#dirty")).toHaveText("dirty");
  await expect(page.locator("#diff")).toContainText("poses");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-fixture-stable", "false");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-committed-fixture-stable", "true");

  await page.locator("#reset-committed").click();

  const reset = await canvasStats(page);
  expect(reset.signature).toBe(baseline.signature);
  await expect(page.locator("#leg-separation-value")).toHaveText("+0.0");
  await expect(page.locator("#goo-strength-value")).toHaveText("1.00x");
  await expect(page.locator("#bridge-thickness-value")).toHaveText("1.00x");
  await expect(page.locator("#crossbar-thickness-value")).toHaveText("1.00x");
  await expect(page.locator("#target-bias-value")).toHaveText("+0.00");
  await expect(page.locator("#dirty")).toHaveText("clean");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-fixture-stable", "true");
  expect(errors).toEqual([]);
});

test("authoring snapshots, commit, and canonical export reflect document state", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await setRange(page, "#scrub", "0.6");
  await setRange(page, "#target-bias", "0.18");

  await page.locator("#snapshot-name").fill("bias-pass");
  await page.locator("#save-snapshot").click();
  await expect(page.locator("#snapshots")).toHaveText("bias-pass");

  await page.locator("#export-json").click();
  await expect(page.locator("#export-output")).toHaveValue(/"schemaVersion": 1/);
  await expect(page.locator("#export-output")).toHaveValue(/"targetMix"/);
  await expect(page.locator("#export-output")).toHaveAttribute("data-changed", "true");

  await page.locator("#commit-scene").click();
  await expect(page.locator("#dirty")).toHaveText("clean");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-fixture-stable", "false");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-committed-fixture-stable", "false");
  expect(errors).toEqual([]);
});

test("authoring controls leave exact endpoint render modes untouched", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await setRange(page, "#scrub", "0");
  await setRange(page, "#leg-separation", "18");
  await setRange(page, "#goo-strength", "1.8");
  await setRange(page, "#bridge-thickness", "1.9");
  await setRange(page, "#crossbar-thickness", "1.8");
  await setRange(page, "#target-bias", "0.22");

  await setRange(page, "#scrub", "0");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "sourcePath");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-base-target-mix", "0.000000");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-tuned-target-mix", "0.000000");

  await setRange(page, "#scrub", "1");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-render-mode", "targetPath");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-base-target-mix", "1.000000");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-tuned-target-mix", "1.000000");
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-fixture-stable", "true");
  await expect(page.locator("#dirty")).toHaveText("clean");
  expect(errors).toEqual([]);
});

test("uses reduced-motion playback duration and Canvas endpoint fill rules", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");

  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-playback-duration", "1600");
  await page.locator("#reduced").check();
  await expect(page.locator("#liquid-canvas")).toHaveAttribute("data-playback-duration", "160");

  const rendererPath = `/@fs${path.resolve("packages/liquid-web/src/index.ts")}`;
  const fillRuleAlpha = await page.evaluate(async ({ modulePath }) => {
    const { LiquidCanvasRenderer } = await import(modulePath);
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const renderer = new LiquidCanvasRenderer(canvas);
    const commands = [
      { type: "M", values: [10, 10] },
      { type: "L", values: [90, 10] },
      { type: "L", values: [90, 90] },
      { type: "L", values: [10, 90] },
      { type: "Z" },
      { type: "M", values: [30, 30] },
      { type: "L", values: [70, 30] },
      { type: "L", values: [70, 70] },
      { type: "L", values: [30, 70] },
      { type: "Z" },
    ];
    const scene = {
      schemaVersion: 1,
      id: "evenodd-canvas",
      fixtureVersion: 1,
      durationMs: 100,
      coordinateSpace: { width: 100, height: 100 },
      fillRule: "evenodd",
      source: {
        assetId: "test",
        shapeId: "nested",
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
        commands,
      },
      target: {
        assetId: "test",
        shapeId: "nested",
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
        commands,
      },
      phases: [{ id: "only", start: 0, end: 1 }],
      thresholds: [],
      poses: [
        {
          at: 0,
          easing: "linear",
          frame: {
            anchor: { x: 0, y: 0 },
            leftLeg: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            rightLeg: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            crossbar: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            bridge: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            blendRadius: 0,
            targetMix: 0,
            cornerSharpness: 0,
          },
        },
        {
          at: 1,
          easing: "linear",
          frame: {
            anchor: { x: 0, y: 0 },
            leftLeg: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            rightLeg: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            crossbar: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            bridge: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 },
            blendRadius: 0,
            targetMix: 0,
            cornerSharpness: 0,
          },
        },
      ],
      reducedMotion: { mode: "crossfade", durationMs: 50, fadeStart: 0, fadeEnd: 1 },
    };
    const frame = {
      label: "",
      progress: 0,
      phase: "only",
      events: [],
      renderMode: "sourcePath",
      sourceOpacity: 1,
      targetOpacity: 0,
      endpointCommands: commands,
      ...scene.poses[0]!.frame,
    };
    renderer.render(scene, frame);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Missing test canvas context");
    return {
      ring: context.getImageData(20, 20, 1, 1).data[3],
      center: context.getImageData(50, 50, 1, 1).data[3],
    };
  }, { modulePath: rendererPath });

  expect(fillRuleAlpha.ring).toBe(255);
  expect(fillRuleAlpha.center).toBe(0);
  expect(errors).toEqual([]);
});

test("renderer options colorize field masks and multiply vector opacity", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");

  const rendererPath = `/@fs${path.resolve("packages/liquid-web/src/index.ts")}`;
  const pixels = await page.evaluate(async ({ modulePath }) => {
    const { LiquidCanvasRenderer } = await import(modulePath);
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 20;
    const renderer = new LiquidCanvasRenderer(canvas);
    const rect = (left: number, top: number, right: number, bottom: number) => [
      { type: "M", values: [left, top] },
      { type: "L", values: [right, top] },
      { type: "L", values: [right, bottom] },
      { type: "L", values: [left, bottom] },
      { type: "Z" },
    ];
    const scene = {
      schemaVersion: 1,
      id: "renderer-options",
      fixtureVersion: 1,
      durationMs: 100,
      coordinateSpace: { width: 20, height: 20 },
      fillRule: "nonzero",
      source: {
        assetId: "test",
        shapeId: "source",
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
        commands: rect(2, 2, 8, 18),
      },
      target: {
        assetId: "test",
        shapeId: "target",
        transform: { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 },
        commands: rect(12, 2, 18, 18),
      },
      phases: [{ id: "only", start: 0, end: 1 }],
      thresholds: [],
      poses: [],
      reducedMotion: { mode: "crossfade", durationMs: 50, fadeStart: 0, fadeEnd: 1 },
    };
    const zeroCapsule = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0 };
    const baseFrame = {
      label: "",
      progress: 0,
      phase: "only",
      events: [],
      sourceOpacity: 1,
      targetOpacity: 1,
      endpointCommands: null,
      anchor: { x: 0, y: 0 },
      leftLeg: zeroCapsule,
      rightLeg: zeroCapsule,
      crossbar: zeroCapsule,
      bridge: zeroCapsule,
      blendRadius: 0,
      targetMix: 0,
      cornerSharpness: 0,
    };
    const readPixel = (x: number, y: number) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing test canvas context");
      return Array.from(context.getImageData(x, y, 1, 1).data);
    };

    renderer.render(scene, { ...baseFrame, renderMode: "sourcePath", sourceOpacity: 0.5, targetOpacity: 0 }, { fillStyle: "rgb(10, 120, 200)", opacity: 0.5 });
    const sourcePath = readPixel(5, 10);

    renderer.render(scene, { ...baseFrame, renderMode: "targetPath", sourceOpacity: 0, targetOpacity: 0.25 }, { fillStyle: "rgb(200, 60, 20)", opacity: 0.5 });
    const targetPath = readPixel(15, 10);

    renderer.render(scene, { ...baseFrame, renderMode: "crossfade", sourceOpacity: 0.5, targetOpacity: 0.25 }, { sourceStyle: "rgb(220, 20, 30)", targetStyle: "rgb(30, 80, 230)", opacity: 0.5 });
    const crossfadeSource = readPixel(5, 10);
    const crossfadeTarget = readPixel(15, 10);

    renderer.render(
      scene,
      {
        ...baseFrame,
        renderMode: "field",
        leftLeg: { start: { x: 5, y: 10 }, end: { x: 15, y: 10 }, radius: 5 },
      },
      { fillStyle: "rgb(20, 180, 60)", opacity: 0.5 },
    );
    const field = readPixel(10, 10);

    return { sourcePath, targetPath, crossfadeSource, crossfadeTarget, field };
  }, { modulePath: rendererPath });

  const sourcePath = pixels.sourcePath as [number, number, number, number];
  const targetPath = pixels.targetPath as [number, number, number, number];
  const crossfadeSource = pixels.crossfadeSource as [number, number, number, number];
  const crossfadeTarget = pixels.crossfadeTarget as [number, number, number, number];
  const field = pixels.field as [number, number, number, number];

  expect(sourcePath[2]).toBeGreaterThan(sourcePath[1]);
  expect(sourcePath[3]).toBeGreaterThanOrEqual(60);
  expect(sourcePath[3]).toBeLessThanOrEqual(66);
  expect(targetPath[0]).toBeGreaterThan(targetPath[1]);
  expect(targetPath[3]).toBeGreaterThanOrEqual(28);
  expect(targetPath[3]).toBeLessThanOrEqual(34);
  expect(crossfadeSource[0]).toBeGreaterThan(crossfadeSource[2]);
  expect(crossfadeSource[3]).toBeGreaterThanOrEqual(60);
  expect(crossfadeSource[3]).toBeLessThanOrEqual(66);
  expect(crossfadeTarget[2]).toBeGreaterThan(crossfadeTarget[0]);
  expect(crossfadeTarget[3]).toBeGreaterThanOrEqual(28);
  expect(crossfadeTarget[3]).toBeLessThanOrEqual(34);
  expect(field[1]).toBeGreaterThan(field[0]);
  expect(field[1]).toBeGreaterThan(field[2]);
  expect(field[3]).toBeGreaterThanOrEqual(124);
  expect(field[3]).toBeLessThanOrEqual(130);
  expect(errors).toEqual([]);
});
