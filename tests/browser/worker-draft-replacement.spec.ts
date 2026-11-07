import { chooseSaveOption } from "./fixtures";
import { expect, test, webkit, devices } from "./fixtures";

test("a replacement worker reloads a WebKit editor and restores its unsaved draft", async () => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      baseURL: "http://127.0.0.1:5174",
    });
    await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
    const page = await context.newPage();
    await page.goto("/?lang=en");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await chooseSaveOption(page, "details");
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Unsaved upgrade sample");
    await page.getByRole("button", { name: "Add description" }).click();
    await page.locator("textarea").fill("Uncommitted field");
    await page.getByRole("button", { name: "Enter coordinates manually" }).click();
    const latitude = page.getByLabel("Latitude", { exact: true });
    const longitude = page.getByLabel("Longitude", { exact: true });
    await latitude.fill("10.5");
    await longitude.fill("-20.25");
    const before = await page.evaluate(() => performance.timeOrigin);
    // A different same-origin script URL forces a real replacement under the same scope.
    // Workbox sees it as external. The native waiting prompt can precede Workbox's timer.
    await page.evaluate(() =>
      navigator.serviceWorker.register("/sw.js?replacement-fixture").then(() => true),
    );
    await page.getByRole("button", { name: "Update now", exact: true }).click();
    await expect.poll(() => page.evaluate(() => performance.timeOrigin)).not.toBe(before);
    await expect(name).toHaveValue("Unsaved upgrade sample");
    await expect(page.locator("textarea")).toHaveValue("Uncommitted field");
    await expect(latitude).toHaveValue("10.5");
    await expect(longitude).toHaveValue("-20.25");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".card-main")).toContainText("Unsaved upgrade sample");
  } finally {
    await browser.close();
  }
});

test("updating the app restores an edited map-search place", async ({ page }) => {
  await page.route("**/api/v1/map-search", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: "1:0",
            name: "Slåboda",
            municipality: "Arboga",
            county: "Västmanland",
            latitude: 59.41,
            longitude: 15.83,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole("textbox", { name: "Search places" }).fill("Slåboda");
  await page.getByRole("button", { name: "Map search", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Map search", exact: true });
  await search
    .locator(".map-search-list")
    .getByRole("button", { name: /Arboga/ })
    .click();
  await search.getByRole("button", { name: "Add place", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Slåboda walk");
  await editor.getByRole("button", { name: "Add description" }).click();
  await editor.locator("textarea").fill("Unfinished walk notes");

  await page.evaluate(() =>
    navigator.serviceWorker.register("/sw.js?map-search-update-fixture").then(() => true),
  );
  await expect(editor.getByText("Your saved data and unfinished edits will remain.")).toBeVisible();
  const reloaded = page.waitForEvent("framenavigated", (frame) => frame === page.mainFrame());
  await editor.getByRole("button", { name: "Update now", exact: true }).click();
  await reloaded;
  await expect(name).toHaveValue("Slåboda walk");
  await expect(editor.locator("textarea")).toHaveValue("Unfinished walk notes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".place-card")).toContainText("Slåboda walk");
  await page.reload();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".place-card")).toContainText("Slåboda walk");
});
