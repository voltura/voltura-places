import { test, expect, type Page } from "./fixtures";
import { canonicalGeometry, type RouteGeometry } from "../../src/shared/routes";

test.use({ serviceWorkers: "block" });

async function openRoute(page: Page, input?: RouteGeometry) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: PositionCallback, error: PositionErrorCallback) => {
          Object.assign(window, { followFix: success, followError: error });

          return 1;
        },
        clearWatch: () => {
          Object.assign(window, { followCleared: true });
        },
      },
    });
  });
  const geometry = await canonicalGeometry(
    input ?? {
      version: 1,
      segments: [
        [
          [59.332, 18.063, 3000, 5],
          [59.333, 18.063, 3500, 5],
          [59.333, 18.064, 4000, 5],
        ],
        [
          [59.33, 18.06, 1000, 5],
          [59.331, 18.061, 2000, 5],
        ],
      ],
    },
  );
  const date = "2026-11-03T00:00:00.000Z";
  const snapshot = {
    version: 1,
    category: { name: "Trail", color: "green" },
    geometry: geometry.geometry,
    route: {
      name: "Shared trail",
      categoryId: "other",
      capturedAt: date,
      updatedAt: date,
      startedAt: date,
      stoppedAt: date,
      duration: 0,
      geometryId: geometry.id,
      ...geometry.summary,
    },
  };
  await page.addInitScript(() => {
    localStorage.setItem("places-account-choice", "done");
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", mapBackground: "naturkartan" }),
    );
  });
  let bearer = false;
  await page.route("**/api/v1/route-share", async (route) => {
    bearer = route.request().headers()["x-places-route-token"] === "a".repeat(64);
    await route.fulfill({ json: snapshot });
  });
  await page.goto(`/#route=${"a".repeat(64)}`);
  const incoming = page.getByRole("dialog", { name: "Shared route", exact: true });
  await expect(incoming).toBeVisible();
  expect(bearer).toBe(true);
  expect(new URL(page.url()).hash).toBe("");
  await expect(incoming.locator(".route-line").first()).toBeVisible();
  await expect(incoming.locator("img.leaflet-tile").first()).toBeVisible();

  await page.getByLabel("Save route to", { exact: true }).selectOption("guest");
  await expect(incoming).toHaveCount(0);
  await expect(page.getByText("Shared trail", { exact: true })).toBeVisible();
}

async function fix(page: Page, latitude = 59.331) {
  await page.evaluate((latitude) => {
    (window as unknown as { followFix: PositionCallback }).followFix({
      timestamp: Date.now(),
      coords: { latitude, longitude: 18.061, accuracy: 150 },
    } as GeolocationPosition);
  }, latitude);
}

test("follow route shows segmented geometry, tracks, pauses, retries and restores details", async ({
  page,
}) => {
  await openRoute(page);
  await page.clock.install();
  await page.getByText("Shared trail", { exact: true }).click();
  const details = page.getByRole("dialog", { name: "Route details", exact: true });
  const follow = details.getByRole("button", { name: "Follow route", exact: true });
  await expect(details.locator(".button.primary")).toHaveCount(1);
  await expect(follow).toHaveClass(/primary/);
  await expect(details.getByRole("button", { name: "Show route start", exact: true })).toHaveClass(
    /outline/,
  );
  await follow.click();
  const view = page.locator(".follow-route-view");
  await expect(view).toBeVisible();
  await expect(view.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(view.locator(".route-line")).toHaveCount(2);
  await expect(view.locator(".follow-route-outline")).toHaveCount(2);
  await expect(view.locator('a[href="https://leafletjs.com"]')).toHaveCount(0);
  await expect(view.locator(".leaflet-attribution-flag")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await view.locator(".route-line").first().getAttribute("d"))?.match(/[ML]/g)?.length ?? 0,
    )
    .toBe(3);
  expect(
    await view
      .locator(".route-line")
      .first()
      .evaluate((line) => getComputedStyle(line).stroke),
  ).toBe("rgb(124, 58, 237)");
  expect(await view.evaluate((el) => el.matches(":modal"))).toBe(true);
  await fix(page);
  await expect(view.locator(".follow-current-position")).toBeVisible();
  await expect(view.locator(".follow-route-status")).toContainText("150 m");
  const recentre = view.getByRole("button", { name: "Re-centre", exact: true });
  await expect(recentre).toHaveAttribute("aria-pressed", "true");
  await fix(page, 59.332);
  const canvas = view.locator(".places-map");
  const marker = view.locator(".follow-current-position");

  const centerDistance = async () => {
    const rect = (await canvas.boundingBox())!;
    const dot = await marker.boundingBox();
    if (!dot) {
      return Infinity;
    }

    return Math.hypot(
      dot.x + dot.width / 2 - rect.x - rect.width / 2,
      dot.y + dot.height / 2 - rect.y - rect.height / 2,
    );
  };

  await expect.poll(centerDistance).toBeLessThan(3);
  await view.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(recentre).toHaveAttribute("aria-pressed", "false");
  await fix(page, 59.333);
  await expect.poll(centerDistance).toBeGreaterThan(5);
  await recentre.click();
  await expect.poll(centerDistance).toBeLessThan(3);
  await view.getByRole("button", { name: "Show route", exact: true }).click();
  await expect(recentre).toHaveAttribute("aria-pressed", "false");
  await recentre.click();
  await expect(recentre).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() =>
    (window as unknown as { followError: PositionErrorCallback }).followError({
      code: 1,
    } as GeolocationPositionError),
  );
  await expect(view.locator(".follow-route-status")).toContainText("Allow location");
  await expect(view.locator(".follow-current-position")).toHaveCount(0);
  await view.getByRole("button", { name: "Retry", exact: true }).click();
  await fix(page);
  await expect(view.locator(".follow-current-position")).toBeVisible();
  await page.clock.fastForward(15001);
  await expect(view.locator(".follow-current-position")).toHaveCount(0);
  await expect(view.locator(".follow-route-status")).toContainText("out of date");
  await fix(page);
  await page.screenshot({ path: ".artifacts/follow-route-phone.png" });
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(details).toBeVisible();
  await expect(follow).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as { followCleared: boolean }).followCleared),
  ).toBe(true);
});

test("route actions preserve search and menu, Swedish desktop follows without changing data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page);
  await page.getByRole("textbox", { name: "Search your places", exact: true }).fill("Shared");
  await page.getByRole("button", { name: "Edit place: Shared trail", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Shared trail", exact: true });
  await menu.getByRole("button", { name: "Follow route", exact: true }).click();
  const view = page.locator(".follow-route-view");
  await expect(view.locator(".route-line")).toHaveCount(2);
  await fix(page);
  await page.screenshot({ path: ".artifacts/follow-route-desktop.png" });
  await view.getByRole("button", { name: "Close", exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Follow route", exact: true })).toBeFocused();
  await menu.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search your places", exact: true })).toHaveValue(
    "Shared",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("select.language-select").first().selectOption("sv");
  await page.keyboard.press("Escape");
  await page.getByText("Shared trail", { exact: true }).first().click();
  await page
    .locator(".details-content:visible")
    .getByRole("button", { name: "Följ rutt", exact: true })
    .click();
  await expect(view.getByRole("button", { name: "Centrera", exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "Visa rutt", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await view.getByRole("button", { name: "Visa rutt", exact: true }).click();
  await fix(page);
  await expect(view.locator(".follow-current-position")).toBeVisible();
  expect(await view.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: ".artifacts/follow-route-swedish.png" });
  await page.keyboard.press("Escape");
});

test("deleting the followed route closes the session and ignores late positions", async ({
  page,
}) => {
  await openRoute(page);
  await page.getByText("Shared trail", { exact: true }).click();
  await page.getByRole("button", { name: "Follow route", exact: true }).click();
  const view = page.locator(".follow-route-view");
  await expect(view.locator(".route-line")).toHaveCount(2);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("voltura-places", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("workspaces", "readwrite");
    const store = tx.objectStore("workspaces");
    const read = store.get("guest");
    read.onsuccess = () => {
      const data = read.result;
      data.records = data.records.map((record: { kind: string }) =>
        record.kind === "route" ? { ...record, deleted: true } : record,
      );
      store.put(data);
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
    window.dispatchEvent(new Event("places-library"));
  });
  await expect(view).toHaveCount(0);
  await fix(page);
  await expect(view).toHaveCount(0);
});

test("unavailable route geometry has explicit retry and cached geometry works offline", async ({
  page,
  context,
}) => {
  await openRoute(page);
  const cached = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("voltura-places-routes", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("geometry", "readwrite");
    const store = tx.objectStore("geometry");
    const rows = await new Promise<unknown[]>((resolve) => {
      const read = store.getAll();
      read.onsuccess = () => resolve(read.result);
    });
    store.clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();

    return rows;
  });
  await page.getByText("Shared trail", { exact: true }).click();
  await page.getByRole("button", { name: "Follow route", exact: true }).click();
  const view = page.locator(".follow-route-view");
  await expect(view.getByRole("alert")).toContainText("Could not load the route");
  await expect(view.locator(".route-marker")).toHaveCount(0);
  await page.evaluate(async (cached) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("voltura-places-routes", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("geometry", "readwrite");
    cached.forEach((row) => tx.objectStore("geometry").put(row));
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, cached);
  await view.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(view.locator(".route-line")).toHaveCount(2);
  await context.setOffline(true);
  await expect(view.locator(".map-warning")).toBeVisible();
  await fix(page);
  await expect(view.locator(".follow-current-position")).toBeVisible();
  await view.getByRole("button", { name: "Show route", exact: true }).click();
  await expect(view.locator(".route-line")).toHaveCount(2);
  await context.setOffline(false);
});

test("date-line loop keeps its complete path and both endpoints visible", async ({ page }) => {
  await openRoute(page, {
    version: 1,
    segments: [
      [
        [0, 179.999, 1000, 5],
        [0.001, -179.999, 2000, 5],
        [0, 179.999, 3000, 5],
      ],
    ],
  });
  await page.getByText("Shared trail", { exact: true }).click();
  await page.getByRole("button", { name: "Follow route", exact: true }).click();
  const view = page.locator(".follow-route-view");
  await expect(view.locator(".route-marker")).toHaveCount(2);
  await page.evaluate(() =>
    (window as unknown as { followFix: PositionCallback }).followFix({
      timestamp: Date.now(),
      coords: { latitude: 0.0005, longitude: -179.9995, accuracy: 5 },
    } as GeolocationPosition),
  );
  await expect(view.locator(".follow-current-position")).toBeVisible();
  await expect
    .poll(async () => (await view.locator(".route-line").boundingBox())?.width ?? 0)
    .toBeGreaterThan(30);
  const line = (await view.locator(".route-line").boundingBox())!;
  const map = (await view.locator(".places-map").boundingBox())!;
  expect(line.x).toBeGreaterThanOrEqual(map.x);
  expect(line.x + line.width).toBeLessThan(map.x + map.width);
});

test("following from map details preserves the library map", async ({ page }) => {
  await openRoute(page);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByRole("button", { name: "Route start: Shared trail", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Route details", exact: true });
  await expect(details).toBeVisible();
  const mainMap = page.locator(".library-pane .places-map");
  const before = await mainMap.locator(".leaflet-map-pane").getAttribute("style");
  await details.getByRole("button", { name: "Follow route", exact: true }).click();
  await expect(page.locator(".follow-route-view .route-line")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(details).toBeVisible();
  expect(await mainMap.locator(".leaflet-map-pane").getAttribute("style")).toBe(before);
});

test("a route west of the date line stays beside a position east of it", async ({ page }) => {
  await openRoute(page, {
    version: 1,
    segments: [
      [
        [0, -179.9, 1000, 5],
        [0.01, -179.8, 2000, 5],
      ],
    ],
  });
  await page.getByText("Shared trail", { exact: true }).click();
  await page.getByRole("button", { name: "Follow route", exact: true }).click();
  const view = page.locator(".follow-route-view");
  await expect(view.locator(".route-line")).toHaveCount(1);
  await page.evaluate(() =>
    (window as unknown as { followFix: PositionCallback }).followFix({
      timestamp: Date.now(),
      coords: { latitude: 0.005, longitude: 179.9, accuracy: 5 },
    } as GeolocationPosition),
  );

  const expectAllInside = async () => {
    const map = (await view.locator(".places-map").boundingBox())!;
    for (const selector of [".route-line", ".follow-current-position", ".route-marker"]) {
      for (const layer of await view.locator(selector).all()) {
        const box = (await layer.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(map.x);
        expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width);
        expect(box.y).toBeGreaterThanOrEqual(map.y);
        expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height);
      }
    }
  };

  await expect(view.locator(".follow-current-position")).toBeVisible();
  await expectAllInside();
  await view.getByRole("button", { name: "Re-centre", exact: true }).click();
  await view.getByRole("button", { name: "Show route", exact: true }).click();
  await expectAllInside();
});
