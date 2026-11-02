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
      language === "sv" ? "Uppdatering dröjer · försöker igen" : "Refresh delayed · will retry",
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

test("foreground events share a pull and a committed edit retries the exact lost request", async ({
  page,
}) => {
  const accountId = "sync-burst-fixture";
  let identities = 0;
  let pulls = 0;
  let hold = false;
  let release: (() => void) | undefined;
  const bodies: string[] = [];
  const records: unknown[] = [];
  await page.route("**/api/account", (route) => {
    identities++;

    return route.fulfill({
      json: { enabled: true, providers: {}, account: { id: accountId, methods: [] } },
    });
  });
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", async (route) => {
    if (route.request().method() === "POST") {
      bodies.push(route.request().postData()!);
      const mutation = route.request().postDataJSON();
      if (bodies.length === 1) {
        records.push({ ...mutation.entity, revision: 1, deleted: false });

        return route.abort("connectionreset");
      }

      return route.fulfill({ json: { accountId, record: records[0] } });
    }
    pulls++;
    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }

    return route.fulfill({ json: { version: 1, accountId, records } });
  });
  await page.goto("/");
  const status = page.locator("#account-sync-status");
  await expect(status).toHaveText("Synced");
  const before = { identities, pulls };
  hold = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => !!release).toBe(true);
  expect(identities - before.identities).toBe(1);
  expect(pulls - before.pulls).toBe(1);
  await page.getByRole("combobox", { name: "Save options" }).selectOption("details");
  const editor = page.getByRole("dialog", { name: "Add place" });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Park");
  await editor.getByRole("button", { name: "Enter coordinates manually" }).click();
  await editor.getByRole("textbox", { name: "Latitude" }).fill("1");
  await editor.getByRole("textbox", { name: "Longitude" }).fill("1");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  hold = false;
  release!();
  await expect(status).toHaveText("Saved locally · will retry");
  await page.getByRole("button", { name: "Account & sync", exact: true }).click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(status).toHaveText("Synced");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
});

for (const status of [401, 403, 503]) {
  test(`photo upload HTTP ${status} reports the appropriate sync status`, async ({ page }) => {
    const accountId = "photo-upload-fixture";
    let mutations = 0;
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: { enabled: true, providers: {}, account: { id: accountId, methods: [] } },
      }),
    );
    await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
    await page.route("**/api/v1/sync", (route) => {
      if (route.request().method() === "POST") {
        mutations++;
      }

      return route.fulfill({ json: { version: 1, accountId, records: [] } });
    });
    await page.route("**/api/v1/photos/*", (route) => route.fulfill({ status }));
    await page.goto("/");
    const feedback = page.locator("#account-sync-status");
    await expect(feedback).toHaveText("Synced");
    await page.getByRole("combobox", { name: "Save options" }).selectOption("details");
    const editor = page.getByRole("dialog", { name: "Add place" });
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Photo fixture");
    await editor.getByRole("button", { name: "Enter coordinates manually" }).click();
    await editor.getByRole("textbox", { name: "Latitude" }).fill("1");
    await editor.getByRole("textbox", { name: "Longitude" }).fill("1");
    await editor
      .locator('input[type="file"][accept="image/*"]:not([capture])')
      .setInputFiles("tests/fixtures/photo.jpg");
    await expect(editor.locator(".photo-picker img")).toBeVisible();
    const upload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/photos/") && response.request().method() === "PUT",
    );
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    expect((await upload).status()).toBe(status);
    await expect(feedback).toHaveText(
      status === 503 ? "Saved locally · will retry" : "Sync needs attention",
    );
    expect(mutations).toBe(0);
  });
}
