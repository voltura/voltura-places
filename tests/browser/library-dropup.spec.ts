import { test, expect, chromium, webkit, devices } from "@playwright/test";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} bottom group picker opens upward without scrolling`, async ({}, testInfo) => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      ...devices[engine === webkit ? "iPhone 13" : "Pixel 7"],
      baseURL: "http://127.0.0.1:5174",
      locale: "en-US",
    });
    await context.addInitScript(() => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-workspace:dropup-preview",
        "family:dropup-preview:10000000-0000-4000-8000-000000000001",
      );
      localStorage.setItem(
        "places-account",
        JSON.stringify({
          enabled: true,
          providers: {},
          account: { id: "dropup-preview", methods: [] },
        }),
      );
      localStorage.setItem(
        "places-family:dropup-preview",
        JSON.stringify({
          families: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              name: "Weekend walks",
              ownerId: "dropup-preview",
              members: [],
            },
          ],
          inactive: [],
        }),
      );
    });
    // Cached libraries remain usable when the network is unavailable.
    await context.route("**/api/**", (route) => route.abort());
    const page = await context.newPage();
    try {
      await page.goto("/");
      const destination = page.locator("button.save-destination");
      const menu = page.getByRole("group", { name: "Choose group", exact: true });
      for (const [width, scale] of [
        [320, 1],
        [390, 1],
        [375, 2],
        [1280, 1],
      ]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(
          (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
          scale,
        );
        const before = await page.evaluate(() => scrollY);
        await destination.tap();
        await expect(menu).toBeVisible();
        const anchor = (await destination.boundingBox())!;
        const popup = (await menu.boundingBox())!;
        expect(popup.y + popup.height).toBeCloseTo(anchor.y - 6, 0);
        expect(popup.x).toBeCloseTo(anchor.x, 0);
        expect(popup.width).toBeCloseTo(anchor.width, 0);
        expect(popup.y).toBeGreaterThanOrEqual(16);
        expect(await page.evaluate(() => scrollY)).toBe(before);
        await page.screenshot({ path: testInfo.outputPath(`dropup-${width}-${scale}.png`) });
        await menu.getByRole("button", { name: "Weekend walks", exact: true }).tap();
        await expect(destination).toHaveText("Weekend walks");
        await expect(menu).toBeHidden();
        await destination.tap();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(destination).toBeFocused();
        await destination.tap();
        await destination.tap();
        await expect(menu).toBeHidden();
      }
    } finally {
      await browser.close();
    }
  });
}
