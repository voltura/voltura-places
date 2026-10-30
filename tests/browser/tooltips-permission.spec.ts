import { test, expect } from "@playwright/test";

for (const theme of ["dark", "light"]) {
  test(`coordinate tooltips use the ${theme} theme above a modal and dismiss with Escape`, async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 6 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (theme) =>
        localStorage.setItem(
          "places-preferences",
          JSON.stringify({ theme, language: "en", provider: "", reviewGps: false }),
        ),
      theme,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Place details", exact: true });
    const copy = modal.getByRole("button", { name: "Copy coordinates", exact: true });
    await expect(copy).not.toHaveAttribute("title");
    await copy.hover();
    const tooltip = page.getByRole("tooltip", { name: "Copy coordinates", exact: true });
    await expect(tooltip).toBeVisible();
    const info = await tooltip.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      text: getComputedStyle(el).color,
      raised: getComputedStyle(document.querySelector(".app-tooltip")!).backgroundColor,
      topLayer: el.matches(":popover-open"),
      box: {
        x: el.getBoundingClientRect().x,
        right: el.getBoundingClientRect().right,
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
      },
      width: innerWidth,
      height: innerHeight,
    }));
    expect(info.topLayer).toBe(true);
    expect(info.background).not.toBe(info.text);
    expect(info.box.x).toBeGreaterThanOrEqual(0);
    expect(info.box.right).toBeLessThanOrEqual(info.width);
    expect(info.box.bottom).toBeLessThanOrEqual(info.height);
    await page.screenshot({ path: testInfo.outputPath("copy-tooltip.png") });
    await tooltip.hover();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(modal).toBeVisible();
    await copy.focus();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(tooltip).toBeHidden();
  });
}

test("review does not restart GPS when focus returns to a still-pending permission prompt", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const permission = Object.assign(new EventTarget(), { state: "prompt" });
    let requests = 0;
    let success!: PositionCallback;
    Object.defineProperty(navigator, "permissions", { value: { query: async () => permission } });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (callback: PositionCallback) => {
          requests++;
          success = callback;
          return requests;
        },
        clearWatch: () => {},
      },
    });
    Object.assign(window, {
      gpsRequests: () => requests,
      allowGps: () => {
        permission.state = "granted";
        permission.dispatchEvent(new Event("change"));
        success({
          timestamp: Date.now(),
          coords: { latitude: 0, longitude: 0, accuracy: 6 },
        } as GeolocationPosition);
      },
    });
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", theme: "dark", provider: "", reviewGps: true }),
    );
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  await expect(review).toBeVisible();
  await page.clock.fastForward(1000);
  for (let i = 0; i < 3; i++)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
  await page.clock.fastForward(16000);
  expect(
    await page.evaluate(() => (window as unknown as { gpsRequests: () => number }).gpsRequests()),
  ).toBe(1);
  await page.evaluate(() => (window as unknown as { allowGps: () => void }).allowGps());
  await expect(
    review.getByRole("button", { name: "Use this position", exact: true }),
  ).toBeEnabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".place-card")).toHaveCount(0);
});
