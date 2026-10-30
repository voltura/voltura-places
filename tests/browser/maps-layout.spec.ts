import { test, expect, chromium, webkit, devices } from "@playwright/test";

for (const engine of [webkit, chromium]) {
  test(`${engine.name()} keeps the details map dropdown inside the phone content margins`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"], locale: "en-US" });
      await context.addInitScript(() => {
        localStorage.setItem("places-account-choice", "done");
        Object.defineProperty(navigator, "geolocation", {
          value: {
            watchPosition(success: PositionCallback) {
              setTimeout(
                () =>
                  success({
                    timestamp: Date.now(),
                    coords: { latitude: 0, longitude: 0, accuracy: 17 },
                  } as GeolocationPosition),
                0,
              );
              return 1;
            },
            clearWatch() {},
          },
        });
      });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:5174/");
      await page.getByRole("button", { name: "Save position", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      const details = page.locator(".details-content:visible");
      await expect(details).toBeVisible();
      for (const [width, scale] of [
        [320, 1],
        [390, 1],
        [430, 1],
        [375, 2],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${scale * 100}%`;
        }, scale);
        const bounds = await details.evaluate((element) => {
          const rect = (selector: string) =>
            element.querySelector(selector)!.getBoundingClientRect();
          const select = rect(".details-map-picker select");
          const picker = rect(".details-map-picker");
          const actions = rect(".details-map-actions");
          const secondary = rect(".details-secondary-actions");
          return {
            selectWidth: select.width,
            pickerWidth: picker.width,
            overflow: select.right - actions.right,
            leftOffset: actions.left - secondary.left,
            rightOffset: select.right - secondary.right,
          };
        });
        expect(bounds.pickerWidth).toBe(56);
        expect(bounds.selectWidth).toBeCloseTo(bounds.pickerWidth, 0);
        expect(bounds.overflow).toBeLessThanOrEqual(1);
        expect(bounds.leftOffset).toBeCloseTo(0, 0);
        expect(bounds.rightOffset).toBeCloseTo(0, 0);
      }
    } finally {
      await browser.close();
    }
  });
}
