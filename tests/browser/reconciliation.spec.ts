import { test, expect, type Page } from "@playwright/test";

const title = "Add device places to this account?";
const identity = { id: "reconciliation-fixture", methods: [] };
const cloudPlace = {
  id: "cloud-place",
  kind: "place",
  revision: 1,
  deleted: false,
  value: {
    name: "Account fixture",
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  },
};
async function workspace(page: Page, key: string) {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("voltura-places", 1);
      request.onsuccess = () => resolve(request.result);
    });
    return new Promise<{ reconciled: boolean; records: { kind: string; deleted: boolean }[] }>(
      (resolve) => {
        const request = db.transaction("workspaces").objectStore("workspaces").get(key);
        request.onsuccess = () => {
          db.close();
          resolve(request.result ?? { reconciled: false, records: [] });
        };
      },
    );
  }, key);
}

for (const mode of ["empty", "deleted", "add", "skip", "close", "retry", "wrong-account"]) {
  test(`first account opening: ${mode}`, async ({ page, context }, testInfo) => {
    let signedIn = mode === "empty" || mode === "retry" || mode === "wrong-account";
    let fail = mode === "retry";
    let wrong = mode === "wrong-account";
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 5 });
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          providers: { email: true },
          account: signedIn ? identity : null,
        },
      }),
    );
    await page.route("**/api/account/sign-out", (route) => {
      signedIn = false;
      return route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/family", (route) => route.fulfill({ json: { family: null } }));
    await page.route("**/api/v1/sync", (route) =>
      route.fulfill(
        fail || route.request().method() !== "GET"
          ? { status: 503, json: { error: "serviceUnavailable" } }
          : {
              json: {
                version: 1,
                accountId: wrong ? "another-account" : identity.id,
                records: [cloudPlace],
              },
            },
      ),
    );
    await page.goto("/");
    if (!["empty", "retry", "wrong-account"].includes(mode)) {
      await page.getByRole("button", { name: "Save position", exact: true }).click();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Device fixture");
      await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      if (mode === "deleted") {
        await page.getByRole("button", { name: "Edit place: Device fixture", exact: true }).click();
        await page.getByRole("button", { name: "Delete", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Delete this place?", exact: true })
          .getByRole("button", { name: "Delete", exact: true })
          .click();
      }
      if (mode === "skip" || mode === "close") {
        await page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const r = indexedDB.open("voltura-places", 1);
            r.onsuccess = () => resolve(r.result);
          });
          const tx = db.transaction("workspaces", "readwrite"),
            store = tx.objectStore("workspaces");
          const r = store.get("guest");
          r.onsuccess = () => store.put({ ...r.result, deviceAccounts: ["previous-account"] });
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
          });
        });
      }
      signedIn = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    if (["skip", "close"].includes(mode)) {
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Closing this screen signs you out.");
      await page.screenshot({ path: testInfo.outputPath("reconciliation.png") });
      if (mode === "close") {
        await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeEnabled();
        expect(signedIn).toBe(false);
        expect((await workspace(page, identity.id)).reconciled).toBe(false);
        return;
      }
      await dialog
        .getByRole("button", {
          name: "Keep them on this device",
          exact: true,
        })
        .click();
    }
    if (mode === "retry" || mode === "wrong-account") {
      await expect(page.getByRole("alert")).toBeVisible();
      expect((await workspace(page, identity.id)).reconciled).toBe(false);
      await expect(dialog).toHaveCount(0);
      fail = false;
      wrong = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await expect.poll(async () => (await workspace(page, identity.id))?.reconciled).toBe(true);
    await expect(dialog).toHaveCount(0);
    const places = (key: string) =>
      workspace(page, key).then(
        (w) => w.records.filter((r) => r.kind === "place" && !r.deleted).length,
      );
    expect(await places(identity.id)).toBe(mode === "add" ? 2 : 1);
    expect(await places("guest")).toBe(["add", "skip"].includes(mode) ? 1 : 0);
    if (mode === "add") {
      await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
      signedIn = false;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      signedIn = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
      expect(await places(identity.id)).toBe(2);
    }
    await page.reload();
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
    await expect(dialog).toHaveCount(0);
  });
}
