import { test, expect, chromium, webkit } from "./fixtures";
import { messages } from "../../src/client/foundation/i18n";

for (const engine of [chromium, webkit]) {
  for (const width of [390, 1280]) {
    test(`${engine.name()} standalone Settings actions at ${width}px`, async ({}, testInfo) => {
      const browser = await engine.launch();
      const language = width === 390 ? "sv" : "en";
      const t = messages(language);
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:5174",
        viewport: { width, height: 900 },
        serviceWorkers: "block",
      });
      try {
        await context.addInitScript(() => {
          localStorage.setItem("places-account-choice", "done");
          Object.defineProperty(navigator, "storage", {
            configurable: true,
            value: { persisted: async () => false, persist: async () => false },
          });
        });
        await context.route("**/api/account", (route) =>
          route.fulfill({
            json: { enabled: true, providers: { google: true, email: true }, account: null },
          }),
        );
        const page = await context.newPage();
        await page.goto(`/?lang=${language}`);
        await page.getByRole("button", { name: t("settings"), exact: true }).click();
        const sheet = page.getByRole("dialog", { name: t("settings"), exact: true });

        const chooseSection = async (
          key: "familySharing" | "account" | "preferences" | "backup",
        ) => {
          const selector = sheet.getByRole("combobox", { name: t("settings"), exact: true });
          if (await selector.isVisible()) {
            await selector.selectOption(key);
          } else {
            await sheet.getByRole("button", { name: t(key), exact: true }).click();
          }
        };

        const checkAction = async (label: string) => {
          const button = sheet.getByRole("button", { name: label, exact: true });
          const bounds = await button.evaluate((element) => {
            const action = element.getBoundingClientRect();
            const container = element.parentElement!.getBoundingClientRect();

            return {
              left: action.left,
              width: action.width,
              height: action.height,
              containerLeft: container.left,
              containerWidth: container.width,
            };
          });
          expect(bounds.height).toBeGreaterThanOrEqual(48);
          expect(Math.abs(bounds.left - bounds.containerLeft)).toBeLessThanOrEqual(1);
          if (width > 700) {
            expect(bounds.width).toBeLessThan(bounds.containerWidth * 0.8);
          } else {
            expect(Math.abs(bounds.width - bounds.containerWidth)).toBeLessThanOrEqual(1);
          }
        };

        await chooseSection("familySharing");
        await expect(sheet.locator(".family-panel > p")).toHaveText(
          language === "sv"
            ? "Dela platser med familjen eller grupper. Dina privata platser förblir privata."
            : "Share places with family or groups. Your private places stay private.",
        );
        await checkAction(t("familySignIn"));
        await page.screenshot({ path: testInfo.outputPath("family-sharing.png") });
        await sheet.getByRole("button", { name: t("familySignIn"), exact: true }).click();
        await expect(
          sheet.getByRole("button", { name: `G ${t("continueGoogle")}`, exact: true }),
        ).toBeVisible();
        await checkAction(`G ${t("continueGoogle")}`);
        await checkAction(t("sendCode"));
        await chooseSection("preferences");
        await checkAction(t("checkUpdates"));
        await chooseSection("backup");
        await checkAction(t("persist"));
        await page.screenshot({ path: testInfo.outputPath("backup-storage.png") });
      } finally {
        await context.close();
        await browser.close();
      }
    });
  }
}
