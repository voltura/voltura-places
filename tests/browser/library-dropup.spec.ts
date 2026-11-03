import { mockMapTiles } from "./fixtures";
import { test, expect, chromium, webkit, devices } from "./fixtures";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} bottom group picker opens upward without scrolling`, async ({}, testInfo) => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      ...devices[engine === webkit ? "iPhone 13" : "Pixel 7"],
      baseURL: "http://127.0.0.1:5174",
      locale: "en-US",
    });
    await mockMapTiles(context);
    await context.addInitScript(() => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-workspace:dropup-preview",
        "family:dropup-preview:10000000-0000-4000-8000-000000000001",
      );
      localStorage.setItem(
        "places-account",
        JSON.stringify({
          enabled: true,
          providers: {},
          account: { id: "dropup-preview", methods: [] },
        }),
      );
      localStorage.setItem(
        "places-family:dropup-preview",
        JSON.stringify({
          families: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              name: "Weekend walks",
              ownerId: "dropup-preview",
              members: [],
            },
          ],
          inactive: [],
        }),
      );
    });
    // Cached libraries remain usable when the network is unavailable.
    await context.route("**/api/**", (route) => route.abort());
    const page = await context.newPage();
    try {
      await page.goto("/");
      const destination = page.locator("button.save-destination");
      const menu = page.getByRole("group", { name: "Choose group", exact: true });
      for (const [width, scale] of [
        [320, 1],
        [390, 1],
        [375, 2],
        [1280, 1],
      ]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(
          (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
          scale,
        );
        const before = await page.evaluate(() => scrollY);
        await destination.tap();
        await expect(menu).toBeVisible();
        const anchor = (await destination.boundingBox())!;
        const popup = (await menu.boundingBox())!;
        expect(popup.y + popup.height).toBeCloseTo(anchor.y - 6, 0);
        expect(popup.x).toBeCloseTo(anchor.x, 0);
        expect(popup.width).toBeCloseTo(anchor.width, 0);
        expect(popup.y).toBeGreaterThanOrEqual(16);
        expect(await page.evaluate(() => scrollY)).toBe(before);
        await page.screenshot({ path: testInfo.outputPath(`dropup-${width}-${scale}.png`) });
        await menu.getByRole("button", { name: "Weekend walks", exact: true }).tap();
        await expect(destination).toHaveText("Weekend walks");
        await expect(menu).toBeHidden();
        await destination.tap();
        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(destination).toBeFocused();
        await destination.tap();
        await destination.tap();
        await expect(menu).toBeHidden();
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
      await page.setViewportSize({ width: 390, height: 844 });
      for (const entry of [
        page.getByRole("button", { name: "Choose group", exact: true }),
        destination,
      ]) {
        await entry.tap();
        await page.keyboard.press("End");
        const join = menu.getByRole("button", { name: "Join group with code…", exact: true });
        await expect(join).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(menu).toBeHidden();
        const code = page.getByRole("textbox", { name: "Invitation code", exact: true });
        await expect(code).toBeFocused();
        await expect(code).toBeInViewport();
        await expect(
          page.getByRole("button", { name: "Request to join", exact: true }),
        ).toBeDisabled();
        await code.fill("1234");
        await expect(code).toHaveValue("1234");
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
        await expect(destination).toHaveText("Weekend walks");
      }
    } finally {
      await browser.close();
    }
  });
}

test("guest Groups retains the sign-in requirement", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("familySharing");
  await expect(page.locator(".family-panel").getByRole("button")).toContainText("Sign in");
  await expect(page.getByRole("textbox", { name: "Invitation code", exact: true })).toHaveCount(0);
});
