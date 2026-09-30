import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function logoState(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const canvas = element.shadowRoot?.querySelector("canvas");
    const slot = element.shadowRoot?.querySelector("slot");
    if (!canvas) return null;
    const context = canvas.getContext("2d");
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    let covered = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    if (pixels) {
      for (let index = 0; index < pixels.length; index += 4) {
        if ((pixels[index + 3] ?? 0) < 250) continue;
        covered += 1;
        red += pixels[index] ?? 0;
        green += pixels[index + 1] ?? 0;
        blue += pixels[index + 2] ?? 0;
      }
    }
    const rect = canvas.getBoundingClientRect();
    return {
      hidden: canvas.hidden,
      fallbackHidden: slot?.hidden ?? false,
      label: canvas.getAttribute("aria-label"),
      cssRatio: rect.width / rect.height,
      covered,
      color: covered ? [Math.round(red / covered), Math.round(green / covered), Math.round(blue / covered)] : null,
    };
  });
}

test("addy-logo plays once when visible, inherits color, and fires complete", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/addy-logo.html");

  await expect(page.locator("#hero")).toHaveAttribute("data-completed", "1", { timeout: 10_000 });
  const hero = await logoState(page, "#hero");
  expect(hero).toMatchObject({ hidden: false, fallbackHidden: true, label: "Addy" });
  expect(hero!.cssRatio).toBeCloseTo(2973 / 1568, 1);
  expect(hero!.covered).toBeGreaterThan(0);
  expect(hero!.color).toEqual([248, 250, 252]);

  const light = await logoState(page, "#light");
  expect(light!.color).toEqual([16, 16, 20]);
  const inline = await logoState(page, "#inline");
  expect(inline!.color).toEqual([167, 243, 208]);

  await page.locator("#replay").click();
  await expect(page.locator("#status")).toHaveText("playing");
  await expect(page.locator("#hero")).toHaveAttribute("data-completed", "2", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("addy-logo uses the short reduced-motion fade", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/addy-logo.html");
  // Time from the first drawn frame so page-load speed does not count; the full
  // animation is about 2s, the reduced-motion fade 180ms.
  await expect.poll(async () => (await logoState(page, "#hero"))?.covered ?? 0, { timeout: 8_000 }).toBeGreaterThan(0);
  const started = Date.now();
  await expect(page.locator("#hero")).toHaveAttribute("data-completed", "1", { timeout: 8_000 });
  expect(Date.now() - started).toBeLessThan(1_200);
  expect((await logoState(page, "#hero"))!.covered).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

async function canvasSignature(page: Page, selector: string): Promise<string> {
  return page.locator(selector).evaluate((element) => {
    const canvas = element.shadowRoot?.querySelector("canvas");
    const data = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0;
    if (data) for (let index = 3; index < data.length; index += 16) hash = (hash * 31 + (data[index] ?? 0)) >>> 0;
    return String(hash);
  });
}

test("addy-logo wave variant drops in, keeps waving past the scene length, and pauses", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/addy-logo.html");
  await page.locator("#wave").scrollIntoViewIfNeeded();
  await expect.poll(async () => (await logoState(page, "#wave"))?.covered ?? 0, { timeout: 5_000 }).toBeGreaterThan(0);
  expect((await logoState(page, "#wave"))!.label).toBe("Addy is working");

  // Past the full scene length the wave is still moving: it looped instead of stopping.
  await page.waitForTimeout(7_000);
  const first = await canvasSignature(page, "#wave");
  await page.waitForTimeout(250);
  expect(await canvasSignature(page, "#wave")).not.toBe(first);

  await page.locator("#wave-toggle").click();
  await page.waitForTimeout(100);
  const paused = await canvasSignature(page, "#wave");
  await page.waitForTimeout(400);
  expect(await canvasSignature(page, "#wave")).toBe(paused);
  expect(errors).toEqual([]);
});

test("addy-logo wave-wordmark variant waves, then lands on the wordmark and completes", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/addy-logo.html");
  await page.locator("#wave-wordmark").scrollIntoViewIfNeeded();
  await expect(page.locator("#wave-wordmark")).toHaveAttribute("data-completed", "1", { timeout: 10_000 });
  await expect(page.locator("#wave-wordmark-status")).toHaveText("complete");
  const state = await logoState(page, "#wave-wordmark");
  const hero = await logoState(page, "#hero");
  // Same final frame as the plain wordmark variant: the exact wordmark in the pill.
  expect(state!.covered).toBeGreaterThan(0);
  expect(Math.abs(state!.covered - hero!.covered) / hero!.covered).toBeLessThan(0.02);
  expect(errors).toEqual([]);
});
