import { test, expect, chromium, webkit, devices } from "./fixtures";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} full group names identify the save destination on phones`, async ({}, testInfo) => {
    const browser = await engine.launch();
    const groupName =
      "Weekend walks and favourite places with family and friends around Stockholm city";
    const groupId = "10000000-0000-4000-8000-000000000001";
    const context = await browser.newContext({
      ...devices[engine === webkit ? "iPhone 13" : "Pixel 7"],
      baseURL: String(testInfo.project.use.baseURL),
      locale: "en-US",
      serviceWorkers: "block",
    });
    await context.addInitScript(
      ({ groupId, groupName }) => {
        localStorage.setItem("places-account-choice", "done");
        localStorage.setItem(
          "places-workspace:destination-preview",
          `family:destination-preview:${groupId}`,
        );
        localStorage.setItem(
          "places-account",
          JSON.stringify({
            enabled: true,
            providers: {},
            account: { id: "destination-preview", methods: [] },
          }),
        );
        localStorage.setItem(
          "places-family:destination-preview",
          JSON.stringify({
            families: [
              { id: groupId, name: groupName, ownerId: "destination-preview", members: [] },
            ],
            inactive: [
              {
                id: "10000000-0000-4000-8000-000000000002",
                name: "Archived walk",
                ownerId: "",
                members: [],
              },
            ],
          }),
        );
      },
      { groupId, groupName },
    );
    // Read cached private and group libraries without relying on cloud availability.
    await context.route("**/api/**", (route) => route.abort());
    const page = await context.newPage();
    try {
      for (const language of ["en", "sv"]) {
        await page.goto(`/?lang=${language}`);
        const prefix = language === "sv" ? "Spara i" : "Save to";
        const privateName = language === "sv" ? "Mina privata platser" : "Private places";
        const groupChoice = language === "sv" ? "Välj grupp" : "Choose group";
        const destination = page.locator("button.save-destination");
        const menu = page.getByRole("group", { name: groupChoice, exact: true });
        for (const [width, height, scale] of [
          [320, 568, 1],
          [390, 844, 1],
          [375, 844, 2],
          [844, 390, 1],
          [1280, 800, 1],
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(
            ({ scale, language }) => {
              document.documentElement.style.fontSize = `${100 * scale}%`;
              document.documentElement.dataset.theme = language === "sv" ? "light" : "dark";
            },
            { scale, language },
          );
          await expect(destination).toHaveAccessibleName(`${prefix} ${groupName}`);
          for (const selector of [".library-selector-name", ".save-destination-label"]) {
            const label = page.locator(selector);
            expect(
              await label.evaluate((el) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                const bounds = el.getBoundingClientRect();

                return [...range.getClientRects()].every(
                  (rect) =>
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1 &&
                    rect.top >= bounds.top - 1 &&
                    rect.bottom <= bounds.bottom + 1,
                );
              }),
            ).toBe(true);
          }
          const save = page.getByRole("button", {
            name: language === "sv" ? "Spara position" : "Save position",
            exact: true,
          });
          expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(56);
          await expect(save).toBeInViewport();
          expect((await destination.boundingBox())!.height).toBeGreaterThanOrEqual(48);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          if (scale === 2) {
            await page.screenshot({
              path: testInfo.outputPath(`destination-${language}-large-text.png`),
            });
          }
          await destination.tap();
          await menu.getByRole("button", { name: privateName, exact: true }).tap();
          await expect(destination).toHaveAccessibleName(`${prefix} ${privateName}`);
          await expect(page.locator(".library-selector-name")).toHaveText(privateName);
          await destination.tap();
          await menu.getByRole("button", { name: groupName, exact: true }).tap();
          await expect(destination).toBeFocused();
          await expect(page.locator(".library-selector-name")).toHaveText(groupName);
        }
        const copyLabel = language === "sv" ? "Lokal kopia" : "Local copy";
        await destination.tap();
        await menu.getByRole("button", { name: `Archived walk · ${copyLabel}`, exact: true }).tap();
        await expect(destination).toHaveAccessibleName(`${copyLabel} · Archived walk`);
        await expect(
          page.getByRole("button", {
            name: language === "sv" ? "Spara position" : "Save position",
            exact: true,
          }),
        ).toBeDisabled();
        await destination.tap();
        await menu.getByRole("button", { name: groupName, exact: true }).tap();
      }
    } finally {
      await browser.close();
    }
  });
}
