import { test, expect } from "./fixtures";
import { skins } from "../../src/client/foundation/appearance";

for (const skin of skins) {
  for (const mode of ["light", "dark"] as const) {
    test(`${skin} ${mode}: readable, independent and persistent`, async ({
      page,
      context,
    }, testInfo) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const modePicker = page.getByRole("combobox", { name: "Color mode", exact: true });
      const skinPicker = page.getByRole("combobox", { name: "Theme", exact: true });
      await skinPicker.selectOption(skin);
      await modePicker.selectOption(mode);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
      const contrast = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const lum = (hex: string) => {
          let digits = hex.trim().replace("#", "");
          if (digits.length === 3) digits = [...digits].map((x) => x + x).join("");
          const rgb = digits
            .match(/../g)!
            .map((x) => parseInt(x, 16) / 255)
            .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const ratio = (a: string, b: string) => {
          const x = lum(css.getPropertyValue(a)),
            y = lum(css.getPropertyValue(b));
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        return {
          text: ratio("--text", "--surface"),
          muted: ratio("--muted", "--surface"),
          primary: ratio("--on-accent", "--accent"),
          primaryTop: ratio("--on-accent", "--accent-top"),
          danger: ratio("--danger", "--surface"),
          bg: css.getPropertyValue("--bg").trim(),
          meta: document.querySelector('meta[name="theme-color"]')!.getAttribute("content"),
        };
      });
      for (const value of [
        contrast.text,
        contrast.muted,
        contrast.primary,
        contrast.primaryTop,
        contrast.danger,
      ])
        expect(value).toBeGreaterThanOrEqual(4.5);
      expect(contrast.meta).toBe(contrast.bg);
      await skinPicker.focus();
      await expect(skinPicker).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("combobox", { name: "Language", exact: true })).toBeFocused();
      await page.setViewportSize({ width: 320, height: 700 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      expect(
        await page.locator(".sheet-content").evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
      await page.screenshot({ path: testInfo.outputPath(`${skin}-${mode}.png`) });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(skinPicker).toHaveValue(skin);
      await expect(modePicker).toHaveValue(mode);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 6 });
      await page.getByRole("button", { name: "Save position", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      const details = page.getByRole("dialog", { name: "Place details", exact: true });
      await expect(details).toBeVisible();
      const copy = details.getByRole("button", { name: "Copy coordinates", exact: true });
      await copy.hover();
      const tooltip = page.getByRole("tooltip", { name: "Copy coordinates", exact: true });
      await expect(tooltip).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${skin}-${mode}-details.png`) });
      await page.keyboard.press("Escape");
      await details.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Map", exact: true }).click();
      await expect(page.locator(".leaflet-container")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${skin}-${mode}-map.png`) });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await skinPicker.selectOption(skin === "forest" ? "matrix" : "forest");
      await expect(modePicker).toHaveValue(mode);
    });
  }
}

test("legacy and invalid skins preserve mode; System follows OS", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language: "en", provider: "apple", theme: "system", skin: "unknown" }),
      );
      sessionStorage.setItem("seeded", "yes");
    }
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "forest");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("midnight");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "midnight");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("sv");
  await expect(page.getByRole("combobox", { name: "Tema", exact: true })).toHaveValue("midnight");
  await expect(page.getByRole("combobox", { name: "Färgläge", exact: true })).toHaveValue("system");
});

for (const skin of skins) {
  for (const mode of ["light", "dark"] as const) {
    test(`before app execution: ${skin} ${mode}`, async ({ page }) => {
      await page.addInitScript(
        ({ skin, mode }) =>
          localStorage.setItem(
            "places-preferences",
            JSON.stringify({ language: "en", provider: "", theme: mode, skin }),
          ),
        { skin, mode },
      );
      await page.route("**/assets/*.js", (route) => route.abort());
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await expect(page.locator("#root")).toBeEmpty();
    });
  }
}

test("legacy mode without a skin remains light", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", provider: "", theme: "light" }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "forest");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("storage unavailable: defaults render and selections still work", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Unavailable");
      },
    });
  });
  await page.goto("/");
  // Onboarding remains usable without localStorage.
  const skip = page.getByRole("button", {
    name: /without an account|on this device|Get started|Continue offline/i,
  });
  if ((await skip.count()) === 1 && (await skip.isVisible())) await skip.click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "forest");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("retro-wood");
  await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "retro-wood");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
