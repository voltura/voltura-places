import { test, expect, chromium, webkit, devices, mockMapTiles } from "./fixtures";
import { messages } from "../../src/client/foundation/i18n";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} active filters stay readable and clear independently in list and map`, async ({}, testInfo) => {
    test.setTimeout(60000);
    const browser = await engine.launch();
    try {
      for (const language of ["en", "sv"] as const) {
        const context = await browser.newContext({
          ...devices[engine === webkit ? "iPhone 13" : "Pixel 7"],
          baseURL: String(testInfo.project.use.baseURL),
          viewport: { width: 375, height: 667 },
          locale: language,
          serviceWorkers: "block",
        });
        await mockMapTiles(context);
        await context.addInitScript(
          ({ language }) => {
            localStorage.setItem("places-account-choice", "done");
            localStorage.setItem(
              "places-preferences",
              JSON.stringify({ language, theme: language === "en" ? "dark" : "light" }),
            );
          },
          { language },
        );
        const page = await context.newPage();
        const t = messages(language);
        const fixture = {
          version: 1,
          name: "Picnic",
          category: "Other",
          latitude: 0,
          longitude: 0,
        };
        await page.goto(`/#place=${Buffer.from(JSON.stringify(fixture)).toString("base64url")}`);
        await page.getByRole("button", { name: t("saveCopy"), exact: true }).click();
        await expect(page.locator(".place-card")).toHaveCount(1);
        const contentFilter = page.getByRole("combobox", { name: t("visitFilter"), exact: true });
        const query = page.getByRole("textbox", { name: t("search"), exact: true });
        await query.fill("Picnic");
        await page
          .getByRole("navigation", { name: t("categories") })
          .getByRole("button", { name: t("other"), exact: true })
          .click();
        await contentFilter.selectOption("none");
        const active = page.getByRole("group", { name: t("activeFilters"), exact: true });
        const categoryChip = active.getByRole("button", {
          name: `${t("removeFilter")}: ${t("other")}`,
          exact: true,
        });
        const statusChip = active.getByRole("button", {
          name: `${t("removeFilter")}: ${t("visitNone")}`,
          exact: true,
        });
        await expect(categoryChip).toBeVisible();
        await expect(statusChip).toBeVisible();
        await statusChip.click();
        await expect(contentFilter).toHaveValue("all");
        await expect(categoryChip).toBeVisible();
        await expect(query).toHaveValue("Picnic");
        await contentFilter.selectOption("visited");
        await expect(page.locator(".place-card")).toHaveCount(0);
        await expect(
          active.getByRole("button", {
            name: `${t("removeFilter")}: ${t("visitVisited")}`,
            exact: true,
          }),
        ).toBeVisible();
        const reset = page.getByRole("button", { name: t("clearFilters"), exact: true });
        await expect(reset).toHaveCount(1);
        await page.evaluate(() => scrollTo(0, 0));
        const resetBounds = (await reset.boundingBox())!;
        const dockBounds = (await page.locator(".save-dock").boundingBox())!;
        expect(resetBounds.y + resetBounds.height).toBeLessThanOrEqual(dockBounds.y);
        await page.screenshot({ path: testInfo.outputPath(`filters-${language}.png`) });
        await reset.click();
        await expect(query).toHaveValue("");
        await expect(query).not.toBeFocused();
        await expect(contentFilter).toHaveValue("all");
        await expect(active).toHaveCount(0);
        await expect(page.locator(".place-card")).toHaveCount(1);
        await page.getByRole("button", { name: t("mapView"), exact: true }).click();
        await contentFilter.selectOption("none");
        await expect(active).toContainText(t("visitNone"));
        await expect(page.locator(".places-map-pin")).toHaveCount(1);
        await context.setOffline(true);
        await active.getByRole("button", { name: t("clearFilters"), exact: true }).click();
        await expect(contentFilter).toHaveValue("all");
        await expect(page.locator(".places-map-pin")).toHaveCount(1);
        await page.getByRole("button", { name: t("listView"), exact: true }).click();
        await contentFilter.selectOption("none");
        for (const [width, height, scale] of [
          [320, 568, 1],
          [375, 667, 2],
          [844, 390, 1],
          [1280, 800, 1],
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(
            (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
            scale,
          );
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          for (const button of await active.getByRole("button").all()) {
            expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
