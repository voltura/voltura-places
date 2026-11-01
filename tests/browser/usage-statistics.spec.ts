import { test, expect } from "./fixtures";

test("activity opt-out clears the browser ID and survives reload", async ({ page }) => {
  let reports = 0;
  await page.route("**/api/v1/activity", (route) => {
    reports++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect.poll(() => reports).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Privacy", { exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Share anonymous activity" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("places-activity-id")))
    .toBeNull();
  const before = reports;
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Privacy", { exact: true }).click();
  await expect(page.getByRole("switch", { name: "Share anonymous activity" })).not.toBeChecked();
  expect(reports).toBe(before);
});

for (const language of ["en", "sv"])
  for (const width of [390, 1280])
    test(`public usage cards ${language} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/api/v1/statistics", (route) =>
        route.fulfill({
          json: {
            version: 1,
            generatedAt: Date.now(),
            activityStartedAt: Date.now(),
            activeNow: 7,
            activeToday: 25,
            active30Days: 123,
            registeredAccounts: 42,
            cloudPlaces: 321,
            averagePersonalPlaces: 2.5,
          },
        }),
      );
      await page.goto(`http://127.0.0.1:5175/places/${language === "sv" ? "sv/" : ""}stats.html`);
      await expect(page.locator('[data-metric="activeNow"]')).toHaveText("7");
      await expect(page.locator('[data-metric="cloudPlaces"]')).toHaveText("321");
      await expect(page.locator('[data-metric="averagePersonalPlaces"]')).toHaveText(
        language === "sv" ? "2,5" : "2.5",
      );
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        language === "sv" ? "Användningsstatistik" : "Usage statistics",
      );
      const card = await page.locator(".usage-summary .stat-card").first().boundingBox();
      expect(card!.height).toBeLessThan(80);
      expect(card!.y).toBeLessThan(220);
      await page
        .getByText(language === "sv" ? "Så räknar vi" : "How we count", { exact: true })
        .click();
      await expect(page.locator("[data-activity-start]")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.locator(".theme-toggle").click();
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(page.locator('[data-metric="activeNow"]')).toHaveText("7");
    });

test("public usage failure leaves code statistics available", async ({ page }) => {
  await page.route("**/api/v1/statistics", (route) =>
    route.fulfill({ status: 503, json: { error: "serviceUnavailable" } }),
  );
  await page.goto("http://127.0.0.1:5175/places/stats.html");
  await expect(page.locator("[data-usage-status]")).toHaveText("Usage unavailable.");
  await expect(page.locator('[data-metric="activeNow"]')).toHaveText("Unavailable");
  await expect(page.getByRole("heading", { name: "Code statistics", exact: true })).toBeVisible();
  await expect(page.getByText("Source lines", { exact: true })).toBeVisible();
});

test("pending usage shows compact skeletons and respects reduced motion", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/statistics", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://127.0.0.1:5175/places/stats.html");
  await expect(page.locator(".stat-skeleton")).toHaveCount(6);
  await expect(page.locator("[data-usage]")).toHaveAttribute("aria-busy", "true");
  expect(
    await page
      .locator(".stat-skeleton")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  release();
  await expect(page.locator('[data-metric="activeNow"]')).toHaveText("Unavailable");
  await expect(page.locator("[data-usage]")).toHaveAttribute("aria-busy", "false");
});
