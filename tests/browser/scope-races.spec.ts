import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("a GPS save completing after a library switch cannot open its editor in the new library", async ({
  page,
}) => {
  const account = "scope-save-fixture",
    group = "11111111-1111-4111-8111-111111111111";
  await page.addInitScript(() => {
    const position = () =>
      ({
        timestamp: Date.now(),
        coords: { latitude: 0, longitude: 0, accuracy: 5 },
      }) as GeolocationPosition;
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => Object.assign(new EventTarget(), { state: "granted" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: PositionCallback) =>
          queueMicrotask(() => success(position())),
        watchPosition: (success: PositionCallback) => {
          queueMicrotask(() => success(position()));
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.route("**/api/account", (r) =>
    r.fulfill({ json: { enabled: true, providers: {}, account: { id: account, methods: [] } } }),
  );
  await page.route("**/api/family", (r) =>
    r.fulfill({
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
  await page.route("**/api/v1/sync", (r) =>
    r.fulfill({
      json: {
        version: 1,
        accountId: r.request().headers()["x-places-family"]
          ? `family:${account}:${group}`
          : account,
        records: [],
      },
    }),
  );
  await page.addInitScript((account) => {
    let saved = false;
    let hold = true;
    const pending: (() => void)[] = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === "workspaces" &&
        value?.key === account &&
        value.records.some((r: { kind: string }) => r.kind === "place")
      )
        saved = true;
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (
        saved &&
        hold &&
        this.name === "workspaces" &&
        this.transaction.mode === "readonly" &&
        key === account
      ) {
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
              pending.push(() => {
                if (typeof listener === "function") listener.call(request, event);
                else listener.handleEvent(event);
              });
            },
            options,
          );
        }) as typeof request.addEventListener;
      }
      return request;
    };
    Object.assign(window, {
      heldSaveReads: () => pending.length,
      releaseSaveReads: () => {
        hold = false;
        pending.splice(0).forEach((run) => run());
      },
    });
  }, account);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Choose group", exact: true })).toBeVisible();
  await expect(page.locator("#account-sync-status")).toContainText("Synced");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).heldSaveReads()))
    .toBeGreaterThanOrEqual(2);
  const selector = page.getByRole("button", { name: "Choose group", exact: true });
  await selector.click();
  await page
    .getByRole("group", { name: "Choose group", exact: true })
    .getByRole("button", { name: "Synthetic group", exact: true })
    .click();
  await expect(page.locator(".save-destination")).toHaveText("Synthetic group");
  await page.evaluate(async () => {
    (window as any).releaseSaveReads();
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await selector.click();
  await expect(page.getByRole("group", { name: "Choose group", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Place saved", exact: true })).toHaveCount(0);
  const stored = await page.evaluate(
    async ({ account, group }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("voltura-places");
        r.onsuccess = () => resolve(r.result);
      });
      const get = (key: string) =>
        new Promise<any>((resolve) => {
          const r = db.transaction("workspaces").objectStore("workspaces").get(key);
          r.onsuccess = () => resolve(r.result);
        });
      const privateWorkspace = await get(account),
        shared = await get(`family:${account}:${group}`);
      db.close();
      const count = (w: any) =>
        w?.records.filter((r: any) => r.kind === "place" && !r.deleted).length ?? 0;
      return { privateCount: count(privateWorkspace), groupCount: count(shared) };
    },
    { account, group },
  );
  expect(stored).toEqual({ privateCount: 1, groupCount: 0 });
});
