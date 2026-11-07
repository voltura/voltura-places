import { test, expect, type Page } from "./fixtures";

const results = [
  {
    id: "1:0",
    name: "Slåboda",
    municipality: "Arboga",
    county: "Västmanland",
    latitude: 59.41,
    longitude: 15.83,
  },
  {
    id: "1:1",
    name: "Slåboda",
    municipality: "Kungsör",
    county: "Västmanland",
    latitude: 59.42,
    longitude: 16.09,
  },
  {
    id: "2:0",
    name: "Slåboda",
    municipality: "Köping",
    county: "Västmanland",
    latitude: 59.42,
    longitude: 16.09,
  },
];

test.use({ serviceWorkers: "block" });

const searchLibrary = (page: Page) => page.getByRole("textbox", { name: "Search places" });

const openSearch = (page: Page) => page.getByRole("button", { name: "Map search", exact: true });

const searchView = (page: Page) => page.getByRole("dialog", { name: "Map search", exact: true });

test("empty library search preserves the Map view, selects pins and saves only on confirmation", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/v1/map-search", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ query: "Slåboda" });
    await route.fulfill({ json: { results } });
  });
  await page.goto("/");
  await expect(openSearch(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await searchLibrary(page).fill(" Slåboda ");
  await expect(page.getByText("No matching places", { exact: true })).toBeVisible();
  const disclosure = "Map search sends your query to Lantmäteriet.";
  await expect(page.getByText(disclosure, { exact: true })).toBeVisible();
  await expect(openSearch(page)).toHaveAccessibleDescription(disclosure);
  expect(calls).toBe(0);
  await openSearch(page).click();
  const dialog = searchView(page);
  await expect(dialog.getByRole("textbox")).toHaveValue("Slåboda");
  const row = dialog.locator(".map-search-list").getByRole("button", { name: /Arboga/ });
  const pin = dialog.locator('.map-search-pin[aria-label*="Kungsör"]');
  await dialog
    .locator(".map-search-list")
    .getByRole("button", { name: /Kungsör/ })
    .click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await dialog.locator('.map-search-pin[aria-label*="Arboga"]').click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("map-search-phone.png") });
  const add = dialog.getByRole("button", { name: "Add place", exact: true });
  await add.click();
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Slåboda");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Back to library" }).click();
  await expect(openSearch(page)).toBeFocused();
  await expect(searchLibrary(page)).toHaveValue(" Slåboda ");
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".places-map-pin")).toHaveCount(0);
  await openSearch(page).click();
  await row.click();
  await add.click();
  await editor.getByRole("textbox", { name: "Name" }).fill("Slåboda walk");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back to library" }).click();
  await expect(page.locator(".places-map-pin")).toHaveCount(1);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".place-card")).toContainText("Slåboda walk");
  await expect(openSearch(page)).toHaveCount(0);
  expect(calls).toBe(2);
});

test("map refinement keeps the selected result and saves the chosen point", async ({
  page,
}, testInfo) => {
  await page.route("**/api/v1/map-search", (route) => route.fulfill({ json: { results } }));
  await page.goto("/");
  await searchLibrary(page).fill("Slåboda");
  await openSearch(page).click();
  const dialog = searchView(page);
  const pin = dialog.locator('.map-search-pin[aria-label*="Arboga"]');
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--raised", "rgb(12, 34, 56)"),
  );
  await pin.focus();
  const tooltip = dialog.getByRole("tooltip");
  await expect(tooltip).toHaveText("Slåboda, Arboga, Västmanland");
  await expect(tooltip).toHaveCSS("background-color", "rgb(12, 34, 56)");
  const row = dialog.locator(".map-search-list").getByRole("button", { name: /Arboga/ });
  await row.click();
  const adjust = dialog.getByRole("button", { name: "Adjust on map" });
  const picker = page.getByRole("dialog", { name: "Adjust on map" });
  await adjust.click();
  await picker.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await adjust.click();
  const map = picker.locator(".places-map");
  await map.click({ position: { x: 130, y: 140 } });
  const originalPin = picker.getByRole("button", { name: "Slåboda, Arboga, Västmanland" });
  await originalPin.click();
  const originalTooltip = picker.getByRole("tooltip");
  await expect(originalTooltip).toHaveText("Slåboda, Arboga, Västmanland");
  expect((await originalTooltip.boundingBox())!.width).toBeGreaterThan(100);
  const pinBounds = (await originalPin.boundingBox())!;
  const mapBounds = (await map.boundingBox())!;
  expect(
    Math.abs(pinBounds.x + pinBounds.width / 2 - mapBounds.x - mapBounds.width / 2),
  ).toBeLessThan(2);
  await map.click({ position: { x: 130, y: 140 } });
  await map.press("ArrowUp");
  const usePoint = picker.getByRole("button", { name: "Use this point", exact: true });
  await expect(usePoint).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("map-search-picker.png") });
  await usePoint.click();
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("Slåboda");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = await page.evaluate(
    () =>
      new Promise<{ latitude: number; longitude: number; accuracy: number | null }>(
        (resolve, reject) => {
          const open = indexedDB.open("voltura-places");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction("workspaces").objectStore("workspaces").get("guest");
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              db.close();
              resolve(
                request.result.records.find((record: { kind: string }) => record.kind === "place")
                  .value,
              );
            };
          };
        },
      ),
  );
  expect(saved.accuracy).toBeNull();
  expect(saved.latitude).not.toBe(results[0].latitude);
  expect(saved.longitude).not.toBe(results[0].longitude);
});

test("distance requires an explicit request, preserves ties and selection, and expires", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    let requests = 0;
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => Object.assign(new EventTarget(), { state: "prompt" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
          requests++;
          if (requests === 1) {
            failure({ code: 1 } as GeolocationPositionError);
          } else {
            success({
              timestamp: Date.now(),
              coords: { latitude: 59.42, longitude: 16.09, accuracy: 5 },
            } as GeolocationPosition);
          }
        },
      },
    });
    Object.assign(window, { searchLocationRequests: () => requests });
    localStorage.setItem("places-preferences", JSON.stringify({ units: "imperial" }));
  });
  await page.route("**/api/v1/map-search", (route) => route.fulfill({ json: { results } }));
  await page.goto("/");
  await searchLibrary(page).fill("Slåboda");
  await openSearch(page).click();
  const dialog = searchView(page);
  const rows = dialog.locator(".map-search-list li");
  await expect(rows.first()).toContainText("Arboga");
  expect(
    await page.evaluate(() =>
      (window as unknown as { searchLocationRequests: () => number }).searchLocationRequests(),
    ),
  ).toBe(0);
  await rows.first().getByRole("button").click();
  const sort = dialog.getByRole("button", { name: "Sort by distance", exact: true });
  await sort.click();
  await expect(dialog.getByText("Location access was denied.")).toBeVisible();
  await expect(rows.first()).toContainText("Arboga");
  await sort.click();
  await expect(rows.nth(0)).toContainText("Kungsör");
  await expect(rows.nth(1)).toContainText("Köping");
  await expect(rows.first()).toContainText("≈ 0 ft");
  await expect(rows.last()).toContainText(/≈ .*\bmi\b/);
  await expect(dialog.getByText("Approximate straight-line distance")).toBeVisible();
  await expect(rows.last().getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await page.clock.fastForward(61000);
  await expect(rows.first()).toContainText("Arboga");
  await expect(rows.first().getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await expect(sort).toBeVisible();
});

test("search displays retry, throttling, no results and offline states", async ({
  page,
  context,
}) => {
  let calls = 0;
  await page.route("**/api/v1/map-search", (route) => {
    calls++;
    if (calls <= 2) {
      return route.fulfill({ status: calls === 1 ? 503 : 429, json: { error: "fixture" } });
    }

    return route.fulfill({ json: { results: [] } });
  });
  await page.goto("/");
  await searchLibrary(page).fill("Slåboda");
  await openSearch(page).click();
  const dialog = searchView(page);
  const field = dialog.getByRole("textbox");
  const submit = dialog.getByRole("button", { name: "Search", exact: true });
  await expect(dialog.getByText("Map search is temporarily unavailable.")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.getByText("Too many searches. Try again in a minute.")).toBeVisible();
  await field.fill(" ");
  await expect(submit).toBeDisabled();
  await field.fill("No match");
  await submit.click();
  await expect(dialog.getByText("No places found. Try a different name.")).toBeVisible();
  await context.setOffline(true);
  await submit.click();
  await expect(dialog.getByText("Connect to the internet to search the map.")).toBeVisible();
  expect(calls).toBe(3);
});

test("a superseded response cannot replace results or cross an account change", async ({
  page,
}) => {
  let account: { id: string; methods: [] } | null = null;
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { enabled: true, providers: {}, account } }),
  );

  let deliver = () => {};

  await page.route("**/api/v1/map-search", async (route) => {
    if (route.request().postDataJSON().query === "Slåboda") {
      await new Promise<void>((resolve) => {
        deliver = resolve;
      });
    }
    await route
      .fulfill({
        json: { results: route.request().postDataJSON().query === "Slåboda" ? results : [] },
      })
      .catch(() => {});
  });
  await page.goto("/");
  await searchLibrary(page).fill("Slåboda");
  let sent = page.waitForRequest("**/api/v1/map-search");
  await openSearch(page).click();
  await sent;
  const dialog = searchView(page);
  await dialog.getByRole("textbox").fill("No match");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await expect(dialog.getByText("No places found. Try a different name.")).toBeVisible();
  deliver();
  await expect(dialog.locator(".map-search-list")).toHaveCount(0);
  await dialog.getByRole("textbox").fill("Slåboda");
  sent = page.waitForRequest("**/api/v1/map-search");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await sent;
  account = { id: "map-search-account", methods: [] };
  await page.evaluate(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "places-account" })),
  );
  await expect(dialog).toHaveCount(0);
  deliver();
  await expect(openSearch(page)).toHaveCount(0);
  await expect(page.locator(".place-card")).toHaveCount(0);
});

test("private and writable-group saves stay in their library and an archived group can only browse", async ({
  page,
}) => {
  const account = "map-search-destinations";
  const group = "10000000-0000-4000-8000-000000000001";
  const archived = "10000000-0000-4000-8000-000000000002";
  const accountState = { enabled: true, providers: {}, account: { id: account, methods: [] } };
  await page.addInitScript(
    ({ accountState, group, archived }) => {
      localStorage.setItem("places-account", JSON.stringify(accountState));
      localStorage.setItem(
        `places-family:${accountState.account.id}`,
        JSON.stringify({
          families: [
            {
              id: group,
              name: "Walks",
              ownerId: accountState.account.id,
              members: [],
              requests: [],
            },
          ],
          inactive: [
            { id: archived, name: "Archived walks", ownerId: "", members: [], requests: [] },
          ],
        }),
      );
    },
    { accountState, group, archived },
  );
  await page.route("**/api/account", (route) => route.fulfill({ json: accountState }));
  await page.route("**/api/family", (route) => route.abort());
  await page.route("**/api/v1/sync", (route) => route.abort());
  await page.route("**/api/v1/map-search", (route) => route.fulfill({ json: { results } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Skip for now", exact: true }).click();
  const dialog = searchView(page);

  const selectResult = async () => {
    await searchLibrary(page).fill("Slåboda");
    await openSearch(page).click();
    await dialog
      .locator(".map-search-list")
      .getByRole("button", { name: /Arboga/ })
      .click();
  };

  const save = async (name: string) => {
    await selectResult();
    await dialog.getByRole("button", { name: "Add place", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Add place", exact: true });
    await editor.getByRole("textbox", { name: "Name" }).fill(name);
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back to library" }).click();
    await expect(page.locator(".place-card")).toHaveText([new RegExp(name)]);
  };

  const switchLibrary = async (name: string) => {
    await page.locator("button.save-destination").click();
    await page
      .getByRole("group", { name: "Choose group" })
      .getByRole("button", { name, exact: true })
      .click();
  };

  await save("Slåboda private");
  await switchLibrary("Walks");
  await save("Slåboda group");
  await switchLibrary("Archived walks · Local copy");
  await selectResult();
  await expect(dialog.getByRole("button", { name: "Add place", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back to library" }).click();
  await switchLibrary("Private places");
  await expect(page.locator(".place-card")).toHaveText([/Slåboda private/]);
});
