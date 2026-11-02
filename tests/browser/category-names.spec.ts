import { test, expect } from "./fixtures";

for (const [language, width] of [
  ["sv", 320],
  ["en", 1280],
] as const) {
  test(`category names translate with one-name fallback in ${language} at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?lang=${language}`);

    async function categories(lang: "en" | "sv") {
      await page
        .getByRole("button", { name: lang === "sv" ? "Inställningar" : "Settings", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: lang === "sv" ? "Inställningar" : "Settings", exact: true })
        .selectOption("categories");
    }

    await categories(language);
    await page
      .getByRole("button", {
        name: language === "sv" ? "Ny kategori" : "New category",
        exact: true,
      })
      .click();
    const name = page.getByRole("textbox", {
      name: language === "sv" ? "Namn" : "Name",
      exact: true,
    });
    const picker = page.getByRole("combobox", {
      name: language === "sv" ? "Språk för kategorinamn" : "Category name language",
      exact: true,
    });
    await expect(picker).toHaveValue(language);
    await expect(page.locator(".category-name-language img")).toHaveAttribute(
      "src",
      `/flags/${language === "sv" ? "se" : "gb"}.svg`,
    );
    await name.fill(language === "sv" ? "Vandringar" : "Hikes");
    await picker.selectOption(language === "sv" ? "en" : "sv");
    await expect(name).toHaveValue("");
    await name.fill(language === "sv" ? "Hikes" : "Vandringar");
    await page.screenshot({ path: testInfo.outputPath("category-language-picker.png") });
    await page
      .getByRole("button", { name: language === "sv" ? "Spara" : "Save", exact: true })
      .click();
    await expect(page.locator(".category-list")).toContainText(
      language === "sv" ? "Vandringar" : "Hikes",
    );
    await page.goto("/?lang=sv");
    await categories("sv");
    await expect(page.locator(".category-list")).toContainText("Vandringar");
    await expect(page.locator(".category-list")).toContainText("Svampar");
    await page.getByRole("button", { name: "Redigera kategori Vandringar", exact: true }).click();
    await page.getByRole("textbox", { name: "Namn", exact: true }).fill("");
    await page.getByRole("button", { name: "Spara", exact: true }).click();
    await expect(page.locator(".category-list")).toContainText("Hikes");
    await page.goto("/?lang=en");
    await categories("en");
    await expect(page.locator(".category-list")).toContainText("Hikes");
    await expect(page.locator(".category-list")).toContainText("Mushrooms");
    expect(await page.locator("html").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
  });
}
