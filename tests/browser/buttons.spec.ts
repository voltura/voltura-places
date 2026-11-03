import { chooseSaveOption } from "./fixtures";
import { test, expect, chromium, webkit, devices, mockMapTiles } from "./fixtures";
import { skins } from "../../src/client/foundation/appearance";

for (const engine of [chromium, webkit]) {
  for (const desktop of [false, true]) {
    test(`${engine.name()} ${desktop ? "mouse" : "touch"}: shared action hierarchy`, async ({}, testInfo) => {
      // This flow checks every skin/mode and captures seven screenshots. Keep
      // individual assertion timeouts while allowing the complete WebKit flow.
      test.setTimeout(60000);
      const browser = await engine.launch();
      const context = await browser.newContext({
        ...(desktop ? { viewport: { width: 1280, height: 900 } } : devices["iPhone 13"]),
        baseURL: "http://127.0.0.1:5174",
        locale: "en-US",
        permissions: ["geolocation"],
        geolocation: { latitude: 0, longitude: 0, accuracy: 8 },
        serviceWorkers: "block",
      });
      await mockMapTiles(context);
      await context.addInitScript(() => {
        localStorage.setItem("places-account-choice", "done");
        Object.defineProperty(navigator, "permissions", {
          value: { query: async () => Object.assign(new EventTarget(), { state: "granted" }) },
        });
        Object.defineProperty(navigator, "geolocation", {
          value: {
            watchPosition: (success: PositionCallback) => {
              setTimeout(
                () =>
                  success({
                    timestamp: Date.now(),
                    coords: { latitude: 0, longitude: 0, accuracy: 8 },
                  } as GeolocationPosition),
                0,
              );

              return 1;
            },
            clearWatch: () => {},
          },
        });
      });
      const page = await context.newPage();
      try {
        await page.goto("/");
        await chooseSaveOption(page, "details");
        const add = page.getByRole("dialog", { name: "Add place", exact: true });
        const cancel = add.getByRole("button", { name: "Cancel", exact: true });
        await expect(cancel).toHaveClass("button outline subdued");
        const choosePhoto = add.getByRole("button", { name: "Choose photo", exact: true });
        await expect(choosePhoto).toHaveClass("button outline");
        const borders = await add.evaluate((el) => {
          const buttons = [...el.querySelectorAll("button")];
          const cancel = buttons.find((button) => button.textContent?.trim() === "Cancel")!;
          const photo = buttons.find((button) => button.textContent?.trim() === "Choose photo")!;

          return [getComputedStyle(cancel).borderTopColor, getComputedStyle(photo).borderTopColor];
        });
        expect(borders[0]).not.toBe(borders[1]);
        await expect(cancel).toHaveCSS("border-top-style", "solid");
        expect(
          await cancel.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)),
        ).toBeGreaterThan(0);
        await expect(add.getByRole("button", { name: "Save", exact: true })).toHaveClass(/primary/);
        await page.keyboard.press("Tab");
        await cancel.focus();
        await expect(cancel).toBeFocused();
        expect(
          await cancel.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)),
        ).toBeGreaterThanOrEqual(1.5);
        await page.screenshot({ path: testInfo.outputPath("add.png") });
        await cancel.click();
        await page.getByRole("button", { name: "Save position", exact: true }).click();
        const saved = page.getByRole("dialog", { name: "Place saved", exact: true });
        await saved
          .getByRole("textbox", { name: "Name", exact: true })
          .fill("Button review fixture");
        const discard = saved.getByRole("button", { name: "Discard place", exact: true });
        await expect(discard).toHaveClass("button danger");
        expect(
          await discard.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)),
        ).toBeGreaterThan(0);
        await expect(discard.locator("svg")).toHaveCount(1);

        // Isolate steady-state palettes from the 160ms surface transitions.
        await page.locator(".button").evaluateAll((buttons) =>
          buttons.forEach((button) => {
            (button as HTMLElement).style.transition = "none";
          }),
        );
        // Measure resolved, rendered colours rather than unexpanded CSS tokens.
        for (const skin of skins) {
          for (const mode of ["light", "dark"]) {
            await page.evaluate(
              ({ skin, mode }) => {
                document.documentElement.dataset.skin = skin;
                document.documentElement.dataset.theme = mode;
              },
              { skin, mode },
            );

            const contrast = await discard.evaluate((element) => {
              const css = getComputedStyle(element);
              const probe = document.createElement("canvas").getContext("2d")!;

              const rgb = (colour: string) => {
                probe.fillStyle = colour;
                probe.fillRect(0, 0, 1, 1);

                return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3).map((x) => x / 255);
              };

              const lum = (colour: string) =>
                rgb(colour)
                  .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

              const ratio = (a: string, b: string) =>
                (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

              return {
                danger: ratio(css.color, css.backgroundColor),
                border: ratio(css.borderTopColor, css.backgroundColor),
                focus: ratio(css.outlineColor, css.backgroundColor),
              };
            });

            expect(contrast.danger, `${skin} ${mode} danger`).toBeGreaterThanOrEqual(4.5);
            expect(contrast.border, `${skin} ${mode} border`).toBeGreaterThanOrEqual(3);
            expect(contrast.focus, `${skin} ${mode} focus`).toBeGreaterThanOrEqual(3);
          }
        }
        await page.locator(".button").evaluateAll((buttons) =>
          buttons.forEach((button) => {
            (button as HTMLElement).style.removeProperty("transition");
          }),
        );
        await page.screenshot({ path: testInfo.outputPath("saved.png") });
        await discard.click();
        const confirmation = page.getByRole("dialog", { name: "Discard this place?", exact: true });
        const finalDiscard = confirmation.getByRole("button", {
          name: "Discard place",
          exact: true,
        });
        await expect(finalDiscard).toHaveClass("button danger confirm");
        const finalColours = await finalDiscard.evaluate((el) => {
          const css = getComputedStyle(el);

          return { background: css.backgroundColor, border: css.borderTopColor, color: css.color };
        });
        expect(finalColours.background).toBe(finalColours.border);
        expect(finalColours.color).not.toBe(finalColours.background);
        await page.screenshot({ path: testInfo.outputPath("confirmation.png") });
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(saved.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
          "Button review fixture",
        );
        await saved.getByRole("button", { name: "Done", exact: true }).click();
        await expect(saved).toBeHidden();
        if (!desktop) {
          await page
            .getByRole("dialog")
            .getByRole("button", { name: "Close", exact: true })
            .click();
        }
        await page
          .getByRole("button", { name: "Edit place: Button review fixture", exact: true })
          .click();
        const menu = page.locator(".place-actions");
        await expect(menu.getByRole("button")).toHaveCount(3);
        for (const row of await menu.getByRole("button").all()) {
          await expect(row).toHaveCSS("text-align", "center");
          await expect(row).toHaveCSS("border-top-style", "solid");
          expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
        }
        await expect(menu.getByRole("button", { name: "Delete", exact: true })).toHaveClass(
          /danger/,
        );
        await page.screenshot({ path: testInfo.outputPath("menu.png") });
        await menu.getByRole("button", { name: "Edit", exact: true }).click();
        const edit = page.getByRole("dialog", { name: "Edit place", exact: true });
        expect(
          await edit
            .getByRole("button", { name: "Cancel", exact: true })
            .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth)),
        ).toBeGreaterThan(0);
        await expect(edit.getByRole("button", { name: "Delete", exact: true })).toHaveClass(
          /danger/,
        );
        await page.screenshot({ path: testInfo.outputPath("edit.png") });
        await edit.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("sv");
        await page.getByRole("button", { name: "Stäng", exact: true }).click();
        await page.setViewportSize({ width: 320, height: 700 });
        if (desktop) {
          await page
            .getByRole("dialog", { name: "Platsinformation", exact: true })
            .getByRole("button", { name: "Stäng", exact: true })
            .click();
        }
        await page.getByRole("button", { name: "Lägg till plats", exact: true }).click();
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        const narrow = page.getByRole("dialog", { name: "Lägg till plats", exact: true });
        for (const button of await narrow.locator(".button").all()) {
          await button.scrollIntoViewIfNeeded();
          const box = await button.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(48);
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(320);
          expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath("swedish-large-text.png") });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
}
