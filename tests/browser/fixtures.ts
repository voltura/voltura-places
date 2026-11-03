import { test as base, type Page, type BrowserContext } from "@playwright/test";

import { messages } from "../../src/client/foundation/i18n";

export * from "@playwright/test";

export async function mockMapTiles(context: BrowserContext) {
  await context.route(
    /^https:\/\/(tile\.openstreetmap\.org|new-maptiles\.naturkartan-cdn\.se)\//,
    (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
  );
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await mockMapTiles(context);
    await use(context);
  },
});

export async function chooseSaveOption(page: Page, value: "details" | "route") {
  const t = messages((await page.locator("html").getAttribute("lang")) === "sv" ? "sv" : "en");
  await page.getByRole("button", { name: t("saveOptions"), exact: true }).click();
  await page
    .getByRole("group", { name: t("saveOptions"), exact: true })
    .getByRole("button", {
      name: t(value === "details" ? "addWithDetails" : "trackRoute"),
      exact: true,
    })
    .click();
}
