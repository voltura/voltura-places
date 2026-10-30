import { mockMapTiles } from "./fixtures";
import { test, expect, chromium, webkit, devices } from "./fixtures";

for (const engine of [webkit, chromium]) {
  test(`${engine.name()} keeps the details map dropdown inside the phone content margins`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"], locale: "en-US" });
      await mockMapTiles(context);
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
      await expect(details.getByRole("heading", { name: "Place", exact: true })).toBeVisible();
      await expect(details.locator(".metadata-date")).not.toBeEmpty();
      for (const [width, scale] of [
        [320, 1],
        [390, 1],
        [375, 1],
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
        if (width === 375 && scale === 1) {
          const sheet = page.getByRole("dialog", { name: "Place details", exact: true });
          const head = (await sheet.locator(".sheet-head").boundingBox())!;
          const name = (await details.locator("h2").boundingBox())!;
          expect(name.y - head.y - head.height).toBeCloseTo(8, 0);
          await page.screenshot({ path: `.artifacts/details-name-${engine.name()}.png` });
        }
      }
    } finally {
      await browser.close();
    }
  });
}
