import { test, expect } from "./fixtures";

for (const language of ["en", "sv"] as const) {
  test(`manual sync reports progress, success, failure and offline in ${language}`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width: language === "en" ? 1280 : 390, height: 900 });
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
    const toast = page.locator(".toast");
    const synced = language === "sv" ? "Synkad" : "Synced";
    await expect(status).toHaveText(synced);
    await expect(toast).toHaveCount(0);
    const header = page.locator(".sync-pill");
    const headerBounds = await header.boundingBox();
    await expect(header.locator(".header-sync-icon .lucide-check")).toHaveCount(1);
    await expect(status.locator(".lucide-check")).toHaveCount(1);
    const explanation = page.getByText(
      language === "sv" ? "Platser synkroniseras automatiskt." : "Places sync automatically.",
      { exact: true },
    );
    const explanationBounds = (await explanation.boundingBox())!;
    const statusBounds = (await status.boundingBox())!;
    if (language === "en") {
      expect(statusBounds.x).toBeGreaterThanOrEqual(explanationBounds.x + explanationBounds.width);
      expect(
        Math.abs(
          statusBounds.y +
            statusBounds.height / 2 -
            explanationBounds.y -
            explanationBounds.height / 2,
        ),
      ).toBeLessThanOrEqual(1);
    } else {
      expect(statusBounds.y).toBeGreaterThanOrEqual(explanationBounds.y + explanationBounds.height);
      expect(Math.abs(statusBounds.x - explanationBounds.x)).toBeLessThanOrEqual(1);
    }
    await expect(header.locator("#account-sync-status")).toHaveClass(/sr-only/);
    const button = page.getByRole("button", {
      name: language === "sv" ? "Synkronisera nu" : "Sync now",
      exact: true,
    });
    const actions = button.locator("..");
    await expect(actions).toHaveClass("account-actions");
    await expect(button).toHaveClass("button outline");
    await expect(
      actions.getByRole("button", {
        name: language === "sv" ? "Logga ut" : "Sign out",
        exact: true,
      }),
    ).toHaveClass("button outline");
    hold = true;
    await button.click();
    await expect(
      page.getByRole("button", {
        name: language === "sv" ? "Synkar…" : "Syncing…",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(status).toHaveText(language === "sv" ? "Synkar…" : "Syncing…");
    await expect(header.locator(".header-sync-icon .lucide-refresh-cw.spin")).toHaveCount(1);
    await expect(status.locator(".lucide-refresh-cw.spin")).toHaveCount(1);
    expect(await header.boundingBox()).toEqual(headerBounds);
    await expect.poll(() => !!release).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("sync-progress.png") });
    hold = false;
    await release!();
    await expect(status).toHaveText(synced);
    await expect(toast).toContainText(language === "sv" ? "Synkronisering klar" : "Sync complete");
    await expect(header.locator(".header-sync-icon .lucide-check")).toHaveCount(1);
    expect(await header.boundingBox()).toEqual(headerBounds);
    await expect(button).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("sync-complete.png") });
    await page.clock.install();
    await page.clock.runFor(3100);
    await expect(toast).toHaveCount(0);
    fail = true;
    await button.click();
    await expect(status).toHaveText(
      language === "sv" ? "Uppdatering dröjer · försöker igen" : "Refresh delayed · will retry",
    );
    await expect(header.locator(".header-sync-icon .lucide-triangle-alert")).toHaveCount(1);
    await expect(status.locator(".lucide-triangle-alert")).toHaveCount(1);
    expect(await header.boundingBox()).toEqual(headerBounds);
    await expect(button).toBeEnabled();
    await expect(page.getByRole("alert")).toContainText(
      language === "sv" ? "Servern kunde inte nås" : "The server could not be reached",
    );
    await expect(page.locator("#settings-sync-detail")).toContainText(
      language === "sv" ? "Servern kunde inte nås" : "The server could not be reached",
    );
    await button.click();
    await expect(page.getByRole("alert")).toContainText(
      language === "sv" ? "Servern kunde inte nås" : "The server could not be reached",
    );
    await page.screenshot({ path: testInfo.outputPath("sync-failure.png") });
    await context.setOffline(true);
    await button.click();
    await expect(status).toHaveText(
      language === "sv"
        ? "Offline · ändringar sparas på enheten"
        : "Offline · changes stay on this device",
    );
    await expect(button).toBeEnabled();
    await expect(header.locator(".header-sync-icon .lucide-cloud-off")).toHaveCount(1);
    await expect(status.locator(".lucide-cloud-off")).toHaveCount(1);
    expect(await header.boundingBox()).toEqual(headerBounds);
  });
}

for (const reason of ["deleted", "member removed"] as const) {
  test(`selected group ${reason} returns to private sync and an explicitly opened local copy is explained`, async ({
    page,
  }, testInfo) => {
    const account = "external-removal-fixture";
    const group = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Former shared group",
      ownerId: "another-person",
      members: [{ id: account, label: "Fixture" }],
      requests: [],
    };
    let access = true;
    let privatePulls = 0;
    let groupPulls = 0;
    await page.addInitScript(
      ({ account, group }) => {
        if (localStorage.getItem("places-account")) {
          return;
        }
        localStorage.setItem("places-account-choice", "done");
        localStorage.setItem(
          "places-account",
          JSON.stringify({ enabled: true, providers: {}, account: { id: account, methods: [] } }),
        );
        localStorage.setItem(
          `places-family:${account}`,
          JSON.stringify({ families: [group], inactive: [] }),
        );
        localStorage.setItem(`places-workspace:${account}`, `family:${account}:${group.id}`);
      },
      { account, group },
    );
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
      }),
    );
    await page.route("**/api/family", (route) =>
      route.fulfill({ json: { families: access ? [group] : [] } }),
    );
    await page.route("**/api/v1/sync", (route) => {
      if (route.request().headers()["x-places-family"]) {
        groupPulls++;

        return access
          ? route.fulfill({
              json: { version: 1, accountId: `family:${account}:${group.id}`, records: [] },
            })
          : route.fulfill({
              status: reason === "deleted" ? 404 : 403,
              json: { error: "familyAccessEnded" },
            });
      }
      privatePulls++;

      return route.fulfill({ json: { version: 1, accountId: account, records: [] } });
    });
    await page.goto("/");
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText(group.name);
    await expect(page.locator("#account-sync-status")).toHaveText("Synced");
    access = false;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText("Private places");
    await expect(page.locator("#account-sync-status")).toHaveText("Synced");
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
    await page.reload();
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText("Private places");
    await expect(page.locator("#account-sync-status")).toHaveText("Synced");
    await page.getByRole("button", { name: "Choose group", exact: true }).click();
    await page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: `${group.name} · Local copy`, exact: true })
      .click();
    await expect(page.locator("#account-sync-status")).toHaveText("Local group copy · no sync");
    const before = { groupPulls, privatePulls };
    await page.getByRole("button", { name: "Account & sync", exact: true }).click();
    await expect(page.locator("#settings-sync-detail")).toContainText(
      "Shared access to this group has ended",
    );
    await expect(page.locator("#settings-sync-status")).not.toHaveClass(/warning/);
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(page.locator(".toast")).toHaveText(
      "Private data synced. This group is a local copy.",
    );
    expect(privatePulls).toBeGreaterThan(before.privatePulls);
    expect(groupPulls).toBe(before.groupPulls);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("local-group-sync.png") });
  });
}

for (const populated of [false, true]) {
  test(`deleting an owned ${populated ? "populated" : "empty"} group removes its selection, cache and records across reload`, async ({
    page,
  }) => {
    const account = "delete-owner-fixture";
    const group = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Group to delete",
      ownerId: account,
      members: [{ id: account, label: "Fixture" }],
      requests: [],
    };
    let deleted = false;
    await page.addInitScript(
      ({ account, group }) => {
        if (localStorage.getItem("places-account")) {
          return;
        }
        localStorage.setItem("places-account-choice", "done");
        localStorage.setItem(
          "places-account",
          JSON.stringify({ enabled: true, providers: {}, account: { id: account, methods: [] } }),
        );
        localStorage.setItem(
          `places-family:${account}`,
          JSON.stringify({ families: [group], inactive: [] }),
        );
        localStorage.setItem(`places-workspace:${account}`, `family:${account}:${group.id}`);
      },
      { account, group },
    );
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
      }),
    );
    await page.route("**/api/family", (route) => {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON()).toMatchObject({
          action: "delete",
          familyId: group.id,
        });
        deleted = true;
      }

      return route.fulfill({ json: { families: deleted ? [] : [group] } });
    });
    await page.route("**/api/v1/sync", (route) => {
      const inGroup = !!route.request().headers()["x-places-family"];

      return route.fulfill({
        json: {
          version: 1,
          accountId: inGroup ? `family:${account}:${group.id}` : account,
          records:
            inGroup && populated
              ? [
                  {
                    id: "synthetic-place",
                    kind: "place",
                    revision: 1,
                    deleted: false,
                    value: {
                      name: "Synthetic place",
                      categoryId: "other",
                      latitude: 0,
                      longitude: 0,
                      accuracy: null,
                      capturedAt: "2026-11-03T00:00:00Z",
                      updatedAt: "2026-11-03T00:00:00Z",
                    },
                  },
                ]
              : [],
        },
      });
    });
    await page.goto("/");
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText(group.name);
    await expect(page.locator("#account-sync-status")).toHaveText("Synced");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Settings", exact: true })
      .selectOption("familySharing");
    await page.locator("summary").filter({ hasText: "Delete group" }).click();
    await page.getByRole("button", { name: "Delete group", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete group", exact: true });
    await confirmation.getByRole("button", { name: "Delete group", exact: true }).click();
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText("Private places");
    expect(deleted).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          async ({ account, group }) => {
            const request = indexedDB.open("voltura-places");
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise<boolean>((resolve, reject) => {
                const r = db
                  .transaction("workspaces", "readonly")
                  .objectStore("workspaces")
                  .get(`family:${account}:${group.id}`);
                r.onsuccess = () => resolve(!r.result);
                r.onerror = () => reject(r.error);
              });
            } finally {
              db.close();
            }
          },
          { account, group },
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        ({ account }) => JSON.parse(localStorage.getItem(`places-family:${account}`)!).discarded,
        { account },
      ),
    ).toContain(group.id);
    await page.reload();
    await expect(
      page.locator(".library-selector-label > span:not(.library-selector-count)"),
    ).toHaveText("Private places");
    await page.getByRole("button", { name: "Choose group", exact: true }).click();
    await expect(page.getByRole("button", { name: /Group to delete/ })).toHaveCount(0);
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
      status === 503
        ? "Saved locally · will retry"
        : status === 401
          ? "Sync sign-in failed"
          : "Sync access denied",
    );
    expect(mutations).toBe(0);
  });
}
