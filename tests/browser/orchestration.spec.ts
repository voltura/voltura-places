import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block", baseURL: "http://127.0.0.1:5173" });

for (const transition of ["workspace", "account"] as const) {
  test(`a delayed backup read cannot reopen after ${transition} A → B → A`, async ({ page }) => {
    let account = "epoch-account-a";
    const group = "11111111-1111-4111-8111-111111111111";
    await page.addInitScript(() => {
      localStorage.setItem("places-account-choice", "done");
      const original = File.prototype.text;
      let hold = true;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, {
        importReadStarted: false,
        releaseImportRead: () => {
          hold = false;
          release();
        },
      });
      File.prototype.text = async function () {
        const value = await original.call(this);
        if (hold) {
          Object.assign(window, { importReadStarted: true });
          await gate;
        }

        return value;
      };
    });
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          providers: {},
          account: { id: account, methods: [] },
        },
      }),
    );
    await page.route("**/api/family", (route) =>
      route.fulfill({
        json: {
          families: [
            {
              id: group,
              name: "Synthetic group",
              ownerId: account,
              members: [{ id: account, label: "Fixture" }],
              requests: [],
            },
          ],
        },
      }),
    );
    await page.route("**/api/v1/sync", (route) => {
      const headers = route.request().headers();
      const key = headers["x-places-family"]
        ? `family:${headers["x-places-account"]}:${group}`
        : headers["x-places-account"];

      return route.fulfill({ json: { version: 1, accountId: key, records: [] } });
    });
    await page.goto("/");
    await expect(page.locator("#account-sync-status")).toHaveText("Synced");
    const backup = {
      name: "synthetic.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "voltura-places",
          version: 1,
          exportedAt: "2026-11-02T00:00:00Z",
          categories: [{ id: "other", value: { name: "Other", color: "slate" } }],
          places: [],
        }),
      ),
    };
    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backup);
    await expect.poll(() => page.evaluate(() => (window as any).importReadStarted)).toBe(true);
    if (transition === "workspace") {
      const selector = page.getByRole("button", { name: "Choose group", exact: true });
      for (const label of ["Synthetic group", "Private places"]) {
        await selector.click();
        await page
          .getByRole("group", { name: "Choose group", exact: true })
          .getByRole("button", { name: label, exact: true })
          .click();
        await expect(page.locator(".save-destination")).toHaveText(label);
      }
    } else {
      for (const id of ["epoch-account-b", "epoch-account-a"]) {
        account = id;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect
          .poll(() =>
            page.evaluate(
              () => JSON.parse(localStorage.getItem("places-account") ?? "null")?.account?.id,
            ),
          )
          .toBe(id);
        await expect(page.locator("#account-sync-status")).toHaveText("Synced");
      }
    }
    await page.evaluate(async () => {
      (window as any).releaseImportRead();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await expect(page.getByRole("dialog", { name: "Review backup", exact: true })).toHaveCount(0);
    // A fresh operation in the returned scope remains usable.
    await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backup);
    await expect(page.getByRole("dialog", { name: "Review backup", exact: true })).toBeVisible();
  });
}
