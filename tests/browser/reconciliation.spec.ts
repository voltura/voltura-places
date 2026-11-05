import { test, expect, type Page } from "./fixtures";
import type { RecordState } from "../../src/shared/model";

const accountId = "transfer-fixture";
const familyId = "e4c4ef13-a164-4aa3-a45e-426e2c62e1e8";

const place = (id: string): RecordState => ({
  id,
  kind: "place",
  revision: 1,
  deleted: false,
  value: {
    name: id,
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-11-02T08:00:00Z",
    updatedAt: "2026-11-02T08:00:00Z",
  },
});

async function local(page: Page, key: string) {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("voltura-places", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction("workspaces");
    const value = await new Promise<{
      records: RecordState[];
      deviceTransfers?: Record<string, { account: string }>;
    }>((resolve) => {
      const r = tx.objectStore("workspaces").get(key);
      r.onsuccess = () => resolve(r.result ?? { records: [] });
    });
    db.close();

    return value;
  }, key);
}

for (const scenario of [
  "merge",
  "retry-write",
  "retry-read",
  "wrong-account",
  "family",
  "swedish",
] as const) {
  test(`automatic guest transfer: ${scenario}`, async ({ page }, testInfo) => {
    let signedIn = false;
    let identity = accountId;
    let failing = scenario === "retry-read";
    let failWrites = scenario === "retry-write";
    let wrong = scenario === "wrong-account";
    const records = new Map<string, RecordState>([["cloud-place", place("cloud-place")]]);
    const family = {
      id: familyId,
      name: "Test family",
      ownerId: accountId,
      members: [{ id: accountId, label: "Fixture" }],
      requests: [],
    };
    await page.route("**/api/account", (route) =>
      route.fulfill({
        json: {
          enabled: true,
          providers: {},
          account: signedIn ? { id: identity, methods: [] } : null,
        },
      }),
    );
    await page.route("**/api/family", (route) =>
      route.fulfill({ json: { families: scenario === "family" ? [family] : [] } }),
    );
    const writes: string[] = [];
    await page.route("**/api/v1/sync", (route) => {
      const request = route.request();
      const isFamily = !!request.headers()["x-places-family"];
      if (isFamily) {
        return route.fulfill({
          json: { version: 1, accountId: `family:${identity}:${familyId}`, records: [] },
        });
      }
      if (failing || (failWrites && request.method() === "POST")) {
        return route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
      }
      if (request.method() === "POST") {
        expect(request.headers()["x-places-account"]).toBe(accountId);
        const body = request.postDataJSON();
        const record = {
          ...body.entity,
          revision: body.baseRevision + 1,
          deleted: body.deleted,
        } as RecordState;
        records.set(record.id, record);
        writes.push(record.id);

        return route.fulfill({ json: { accountId: identity, record } });
      }

      return route.fulfill({
        json: {
          version: 1,
          accountId: wrong ? "wrong-account" : identity,
          records:
            identity === accountId
              ? [...records.values()].sort((a, b) => a.id.localeCompare(b.id))
              : [],
        },
      });
    });
    await page.goto(`/?lang=${scenario === "swedish" ? "sv" : "en"}`);
    await expect(
      page.getByRole("button", {
        name: scenario === "swedish" ? "Spara position" : "Save position",
        exact: true,
      }),
    ).toBeEnabled();
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
          deviceAccounts: ["previous-account"],
          records: records.map((r) => ({ ...r, revision: 0, generation: 1, dirty: true })),
        });
        await new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
        });
        db.close();
        window.dispatchEvent(new Event("places-library"));
      },
      [place("device-one"), place("device-two"), place("device-three")],
    );
    signedIn = true;
    if (scenario === "family") {
      await page.evaluate(
        ({ family, accountId, familyId }) => {
          localStorage.setItem(
            "places-account",
            JSON.stringify({
              enabled: true,
              providers: {},
              account: { id: accountId, methods: [] },
            }),
          );
          localStorage.setItem(
            `places-family:${accountId}`,
            JSON.stringify({ families: [family], inactive: [] }),
          );
          localStorage.setItem(`places-workspace:${accountId}`, `family:${accountId}:${familyId}`);
        },
        { family, accountId, familyId },
      );
      await page.reload();
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
    if (["retry-write", "retry-read", "wrong-account"].includes(scenario)) {
      const failure = page.locator(".device-transfer-notice");
      await expect(failure).toBeVisible();
      expect((await local(page, "guest")).records.filter((r) => r.kind === "place")).toHaveLength(
        3,
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (scenario === "retry-write") {
        expect(
          Object.values((await local(page, "guest")).deviceTransfers ?? {}).every(
            (t) => t.account === accountId,
          ),
        ).toBe(true);
        await page.reload();
        await expect(failure).toBeVisible();
      }
      if (scenario === "retry-write") {
        await page.getByRole("button", { name: "Skip for now", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "Save position", exact: true }),
        ).toBeEnabled();
        await expect(failure).toContainText(
          "Some places or routes remain on this device. Retry when ready.",
        );
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.getByRole("button", { name: "Skip for now", exact: true })).toHaveCount(
          0,
        );
        expect((await local(page, "guest")).records.filter((r) => r.kind === "place")).toHaveLength(
          3,
        );
      }
      await page.screenshot({ path: testInfo.outputPath("transfer-retry.png") });
      failing = false;
      failWrites = false;
      wrong = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    const confirmation =
      scenario === "swedish"
        ? "3 poster har lagts till i ditt privata bibliotek."
        : "3 items added to your private library.";
    await expect(page.getByRole("status").filter({ hasText: confirmation })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("transfer-confirmation.png") });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await local(page, "guest")).records.filter((r) => r.kind === "place")).toHaveLength(0);
    expect(
      (await local(page, accountId)).records.filter((r) => r.kind === "place" && !r.deleted),
    ).toHaveLength(4);
    expect(new Set(writes).size).toBe(3);
    if (scenario === "family") {
      expect(
        (await local(page, `family:${accountId}:${familyId}`)).records.filter(
          (r) => r.kind === "place",
        ),
      ).toHaveLength(0);
    }
    await page.reload();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(records.size).toBe(4);
    identity = "different-account";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect
      .poll(
        async () => (await local(page, identity)).records.filter((r) => r.kind === "place").length,
      )
      .toBe(0);
    expect(records.size).toBe(4);
  });
}
