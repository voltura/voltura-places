import { test, expect } from "./fixtures";
import { skins } from "../../src/client/foundation/appearance";
import { en, sv } from "../../src/client/foundation/i18n";

for (const language of ["en", "sv"] as const) {
  for (const width of [320, 1280]) {
    test(`promo theme deck: ${language} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:5175/places/${language === "sv" ? "sv/" : ""}#themes`);

      const section = page.locator("#themes");
      const region = section.getByRole("region");
      const dark = section.locator('[data-deck-mode="dark"]');
      const light = section.locator('[data-deck-mode="light"]');
      const images = section.locator(".theme-phone img");
      const labels = language === "sv" ? sv : en;
      await expect(section.locator("figcaption")).toHaveText(skins.map((skin) => labels[skin]));
      await expect(images).toHaveCount(skins.length);
      await expect(dark).toHaveAttribute("aria-pressed", "true");
      await expect(light).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      for (const mode of ["dark", "light"] as const) {
        if (mode === "light") {
          await light.click();
          await expect(light).toHaveAttribute("aria-pressed", "true");
          await expect(dark).toHaveAttribute("aria-pressed", "false");
        }
        for (const [index, skin] of skins.entries()) {
          const image = images.nth(index);
          await image.scrollIntoViewIfNeeded();
          await expect(image).toHaveAttribute(
            "src",
            new RegExp(`theme-${skin}-${language}-${mode}\\.[a-f0-9]{16}\\.webp$`),
          );
          await expect
            .poll(() =>
              image.evaluate((element: HTMLImageElement) => [
                element.complete,
                element.naturalWidth,
                element.naturalHeight,
              ]),
            )
            .toEqual([true, 1206, 2622]);
        }
      }

      await page.locator(".theme-toggle").click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(light).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(dark).toHaveAttribute("aria-pressed", "true");
      await expect(images.first()).toHaveAttribute("src", /-dark\.[a-f0-9]{16}\.webp$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 320) {
        await region.focus();
        await expect(region).toBeFocused();
        await region.evaluate((element) => (element.scrollLeft = 0));
        await page.keyboard.press("ArrowRight");
        await expect
          .poll(() => region.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
      }
    });
  }
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the dark captures without an inoperative mode control", async ({ page }) => {
    await page.goto("http://127.0.0.1:5175/places/#themes");
    const section = page.locator("#themes");
    await expect(section.locator(".theme-mode-switch")).toBeHidden();
    await expect(section.locator(".theme-phone img")).toHaveCount(skins.length);
    await expect(section.locator(".theme-phone img").first()).toHaveAttribute(
      "src",
      /-dark\.[a-f0-9]{16}\.webp$/,
    );
  });
});
