import { test, expect } from "./fixtures";
for (const theme of ["dark", "light"])
  test(`category appearance persists in ${theme} on a narrow phone`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addInitScript((theme) => {
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ theme, language: "en", provider: "" }),
      );
    }, theme);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
    await expect(page.locator(".category-list .category-icon")).toHaveCount(6);
    await page.getByRole("button", { name: "New category", exact: true }).click();
    await page.getByRole("textbox", { name: "Category name", exact: true }).fill("Camping");
    await page.getByRole("button", { name: "Rose", exact: true }).click();
    await page.getByRole("button", { name: "Tent", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tent", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      await page
        .locator(".category-appearance-picker")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("category-picker.png") });
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New category", exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
    await expect(
      page
        .locator(".category-list > div")
        .filter({ hasText: "Camping" })
        .locator(".category-icon.rose .lucide-tent"),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Edit category Camping", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tent", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "Rose", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
