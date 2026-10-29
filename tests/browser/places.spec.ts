import { test, expect } from "@playwright/test";
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
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Location access was denied");
  await expect(page.getByRole("heading", { name: "Your places 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save here", exact: true })).toBeEnabled();
});
test("an unfinished manual draft reopens after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add coordinates", exact: true }).first().click();
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
  await expect(page.getByRole("dialog", { name: "Add coordinates" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Unfinished draft",
  );
});
test("GPS quick save commits before naming and survives offline reload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 59.3293, longitude: 18.0686, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Saved on this device" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.getByRole("button", { name: "Add coordinates", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Offline clearing");
  await page.getByRole("textbox", { name: "Latitude", exact: true }).fill("59.33");
  await page.getByRole("textbox", { name: "Longitude", exact: true }).fill("18.07");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 2" })).toBeVisible();
});
test("invalid manual entry is rejected, saved entries search and edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add coordinates", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Trailhead");
  await page.getByRole("textbox", { name: "Latitude", exact: true }).fill("99");
  await page.getByRole("textbox", { name: "Longitude", exact: true }).fill("18");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("valid latitude");
  await page.getByRole("textbox", { name: "Latitude", exact: true }).fill("59");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("textbox", { name: "Search your places" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching places" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit place: Trailhead" })).toBeVisible();
});
