import { test, expect } from "@playwright/test";
for (const provider of ["Google Maps", "Apple Maps"]) {
  test(`${provider} opens separately from the picker and remembered provider`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
    // Keep this fixture local: verify browser navigation without contacting maps.
    await context.route(/https:\/\/(www\.google\.com\/maps|maps\.apple\.com\/)/, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Map fixture</title>" }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    const appURL = page.url();
    const openMaps = page
      .locator(".details-content")
      .getByRole("button", { name: "Open maps", exact: true });
    await openMaps.click();
    const picker = page.getByRole("dialog", { name: "Choose map app", exact: true });
    const link = picker.getByRole("link", { name: provider, exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const destination = await link.getAttribute("href");
    for (const source of ["picker", "remembered"]) {
      const opened = context.waitForEvent("page");
      if (source === "picker") await link.click();
      else await openMaps.click();
      const maps = await opened;
      await expect(maps).toHaveURL(destination!);
      await maps.waitForLoadState("domcontentloaded");
      expect(await maps.evaluate(() => window.opener === null && document.referrer === "")).toBe(
        true,
      );
      await expect(page).toHaveURL(appURL);
      await expect(openMaps).toBeVisible();
      await maps.close();
    }
    const dropdown = page.locator(".details-content:visible .details-map-picker select");
    await expect(dropdown).toHaveAccessibleName("Open with…");
    const alternative = provider === "Google Maps" ? "apple" : "google";
    const opened = context.waitForEvent("page");
    await dropdown.selectOption(alternative);
    const maps = await opened;
    await maps.waitForLoadState("domcontentloaded");
    expect(await maps.evaluate(() => window.opener === null && document.referrer === "")).toBe(
      true,
    );
    await maps.close();
    await page.reload();
    await page.locator("article .card-main").first().click();
    const remembered = context.waitForEvent("page");
    await page
      .locator(".details-content:visible")
      .getByRole("button", { name: "Open maps", exact: true })
      .click();
    const preferred = await remembered;
    await expect(preferred).toHaveURL(
      alternative === "apple" ? /maps\.apple\.com/ : /google\.com\/maps/,
    );
    await preferred.close();
  });
}
test("saved-place editor refines only better GPS fixes and saves the matching coordinates", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let callback!: PositionCallback;
    const watches = new Set<number>();
    let next = 0;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: PositionCallback) => {
          callback = success;
          const id = ++next;
          watches.add(id);
          if (id === 1)
            success({
              timestamp: Date.now(),
              coords: { latitude: 0, longitude: 0, accuracy: 500 },
            } as GeolocationPosition);
          return id;
        },
        clearWatch: (id: number) => watches.delete(id),
      },
    });
    Object.assign(window, {
      emitFix: (accuracy: number, latitude: number) =>
        callback({
          timestamp: Date.now(),
          coords: { latitude, longitude: 0, accuracy },
        } as GeolocationPosition),
      activeWatches: () => watches.size,
    });
  });
  const emit = (accuracy: number, latitude: number) =>
    page.evaluate(
      ([a, lat]) =>
        (window as unknown as { emitFix: (a: number, lat: number) => void }).emitFix(a, lat),
      [accuracy, latitude],
    );
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText("±500 m");
  await expect(
    dialog.getByRole("button", { name: "Use current location", exact: true }),
  ).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Update location", exact: true })).toBeVisible();
  await expect(dialog.locator(".success-note")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { activeWatches: () => number }).activeWatches()),
    )
    .toBe(1);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Refined position");
  await emit(25, 1);
  await expect(dialog.getByRole("status")).toContainText("±25 m");
  await emit(100, 2);
  await expect(dialog.getByRole("status")).toContainText("±25 m");
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Refined position",
  );
  await page.screenshot({ path: testInfo.outputPath("gps-refinement.png") });
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(dialog).toBeHidden();
  await emit(1, 3); // A browser may deliver a queued callback after clearWatch.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { activeWatches: () => number }).activeWatches()),
    )
    .toBe(0);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("voltura-places");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{
        records: { kind: string; value: { latitude: number; accuracy: number } }[];
      }>((resolve, reject) => {
        const request = db.transaction("workspaces").objectStore("workspaces").get("guest");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
  expect(saved.records.find((r) => r.kind === "place")?.value).toMatchObject({
    latitude: 1,
    accuracy: 25,
  });
});
test("quick save recovers from initial unavailable positions without enabling accuracy review", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "granted" });
    Object.defineProperty(navigator, "permissions", { value: { query: async () => permission } });
    let attempts = 0;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: PositionCallback, error: PositionErrorCallback) => {
          const attempt = ++attempts;
          if (attempt < 3) error({ code: 2 } as GeolocationPositionError);
          else
            success({
              timestamp: Date.now(),
              coords: { latitude: 0, longitude: 0, accuracy: 9 },
            } as GeolocationPosition);
          return attempt;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.runFor(3000);
  await expect(
    page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1", exact: true })).toBeVisible();
});
test("first use offers optional sign-in and remembers continuing without an account", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5174",
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Use Places", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in or create account", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("first-use.png") });
    await page.getByRole("button", { name: "Continue without an account", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Use Places", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Not signed in", { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
test("first location permission grant recovers in the current app without a restart", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "prompt" });
    const fixes: PositionCallback[] = [];
    Object.defineProperty(navigator, "permissions", { value: { query: async () => permission } });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: PositionCallback) => {
          fixes.push(success);
          return fixes.length;
        },
        clearWatch: () => {},
      },
    });
    (window as unknown as { grantLocation: () => void }).grantLocation = () => {
      permission.state = "granted";
      permission.dispatchEvent(new Event("change"));
      fixes.at(-1)!({
        timestamp: Date.now(),
        coords: { latitude: 0, longitude: 0, accuracy: 7 },
      } as GeolocationPosition);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await page.evaluate(() => (window as unknown as { grantLocation: () => void }).grantLocation());
  await expect(
    page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).not.toHaveValue("");
});
for (const failure of ["invalid", "throw"] as const) {
  test(`quick GPS save recovers from ${failure} results without saving`, async ({ page }) => {
    await page.addInitScript(
      (mode) =>
        Object.defineProperty(navigator, "geolocation", {
          value: {
            getCurrentPosition: (success: PositionCallback) => {
              if (mode === "throw") throw new Error("unavailable");
              success({
                timestamp: NaN,
                coords: { latitude: NaN, longitude: 0, accuracy: 5 },
              } as GeolocationPosition);
            },
          },
        }),
      failure,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No places saved yet", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  });
}
test("an account change clears an open private map dialog", async ({ page }) => {
  const identity = {
    id: "review-account",
    methods: [{ provider: "email", label: "review@example.invalid" }],
  };
  let account: typeof identity | null = null;
  await page.route("**/api/account", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        providers: { email: true },
        account,
      },
    }),
  );
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: identity.id, records: [] } }),
  );
  await page.route("**/api/family", (route) => route.fulfill({ json: { family: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Private review fixture");
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open maps", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Choose map app", exact: true })).toBeVisible();
  account = identity;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog", { name: "Choose map app", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
});
for (const [width, height, textScale] of [
  [320, 568, 1],
  [375, 812, 1],
  [430, 932, 1],
  [375, 812, 2],
]) {
  test(`phone readability and Swedish labels fit at ${width}px with ${textScale * 100}% text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?lang=sv");
    if (textScale !== 1)
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, textScale);
    const font = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const fits = async () => {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const content = page.locator("dialog[open] .sheet-content").last();
      if (await content.count())
        expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    };
    expect(await font(".save-here")).toBeGreaterThanOrEqual(20 * textScale);
    await page.getByRole("button", { name: "Spara position", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Namn", exact: true })
      .fill("Svampstället vid den gamla tallstigen");
    await page.getByRole("combobox", { name: "Kategori", exact: true }).selectOption("mushrooms");
    expect(await font(".photo-picker .button")).toBeGreaterThanOrEqual(18 * textScale);
    const photoButtons = await page
      .locator(".photo-picker .action-pair .button")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          top: button.getBoundingClientRect().top,
          width: button.getBoundingClientRect().width,
        })),
      );
    expect(photoButtons.every((button) => button.width >= 48)).toBe(true);
    if (width >= 430 && textScale === 1) expect(photoButtons[0].top).toBe(photoButtons[1].top);
    await fits();
    await page.getByRole("button", { name: "Klart", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stäng", exact: true }).click();
    expect(await font(".search-field input")).toBeGreaterThanOrEqual(18 * textScale);
    expect(await font(".card-maps")).toBeGreaterThanOrEqual(18 * textScale);
    expect(await font(".card-text strong")).toBeGreaterThanOrEqual(20 * textScale);
    expect(await font(".card-text > span")).toBeGreaterThanOrEqual(16 * textScale);
    await fits();
    await page.getByRole("button", { name: "Inställningar", exact: true }).click();
    for (const tab of [
      "Kategorier",
      "Säkerhetskopiering",
      "Konto och synkronisering",
      "Familjedelning",
      "Utseende och språk",
    ]) {
      await page
        .getByRole("combobox", { name: "Inställningar", exact: true })
        .selectOption({ label: tab });
      await fits();
      expect(
        await page
          .locator(".settings-tabs button")
          .evaluateAll((els) =>
            els.every(
              (el) =>
                el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
            ),
          ),
      ).toBe(true);
    }
  });
}
test("installed-app metadata references real icons and matched Apple startup images", async ({
  page,
}) => {
  await page.goto("/");
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(manifestUrl!)).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(
    true,
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Voltura Places",
  );
  await expect(page.locator('link[rel="apple-touch-startup-image"]')).toHaveCount(64);
  const startup = await page
    .locator('link[rel="apple-touch-startup-image"]')
    .evaluateAll((elements) =>
      elements.map((el) => ({ href: el.getAttribute("href"), media: el.getAttribute("media") })),
    );
  expect(
    startup.some(
      (link) =>
        link.media?.includes("390px") &&
        link.media.includes("844px") &&
        link.media.includes("portrait"),
    ),
  ).toBe(true);
  for (const path of ["/apple-touch-icon.png", "/icon-maskable-512.png", startup[0].href!]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.headers()["content-type"]).toBe("image/x-icon");
});
test("a Swedish app link overrides English browser/preferences and remembers the choice", async ({
  page,
}) => {
  await page.goto("/?lang=sv");
  await expect(page.getByRole("button", { name: "Spara position", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page).toHaveURL("/");
  await page.reload();
  await expect(page.getByRole("button", { name: "Spara position", exact: true })).toBeVisible();
  await page.goto("/?lang=en");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeVisible();
  await page.goto("/?lang=sv&source=family");
  await expect(page.getByRole("button", { name: "Spara position", exact: true })).toBeVisible();
  await expect(page).toHaveURL("/?source=family");
  await page.goto("/?lang=unknown");
  await expect(page.getByRole("button", { name: "Spara position", exact: true })).toBeVisible();
});
test("desktop stays focused on the library and opens details only for a selected place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(
    page.getByText("Save your current location to get started.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator(".save-dock .dock-hint")).toHaveCount(0);
  await expect(page.getByText("Works offline", { exact: true })).toHaveCount(0);
  await expect(page.locator(".detail-welcome, .trail-art, .library-title .eyebrow")).toHaveCount(0);
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Desktop trailhead");
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("complementary")).toContainText("Desktop trailhead");
});
test("optional accuracy review refines GPS and commits only the confirmed fix", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const watches = new Map<number, ReturnType<typeof setTimeout>[]>();
    let next = 0;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: (p: unknown) => void) => {
          const id = ++next;
          watches.set(
            id,
            [80, 25, 6].map((accuracy, i) =>
              setTimeout(
                () =>
                  success({
                    timestamp: Date.now(),
                    coords: { latitude: 0, longitude: 0, accuracy },
                  }),
                100 + i * 400,
              ),
            ),
          );
          return id;
        },
        clearWatch: (id: number) => {
          watches.get(id)?.forEach(clearTimeout);
          watches.delete(id);
          document.documentElement.dataset.gpsStopped = "true";
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", {
    name: "Review GPS accuracy before saving",
    exact: false,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page
    .getByRole("combobox", { name: "Distance units", exact: true })
    .selectOption("imperial");
  await page.reload();
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByRole("meter")).toHaveAttribute("aria-valuenow", "4");
  await expect(review).toContainText("±20 ft");
  await expect(page.getByRole("heading", { name: "No places saved yet" })).toBeAttached();
  await review.getByRole("button", { name: "Use this position", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true }),
  ).toContainText("±20 ft");
  await expect(page.locator("html")).toHaveAttribute("data-gps-stopped", "true");
  await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Keep my draft",
  );
});
test("accuracy review shows waiting, live quality, stale fix protection and retry", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.addInitScript(() => {
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", theme: "dark", provider: "", reviewGps: true }),
    );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: (p: unknown) => void) => {
          (window as any).__reviewFix = (accuracy: number) =>
            success({
              timestamp: Date.now(),
              coords: { latitude: 0, longitude: 0, accuracy },
            });
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  const confirm = review.getByRole("button", { name: "Use this position", exact: true });
  await expect(review).toContainText("Finding your location…");
  await expect(review.getByRole("meter")).toHaveCount(0);
  await expect(review.locator(".gps-number")).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("gps-waiting.png") });
  await page.evaluate(() => (window as any).__reviewFix(12));
  await expect(review.locator(".gps-number")).toHaveText("±12 m");
  await expect(review).toContainText("Estimated accuracy");
  await expect(review.locator(".gps-quality")).toHaveText("Good accuracy");
  await expect(review.getByRole("meter")).toHaveAttribute("aria-valuenow", "3");
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("gps-accuracy.png") });
  await page.evaluate(() => (window as any).__reviewFix(6));
  await expect(review.locator(".gps-number")).toHaveText("±6 m");
  await page.clock.runFor(16000);
  await expect(confirm).toBeDisabled();
  await expect(review.getByRole("meter")).toHaveCount(0);
  await expect(review).not.toContainText("Location search finished");
  await page.clock.runFor(44000);
  await expect(review).toContainText("Location search finished");
  await expect(review.locator(".gps-spinner")).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("gps-finished.png") });
  await review.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(review).toContainText("Finding your location…");
  await expect(review).not.toContainText("Location search finished");
  await page.clock.runFor(60000);
  await expect(review.getByRole("alert")).toHaveText("Couldn’t find your location.");
  await expect(review).not.toContainText("Location search finished");
  await expect(review).not.toContainText("Accuracy may improve");
  await expect(review).not.toContainText("trees and buildings");
  await expect(confirm).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("gps-failed.png") });
  await review.getByRole("button", { name: "Try again", exact: true }).click();
  await page.evaluate(() => (window as any).__reviewFix(8));
  await expect(confirm).toBeEnabled();
  await review.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No places saved yet", exact: true }),
  ).toBeVisible();
});
test("accuracy review handles denied permission and cancel without saving", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", theme: "dark", provider: "", reviewGps: true }),
    );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (_s: unknown, error: (e: unknown) => void) => {
          setTimeout(() => error({ code: 1 }), 20);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  await expect(review.getByRole("alert")).toContainText("Location access was denied");
  await expect(review.getByRole("button", { name: "Use this position", exact: true })).toHaveCount(
    0,
  );
  await review.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "No places saved yet" })).toBeVisible();
});
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
});
test("camera and library inputs support a durable offline photo and removable draft", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Photo fixture");
  await expect(page.getByRole("textbox", { name: "Latitude", exact: true })).toHaveCount(0);
  await expect(page.locator('input[capture="environment"]')).toHaveAttribute("accept", "image/*");
  const picker = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  await picker.setInputFiles("tests/fixtures/photo-gps.jpg");
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Use photo location", exact: true }).click();
  await expect(page.getByText("Location selected", { exact: true })).toBeVisible();
  await picker.setInputFiles({
    name: "invalid.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit place: Photo fixture", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Edit place: Photo fixture", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit place", exact: true }).click();
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  await expect(page.locator(".photo-picker img")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Photo removed draft");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open("voltura-places");
            open.onsuccess = () => {
              const db = open.result;
              const read = db.transaction("drafts").objectStore("drafts").get("guest");
              read.onsuccess = () => {
                resolve(
                  read.result?.name === "Photo removed draft" && read.result?.photoId === null,
                );
                db.close();
              };
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Photo removed draft",
  );
  await expect(page.locator(".photo-picker img")).toHaveCount(0);
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("GPS denial leaves the library intact and offers recovery", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_success: unknown, error: (e: { code: number }) => void) =>
          error({ code: 1 }),
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Location access was denied");
  await expect(page.getByRole("heading", { name: "No places saved yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
});
test("an unfinished manual draft reopens after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Unfinished draft");
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("voltura-places");
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("drafts").objectStore("drafts").get("guest");
          get.onsuccess = () => {
            resolve(get.result?.name === "Unfinished draft");
            db.close();
          };
          get.onerror = () => {
            resolve(false);
            db.close();
          };
        };
        open.onerror = () => resolve(false);
      }),
  );
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Add place" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Unfinished draft",
  );
});
test("GPS quick save commits before naming and survives offline reload", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 59.3293, longitude: 18.0686, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /^(Edit place|Place saved)$/ })).toBeVisible();
  await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await expect(page.locator(".save-dock .dock-hint")).toHaveText(
    "Offline · changes saved on this device",
  );
  await page.reload();
  await expect(page.locator(".save-dock .dock-hint")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("offline-save-dock.png") });
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Offline clearing");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 2" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".save-dock .dock-hint")).toHaveCount(0);
});
test("location is required and GPS places search and edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Trailhead");
  await expect(page.getByRole("textbox", { name: "Latitude", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a photo location");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("mushrooms");
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("textbox", { name: "Search your places" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching places" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit place: Trailhead" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText("Mushrooms");
});
test("sign-out retains sign-in providers and rejects a late account response", async ({ page }) => {
  const identity = {
    id: "fixture-account",
    methods: [
      { provider: "email", label: "fixture@example.invalid" },
      { provider: "google", label: "fixture@example.invalid" },
    ],
  };
  let signedIn = true;
  let holdNext = false;
  let releaseOld: (() => Promise<void>) | undefined;
  let held: (() => void) | undefined;
  const oldRequested = new Promise<void>((resolve) => {
    held = resolve;
  });
  const state = (account: typeof identity | null) => ({
    enabled: true,
    providers: { google: true, email: true, chatgpt: true },
    account,
  });
  await page.route("**/api/account", async (route) => {
    if (holdNext) {
      holdNext = false;
      releaseOld = () => route.fulfill({ json: state(identity) });
      held!();
      return;
    }
    await route.fulfill({ json: state(signedIn ? identity : null) });
  });
  await page.route("**/api/account/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: identity.id, records: [] } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Account & sync", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(
    page.locator(".account-summary").getByText("fixture@example.invalid", { exact: true }),
  ).toHaveCount(1);
  await page.getByText("Sign-in methods", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Link ChatGPT", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with ChatGPT", exact: true }),
  ).toBeHidden();
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await oldRequested;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "G Sign in with Google", exact: true }),
  ).toBeEnabled();
  await releaseOld!();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
  await expect(page.getByText("Account service is unavailable", { exact: false })).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("places-account") ?? "null")?.account),
    )
    .toBeNull();
});
test("copy feedback stays above an open map dialog and follows it back to the page", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } }),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Copy example");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open maps", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose map app", exact: true });
  await dialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  const toast = dialog.getByRole("status");
  await expect(toast).toContainText("Copied");
  expect(
    await toast.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
  await toast.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  await dialog.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("body > .toast")).toContainText("Copied");
  await expect
    .poll(() => page.locator("html").evaluate((element) => getComputedStyle(element).overflow))
    .not.toBe("hidden");
  await page.locator(".card-main").first().click();
  const detailsDialog = page.getByRole("dialog", { name: "Place details", exact: true });
  await detailsDialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  await expect(detailsDialog.getByRole("status")).toContainText("Copied");
});
for (const theme of ["dark", "light"]) {
  test(`place deletion uses a ${theme} themed confirmation with safe cancellation`, async ({
    page,
    context,
  }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language: "en", theme, provider: "" }),
      );
    }, theme);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    const card = page.locator(".place-card");
    const open = async () => {
      await card.getByRole("button", { name: /^Edit place:/ }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    };
    await open();
    const confirmation = page.getByRole("dialog", { name: "Delete this place?", exact: true });
    const cancel = confirmation
      .locator(".sheet-content")
      .getByRole("button", { name: /^(Cancel|Done)$/, exact: true });
    await expect(cancel).toBeFocused();
    await expect(confirmation).toContainText(
      "This removes the place from this library and its synced devices.",
    );
    await page.screenshot({ path: `.artifacts/delete-confirmation-${theme}.png` });
    await cancel.click();
    await expect(confirmation).toHaveCount(0);
    await expect(card).toHaveCount(1);
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(card).toHaveCount(1);
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(card).toHaveCount(0);
  });
}
for (const [width, scale] of [
  [320, 1],
  [375, 1],
  [430, 1],
  [375, 2],
  [1280, 1],
]) {
  test(`position details adapt at ${width}px with ${scale * 100}% text`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(
      width === 320
        ? { latitude: 59.123, longitude: 18.1, accuracy: 16 }
        : { latitude: -58.912058, longitude: -117.944706, accuracy: 16 },
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    const name =
      "A long location name beside the old forest trail ".repeat(2) +
      "UnbrokenLocationName".repeat(3);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    if (scale !== 1)
      await page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, scale);
    const details = page.locator(".details-content:visible");
    await expect(details.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(details.locator(".coordinate-display")).toHaveText(
      width === 320 ? "59.123, 18.100" : "-58.912058, -117.944706",
    );
    const measurements = await details.evaluate((el) => {
      const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      return {
        fits: el.scrollWidth <= el.clientWidth + 1,
        buttons: Array.from(el.querySelectorAll("button")).map((button) => ({
          height: button.getBoundingClientRect().height,
          fits: button.scrollWidth <= button.clientWidth + 1,
        })),
        share: rect(".details-secondary-actions button:first-child").width,
        edit: rect(".details-secondary-actions button:last-child").width,
        nameBottom: rect("h2").bottom,
        categoryTop: rect(".details-header").top,
        categoryBottom: rect(".details-header").bottom,
        accuracyTop: rect("dl > div:last-child").top,
        savedBottom: rect("dl > div:first-child").bottom,
        coordinatesTop: rect(".details-coordinates").top,
        coordinateRight: rect(".coordinate-display").right,
        copyLeft: rect(".details-coordinates button").left,
        savedTop: rect("dt").top,
        dateTop: rect("dd").top,
        dateSize: parseFloat(getComputedStyle(el.querySelector("dd")!).fontSize),
        nameSize: parseFloat(getComputedStyle(el.querySelector("h2")!).fontSize),
        mapsWidth: rect(".details-map-actions button:first-child").width,
        chooserWidth: rect(".details-map-picker").width,
        mapColumns: getComputedStyle(
          el.querySelector(".details-map-actions")!,
        ).gridTemplateColumns.split(" ").length,
        padding: getComputedStyle(el).paddingLeft,
      };
    });
    expect(measurements.fits).toBe(true);
    for (const button of measurements.buttons) {
      expect(button.height).toBeGreaterThanOrEqual(48);
      expect(button.fits).toBe(true);
    }
    expect(measurements.share).toBeCloseTo(measurements.edit, 0);
    expect(measurements.coordinatesTop).toBeGreaterThanOrEqual(measurements.nameBottom);
    expect(measurements.categoryTop).toBeGreaterThan(measurements.nameBottom);
    expect(measurements.coordinatesTop - measurements.categoryBottom).toBe(12);
    expect(measurements.accuracyTop).toBeGreaterThan(measurements.savedBottom);
    expect(measurements.copyLeft - measurements.coordinateRight).toBeCloseTo(8, 0);
    expect(measurements.dateSize).toBeLessThan(measurements.nameSize);
    if (scale === 1) expect(Math.abs(measurements.savedTop - measurements.dateTop)).toBeLessThan(5);
    expect(measurements.mapColumns).toBe(2);
    expect(measurements.chooserWidth).toBe(56);
    await expect(details.getByRole("combobox", { name: "Open with…", exact: true })).toHaveCSS(
      "color",
      "rgba(0, 0, 0, 0)",
    );
    expect(measurements.mapsWidth).toBeGreaterThan(measurements.chooserWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: `.artifacts/position-card-${width}-${scale}.png`,
      fullPage: true,
    });
    if (width === 1280) {
      await page.locator(".detail-pane").evaluate((el) => {
        el.style.width = "330px";
      });
      expect(
        await details
          .locator(".details-map-actions")
          .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
      ).toBe(2);
      expect(await details.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    if (width === 430) {
      await details.getByRole("button", { name: "Edit place", exact: true }).click();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Svamp");
      await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
      await expect(details.getByRole("heading", { name: "Svamp", exact: true })).toBeVisible();
      await page.screenshot({ path: ".artifacts/position-card-compact.png", fullPage: true });
    }
  });
}
test("compact editor confirms discarding edits and preserves the saved place", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 90 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true });
  await expect(editor.getByRole("heading", { name: "Place saved", exact: true })).toBeVisible();
  await expect(editor.getByRole("status")).toHaveText("Accuracy: ±90 m");
  await expect(editor.getByText("Photos aren’t included in shared links.")).toHaveCount(0);
  const photoButtons = await editor
    .locator(".photo-picker .action-pair button")
    .evaluateAll((buttons) =>
      buttons.map((b) => ({
        top: b.getBoundingClientRect().top,
        height: b.getBoundingClientRect().height,
      })),
    );
  expect(photoButtons[0].top).toBe(photoButtons[1].top);
  expect(photoButtons.every((b) => b.height >= 48)).toBe(true);
  const crosshair = await editor
    .getByRole("button", { name: "Update location", exact: true })
    .boundingBox();
  expect(crosshair!.width).toBeGreaterThanOrEqual(48);
  expect(crosshair!.height).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: testInfo.outputPath("compact-editor-dark.png") });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  const original = await name.inputValue();
  await name.fill("Unsaved edit");
  await editor.getByRole("combobox", { name: "Category", exact: true }).selectOption("mushrooms");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const warning = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await warning.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(name).toHaveValue("Unsaved edit");
  await page.keyboard.press("Escape");
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole("dialog").getByRole("button", { name: "Edit place", exact: true }).click();
  await expect(name).toHaveValue(original);
  await expect(editor.getByRole("combobox", { name: "Category", exact: true })).toHaveValue(
    "other",
  );
  await editor.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
  await expect(warning).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Share place", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Share place", exact: true })
      .getByText("Photos aren’t included in shared links."),
  ).toBeVisible();
});

for (const theme of ["dark", "light"]) {
  test(`map dropdown has compact themed options and subtle focus in ${theme}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language: "en", theme, provider: "" }),
      );
    }, theme);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 90 });
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    const picker = page.locator(".details-content:visible .details-map-picker select");
    await picker.focus();
    await expect(picker).toHaveCSS("outline-style", "none");
    await expect(picker).toHaveCSS("appearance", "base-select");
    await picker.press("Space");
    const options = picker.getByRole("option");
    await expect(options).toHaveCount(3);
    for (const option of await options.all()) {
      await expect(option).toBeVisible();
      await expect(option).toHaveCSS("font-size", "16px");
      await expect(option).toHaveCSS("outline-style", "none");
      const bounds = await option.boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(48);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    await page.screenshot({ path: `.artifacts/map-dropdown-${theme}.png` });
    await picker.press("Escape");
    await expect(picker.getByRole("option", { name: "Google Maps", exact: true })).toBeHidden();
  });
}

for (const android of [true, false]) {
  test(`map chooser compact rows, wrapping and copy feedback on ${android ? "Android" : "iOS"}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
    await page.addInitScript((android) => {
      Object.defineProperty(navigator, "userAgent", { value: android ? "Android" : "iPhone" });
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
    }, android);
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    const name = "A long saved place name with a woodland trail and lakeside picnic spot ".repeat(
      2,
    );
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    await page
      .locator(".details-content")
      .getByRole("button", { name: "Open maps", exact: true })
      .click();
    await expect(page.locator('.details-map-picker option[value="geo"]')).toHaveCount(
      android ? 1 : 0,
    );
    const dialog = page.getByRole("dialog", { name: "Choose map app", exact: true });
    await expect(dialog.locator(".sheet-subtitle")).toHaveText(name.trim());
    await expect(dialog.getByRole("link")).toHaveCount(android ? 3 : 2);
    await expect(dialog.getByRole("link", { name: "Other map app", exact: true })).toHaveCount(
      android ? 1 : 0,
    );
    const geometry = await dialog.evaluate((el) => ({
      overflow: el.scrollWidth > el.clientWidth,
      rows: Array.from(el.querySelectorAll(".map-app-row")).map(
        (row) => row.getBoundingClientRect().height,
      ),
      subtitle: el.querySelector(".sheet-subtitle")!.getBoundingClientRect().height,
    }));
    expect(geometry.overflow).toBe(false);
    expect(geometry.rows.every((height) => height >= 48)).toBe(true);
    expect(geometry.subtitle).toBeGreaterThan(32);
    await dialog.locator(".sheet-head button").press("Tab");
    await expect(dialog.getByRole("link", { name: "Google Maps", exact: true })).toBeFocused();
    await expect(dialog.getByRole("link", { name: "Google Maps", exact: true })).toHaveCSS(
      "outline-style",
      "solid",
    );
    await dialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Copied");
    await page.screenshot({ path: `.artifacts/map-chooser-${android ? "android" : "ios"}.png` });
  });
}
