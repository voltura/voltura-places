import { test, expect } from "./fixtures";

for (const language of ["en", "sv"] as const) {
  test(`manual sync reports progress, success, failure and offline in ${language}`, async ({
    page,
    context,
  }, testInfo) => {
    const accountId = "manual-sync-fixture";
    let hold = false;
    let release: (() => Promise<void>) | undefined;
    let fail = false;
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          providers: { email: true },
          account: {
            id: accountId,
            methods: [{ provider: "email", label: "fixture@example.invalid" }],
          },
        },
      }),
    );
    await page.route("**/api/v1/sync", async (route) => {
      const respond = () =>
        fail
          ? route.fulfill({ status: 503, json: { error: "serviceUnavailable" } })
          : route.fulfill({ json: { version: 1, accountId, records: [] } });

      if (hold) {
        release = respond;
      } else {
        await respond();
      }
    });
    await page.goto(`/?lang=${language}`);
    await page
      .getByRole("button", {
        name: language === "sv" ? "Konto och synkronisering" : "Account & sync",
        exact: true,
      })
      .click();
    const status = page.locator("#settings-sync-status");
    const synced = language === "sv" ? "Synkroniserat" : "Synced";
    await expect(status).toHaveText(synced);
    const button = page.getByRole("button", {
      name: language === "sv" ? "Synkronisera nu" : "Sync now",
      exact: true,
    });
    hold = true;
    await button.click();
    await expect(
      page.getByRole("button", {
        name: language === "sv" ? "Synkroniserar…" : "Syncing…",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(status).toHaveText(language === "sv" ? "Synkroniserar…" : "Syncing…");
    await expect.poll(() => !!release).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("sync-progress.png") });
    hold = false;
    await release!();
    await expect(status).toHaveText(synced);
    await expect(button).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("sync-complete.png") });
    fail = true;
    await button.click();
    await expect(status).toHaveText(
      language === "sv" ? "Synkroniseringen behöver din hjälp" : "Sync needs attention",
    );
    await expect(button).toBeEnabled();
    await context.setOffline(true);
    await button.click();
    await expect(status).toHaveText(
      language === "sv"
        ? "Offline · ändringar sparas på enheten"
        : "Offline · changes stay on this device",
    );
    await expect(button).toBeEnabled();
  });
}
