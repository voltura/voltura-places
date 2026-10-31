import { expect, test, type Page, type Route } from "./fixtures";
import { readFile } from "node:fs/promises";

const value = (name: string, categoryId = "other", capturedAt = "2026-10-30T10:00:00Z") => ({
  name,
  categoryId,
  capturedAt,
  updatedAt: capturedAt,
  latitude: 0,
  longitude: 0,
  accuracy: null,
});
async function seed(page: Page, records: unknown[]) {
  await page.evaluate(async (records) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("voltura-places", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put({
      key: "guest",
      reconciled: true,
      presetRevision: 2,
      records,
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    window.dispatchEvent(new Event("places-library"));
  }, records);
}

test("newest sorting compares instants across supported ISO timestamp precision", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  const record = (id: string, capturedAt: string) => ({
    id,
    kind: "place",
    value: value(id, "other", capturedAt),
    revision: 0,
    generation: 1,
    dirty: true,
    deleted: false,
  });
  await seed(page, [
    record("Earlier", "2026-10-30T10:00:00Z"),
    record("Later", "2026-10-30T10:00:00.500Z"),
  ]);
  await expect(page.locator(".card-text strong").first()).toHaveText("Later");
});

test("Other filtering includes places whose category was removed on another device", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, [
    {
      id: "other",
      kind: "category",
      value: { name: "Other", color: "slate", builtIn: "other" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    },
    ...["other", "deleted-category"].map((categoryId, i) => ({
      id: `place-${i}`,
      kind: "place",
      value: value(`Place ${i}`, categoryId),
      revision: 1,
      generation: 0,
      dirty: false,
      deleted: false,
    })),
  ]);
  await page
    .getByRole("navigation", { name: "Categories", exact: true })
    .getByRole("button", { name: "Other", exact: true })
    .click();
  await expect(page.locator(".place-card")).toHaveCount(2);
});

test("clicking the sheet's inner bottom padding keeps it open while backdrop closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const snapshot = {
    version: 1,
    name: "Shared fixture",
    category: "Other",
    latitude: 0,
    longitude: 0,
  };
  await page.goto(`/#place=${Buffer.from(JSON.stringify(snapshot)).toString("base64url")}`);
  const sheet = page.getByRole("dialog");
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 5);
  await expect(sheet).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(sheet).toHaveCount(0);
});

test("a shared place waits for account initialization and a double click saves one copy", async ({
  page,
}) => {
  const account = "shared-copy-fixture";
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  let waiting: Route | undefined;
  let hold = true;
  await page.route("**/api/v1/sync", async (route) => {
    if (route.request().method() !== "GET")
      return route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
    if (hold) {
      waiting = route;
      return;
    }
    return route.fulfill({ json: { version: 1, accountId: account, records: [] } });
  });
  const snapshot = {
    version: 1,
    name: "Shared recovery fixture",
    category: "Other",
    latitude: 0,
    longitude: 0,
  };
  await page.goto(`/#place=${Buffer.from(JSON.stringify(snapshot)).toString("base64url")}`);
  const save = page.getByRole("button", { name: "Save a copy", exact: true });
  await expect.poll(() => Boolean(waiting)).toBe(true);
  await expect(save).toBeDisabled();
  hold = false;
  await waiting!.fulfill({ json: { version: 1, accountId: account, records: [] } });
  await expect(save).toBeEnabled();
  await save.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator(".place-card")).toHaveCount(1);
});

test("invalid shared fragments are removed after reporting the validation failure", async ({
  page,
}) => {
  await page.goto("/#place=invalid");
  await expect(page.getByRole("alert")).toContainText("shared");
  await expect(page).not.toHaveURL(/#place=/);
});

test("changing a preset's appearance preserves its translated name", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("combobox", { name: "Settings", exact: true });
  await settings.selectOption("categories");
  await page.getByRole("button", { name: "Edit category Mushrooms", exact: true }).click();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await settings.selectOption("preferences");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("sv");
  await page
    .getByRole("combobox", { name: "Inställningar", exact: true })
    .selectOption("categories");
  await expect(
    page.getByRole("button", { name: "Redigera kategori Svampar", exact: true }),
  ).toBeVisible();
});

test("submitting a new category twice while its save is pending creates one category", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
  await page.getByRole("button", { name: "New category", exact: true }).click();
  await page.getByRole("textbox", { name: "Category name", exact: true }).fill("One category");
  await page.locator("dialog form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.locator(".category-list > div").filter({ hasText: "One category" }),
  ).toHaveCount(1);
});

test("read-only groups disable category mutations and backup imports", async ({ page }) => {
  const account = "readonly-fixture",
    groupId = "00000000-0000-4000-8000-000000000001";
  await page.addInitScript(
    ({ account, groupId }) => {
      localStorage.setItem(
        "places-account",
        JSON.stringify({ enabled: true, providers: {}, account: { id: account, methods: [] } }),
      );
      localStorage.setItem(
        `places-family:${account}`,
        JSON.stringify({
          families: [],
          inactive: [
            { id: groupId, name: "Archived group", ownerId: account, members: [], requests: [] },
          ],
        }),
      );
      localStorage.setItem(`places-workspace:${account}`, `family:${account}:${groupId}`);
    },
    { account, groupId },
  );
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ status: 403, json: { error: "familyAccessEnded" } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("combobox", { name: "Settings", exact: true });
  await settings.selectOption("categories");
  await expect(page.getByRole("button", { name: "New category", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit category Parking", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Delete Parking", exact: true })).toBeDisabled();
  await settings.selectOption("backup");
  await expect(page.getByRole("button", { name: "Import backup", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export backup", exact: true })).toBeEnabled();
});

test("a visible missing photo recovers when reconnection downloads its bytes", async ({ page }) => {
  const account = "photo-recovery-fixture",
    photoId = "00000000-0000-4000-8000-000000000002";
  const record = {
    id: "photo-recovery-place",
    kind: "place",
    value: { ...value("Photo recovery"), photoId },
    revision: 1,
    deleted: false,
  };
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  let available = false;
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: account, records: [record] } }),
  );
  await page.route(`**/api/v1/photos/${photoId}`, (route) =>
    route.fulfill(
      available
        ? { contentType: "image/jpeg", body: jpeg }
        : { status: 503, json: { error: "photoUnavailable" } },
    ),
  );
  await page.goto("/");
  await page.locator(".card-main").click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("This photo is not available on this device yet. Connect and retry sync.", {
        exact: true,
      }),
  ).toBeVisible();
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("dialog").locator(".place-photo")).toBeVisible();
});

test("an open editor preserves a cloud edit that arrives before Save", async ({
  page,
}, testInfo) => {
  const account = "editor-conflict-fixture";
  let cloud = {
    id: "editor-conflict-place",
    kind: "place",
    value: value("Original cloud name"),
    revision: 1,
    deleted: false,
  };
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: { enabled: true, providers: {}, account: { id: account, methods: [] } },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: account, records: [cloud] } }),
  );
  await page.goto("/");
  await page.locator(".card-main").click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("My editor name");
  cloud = { ...cloud, value: value("Other device's name"), revision: 2 };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() =>
      page.evaluate(async (account) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open("voltura-places", 1);
          r.onsuccess = () => resolve(r.result);
        });
        const result = await new Promise<{ records: { id: string; revision: number }[] }>(
          (resolve) => {
            const r = db.transaction("workspaces").objectStore("workspaces").get(account);
            r.onsuccess = () => resolve(r.result);
          },
        );
        db.close();
        return result.records.find((r) => r.id === "editor-conflict-place")?.revision;
      }, account),
    )
    .toBe(2);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".conflict-notice")).toContainText("My editor name");
  await expect(page.locator(".conflict-notice")).toContainText("Other device's name");
  await page
    .getByRole("dialog", { name: "Place details", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator(".conflict-notice").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("preserved-conflict.png") });
});

test("shared links arriving in an already open app are shown and scrubbed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  for (const name of ["First incoming place", "Second incoming place"]) {
    const snapshot = { version: 1, name, category: "Other", latitude: 0, longitude: 0 };
    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      `place=${Buffer.from(JSON.stringify(snapshot)).toString("base64url")}`,
    );
    await expect(
      page.getByRole("dialog").getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/#place=/);
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("typing waits for draft restoration instead of being overwritten by its late result", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, [
    {
      id: "draft-race",
      kind: "place",
      value: value("Saved name"),
      revision: 0,
      generation: 1,
      dirty: true,
      deleted: false,
    },
  ]);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("voltura-places", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction("drafts", "readwrite");
    tx.objectStore("drafts").put(
      {
        id: "draft-race",
        name: "Recovered draft",
        categoryId: "other",
        latitude: "0",
        longitude: "0",
      },
      "guest",
    );
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.addInitScript(() => {
    let reads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      const request = get.call(this, query);
      if (this.name === "drafts" && ++reads === 2) {
        const add = request.addEventListener.bind(request);
        request.addEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject | null,
          options?: boolean | AddEventListenerOptions,
        ) => {
          if (!listener) return;
          if (type !== "success") return add(type, listener, options);
          add(
            type,
            (event) => {
              setTimeout(() => {
                if (typeof listener === "function") listener.call(request, event);
                else listener.handleEvent(event);
              }, 800);
            },
            options,
          );
        }) as typeof request.addEventListener;
      }
      return request;
    };
  });
  await page.reload();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Fast typing");
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
  await expect(name).toHaveValue("Fast typing");
});

test("backup export failures describe export recovery instead of an invalid imported file", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, [
    {
      id: "other",
      kind: "category",
      value: { name: "Other", color: "slate" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    },
    {
      id: "missing-photo",
      kind: "place",
      value: { ...value("Missing photo"), photoId: "00000000-0000-4000-8000-000000000003" },
      revision: 0,
      generation: 1,
      dirty: true,
      deleted: false,
    },
  ]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("backup");
  await page.getByRole("button", { name: "Export backup", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not create the backup");
});

test("signing out in one tab promptly hides its account library in another tab", async ({
  page,
  context,
}) => {
  const account = "two-tab-account";
  let signedIn = true;
  await context.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        providers: {},
        account: signedIn ? { id: account, methods: [] } : null,
      },
    }),
  );
  await context.route("**/api/account/sign-out", (route) => {
    signedIn = false;
    return route.fulfill({ json: { ok: true } });
  });
  await context.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await context.route("**/api/v1/sync", (route) =>
    route.fulfill({
      json: {
        version: 1,
        accountId: account,
        records: [
          {
            id: "private-place",
            kind: "place",
            value: value("Private account fixture"),
            revision: 1,
            deleted: false,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".card-text strong")).toHaveText("Private account fixture");
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".card-text strong")).toHaveText("Private account fixture");
  await page.getByRole("button", { name: "Account & sync", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(second.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(second.locator(".place-card")).toHaveCount(0);
  await second.close();
});

test("automatic copying at category capacity offers account-only access instead of an endless retry", async ({
  page,
}, testInfo) => {
  const account = "capacity-account";
  let signedIn = false;
  const cloud = Array.from({ length: 200 }, (_, i) => ({
    id: i ? `cloud-category-${i}` : "other",
    kind: "category",
    value: { name: i ? `Cloud category ${i}` : "Other", color: "slate" },
    revision: 1,
    deleted: false,
  }));
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        providers: {},
        account: signedIn ? { id: account, methods: [] } : null,
      },
    }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: account, records: cloud } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, [
    {
      id: "other",
      kind: "category",
      value: { name: "Other", color: "slate" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    },
    {
      id: "device-category",
      kind: "category",
      value: { name: "Device category", color: "green" },
      revision: 0,
      generation: 1,
      dirty: true,
      deleted: false,
    },
    {
      id: "device-place",
      kind: "place",
      value: value("Keep this device place", "device-category"),
      revision: 0,
      generation: 1,
      dirty: true,
      deleted: false,
    },
  ]);
  signedIn = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toContainText("Some device places could not be copied");
  await page.screenshot({ path: testInfo.outputPath("copy-capacity-recovery.png") });
  await page.getByRole("button", { name: "Keep them on this device", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
});

test("an over-capacity import explains the library limit", async ({ page }) => {
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { enabled: true, providers: {}, account: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(
    page,
    Array.from({ length: 200 }, (_, i) => ({
      id: i ? `category-${i}` : "other",
      kind: "category",
      value: { name: i ? `Category ${i}` : "Other", color: "slate" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    })),
  );
  const backup = {
    format: "voltura-places",
    version: 1,
    exportedAt: new Date().toISOString(),
    places: [],
    categories: [
      { id: "other", value: { name: "Other", color: "slate" } },
      { id: "new-category", value: { name: "Incoming category", color: "green" } },
    ],
  };
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: "limit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("library has reached its supported capacity");
});

test("keyboard focus keeps each conflict choice above the fixed save bar", async ({ page }) => {
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { enabled: true, providers: {}, account: null } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  const saved = value("Keyboard fixture");
  await seed(page, [
    {
      id: "other",
      kind: "category",
      value: { name: "Other", color: "slate" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    },
    {
      id: "keyboard",
      kind: "place",
      value: saved,
      revision: 1,
      generation: 1,
      dirty: true,
      deleted: false,
      conflict: {
        id: "keyboard",
        kind: "place",
        value: { ...saved, name: "Other version" },
        revision: 2,
        deleted: false,
      },
    },
  ]);
  await page.getByRole("button", { name: "Keep device", exact: true }).focus();
  for (const name of ["Keep device", "Keep cloud", "Keep both"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeFocused();
    const bounds = (await button.boundingBox())!,
      dock = (await page.locator(".save-dock").boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(dock.y);
    await page.keyboard.press("Tab");
  }
});
