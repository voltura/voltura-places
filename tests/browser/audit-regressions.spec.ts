import { test, expect, chromium, webkit, devices, type Page } from "./fixtures";
import { starters } from "../../src/shared/model";
const record = (id = "audit-pin", name = "Saved pin", longitude = 18) => ({
  id,
  kind: "place",
  value: {
    name,
    categoryId: "parking",
    latitude: 59,
    longitude,
    accuracy: 5,
    capturedAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
  },
  revision: 1,
  deleted: false,
  generation: 0,
  dirty: false,
});
async function seed(page: Page, records: unknown[]) {
  await page.evaluate(
    async (records) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("voltura-places", 1);
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put({
        key: "guest",
        reconciled: true,
        presetRevision: 2,
        records,
      });
      await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
      db.close();
      window.dispatchEvent(new Event("places-library"));
    },
    [
      ...starters.map((e) => ({ ...e, revision: 0, deleted: false, generation: 0, dirty: false })),
      ...records,
    ],
  );
}
for (const engine of [chromium, webkit]) {
  test(`${engine.name()} phone portrait/landscape: single-pin fullscreen details, nested controls and 48px attribution`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "en-US",
        baseURL: "http://127.0.0.1:5174",
      });
      await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
      await seed(page, [record()]);
      await page.getByRole("button", { name: "Map", exact: true }).tap();
      await page.locator(".places-map-pin").waitFor();
      for (const viewport of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.getByRole("button", { name: "Fullscreen map", exact: true }).tap();
        await page.locator(".places-map-pin").tap();
        const details = page.getByRole("dialog", { name: "Place details", exact: true });
        await expect(details).toBeVisible();
        await details.getByRole("button", { name: "Open maps", exact: true }).tap();
        const picker = page.getByRole("dialog", { name: "Choose map app", exact: true });
        await expect(picker).toBeVisible();
        await picker.getByRole("button", { name: "Close", exact: true }).tap();
        await expect(details).toBeVisible();
        await details.getByRole("button", { name: "Close", exact: true }).tap();
        const surface = page.getByRole("dialog", { name: "Map", exact: true });
        const attribution = surface.getByRole("link", { name: "OpenStreetMap", exact: true });
        const a = (await attribution.boundingBox())!;
        expect(a.height).toBeGreaterThanOrEqual(48);
        expect(a.width).toBeGreaterThanOrEqual(48);
        await surface.getByRole("button", { name: "Exit fullscreen map", exact: true }).tap();
      }
      await page.getByRole("button", { name: "List", exact: true }).tap();
      const category = page
        .getByRole("navigation", { name: "Categories", exact: true })
        .getByRole("button", { name: "Parking", exact: true });
      await category.tap();
      await expect(category).toHaveAttribute("aria-pressed", "true");
      await expect(
        page
          .getByRole("navigation", { name: "Categories", exact: true })
          .getByRole("button", { name: "All places", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await context.close();
    } finally {
      await browser.close();
    }
  });
  for (const skin of [
    "forest",
    "retro-wood",
    "modern-metallic",
    "modern-black",
    "midnight",
    "matrix",
  ]) {
    test(`${engine.name()} iPhone ${skin}: both modes, touch controls, enlarged text and safe layers`, async ({}, testInfo) => {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({
          ...devices["iPhone 13"],
          locale: "en-US",
          baseURL: "http://127.0.0.1:5174",
        });
        await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
        await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
        const page = await context.newPage();
        await page.goto("/");
        await page.getByRole("button", { name: "Settings", exact: true }).tap();
        for (const theme of ["light", "dark"]) {
          await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(skin);
          await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption(theme);
          await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          const toggle = page.getByRole("switch", {
            name: "Review GPS accuracy before saving",
            exact: true,
          });
          await toggle.tap();
          await expect(toggle).toBeChecked();
          await toggle.tap();
          await expect(toggle).not.toBeChecked();
          await page.setViewportSize({ width: 320, height: 568 });
          await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
          expect(
            await page.locator(".sheet-content").evaluate((e) => e.scrollWidth <= e.clientWidth),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`${engine.name()}-${skin}-${theme}.png`),
          });
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
          await page.setViewportSize({ width: 390, height: 844 });
        }
        await context.close();
      } finally {
        await browser.close();
      }
    });
  }
}
for (const deleted of [false, true])
  test(`restored draft preserves revision 2 (deleted=${deleted})`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
    await seed(page, [record()]);
    await page.locator(".card-main").click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("My restored edit");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const r = indexedDB.open("voltura-places", 1);
            r.onsuccess = () => resolve(r.result);
          });
          return new Promise<string>((resolve) => {
            const r = db.transaction("drafts").objectStore("drafts").get("guest");
            r.onsuccess = () => {
              db.close();
              resolve(r.result?.name);
            };
          });
        }),
      )
      .toBe("My restored edit");
    await seed(page, [{ ...record("audit-pin", "New cloud"), revision: 2, deleted }]);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
      "My restored edit",
    );
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.locator(".conflict-notice")).toContainText("My restored edit");
    await expect(page.locator(".conflict-notice")).toContainText(deleted ? "Deleted" : "New cloud");
  });
test("consumed invitation metadata clears the old code and permits a fresh invitation", async ({
  page,
}) => {
  const account = "invite-regression",
    group = {
      id: "00000000-0000-4000-8000-000000000123",
      name: "Group",
      ownerId: account,
      members: [{ id: account, label: "Owner" }],
      requests: [],
      invitationVersion: null as string | null,
    };
  let created = 0;
  await page.route("**/api/account", (r) =>
    r.fulfill({ json: { enabled: true, providers: {}, account: { id: account, methods: [] } } }),
  );
  await page.route("**/api/v1/sync", (r) =>
    r.fulfill({ json: { version: 1, accountId: account, records: [] } }),
  );
  await page.route("**/api/family", (r) => {
    if (r.request().method() === "POST") {
      created++;
      group.invitationVersion = String(created).padStart(64, "a");
      return r.fulfill({
        json: {
          code: created === 1 ? "1234" : "5678",
          expiresAt: 0,
          version: group.invitationVersion,
        },
      });
    }
    return r.fulfill({ json: { families: [group] } });
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("familySharing");
  await page.getByRole("button", { name: "Invite member", exact: true }).click();
  await expect(page.locator(".family-code-digits")).toHaveText("1234");
  await page.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).click();
  group.invitationVersion = null;
  await page.clock.fastForward(5100);
  await page.getByRole("button", { name: "Invite member", exact: true }).click();
  await expect(page.locator(".family-code-digits")).toHaveText("5678");
  expect(created).toBe(2);
});
test("sync failure is exposed by the phone account status description", async ({ page }) => {
  const account = "status-regression";
  let reads = 0;
  await page.route("**/api/account", (r) =>
    r.fulfill({ json: { enabled: true, providers: {}, account: { id: account, methods: [] } } }),
  );
  await page.route("**/api/family", (r) => r.fulfill({ json: { families: [] } }));
  await page.route("**/api/v1/sync", (r) =>
    ++reads === 1
      ? r.fulfill({ json: { version: 1, accountId: account, records: [] } })
      : r.fulfill({ status: 503, json: { error: "serviceUnavailable" } }),
  );
  await page.goto("/");
  const accountButton = page.getByRole("button", { name: "Account & sync", exact: true });
  await expect(accountButton).toHaveAttribute("aria-describedby", "account-sync-status");
  await expect(page.locator("#account-sync-status")).toHaveAttribute("role", "status");
  await expect(page.locator("#account-sync-status")).toHaveText("Sync needs attention");
});
for (const engine of [chromium, webkit])
  test(`${engine.name()} phone: manual update offers a tappable dialog above Settings and reopens after Later`, async () => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      baseURL: "http://127.0.0.1:5174",
      storageState: {
        cookies: [],
        origins: [
          {
            origin: "http://127.0.0.1:5174",
            localStorage: [{ name: "places-account-choice", value: "done" }],
          },
        ],
      },
    });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        const state = window as unknown as {
          auditWaiting: boolean;
          auditInstallRequested: boolean;
        };
        const worker = {
          state: "installed",
          scriptURL: location.origin + "/sw.js",
          postMessage(message: { type?: string }) {
            if (message.type === "SKIP_WAITING") state.auditInstallRequested = true;
          },
        };
        const original = Object.getOwnPropertyDescriptor(
          ServiceWorkerRegistration.prototype,
          "waiting",
        )!;
        Object.defineProperty(ServiceWorkerRegistration.prototype, "waiting", {
          get() {
            return state.auditWaiting ? worker : original.get!.call(this);
          },
        });
        document.addEventListener(
          "click",
          (event) => {
            if (
              (event.target as Element).closest("button")?.textContent?.trim() ===
              "Check for updates"
            )
              state.auditWaiting = true;
          },
          true,
        );
      });
      await page.goto("/");
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await page.getByRole("button", { name: "Check for updates", exact: true }).tap();
      const prompt = page.getByRole("dialog", { name: "An update is ready", exact: true });
      await expect(prompt).toBeVisible();
      await expect(prompt).toBeFocused();
      await expect(page.locator(".toast")).toHaveCount(0);
      await prompt.getByRole("button", { name: "Later", exact: true }).last().tap();
      await expect(prompt).toHaveCount(0);
      await page.getByRole("button", { name: "Check for updates", exact: true }).tap();
      await expect(prompt).toBeVisible();
      await page.screenshot({ path: `.artifacts/update-settings-${engine.name()}.png` });
      await prompt.getByRole("button", { name: "Update now", exact: true }).tap();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { auditInstallRequested: boolean }).auditInstallRequested,
          ),
        )
        .toBe(true);
    } finally {
      await browser.close();
    }
  });

for (const engine of [chromium, webkit])
  for (const theme of ["light", "dark"]) {
    test(`${engine.name()} ${theme}: category editing and deletion reuse themed sheets`, async ({}, testInfo) => {
      const browser = await engine.launch();
      try {
        const context = await browser.newContext({
          ...devices["iPhone 13"],
          locale: "en-US",
          baseURL: "http://127.0.0.1:5174",
        });
        await context.addInitScript((theme) => {
          localStorage.setItem("places-account-choice", "done");
          localStorage.setItem(
            "places-preferences",
            JSON.stringify({ language: "en", theme, skin: "midnight", provider: "" }),
          );
          window.confirm = () => {
            throw Error("Native confirmation must not be used");
          };
        }, theme);
        await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
        const page = await context.newPage();
        await page.goto("/");
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeEnabled();
        await seed(page, [record()]);
        await page.getByRole("button", { name: "Settings", exact: true }).tap();
        await page
          .getByRole("combobox", { name: "Settings", exact: true })
          .selectOption("categories");
        await page.getByRole("button", { name: "Edit category Parking", exact: true }).tap();
        const editor = page.getByRole("dialog", { name: "Edit category", exact: true });
        await expect(editor).toBeVisible();
        await editor.getByRole("button", { name: "Close", exact: true }).tap();
        await page.getByRole("button", { name: "Delete Parking", exact: true }).tap();
        const confirmation = page.getByRole("dialog", { name: "Delete category?", exact: true });
        await expect(confirmation).toContainText("Parking");
        await expect(confirmation).toContainText("Its places move to Other.");
        await expect(
          confirmation
            .locator(".sheet-content")
            .getByRole("button", { name: "Cancel", exact: true }),
        ).toBeFocused();
        expect(await confirmation.evaluate((e) => e.matches(":modal"))).toBe(true);
        const colors = await confirmation.evaluate((e) => ({
          surface: getComputedStyle(e).backgroundColor,
          text: getComputedStyle(e).color,
        }));
        expect(colors.surface).not.toBe(colors.text);
        await page.screenshot({
          path: testInfo.outputPath(`category-confirm-${engine.name()}-${theme}.png`),
        });
        await confirmation
          .locator(".sheet-content")
          .getByRole("button", { name: "Cancel", exact: true })
          .tap();
        await expect(confirmation).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Delete Parking", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Delete Parking", exact: true }).tap();
        await confirmation.getByRole("button", { name: "Delete", exact: true }).tap();
        await expect(confirmation).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Delete Parking", exact: true })).toHaveCount(
          0,
        );
        await page
          .getByRole("dialog", { name: "Settings", exact: true })
          .getByRole("button", { name: "Close", exact: true })
          .tap();
        await page.locator(".card-main").tap();
        await expect(page.locator(".details-category")).toHaveText("Other");
        await context.close();
      } finally {
        await browser.close();
      }
    });
  }

for (const engine of [chromium, webkit])
  test(`${engine.name()} modal interface headers resist selection while editable/data text remains selectable`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        locale: "en-US",
        baseURL: "http://127.0.0.1:5174",
      });
      await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      await context.route("https://tile.openstreetmap.org/**", (r) => r.abort());
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
      await seed(page, [record()]);
      await page.locator(".card-main").tap();
      const details = page.getByRole("dialog", { name: "Place details", exact: true });
      await expect(details.locator(".sheet-head h2")).toHaveCSS("user-select", "none");
      await expect(details.locator(".details-content h2")).toHaveCSS("user-select", "text");
      await expect(details.locator(".coordinate-display")).toHaveCSS("user-select", "text");
      await details.getByRole("button", { name: "Edit", exact: true }).tap();
      const editor = page.getByRole("dialog", { name: "Edit place", exact: true });
      await expect(editor.locator(".sheet-head h2")).toHaveCSS("user-select", "none");
      await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveCSS(
        "user-select",
        "text",
      );
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await editor.locator(".sheet-head h2").dblclick();
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
      await editor.getByRole("button", { name: "Close", exact: true }).tap();
      await details.getByRole("button", { name: "Close", exact: true }).tap();
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await expect(
        page.getByRole("dialog", { name: "Settings", exact: true }).locator(".sheet-head h2"),
      ).toHaveCSS("user-select", "none");
      await context.close();
    } finally {
      await browser.close();
    }
  });
