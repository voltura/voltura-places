import { test, expect } from "./fixtures";
import { messages } from "../../src/client/foundation/i18n";

test.use({ serviceWorkers: "block" });

for (const language of ["en", "sv"] as const) {
  test("account display name saves, retries and clears (" + language + ")", async ({ page }) => {
    const t = messages(language);
    const account = {
      id: "profile-fixture",
      displayName: null as string | null,
      methods: [{ provider: "email", label: "fixture@example.invalid" }],
    };
    const attempted: (string | null)[] = [];
    let failSave = true;
    let failRefresh = false;
    await page.setViewportSize({ width: language === "en" ? 320 : 390, height: 844 });
    await page.addInitScript((language) => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem("places-preferences", JSON.stringify({ theme: "light", language }));
    }, language);
    await page.route("**/api/account", (route) => {
      if (failRefresh) {
        failRefresh = false;

        return route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
      }

      return route.fulfill({ json: { enabled: true, providers: {}, account } });
    });
    await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
    await page.route("**/api/v1/sync*", (route) =>
      route.fulfill({ json: { version: 1, accountId: account.id, records: [] } }),
    );
    await page.route("**/api/account/display-name", (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-places-account"]).toBe(account.id);
      const { displayName } = route.request().postDataJSON();
      attempted.push(displayName);
      if (failSave) {
        failSave = false;

        return route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
      }
      account.displayName = displayName;
      if (attempted.length === 2) {
        failRefresh = true;
      }

      return route.fulfill({ json: { account } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: t("settings"), exact: true }).click();
    const sheet = page.getByRole("dialog", { name: t("settings"), exact: true });
    await sheet.getByRole("combobox", { name: t("settings"), exact: true }).selectOption("account");
    const form = sheet.getByRole("form", { name: t("profileName"), exact: true });
    const input = form.getByRole("textbox", { name: t("profileName") });
    const save = form.getByRole("button", { name: t("profileSave"), exact: true });
    await expect(input).toHaveValue("");
    const unicode = "\u{1f33f}".repeat(60);
    await input.fill(unicode + "x");
    await expect(save).toBeDisabled();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill(unicode);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(form.getByRole("alert")).toHaveText(t("profileSaveFailed"));
    await expect(input).toHaveValue(unicode);
    await save.click();
    await expect(form.getByRole("alert")).toHaveText(t("profileRefreshFailed"));
    if (language === "en") {
      await form.getByRole("button", { name: t("profileClear"), exact: true }).click();
      await expect(save).toBeEnabled();
      await save.click();
      await expect(form.getByRole("status")).toHaveText(t("profileSaved"));
      expect(attempted.at(-1)).toBe(null);
      await input.fill(unicode);
      await save.click();
    } else {
      await form.getByRole("button", { name: t("retry"), exact: true }).click();
    }
    await expect(sheet.locator(".account-summary strong")).toHaveText(unicode);
    const firstWrites = language === "en" ? [unicode, unicode, null, unicode] : [unicode, unicode];
    expect(attempted).toEqual(firstWrites);
    expect(await sheet.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(
      await sheet.evaluate((el) => el.clientWidth),
    );
    const example = language === "en" ? "Alex Woods" : "Alex Skog";
    await input.fill("   " + example + "   ");
    await save.click();
    await expect(form.getByRole("status")).toHaveText(t("profileSaved"));
    await expect(input).toHaveValue(example);
    await expect(sheet.locator(".account-summary")).not.toContainText(account.methods[0].label);
    await sheet.locator(".sheet-content").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: ".artifacts/profile-name-" + language + ".png" });
    await sheet
      .locator("summary")
      .filter({ hasText: t("linkedMethods") })
      .click();
    await expect(sheet.locator(".methods")).toContainText(account.methods[0].label);
    await form.getByRole("button", { name: t("profileClear"), exact: true }).click();
    await save.click();
    await expect(form.getByRole("status")).toHaveText(t("profileSaved"));
    await expect(sheet.locator(".account-summary")).toContainText(account.methods[0].label);
    expect(attempted).toEqual([...firstWrites, example, null]);
  });
}
