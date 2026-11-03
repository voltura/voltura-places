import { test, expect } from "./fixtures";
import { messages } from "../../src/client/foundation/i18n";

for (const language of ["en", "sv"] as const) {
  for (const named of [false, true]) {
    test(`join confirmation and display-name handoff ${language} named=${named}`, async ({
      page,
    }, testInfo) => {
      const t = messages(language);
      const account = {
        id: "join-name-fixture",
        displayName: named ? "Demo member" : null,
        methods: [],
      };
      let pending = false;
      let reject = true;
      let submissions = 0;
      await page.route("**/api/account", (route) =>
        route.fulfill({ json: { enabled: true, providers: {}, account } }),
      );
      await page.route("**/api/v1/sync", (route) =>
        route.fulfill({ json: { version: 1, accountId: account.id, records: [] } }),
      );
      await page.route("**/api/family", (route) => {
        if (route.request().method() === "POST") {
          submissions++;
          if (reject) {
            return route.fulfill({ status: 403, json: { error: "invalidFamilyCode" } });
          }
          pending = true;
        }

        return route.fulfill({
          json: { families: [], pendingRequest: pending ? { expiresAt: 0 } : null },
        });
      });
      await page.route("**/api/account/display-name", async (route) => {
        account.displayName = route.request().postDataJSON().displayName;
        await route.fulfill({ json: { account } });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?lang=${language}`);
      await page.getByRole("button", { name: t("settings"), exact: true }).click();
      const settings = page.getByRole("dialog", { name: t("settings"), exact: true });
      await settings
        .getByRole("combobox", { name: t("settings"), exact: true })
        .selectOption("familySharing");
      await settings
        .getByRole("textbox", { name: t("familyInvitationCode"), exact: true })
        .fill("1234");
      await settings.getByRole("button", { name: t("familyRequestJoin"), exact: true }).click();
      const sent = page.getByRole("dialog", { name: t("familyRequestSentTitle"), exact: true });
      await expect(settings.getByRole("alert")).toBeVisible();
      await expect(sent).toHaveCount(0);
      reject = false;
      await settings.getByRole("button", { name: t("familyRequestJoin"), exact: true }).click();
      await expect(sent).toBeVisible();
      await expect(sent.getByRole("button", { name: t("done"), exact: true })).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("request-sent.png") });
      await sent.getByRole("button", { name: t("done"), exact: true }).click();
      await expect(sent).toHaveCount(0);
      await expect(settings.getByRole("status")).toHaveText(t("familyRequestSent"));
      await settings
        .getByRole("combobox", { name: t("settings"), exact: true })
        .selectOption("account");
      await settings
        .getByRole("combobox", { name: t("settings"), exact: true })
        .selectOption("familySharing");
      await expect(sent).toHaveCount(0);
      await settings
        .getByRole("textbox", { name: t("familyInvitationCode"), exact: true })
        .fill("1234");
      await settings.getByRole("button", { name: t("familyRequestJoin"), exact: true }).click();
      await sent
        .getByRole("button", {
          name: t(named ? "changeDisplayName" : "setDisplayName"),
          exact: true,
        })
        .click();
      const input = settings.getByRole("textbox", { name: t("profileName"), exact: true });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(named ? "Demo member" : "");
      await input.fill("Alex Demo");
      await input
        .locator("xpath=ancestor::form")
        .getByRole("button", { name: t("save"), exact: true })
        .click();
      await expect(settings.locator(".toast")).toHaveText(t("profileSaved"));
      await expect(input).toHaveValue("Alex Demo");
      expect(account.displayName).toBe("Alex Demo");
      expect(pending).toBe(true);
      expect(submissions).toBe(3);
    });
  }
}
