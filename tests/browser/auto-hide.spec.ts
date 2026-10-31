import { chromium, webkit, devices, expect, test, mockMapTiles } from "./fixtures";

for (const engine of [chromium, webkit]) {
  for (const desktop of [false, true]) {
    test(`${engine.name()} ${desktop ? "desktop" : "phone"} auto-hide save bar`, async () => {
      const browser = await engine.launch();
      const context = await browser.newContext({
        ...(desktop ? { viewport: { width: 1280, height: 800 } } : devices["iPhone 13"]),
        baseURL: "http://127.0.0.1:5174",
        locale: "en-US",
        reducedMotion: desktop ? "no-preference" : "reduce",
      });
      await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      await mockMapTiles(context);
      const page = await context.newPage();
      try {
        await page.goto("/");
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeEnabled();
        await page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open("voltura-places", 1);
            request.onsuccess = () => resolve(request.result);
          });
          const tx = db.transaction("workspaces", "readwrite");
          tx.objectStore("workspaces").put({
            key: "guest",
            reconciled: true,
            presetRevision: 2,
            records: Array.from({ length: 20 }, (_, i) => ({
              id: `place-${i}`,
              kind: "place",
              value: {
                name: `Place ${i}`,
                categoryId: "other",
                latitude: 59.33 + i * 0.001,
                longitude: 18.07,
                accuracy: 8,
                capturedAt: "2026-10-30T10:00:00Z",
                updatedAt: "2026-10-30T10:00:00Z",
              },
              deleted: false,
              revision: 0,
              generation: 1,
              dirty: true,
            })),
          });
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
          });
          db.close();
          window.dispatchEvent(new Event("places-library"));
        });
        await expect(page.locator(".place-card")).toHaveCount(20);
        await page.evaluate(() => window.scrollTo(0, 300));
        await expect(page.locator(".save-dock")).not.toHaveClass(/controls-hidden/);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        const setting = page.getByRole("switch", {
          name: "Auto-hide save bar",
          exact: true,
        });
        await expect(setting).not.toBeChecked();
        await setting.check();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.evaluate(() => window.scrollTo(0, 30));
        await expect(page.locator(".save-dock")).not.toHaveClass(/controls-hidden/);
        await page.getByRole("textbox", { name: "Search your places", exact: true }).focus();
        await page.evaluate(async () => {
          window.scrollBy(0, 100);
          await new Promise(requestAnimationFrame);
        });
        await expect(page.locator(".save-dock")).not.toHaveClass(/controls-hidden/);
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.evaluate(() => window.scrollTo(0, 300));
        const reveal = page.getByRole("button", { name: "Show save bar", exact: true });
        await expect(reveal).toBeVisible();
        const rightAlignment = await reveal.evaluate((element) => {
          const header = document.querySelector(".header-inner")!;
          const edge =
            header.getBoundingClientRect().right -
            parseFloat(getComputedStyle(header).paddingRight);
          return Math.abs(element.getBoundingClientRect().right - edge);
        });
        expect(rightAlignment).toBeLessThanOrEqual(1);
        await expect(page.locator(".app-header")).toHaveCSS("position", "static");
        await expect(page.locator(".save-dock")).toHaveCSS("opacity", "0");
        const transition = await page
          .locator(".save-dock")
          .evaluate((element) => getComputedStyle(element).transitionDuration);
        expect(transition.includes("0.2s")).toBe(desktop);
        await expect(page.locator(".save-dock")).toHaveAttribute("inert", "");
        await expect(page.locator(".app-header")).not.toHaveAttribute("inert");
        await expect(page.getByRole("button", { name: "Save position", exact: true })).toHaveCount(
          0,
        );
        const y = await page.evaluate(() => window.scrollY);
        await page.evaluate((y) => window.scrollTo(0, y - 30), y);
        await expect(reveal).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Settings", exact: true }),
        ).not.toBeInViewport();
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.evaluate(() => window.scrollBy(0, 100));
        await expect(reveal).toBeVisible();
        expect((await reveal.boundingBox())!.height).toBeGreaterThanOrEqual(48);
        await page.screenshot({
          path: `.artifacts/auto-hide-${engine.name()}-${desktop ? "desktop" : "phone"}.png`,
        });
        await reveal.focus();
        await reveal.press("Enter");
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeFocused();
        await page.evaluate(() => window.scrollBy(0, 100));
        await expect(reveal).toHaveCount(0);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await expect(setting).toBeChecked();
        await page.reload();
        await expect(page.locator(".auto-hide-dock")).toBeVisible();
        await page.evaluate(() =>
          Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: { watchPosition: () => 1, clearWatch: () => {} },
          }),
        );
        await page.getByRole("button", { name: "Save position", exact: true }).click();
        await page.evaluate(async () => {
          window.scrollBy(0, 100);
          await new Promise(requestAnimationFrame);
        });
        await expect(
          page.getByRole("button", { name: "Cancel locating", exact: true }),
        ).toBeVisible();
        await expect(reveal).toHaveCount(0);
        await page.getByRole("button", { name: "Cancel locating", exact: true }).click();
        await page.getByRole("button", { name: "Map", exact: true }).click();
        await expect(page.locator(".leaflet-container")).toBeVisible();
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await expect(reveal).toHaveCount(0);
        await page.getByRole("button", { name: "Zoom in", exact: true }).click();
        await expect(reveal).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect
          .poll(async () => {
            const attribution = (await page
              .locator(".places-map-section:not(.places-map-preview) .leaflet-control-attribution")
              .boundingBox())!;
            const pill = (await reveal.boundingBox())!;
            return attribution.y + attribution.height <= pill.y;
          })
          .toBe(true);
        await reveal.click();
        const map = page.locator(".places-map");
        const bounds = (await map.boundingBox())!;
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2, {
          steps: 6,
        });
        await page.mouse.up();
        await expect(reveal).toBeVisible();
        await reveal.click();
        if (await page.getByRole("button", { name: "Show all", exact: true }).isVisible()) {
          await page.getByRole("button", { name: "Show all", exact: true }).click();
          await expect(reveal).toHaveCount(0);
        }
        await page.getByRole("button", { name: "Fullscreen map", exact: true }).click();
        await expect(reveal).toHaveCount(0);
        await page.getByRole("button", { name: "Exit fullscreen map", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "List", exact: true }).click();
        await page.evaluate(() => {
          (document.activeElement as HTMLElement)?.blur();
          document.documentElement.style.fontSize = "200%";
        });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(reveal).toBeVisible();
        await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
        });
        await expect(reveal).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(
          page
            .locator(".place-card")
            .last()
            .getByRole("button", { name: "Edit place: Place 19", exact: true }),
        ).toBeInViewport();
        expect(
          await page.locator("main").evaluate((element) => getComputedStyle(element).paddingBottom),
        ).toBe("24px");
        await page.screenshot({
          path: `.artifacts/auto-hide-floating-${engine.name()}-${desktop ? "desktop" : "phone"}.png`,
        });
        await reveal.click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await setting.uncheck();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.evaluate(() => {
          const value = JSON.parse(localStorage.getItem("places-preferences")!);
          value.autoHideControls = "true";
          localStorage.setItem("places-preferences", JSON.stringify(value));
        });
        await page.reload();
        await expect(page.locator(".auto-hide-dock")).toHaveCount(0);
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
}
