import { test, expect, chooseSaveOption } from "./fixtures";

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

test("only the latest selected backup can open review", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("places-account-choice", "done");
    const original = File.prototype.text;
    File.prototype.text = async function () {
      const text = await original.call(this);
      if (this.name === "first.json") {
        await new Promise<void>((resolve) => Object.assign(window, { finishFirst: resolve }));
      }

      return text;
    };
  });
  await page.goto("/");
  const input = page.locator('input[type="file"][accept=".json,application/json"]');
  const valid = Buffer.from(
    JSON.stringify({
      format: "voltura-places",
      version: 1,
      exportedAt: "2026-11-02T00:00:00Z",
      categories: [{ id: "other", value: { name: "Other", color: "slate" } }],
      places: [],
    }),
  );
  await input.setInputFiles({ name: "first.json", mimeType: "application/json", buffer: valid });
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishFirst)).toBe("function");
  await input.setInputFiles({
    name: "second.json",
    mimeType: "application/json",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(async () => {
    (window as any).finishFirst();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByRole("dialog", { name: "Review backup" })).toHaveCount(0);
});

test("account return preserves unrelated query parameters and ignores normal anchors", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.goto("/?account=error&source=promo#about");
  await expect(page).toHaveURL(/\?source=promo#about$/);
  await page.evaluate(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("hashchange", () => resolve(), { once: true }),
    );
    location.hash = "settings";
    await changed;
    await new Promise(requestAnimationFrame);
  });
  await expect(page.getByText("This shared place link is invalid or incomplete.")).toHaveCount(0);
});

test("revoking group access closes its editor and rejoining restores its draft", async ({
  page,
}) => {
  const id = "editor-access-fixture";
  const group = {
    id: "20265678-2222-4222-8222-222222222222",
    name: "Access fixture",
    ownerId: id,
    members: [],
    requests: [],
  };
  const key = `family:${id}:${group.id}`;
  let member = true;
  await page.addInitScript(
    ({ id, group, key }) => {
      localStorage.setItem(
        "places-account",
        JSON.stringify({ enabled: true, providers: {}, account: { id, methods: [] } }),
      );
      localStorage.setItem(
        `places-family:${id}`,
        JSON.stringify({ families: [group], inactive: [] }),
      );
      localStorage.setItem(`places-workspace:${id}`, key);
    },
    { id, group, key },
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { enabled: true, providers: {}, account: { id, methods: [] } } }),
  );
  await page.route("**/api/family", (route) =>
    route.fulfill({ json: { families: member ? [group] : [] } }),
  );
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({
      json: {
        version: 1,
        accountId: route.request().headers()["x-places-family"] ? key : id,
        records: [],
      },
    }),
  );
  await page.goto("/");
  await chooseSaveOption(page, "details");
  const name = page.getByRole("dialog").getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Retained draft");
  member = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".toast[role=status]")).toContainText(
    "Group access ended. Switched to Private places.",
  );
  await expect(page.locator(".library-selector-name")).toHaveText("Private places");
  await expect(name).toHaveCount(0);
  member = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "Choose group", exact: true }).click();
  await page
    .getByRole("group", { name: "Choose group", exact: true })
    .getByRole("button", { name: group.name, exact: true })
    .click();
  await expect(name).toHaveValue("Retained draft");
});

test("offline cross-tab sign-out immediately hides the discarded workspace", async ({ page }) => {
  const id = "cross-tab-fixture";
  let signedOut = false;
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.route("**/api/account", (route) =>
    signedOut
      ? route.abort("internetdisconnected")
      : route.fulfill({ json: { enabled: true, providers: {}, account: { id, methods: [] } } }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: id, records: [] } }),
  );
  await page.goto("/");
  await expect(page.locator("#account-sync-status")).toHaveText("Synced");
  signedOut = true;
  await page.evaluate(() => {
    localStorage.removeItem("places-account");
    window.dispatchEvent(new StorageEvent("storage", { key: "places-account", newValue: null }));
  });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.locator(".save-destination")).toBeHidden();
});

test("unrelated workspace notifications skip library reads while legacy broadcasts still refresh", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();

  const count = await page.evaluate(async () => {
    let reads = 0;
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === "workspaces") {
        reads++;
      }

      return original.call(this, key);
    };

    const settle = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    };

    try {
      window.dispatchEvent(
        new CustomEvent("places-library", { detail: { workspaces: ["other-library"] } }),
      );
      await settle();
      const unrelated = reads;
      window.dispatchEvent(new Event("places-library"));
      await settle();

      return { unrelated, all: reads };
    } finally {
      IDBObjectStore.prototype.get = original;
    }
  });

  expect(count.unrelated).toBe(0);
  expect(count.all).toBeGreaterThan(0);
});

test("an incoming share matches a translated preset and an invalid replacement clears the preview", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  const hash =
    "#place=" +
    Buffer.from(
      JSON.stringify({
        version: 1,
        name: "Cross-language place",
        category: "Parkering",
        latitude: 1,
        longitude: 2,
      }),
    ).toString("base64url");
  await page.goto("/" + hash);
  await page.getByRole("dialog").getByRole("button", { name: "Save a copy" }).click();
  await expect(page.locator(".place-card")).toContainText("Parking");
  await page.evaluate((hash) => {
    location.hash = hash;
  }, hash);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    location.hash = "#place=broken";
  });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("alert")).toContainText("invalid or incomplete");
});

test("skip after an unavailable first account snapshot permits a durable manual save", async ({
  page,
}) => {
  const id = "deferred-first-snapshot";
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { enabled: true, providers: {}, account: { id, methods: [] } } }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ status: 503, json: { error: "serviceUnavailable" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  await chooseSaveOption(page, "details");
  const editor = page.getByRole("dialog", { name: "Add place" });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Deferred manual");
  await editor.getByRole("button", { name: "Enter coordinates manually" }).click();
  await editor.getByRole("textbox", { name: "Latitude" }).fill("1");
  await editor.getByRole("textbox", { name: "Longitude" }).fill("2");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator(".place-card")).toContainText("Deferred manual");
});

test("account header shows only the active account's display name or identity fallback", async ({
  page,
}, testInfo) => {
  const fallback = "private-identity@example.invalid";
  let id = "profile-one";
  let displayName: string | null = null;
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        providers: {},
        account: {
          id,
          displayName,
          methods: [
            {
              provider: "email",
              label: id === "profile-one" ? fallback : "second@example.invalid",
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: id, records: [] } }),
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const account = page.getByRole("button", { name: "Account & sync", exact: true });
  const identity = account.locator("#header-account-identity");
  await expect(identity).toHaveText(fallback);
  displayName = "Synthetic profile with a very long display name";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(identity).toHaveText(displayName);
  await expect(account).toHaveAccessibleDescription(new RegExp(displayName));
  await expect(account).not.toContainText(fallback);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("account-profile-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 740 });
  await page.screenshot({ path: testInfo.outputPath("account-profile-desktop.png") });
  id = "profile-two";
  displayName = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(identity).toHaveText("second@example.invalid");
  await expect(account).not.toContainText("Synthetic profile");
});

test("opening a manual editor cancels an older GPS save in the same library", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("places-account-choice", "done");
    const geo = {
      getCurrentPosition: () => {},
      watchPosition: (success: PositionCallback) => {
        Object.assign(window, {
          deliverOld: () =>
            success({
              timestamp: Date.now(),
              coords: { latitude: 1, longitude: 2, accuracy: 5 },
            } as GeolocationPosition),
        });

        return 1;
      },
      clearWatch: () => {},
    };
    Object.defineProperty(navigator, "geolocation", { value: geo });
  });
  await page.goto("/");
  const hash =
    "#place=" +
    Buffer.from(
      JSON.stringify({
        version: 1,
        name: "Existing place",
        category: "Other",
        latitude: 1,
        longitude: 2,
      }),
    ).toString("base64url");
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
  await page.getByRole("button", { name: "Save a copy" }).click();
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await page.getByRole("button", { name: "Add place", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("My manual draft");
  await page.evaluate(async () => {
    (window as any).deliverOld();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "My manual draft",
  );
  await expect(page.locator(".place-card")).toHaveCount(1);
});

test("a failed place deletion retains the confirmation for retry", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  const hash =
    "#place=" +
    Buffer.from(
      JSON.stringify({
        version: 1,
        name: "Deletion target",
        category: "Other",
        latitude: 1,
        longitude: 2,
      }),
    ).toString("base64url");
  await page.goto("/" + hash);
  await page.getByRole("button", { name: "Save a copy" }).click();
  await page
    .locator(".place-card .card-more, .place-card button[aria-label^='Edit place:']")
    .first()
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete this place?" });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === "workspaces" &&
        value.records.some((r: any) => r.kind === "place" && r.deleted)
      ) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("Synthetic quota error", "QuotaExceededError");
      }

      return put.call(this, value, key);
    };
  });
  const submit = confirmation.getByRole("button", { name: "Delete", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(confirmation).toBeHidden();
  await expect(page.locator(".place-card")).toHaveCount(0);
});
