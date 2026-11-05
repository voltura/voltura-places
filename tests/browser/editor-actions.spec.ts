import { test, expect, chromium, webkit, mockMapTiles } from "./fixtures";
import { messages } from "../../src/client/foundation/i18n";

for (const engine of [chromium, webkit]) {
  for (const language of ["en", "sv"] as const) {
    test(`${engine.name()} ${language} editor keeps its save action reachable and closing retains the place`, async ({}, testInfo) => {
      const browser = await engine.launch();
      const context = await browser.newContext({
        baseURL: String(testInfo.project.use.baseURL),
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        serviceWorkers: "block",
        permissions: ["geolocation"],
        geolocation: { latitude: 0, longitude: 0, accuracy: 8 },
      });
      const page = await context.newPage();
      const t = messages(language);
      try {
        await mockMapTiles(context);
        await page.addInitScript(() => {
          localStorage.setItem("places-account-choice", "done");

          const position = () =>
            ({
              coords: { latitude: 0, longitude: 0, accuracy: 8 },
              timestamp: Date.now(),
            }) as GeolocationPosition;

          Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: {
              getCurrentPosition: (success: PositionCallback) => success(position()),
              watchPosition: (success: PositionCallback) =>
                window.setTimeout(() => success(position()), 0),
              clearWatch: (id: number) => window.clearTimeout(id),
            },
          });
        });
        await page.goto(`/?lang=${language}`);
        await page.getByRole("button", { name: t("saveHere"), exact: true }).click();
        const editor = page.getByRole("dialog", { name: t("placeSaved"), exact: true });
        const name = editor.getByRole("textbox", { name: t("name"), exact: true });
        const originalName = await name.inputValue();
        await name.fill("Lakeside picnic");
        await editor.getByRole("button", { name: t("addDescription"), exact: true }).click();
        await editor
          .getByRole("textbox", { name: t("description"), exact: true })
          .fill("A quiet place by the lake.");
        // Chromium covers photo expansion; WebKit covers the expanded description and viewport.
        if (engine === chromium) {
          await editor
            .locator('input[type="file"][accept="image/*"]:not([capture])')
            .setInputFiles("tests/fixtures/photo.jpg");
          await expect(
            editor.getByRole("img", { name: t("placePhoto"), exact: true }),
          ).toBeVisible();
        }
        const done = editor.getByRole("button", { name: t("done"), exact: true });
        await expect(done).toBeEnabled();
        const body = editor.locator(".sheet-content");
        for (const viewport of [
          { width: 320, height: 568 },
          { width: 667, height: 375 },
          { width: 1280, height: 800 },
        ]) {
          await page.setViewportSize(viewport);
          await body.evaluate((element) => element.scrollTo(0, 0));
          await expect(done).toBeInViewport({ ratio: 1 });
          expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(56);
          expect(
            await editor.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
          await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
          await expect(done).toBeInViewport({ ratio: 1 });
        }
        await page.setViewportSize({ width: 375, height: 667 });
        await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%"));
        await body.evaluate((element) => element.scrollTo(0, 0));
        await expect(done).toBeInViewport({ ratio: 1 });
        expect(await body.evaluate((element) => element.clientHeight)).toBeGreaterThan(100);
        await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
        await page.screenshot({ path: testInfo.outputPath("editor-footer.png") });

        // A keyboard reduces the visual viewport without resizing the layout viewport on iOS.
        await page.evaluate(() => {
          const viewport = window.visualViewport!;
          Object.defineProperties(viewport, {
            height: { configurable: true, value: 320 },
            offsetTop: { configurable: true, value: 12 },
          });
          viewport.dispatchEvent(new Event("resize"));
        });
        await expect
          .poll(async () => {
            const bounds = (await done.boundingBox())!;

            return bounds.y + bounds.height;
          })
          .toBeLessThanOrEqual(332);
        expect(await body.evaluate((element) => element.clientHeight)).toBeGreaterThan(50);
        await page.evaluate(() => {
          const viewport = window.visualViewport!;
          Reflect.deleteProperty(viewport, "height");
          Reflect.deleteProperty(viewport, "offsetTop");
          viewport.dispatchEvent(new Event("resize"));
        });

        await editor.getByRole("button", { name: t("close"), exact: true }).click();
        const confirmation = page.getByRole("dialog", { name: t("discardChanges"), exact: true });
        await expect(confirmation).toContainText(t("discardSavedChangesHint"));
        await expect(
          confirmation.getByRole("button", { name: t("keepEditing"), exact: true }),
        ).toBeFocused();
        await confirmation.getByRole("button", { name: t("keepEditing"), exact: true }).click();
        await expect(name).toHaveValue("Lakeside picnic");
        await editor.getByRole("button", { name: t("close"), exact: true }).click();
        await confirmation.getByRole("button", { name: t("discard"), exact: true }).click();
        await expect(editor).toHaveCount(0);
        await expect(page.locator(".place-card")).toHaveCount(1);
        await expect(page.locator(".place-card")).toContainText(originalName);
        await page.getByRole("button", { name: t("editAction"), exact: true }).click();
        const edit = page.getByRole("dialog", { name: t("edit"), exact: true });
        await edit
          .getByRole("textbox", { name: t("name"), exact: true })
          .fill("Saved using the footer");
        await edit.getByRole("button", { name: t("save"), exact: true }).click();
        await expect(edit).toHaveCount(0);
        await page.reload();
        await expect(page.locator(".place-card")).toContainText("Saved using the footer");
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
}
