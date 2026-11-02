import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block" });

for (const width of [390, 1440]) {
  test(`photo fullscreen preserves editor and details at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Save options", exact: true }).selectOption("details");
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Fullscreen photo fixture");
    await page.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
    await page.getByRole("textbox", { name: "Latitude", exact: true }).fill("59.5");
    await page.getByRole("textbox", { name: "Longitude", exact: true }).fill("18.25");
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 600;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "teal";
      context.fillRect(0, 0, 800, 600);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
    const editor = page.getByRole("dialog", { name: "Add place", exact: true });
    const open = page.getByRole("button", { name: "View photo fullscreen", exact: true });
    await open.click();
    const viewer = page.locator("dialog.photo-fullscreen");
    const close = viewer.getByRole("button", { name: "Exit fullscreen photo", exact: true });
    await expect(close).toBeFocused();
    expect(await viewer.evaluate((el) => el.matches(":modal"))).toBe(true);
    const bounds = await viewer.boundingBox();
    expect(bounds).toEqual({ x: 0, y: 0, width, height: 900 });
    const control = await close.boundingBox();
    expect(control!.width).toBeGreaterThanOrEqual(48);
    expect(control!.height).toBeGreaterThanOrEqual(48);
    await page.screenshot({ path: testInfo.outputPath("photo-fullscreen.png") });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(editor).toBeVisible();
    await expect(name).toHaveValue("Fullscreen photo fixture");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.locator("article .card-main").click();
    const details = page.locator(".details-content:visible");
    const detailsToggle = details.getByRole("button", {
      name: "View photo fullscreen",
      exact: true,
    });
    await expect(detailsToggle).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("photo-details.png") });
    await context.setOffline(true);
    await detailsToggle.click();
    await expect(viewer.locator("img")).toBeVisible();
    expect(
      await viewer.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBeGreaterThan(0);
    await close.click();
    await expect(viewer).toHaveCount(0);
    await expect(detailsToggle).toBeFocused();
    await expect(details.getByRole("heading", { name: "Fullscreen photo fixture" })).toBeVisible();
    await context.setOffline(false);
    if (width < 700) await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await page.getByRole("button", { name: "Fullscreen map", exact: true }).click();
    await page.locator('.map-surface .places-map-pin[title="Fullscreen photo fixture"]').click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "View photo fullscreen", exact: true })
      .click();
    await expect(viewer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "View photo fullscreen", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Exit fullscreen map", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Fullscreen map", exact: true })).toBeVisible();
  });
}
