import { chromium, webkit, devices, expect, test, type Page } from "./fixtures";

const record = (id: string, latitude = 59.33, longitude = 18.07, deleted = false) => ({
  id,
  kind: "place",
  value: {
    name: id,
    categoryId: "other",
    latitude,
    longitude,
    accuracy: 8,
    capturedAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
  },
  deleted,
  revision: 0,
  generation: 1,
  dirty: true,
});
async function seed(page: Page, records: unknown[], key = "guest") {
  await page.evaluate(
    async ({ records, key }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("voltura-places", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put({ key, records, reconciled: true, presetRevision: 2 });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      window.dispatchEvent(new Event("places-library"));
    },
    { records, key },
  );
}
async function start(page: Page, records: unknown[]) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, records);
}
async function openMap(page: Page) {
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".leaflet-container")).toBeVisible();
}
test.beforeEach(async ({ context }) => {
  // Synthetic local tiles: automated browsing never requests real OSM tiles.
  await context.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
});

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} centres cluster counts and keeps map controls at least 48px`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        baseURL: "http://127.0.0.1:5174",
        locale: "en-US",
      });
      await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      await context.route("https://tile.openstreetmap.org/**", (route) =>
        route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
      const page = await context.newPage();
      await start(page, [record("First"), record("Second"), record("Third")]);
      await openMap(page);
      const geometry = await page.locator(".places-map-cluster").evaluate((el) => {
        const circle = el.getBoundingClientRect(),
          number = el.querySelector("span")!.getBoundingClientRect();
        return {
          dx: Math.abs((circle.left + circle.right - number.left - number.right) / 2),
          dy: Math.abs((circle.top + circle.bottom - number.top - number.bottom) / 2),
        };
      });
      expect(geometry.dx).toBeLessThan(1);
      expect(geometry.dy).toBeLessThan(1);
      const zoom = await page.locator(".leaflet-control-zoom-in").boundingBox();
      expect(zoom!.width).toBeGreaterThanOrEqual(48);
      expect(zoom!.height).toBeGreaterThanOrEqual(48);
      await page
        .locator(".places-map-section")
        .screenshot({ path: `.artifacts/map-cluster-${engine.name()}.png` });
      await page
        .locator(".places-map-cluster")
        .screenshot({ path: `.artifacts/map-count-${engine.name()}.png` });
      await page.locator(".places-map-cluster").press("Enter");
      await expect(page.getByRole("dialog", { name: "Choose place", exact: true })).toBeVisible();
    } finally {
      await browser.close();
    }
  });
}

test("map is optional, opens saved details under production CSP, and filters share list state", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { cspErrors: string[] }).cspErrors = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { cspErrors: string[] }).cspErrors.push(event.violatedDirective);
    });
  });
  let tileRequests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://tile.openstreetmap.org/")) tileRequests++;
  });
  await start(page, [
    record("Forest picnic"),
    record("City coffee", 55, 13),
    record("Deleted", 59, 18, true),
  ]);
  await expect(page.locator(".place-card")).toHaveCount(2);
  expect(tileRequests).toBe(0);
  // Measure the map's lazy import and interactions separately from initial loading.
  await page.evaluate(() => {
    (window as unknown as { cspErrors: string[] }).cspErrors = [];
  });
  await openMap(page);
  await expect(page.locator(".places-map-pin")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "OpenStreetMap", exact: true })).toBeVisible();
  await expect(page.locator(".leaflet-tile").first()).toHaveAttribute("referrerpolicy", "origin");
  await page.locator('.places-map-pin[title="Forest picnic"]').click();
  await expect(page.locator(".details-content:visible h2")).toHaveText("Forest picnic");
  await expect(page.getByRole("button", { name: "Navigate", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("textbox", { name: "Search your places", exact: true }).fill("coffee");
  await expect(page.locator(".places-map-pin")).toHaveCount(1);
  await expect(page.locator('.places-map-pin[title="City coffee"]')).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".place-card")).toHaveCount(1);
  violations.push(
    ...(await page.evaluate(() => (window as unknown as { cspErrors: string[] }).cspErrors)),
  );
  expect(violations).toEqual([]);
});

test("identical pins open a chooser and remain useful offline", async ({ page, context }) => {
  await start(page, [record("First place"), record("Second place")]);
  await openMap(page);
  await page.locator(".places-map-cluster").click();
  const picker = page.getByRole("dialog", { name: "Choose place", exact: true });
  await expect(picker.getByRole("button", { name: "First place", exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Second place", exact: true }).click();
  await expect(page.locator(".details-content:visible h2")).toHaveText("Second place");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await context.setOffline(true);
  await expect(page.locator(".map-warning")).toContainText("Background map unavailable");
  await page.locator(".places-map-cluster").click();
  await picker.getByRole("button", { name: "First place", exact: true }).click();
  await expect(page.locator(".details-content:visible h2")).toHaveText("First place");
  await context.setOffline(false);
});

test("tile failures preserve pins; local updates and tombstones update the map", async ({
  page,
  context,
}) => {
  await context.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await start(page, [record("Before")]);
  await openMap(page);
  await expect(page.getByRole("status")).toContainText("Background map unavailable");
  await expect(page.locator('.places-map-pin[title="Before"]')).toBeVisible();
  await seed(page, [record("Before", 59, 18, true), record("After")]);
  await expect(page.locator('.places-map-pin[title="Before"]')).toHaveCount(0);
  await page.locator('.places-map-pin[title="After"]').press("Enter");
  await expect(page.locator(".details-content:visible h2")).toHaveText("After");
});

test("maximum library clusters without rendering thousands of controls", async ({ page }) => {
  await start(page, [record("Initial")]);
  await openMap(page);
  await seed(
    page,
    Array.from({ length: 5000 }, (_, i) => record(`Place-${i}`, 59.33 + i * 0.000001, 18.07)),
  );
  await expect(page.locator(".map-toolbar")).toContainText("5000");
  await expect(page.locator(".places-map-cluster").first()).toBeVisible();
  expect(await page.locator(".leaflet-marker-icon").count()).toBeLessThan(30);
});

for (const width of [375, 390, 1280]) {
  test(`details map preview expands the saved place at ${width}px without duplicate hidden maps`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
    const picnic = record("Forest picnic");
    picnic.value.accuracy = 183;
    await start(page, [picnic, record("Distant coffee", 55, 13)]);
    await page.getByRole("textbox", { name: "Search your places", exact: true }).fill("Forest");
    await page.locator(".card-main").click();
    const details = page.locator(".details-content:visible");
    await expect(details.locator(".places-map-preview .places-map")).toBeVisible();
    await expect(page.locator(".details-map-preview")).toHaveCount(1);
    await expect(details.locator(".leaflet-control-zoom")).toHaveCount(0);
    expect((await details.locator(".places-map").boundingBox())!.height).toBe(180);
    const radius = details.locator(".place-accuracy-radius");
    await expect(radius).toHaveCount(1);
    const circle = (await radius.boundingBox())!;
    const map = (await details.locator(".places-map").boundingBox())!;
    expect(circle.width).toBeGreaterThan(20);
    expect(circle.x).toBeGreaterThan(map.x);
    expect(circle.y).toBeGreaterThan(map.y);
    expect(circle.y + circle.height).toBeLessThan(map.y + map.height);
    const actions = (await details.locator(".details-map-actions").boundingBox())!;
    const navigate = (await details.locator(".navigate-place").boundingBox())!;
    const secondary = (await details.locator(".details-secondary-actions").boundingBox())!;
    expect(navigate.y - actions.y - actions.height).toBeCloseTo(12, 0);
    expect(secondary.y - navigate.y - navigate.height).toBeCloseTo(12, 0);
    if (width === 375) {
      const head = page.locator(".sheet-head");
      const before = (await head.boundingBox())!;
      expect(before.height).toBeLessThanOrEqual(66);
      // At least 110px of the preview is reachable before scrolling on iPhone SE.
      expect(map.y).toBeLessThan(550);
      await page.screenshot({ path: ".artifacts/details-compact-375.png" });
      await page.locator(".sheet-content").evaluate((element) => {
        element.scrollTop = 180;
      });
      expect((await head.boundingBox())!.y).toBeCloseTo(before.y, 0);
    }
    await expect(details.getByRole("link", { name: "OpenStreetMap", exact: true })).toBeVisible();
    await details.screenshot({ path: `.artifacts/details-map-preview-${width}.png` });
    await details.getByRole("button", { name: "Expand map", exact: true }).click();
    if (width < 1000)
      await expect(page.getByRole("dialog", { name: "Place details", exact: true })).toHaveCount(0);
    await expect(page.locator(".library-pane .places-map")).toBeVisible();
    await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("textbox", { name: "Search your places", exact: true }),
    ).toHaveValue("");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = document.querySelector(".library-pane .places-map")!.getBoundingClientRect();
          const pin = document
            .querySelector('.library-pane .places-map-pin[title="Forest picnic"]')!
            .getBoundingClientRect();
          return Math.abs((map.left + map.right - pin.left - pin.right) / 2);
        }),
      )
      .toBeLessThan(4);
  });
}

test("an unavailable preview background preserves details and the expand action", async ({
  page,
  context,
}) => {
  await context.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await start(page, [record("Saved destination")]);
  await page.locator(".card-main").click();
  const details = page.locator(".details-content:visible");
  await expect(details.locator(".map-warning")).toContainText("Background map unavailable");
  await expect(details.getByRole("button", { name: "Navigate", exact: true })).toBeEnabled();
  await expect(details.getByRole("button", { name: "Expand map", exact: true })).toBeEnabled();
  await expect(details.locator(".places-map-pin")).toHaveCount(1);
});

test("phone map puts Show all inside the canvas and keeps its bottom clear of the save dock", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, [record("Saved place")]);
  const cardTop = await page
    .locator(".place-card")
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(cardTop).toBeLessThan(360);
  await page.screenshot({ path: ".artifacts/compact-phone-list.png" });
  await openMap(page);
  await expect(page.getByRole("combobox", { name: "Sort places", exact: true })).toHaveCount(0);
  const showAll = page.getByRole("button", { name: "Show all", exact: true });
  await expect(showAll).toHaveCount(0);
  await page.locator(".leaflet-control-zoom-in").click();
  await expect(showAll).toHaveCount(0);
  const map = page.locator(".library-pane .places-map");
  for (let i = 0; i < 3; i++) await map.press("ArrowRight", { delay: 300 });
  await expect(showAll).toBeVisible();
  const geometry = await page.evaluate(() => {
    const map = document.querySelector(".places-map")!.getBoundingClientRect();
    const showAll = document.querySelector(".map-show-all")!.getBoundingClientRect();
    return {
      top: map.top,
      height: map.height,
      inside: showAll.top >= map.top && showAll.bottom <= map.bottom && showAll.right <= map.right,
    };
  });
  expect(geometry.top).toBeLessThan(360);
  expect(geometry.height).toBeGreaterThan(500);
  expect(geometry.inside).toBe(true);
  await showAll.click();
  await expect(showAll).toHaveCount(0);
  await expect(map).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const unobscured = await page.evaluate(
    () =>
      document.querySelector(".places-map")!.getBoundingClientRect().bottom <=
      document.querySelector(".save-dock")!.getBoundingClientRect().top,
  );
  expect(unobscured).toBe(true);
  await page.screenshot({ path: ".artifacts/compact-phone-map.png" });
});

test("desktop map uses available width and details shrink to content with amber poor accuracy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const place = record("Trail entrance");
  place.value.accuracy = 500;
  await start(page, [place]);
  await openMap(page);
  expect((await page.locator(".library-pane .places-map").boundingBox())!.width).toBeGreaterThan(
    1100,
  );
  await page.locator('.places-map-pin[title="Trail entrance"]').click();
  await expect(page.locator(".detail-pane .accuracy-imprecise")).toHaveText("±500 m");
  const metadata = page.locator(".detail-pane .details-metadata");
  await expect(metadata.locator("dt")).toHaveText(["Coordinates", "Saved", "Accuracy"]);
  await expect(metadata.locator(".accuracy-dot")).toBeVisible();
  await metadata.getByRole("button", { name: "About location accuracy", exact: true }).click();
  await expect(page.locator(".detail-pane .accuracy-help")).toBeVisible();
  await metadata.getByRole("button", { name: "About location accuracy", exact: true }).click();
  await metadata.screenshot({ path: ".artifacts/place-metadata-rows.png" });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document.querySelector(".places-map")!.getBoundingClientRect();
        const pin = document.querySelector(".places-map-pin")!.getBoundingClientRect();
        return Math.abs((map.left + map.right - pin.left - pin.right) / 2);
      }),
    )
    .toBeLessThan(4);
  const gap = await page.evaluate(() => {
    const panel = document.querySelector(".detail-pane")!.getBoundingClientRect();
    const content = document
      .querySelector(".detail-pane .details-content")!
      .getBoundingClientRect();
    return panel.height - content.height;
  });
  expect(gap).toBeLessThan(8);
  expect((await page.locator(".library-pane .places-map").boundingBox())!.width).toBeGreaterThan(
    700,
  );
  await page.screenshot({ path: ".artifacts/compact-desktop-map.png" });
});

test("map switches between private, active and retained read-only groups without mixing pins", async ({
  page,
}) => {
  const identity = {
    id: "map-account",
    methods: [{ provider: "email", label: "map@example.invalid" }],
  };
  const state = {
    enabled: true,
    providers: { email: true },
    account: identity as typeof identity | null,
  };
  const active = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Walking group",
    ownerId: identity.id,
    members: [{ id: identity.id, label: "Map tester" }],
    requests: [],
  };
  const archived = {
    ...active,
    id: "22222222-2222-4222-8222-222222222222",
    name: "Retained group",
  };
  await page.addInitScript(
    ({ state, active, archived }) => {
      localStorage.setItem("places-account", JSON.stringify(state));
      localStorage.setItem(
        `places-family:${state.account!.id}`,
        JSON.stringify({ families: [active], inactive: [archived] }),
      );
    },
    { state, active, archived },
  );
  await page.route("**/api/account", (route) => route.fulfill({ json: state }));
  await page.route("**/api/family", (route) => route.fulfill({ json: { families: [active] } }));
  await page.route("**/api/v1/sync**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            version: 1,
            accountId: route.request().headers()["x-places-family"]
              ? `family:${identity.id}:${route.request().headers()["x-places-family"]}`
              : identity.id,
            records: [],
          },
        })
      : route.fulfill({ status: 503, json: { error: "serviceUnavailable" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  await seed(page, [record("Private secret")], identity.id);
  await seed(page, [record("Group walk", 55, 13)], `family:${identity.id}:${active.id}`);
  await seed(page, [record("Old walk", 65, 20)], `family:${identity.id}:${archived.id}`);
  await openMap(page);
  await expect(page.locator('.places-map-pin[title="Private secret"]')).toBeVisible();
  const choose = async (name: string) => {
    await page.getByRole("button", { name: "Choose group", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  };
  await choose(active.name);
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('.places-map-pin[title="Group walk"]')).toBeVisible();
  await expect(page.locator('.places-map-pin[title="Private secret"]')).toHaveCount(0);
  await choose(archived.name);
  await expect(page.locator('.places-map-pin[title="Old walk"]')).toBeVisible();
  await page.locator('.places-map-pin[title="Old walk"]').click();
  await expect(
    page.locator(".details-content:visible").getByRole("button", { name: "Edit", exact: true }),
  ).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeDisabled();
  state.account = null;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".places-map")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No places saved yet", exact: true }),
  ).toBeVisible();
});

for (const provider of ["Google Maps", "Apple Maps"]) {
  test(`${provider} Navigate hands off directions and remembers the provider`, async ({
    page,
    context,
  }) => {
    await context.route(/https:\/\/(www\.google\.com\/maps|maps\.apple\.com\/)/, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Directions fixture</title>" }),
    );
    await start(page, [record("Destination", -33.123456789, 151.987654321)]);
    await page.locator(".card-main").click();
    const navigate = page.getByRole("button", { name: "Navigate", exact: true });
    await navigate.click();
    const picker = page.getByRole("dialog", { name: "Choose map app", exact: true });
    await expect(picker.getByRole("link", { name: "Other map app", exact: true })).toHaveCount(0);
    const link = picker.getByRole("link", { name: provider, exact: true });
    const target = new URL((await link.getAttribute("href"))!);
    expect(target.searchParams.get("destination")).toBe("-33.123456789,151.987654321");
    for (const action of [() => link.click(), () => navigate.click()]) {
      const opened = context.waitForEvent("page");
      await action();
      const external = await opened;
      await external.waitForLoadState();
      expect(external.url()).toBe(target.href);
      expect(
        await external.evaluate(() => window.opener === null && document.referrer === ""),
      ).toBe(true);
      await external.close();
    }
  });
}
