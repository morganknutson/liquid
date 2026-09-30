import { expect, test, type Page } from "@playwright/test";
import sampleData from "../../../shared/golden/capsule-to-a.samples.json" with { type: "json" };

interface GoldenSample {
  readonly label: string;
  readonly progress: number;
}

const samples = sampleData.samples as GoldenSample[];
const canvasSelector = "#liquid-canvas";
// Per-snapshot tolerance: low color threshold with a 0.1% diff cap catches silhouette drift
// while allowing isolated browser antialiasing noise at canvas edges.
const screenshotTolerance = {
  threshold: 0.08,
  maxDiffPixelRatio: 0.001,
} as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function expectedRenderMode(progress: number): string {
  if (progress === 0) return "sourcePath";
  if (progress === 1) return "targetPath";
  return "field";
}

async function setRange(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    if (!(input instanceof HTMLInputElement)) throw new Error("Range target is not an input");
    input.step = "any";
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function prepareLab(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(canvasSelector)).toBeVisible();
  await page.locator("#debug").uncheck();
  await page.locator("#reduced").uncheck();
  await page.locator("#reset-tuning").click();
}

async function scrubToSample(page: Page, sample: GoldenSample): Promise<void> {
  const progress = String(sample.progress);
  await setRange(page, "#scrub", progress);
  await expect(page.locator("#scrub")).toHaveValue(progress);
  await expect(page.locator(canvasSelector)).toHaveAttribute("data-fixture-stable", "true");
  await expect(page.locator(canvasSelector)).toHaveAttribute("data-render-mode", expectedRenderMode(sample.progress));
  await expect(page.locator("#phase")).not.toHaveText("");
}

for (const sample of samples) {
  test(`visual canvas snapshot: ${sample.label}`, async ({ page }, testInfo) => {
    const errors = collectPageErrors(page);
    await prepareLab(page);
    await scrubToSample(page, sample);

    await expect(page.locator(canvasSelector)).toHaveScreenshot(
      `${sample.label}-${testInfo.project.name}.png`,
      screenshotTolerance,
    );
    expect(errors).toEqual([]);
  });
}
