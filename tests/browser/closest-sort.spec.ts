import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("a synchronous background location failure keeps the app usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "granted" });
    Object.defineProperty(navigator, "permissions", { value: { query: async () => permission } });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: () => {
          throw new Error("Location provider unavailable");
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const permissions of ["unavailable", "rejected", "throwing", "missing-query"] as const) {
  test(`Closest clears a saved fix on hide when Permissions API is ${permissions}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((permissions) => {
      let requests = 0;
      Object.defineProperty(navigator, "permissions", {
        value:
          permissions === "unavailable"
            ? undefined
            : permissions === "missing-query"
              ? {}
              : {
                  query: () => {
                    if (permissions === "throwing") {
                      throw new Error("Unsupported permission");
                    }

                    return Promise.reject(new Error("Unsupported permission"));
                  },
                },
      });
      Object.defineProperty(navigator, "geolocation", {
        value: {
          getCurrentPosition: (success: PositionCallback) => {
            requests++;
            success({
              timestamp: Date.now(),
              coords: { latitude: 0, longitude: 0, accuracy: 5 },
            } as GeolocationPosition);
          },
        },
      });
      Object.assign(window, { locationRequests: () => requests });
    }, permissions);
    await page.goto("/");
    const savePosition = page.getByRole("button", { name: "Save position", exact: true });
    await expect(savePosition).toBeEnabled();
    expect(await page.evaluate(() => (window as any).locationRequests())).toBe(0);
    await savePosition.click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Place details", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    // Quick save requests the first fix. The saved-place editor then refines it.
    const requestsAfterSave = await page.evaluate(() => (window as any).locationRequests());
    expect(requestsAfterSave).toBe(2);
    const sort = page.getByRole("combobox", { name: "Sort places", exact: true });
    await sort.selectOption("closest");
    await expect(sort).toHaveValue("closest");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(sort).toHaveValue("newest");
    await expect(sort.locator('option[value="closest"]')).toHaveCount(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(sort.locator('option[value="closest"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).locationRequests())).toBe(requestsAfterSave);
    await savePosition.click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sort.locator('option[value="closest"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("Closest requires a known position, reorders with movement and falls back on denial", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "prompt" });
    let latitude = 0;
    let requests = 0;
    Object.defineProperty(navigator, "permissions", { value: { query: async () => permission } });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          requests++;
          success({
            timestamp: Date.now(),
            coords: { latitude, longitude: 0, accuracy: 5 },
          } as GeolocationPosition);
        },
      },
    });
    Object.assign(window, {
      setLocationPermission: (state: string, nextLatitude = 0) => {
        latitude = nextLatitude;
        permission.state = state;
        permission.dispatchEvent(new Event("change"));
      },
      locationRequests: () => requests,
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("voltura-places", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const records = [0, 1, 10].map((latitude, i) => ({
      id: `place-${i}`,
      kind: "place",
      revision: 0,
      generation: 1,
      dirty: true,
      deleted: false,
      value: {
        name: ["Near", "Middle", "Far"][i],
        latitude,
        longitude: 0,
        accuracy: 5,
        categoryId: "other",
        capturedAt: `2026-10-${20 + i}T10:00:00Z`,
        updatedAt: "2026-10-30T10:00:00Z",
      },
    }));
    const tx = db.transaction("workspaces", "readwrite");
    tx.objectStore("workspaces").put({
      key: "guest",
      records,
      reconciled: true,
      presetRevision: 2,
    });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    window.dispatchEvent(new Event("places-library"));
  });
  const sort = page.getByRole("combobox", { name: "Sort places", exact: true });
  const names = page.locator(".place-card strong");
  await expect(names).toHaveText(["Far", "Middle", "Near"]);
  await expect(sort.locator('option[value="closest"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).locationRequests())).toBe(0);
  await page.evaluate(() => (window as any).setLocationPermission("granted"));
  await expect(sort.locator('option[value="closest"]')).toHaveText("Closest");
  await sort.selectOption("closest");
  await expect(names).toHaveText(["Near", "Middle", "Far"]);
  await page.evaluate(() => (window as any).setLocationPermission("granted", 10));
  await expect(names).toHaveText(["Far", "Middle", "Near"]);
  await page.screenshot({ path: "test-results/closest-sort.png" });
  await page.evaluate(() => (window as any).setLocationPermission("denied"));
  await expect(sort).toHaveValue("newest");
  await expect(sort.locator('option[value="closest"]')).toHaveCount(0);
});
