import { test, expect } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

for (const [browserLanguage, saved, query, expected] of [
  ["sv-SE", null, "", "sv"],
  ["SV-fi", null, "", "sv"],
  ["sv", null, "", "sv"],
  ["en-GB", null, "", "en"],
  ["de-DE", null, "", "en"],
  [null, null, "", "en"],
  ["sv-SE", "en", "", "en"],
  ["en-US", "sv", "", "sv"],
  ["en-US", "en", "?lang=sv", "sv"],
  ["sv-SE", "sv", "?lang=en", "en"],
  ["sv-SE", null, "?lang=unknown", "sv"],
] as const) {
  test(`initial language: browser ${browserLanguage}, saved ${saved}, link ${query}`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ browserLanguage, saved }) => {
        Object.defineProperty(navigator, "language", { value: browserLanguage });
        if (saved && !localStorage.getItem("places-preferences")) {
          localStorage.setItem(
            "places-preferences",
            JSON.stringify({ language: saved, theme: "dark", provider: "" }),
          );
        }
      },
      { browserLanguage, saved },
    );
    await page.goto(`/${query}`);
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    const dialog = page.getByRole("dialog", {
      name: expected === "sv" ? "Kom igång" : "Get started",
      exact: true,
    });
    await expect(
      dialog.getByRole("combobox", { name: expected === "sv" ? "Språk" : "Language", exact: true }),
    ).toHaveValue(expected);
    await expect(dialog.locator(".language-flag")).toHaveAttribute(
      "src",
      `/flags/${expected === "sv" ? "se" : "gb"}.svg`,
    );
    await expect
      .poll(() =>
        dialog
          .locator(".language-flag")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  });
}

test("language changes preserve expanded help, update the app, and persist without completing onboarding", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog");
  await dialog.locator("summary").click();
  const language = dialog.getByRole("combobox");
  await dialog.focus();
  await page.keyboard.press("Tab");
  await expect(language).toBeFocused();
  await language.selectOption("sv");
  await expect(dialog).toHaveAccessibleName("Kom igång");
  await expect(language).toHaveAccessibleName("Språk");
  await expect(language).toBeFocused();
  await expect(dialog.locator("details")).toHaveAttribute("open", "");
  await expect(dialog.locator("summary")).toHaveText("Så installerar du");
  await expect(
    dialog.getByText("Lägg till Places på hemskärmen för att använda det som en app."),
  ).toBeVisible();
  await expect(dialog.getByText("I Chrome på Android:", { exact: false })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.getByRole("button", { name: "Spara position", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(dialog).toHaveAccessibleName("Kom igång");
  await expect(language).toHaveValue("sv");
  await dialog.locator("summary").click();
  await language.selectOption("en");
  await expect(dialog).toHaveAccessibleName("Get started");
  await expect(dialog.locator("details")).toHaveAttribute("open", "");
  await expect(dialog.getByText("In Chrome on Android:", { exact: false })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(language).toHaveValue("en");
  await expect(dialog).toBeVisible();
});

for (const width of [320, 390]) {
  for (const doubled of [false, true]) {
    test(`language header fits ${width}px, doubled text ${doubled}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      if (doubled) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
      }
      const dialog = page.getByRole("dialog");
      for (const language of ["en", "sv"]) {
        const select = dialog.getByRole("combobox");
        await select.selectOption(language);
        await expect(select).toBeInViewport();
        const close = dialog.getByRole("button", {
          name: language === "sv" ? "Stäng" : "Close",
          exact: true,
        });
        await expect(close).toBeInViewport();
        expect(
          await dialog.locator(".sheet-head").evaluate((header) => {
            const bounds = header.getBoundingClientRect();
            const title = header.querySelector("h2")!.getBoundingClientRect();
            const control = header.querySelector("select")!.getBoundingClientRect();
            const close = header.querySelector("button")!.getBoundingClientRect();

            return (
              header.scrollWidth <= header.clientWidth + 1 &&
              title.right <= close.left &&
              control.right <= close.left &&
              control.left >= bounds.left &&
              control.bottom <= bounds.bottom &&
              (title.right <= control.left || title.bottom <= control.top)
            );
          }),
        ).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`header-${language}.png`) });
      }
    });
  }
}

test("device preferences follow another tab without overwriting unrelated edits", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await other.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("matrix");
  await expect(other.locator("html")).toHaveAttribute("data-skin", "matrix");
  await other.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-skin", "matrix");
});

test("a language deep link survives reload when preferences cannot persist", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "places-preferences") {
        throw new DOMException("blocked", "SecurityError");
      }

      return set.call(this, key, value);
    };
  });
  await page.goto("/?lang=sv&from=promo#saved");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page).toHaveURL(/lang=sv/);
  await page.reload();
  const onboarding = page.getByRole("dialog", { name: "Kom igång" });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("combobox", { name: "Språk", exact: true }).selectOption("en");
  await expect(page).toHaveURL(/lang=en/);
  expect(new URL(page.url()).searchParams.get("from")).toBe("promo");
  expect(new URL(page.url()).hash).toBe("#saved");
});
