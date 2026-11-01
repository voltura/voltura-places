import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("manual coordinates validate, survive drafts and save without GPS", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  const save = editor.getByRole("button", { name: "Save", exact: true });
  const toggle = editor.getByRole("button", { name: "Enter coordinates manually", exact: true });
  const locate = editor.getByRole("button", { name: "Use current location", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(locate).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Latitude", exact: true })).toBeHidden();
  await expect(save.locator("svg")).toHaveCount(1);
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Manual fixture");
  await save.click();
  await expect(editor.getByRole("alert")).toContainText("enter longitude and latitude");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(locate).toBeHidden();
  await expect(editor.locator(".editor-coordinates input").first()).toHaveAccessibleName(
    "Latitude",
  );
  const longitude = editor.getByRole("textbox", { name: "Longitude", exact: true });
  const latitude = editor.getByRole("textbox", { name: "Latitude", exact: true });
  await expect(longitude).toHaveAttribute("inputmode", "decimal");
  await longitude.fill("181");
  await latitude.fill("-91");
  await toggle.click();
  await save.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(editor.getByRole("alert")).toContainText("valid coordinates");
  await longitude.fill("0x10");
  await latitude.fill("0");
  await save.click();
  await expect(editor.getByRole("alert")).toContainText("valid coordinates");
  await longitude.fill("-18,5");
  await latitude.fill("0");
  await toggle.click();
  await expect(latitude).toBeHidden();
  await expect(locate).toBeVisible();
  await expect(editor.getByRole("status")).toHaveText("Manual location");
  await toggle.press("Enter");
  await expect(locate).toBeHidden();
  await expect(latitude).toHaveValue("0");
  await expect(longitude).toHaveValue("-18,5");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open("voltura-places");
        request.onsuccess = () => {
          const db = request.result;
          const draft = db.transaction("drafts").objectStore("drafts").get("guest");
          draft.onsuccess = () => {
            resolve(draft.result?.longitude === "-18,5" && draft.result?.latitude === "0");
            db.close();
          };
        };
      }),
  );
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(editor.getByRole("status")).toHaveText("Manual location");
  await page.screenshot({ path: testInfo.outputPath("manual-coordinates-collapsed.png") });
  await toggle.click();
  await expect(longitude).toHaveValue("-18,5");
  await expect(latitude).toHaveValue("0");
  await page.screenshot({ path: testInfo.outputPath("manual-coordinates.png") });
  await save.click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("article")
    .getByRole("button", { name: /^Manual fixture Other/ })
    .click();
  await expect(page.locator(".details-content:visible")).toContainText("0.0, -18.5");
});

test("manual entry returns after GPS cancellation or denial and hides after a fix", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let requests = 0;
    let success: PositionCallback;
    let failure: PositionErrorCallback;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (onPosition: PositionCallback, onError: PositionErrorCallback) => {
          requests++;
          success = onPosition;
          failure = onError;
          return 1;
        },
        clearWatch: () => {},
      },
    });
    Object.assign(window, {
      manualRequests: () => requests,
      manualFix: () =>
        success({
          timestamp: Date.now(),
          coords: { latitude: 0, longitude: 0, accuracy: 8 },
        } as GeolocationPosition),
      manualDeny: () => failure({ code: 1 } as GeolocationPositionError),
    });
  });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
  const latitude = page.getByRole("textbox", { name: "Latitude", exact: true });
  const locate = page.getByRole("button", { name: "Use current location", exact: true });
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await latitude.fill("12");
  await page.getByRole("textbox", { name: "Longitude", exact: true }).fill("34");
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await expect(page.getByText("Manual location", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).manualRequests())).toBe(0);
  await locate.click();
  await expect(latitude).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel location update", exact: true }).click();
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await expect(latitude).toHaveValue("12");
  await expect(page.getByRole("textbox", { name: "Longitude", exact: true })).toHaveValue("34");
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await locate.click();
  await page.evaluate(() => (window as any).manualDeny());
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await expect(latitude).toHaveValue("12");
  await expect(page.getByText("Manual location", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await locate.click();
  await page.evaluate(() => (window as any).manualFix());
  await expect(latitude).toHaveCount(0);
  await expect(page.getByText("Manual location", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Update location", exact: true })).toBeVisible();
});
