import { test, expect } from "@playwright/test";

for (const [width, scale] of [
  [320, 1],
  [390, 1],
  [375, 2],
  [1280, 1],
]) {
  test(`library stays compact and scrollable at ${width}px ${scale}x text`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 6 });
    await page.goto("/");
    await page.evaluate(
      (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
      scale,
    );
    await expect(page.getByRole("heading", { name: "Your places", exact: true })).toHaveCount(0);
    await expect(page.locator(".count, .search-row, .category-chips")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Save options", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No places saved yet", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".save-destination")).toHaveCount(0);
    const emptyGeometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const library = rect(".library-pane");
      const primary = rect(".save-split");
      const picker = rect(".save-picker");
      const inner = rect(".dock-inner");
      return {
        centred: Math.abs(primary.x + primary.width / 2 - library.x - library.width / 2),
        aligned: Math.abs(inner.x - library.x),
        primaryWidth: primary.width,
        libraryWidth: library.width,
        pickerWidth: picker.width,
        pickerHeight: picker.height,
      };
    });
    expect(emptyGeometry.pickerWidth).toBeGreaterThanOrEqual(48);
    expect(emptyGeometry.pickerHeight).toBeGreaterThanOrEqual(48);
    await expect(page.locator(".save-details, .save-secondary-row")).toHaveCount(0);
    expect(emptyGeometry.centred).toBeLessThanOrEqual(1);
    expect(emptyGeometry.aligned).toBeLessThanOrEqual(1);
    if (width < 640) expect(emptyGeometry.primaryWidth).toBe(emptyGeometry.libraryWidth);
    await expect(page.locator(".account-indicator > svg")).toBeVisible();
    await expect(page.locator(".account-indicator .status-dot")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("library-empty.png") });
    const picker = page.getByRole("combobox", { name: "Save options", exact: true });
    await picker.focus();
    await picker.press("Space");
    const detailsOption = picker.getByRole("option", { name: "Save with details", exact: true });
    await expect(detailsOption).toBeVisible();
    const optionBounds = (await detailsOption.boundingBox())!;
    const dockBounds = (await page.locator(".save-dock").boundingBox())!;
    expect(optionBounds.height).toBeGreaterThanOrEqual(48);
    expect(optionBounds.y).toBeGreaterThanOrEqual(0);
    expect(optionBounds.y + optionBounds.height).toBeLessThanOrEqual(dockBounds.y);
    expect(optionBounds.x).toBeGreaterThanOrEqual(0);
    expect(optionBounds.x + optionBounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath("save-options.png") });
    await picker.press("Escape");
    await expect(detailsOption).toBeHidden();
    await expect(picker).toBeFocused();
    await picker.selectOption("details");
    const editor = page.getByRole("dialog", { name: "Add place", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("");
    await page.screenshot({ path: testInfo.outputPath("add-place.png") });
    await editor.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.locator(".place-card")).toHaveCount(0);

    for (const [index, category] of [
      "parking",
      "food",
      "outdoors",
      "accommodation",
      "mushrooms",
      "other",
    ].entries()) {
      await page.getByRole("button", { name: "Save position", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Name", exact: true })
        .fill(
          index === 0
            ? "Averylongunbrokenplacenamewhichmustwrapwithoutpushingcontrolsoutsideitscard"
            : `Example place ${index}`,
        );
      const option = page.getByRole("combobox", { name: "Category", exact: true });
      if (await option.locator(`option[value="${category}"]`).count())
        await option.selectOption(category);
      await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true }),
      ).toBeHidden();
      if (width < 640)
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      else await expect(page.getByRole("dialog")).toBeHidden();
    }
    await expect(page.getByRole("heading", { name: "Your places 6", exact: true })).toBeVisible();
    await expect(page.locator(".search-row")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return {
        search: rect(".search-field").top,
        sort: rect(".sort-button").top,
        maps: rect(".card-maps").left,
        content: rect(".card-main").left,
        overflow: document.documentElement.scrollWidth > innerWidth,
        filtersOverflow:
          document.querySelector(".category-chips")!.scrollWidth >
          document.querySelector(".category-chips")!.clientWidth,
        chipWrap: [...document.querySelectorAll(".category-chips button")].some(
          (el) => getComputedStyle(el).whiteSpace !== "nowrap",
        ),
      };
    });
    expect(geometry.search).toBe(geometry.sort);
    expect(geometry.maps).toBe(geometry.content);
    expect(geometry.overflow).toBe(false);
    expect(geometry.chipWrap).toBe(false);
    if (width < 640) expect(geometry.filtersOverflow).toBe(true);
    await page
      .getByRole("textbox", { name: "Search your places", exact: true })
      .fill("nothing matches");
    await expect(
      page.getByRole("heading", { name: "No matching places", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".search-row, .category-chips")).toHaveCount(2);
    await page.getByRole("textbox", { name: "Search your places", exact: true }).fill("");
    const last = page.locator(".place-card").last();
    await last.scrollIntoViewIfNeeded();
    const card = (await last.boundingBox())!;
    const dock = (await page.locator(".save-dock").boundingBox())!;
    expect(card.y + card.height).toBeLessThanOrEqual(dock.y + 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("library-populated.png") });
  });
}

test("library selector keeps long group destinations explicit and private places separate", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60000);
  const origin = "http://127.0.0.1:5174";
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 0, longitude: 0, accuracy: 6 },
  });
  await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  const response = await context.request.post("/api/account/connect", {
    headers: {
      Origin: origin,
      "oai-authenticated-user-id": `layout-${crypto.randomUUID()}`,
      "oai-authenticated-user-email": "layout@example.invalid",
    },
    data: { provider: "chatgpt" },
  });
  expect(response.ok()).toBe(true);
  const account = (await response.json()).account.id;
  const headers = { Origin: origin, "X-Places-Account": account };
  const ids: string[] = [];
  try {
    for (const name of [
      "Averylonggroupnamewhichwrapswithouttruncatingthelabelorbreakingthelayout",
      "Weekend walks",
      "Shared parking",
    ]) {
      const created = await context.request.post("/api/family", {
        headers,
        data: { action: "create", name },
      });
      expect(created.ok()).toBe(true);
      ids.push((await created.json()).familyId);
    }
    const page = await context.newPage();
    await page.goto("/");
    const selector = page.getByRole("button", { name: "Choose group", exact: true });
    const menu = page.getByRole("group", { name: "Choose group", exact: true });
    const longName = "Averylonggroupnamewhichwrapswithouttruncatingthelabelorbreakingthelayout";
    await selector.click();
    await expect(menu.locator(".library-option")).toHaveCount(4);
    await expect(page.locator(".account-indicator .status-dot")).toBeVisible();
    await menu.getByRole("button", { name: longName, exact: true }).click();
    await expect(page.locator(".save-destination")).toHaveText(longName);
    await expect(page.locator(".save-destination > svg")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No places saved yet", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Save your current location to get started.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".shared-library-notice p")).toHaveText("Shared with this group");
    const members = page.getByRole("button", { name: "Members \u00b7 1", exact: true });
    for (const [width, scale] of [
      [390, 1],
      [320, 1],
      [375, 2],
      [1280, 1],
    ]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(
        (scale) => (document.documentElement.style.fontSize = `${scale * 100}%`),
        scale,
      );
      const button = (await members.boundingBox())!;
      const metrics = await page.locator(".library-selector-label span").evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(el).lineHeight),
        clamp: getComputedStyle(el).webkitLineClamp,
      }));
      expect(metrics.clamp).toBe("2");
      const icons = await page
        .locator(".library-selector-label > svg")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      expect(icons).toEqual([22, 20]);
      expect(await selector.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(
        17 * scale,
      );
      expect(metrics.height).toBeLessThanOrEqual(metrics.line * 2 + 1);
      await expect(page.locator(".save-destination-name")).toHaveText(longName);
      expect(
        await page
          .locator(".save-destination-name")
          .evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
      const beforeDock = (await page.locator(".save-dock").boundingBox())!;
      const beforeSave = (await page.locator(".save-here").boundingBox())!;
      await page.screenshot({
        path: testInfo.outputPath(`save-destination-${width}-${scale}.png`),
      });
      const scrollBefore = await page.evaluate(() => scrollY);
      await page.locator("button.save-destination").click();
      const dropup = (await menu.boundingBox())!;
      const dockTrigger = (await page.locator("button.save-destination").boundingBox())!;
      expect(dropup.y + dropup.height).toBeCloseTo(dockTrigger.y - 6, 0);
      expect(dropup.x).toBeCloseTo(dockTrigger.x, 0);
      expect(dropup.width).toBeCloseTo(dockTrigger.width, 0);
      expect(dropup.y).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
      await expect(menu.getByRole("button", { name: longName, exact: true })).toBeVisible();
      const option = menu.getByRole("button", { name: longName, exact: true }).locator("span");
      expect(
        await option.evaluate(
          (el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`group-menu-${width}-${scale}.png`) });
      await menu.getByRole("button", { name: "Weekend walks", exact: true }).click();
      expect((await page.locator(".save-dock").boundingBox())!.height).toBe(beforeDock.height);
      expect((await page.locator(".save-here").boundingBox())!.height).toBe(beforeSave.height);
      await selector.click();
      await menu.getByRole("button", { name: longName, exact: true }).click();
      const destination = (await page.locator(".save-destination").boundingBox())!;
      const save = (await page
        .getByRole("button", { name: "Save position", exact: true })
        .boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(48);
      expect(destination.y + destination.height).toBeLessThanOrEqual(save.y);
      expect(save.height).toBeGreaterThanOrEqual(56);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`shared-empty-${width}-${scale}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    await page
      .getByRole("dialog", { name: "Place details", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await selector.click();
    await menu.getByRole("button", { name: "Private places", exact: true }).click();
    await expect(page.locator(".save-destination")).toHaveText("Private places");
    await expect(page.locator(".save-destination > svg.lucide-lock-keyhole")).toBeVisible();
    await expect(page.locator(".place-card")).toHaveCount(0);
    await page.locator("button.save-destination").click();
    await expect(menu).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("library-groups.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.locator("button.save-destination")).toBeFocused();
    await selector.click();
    await expect(menu).toBeVisible();
    const triggerBox = (await selector.boundingBox())!;
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.y).toBeCloseTo(triggerBox.y + triggerBox.height + 6, 0);
    expect(menuBox.x).toBe(triggerBox.x);
    expect(menuBox.width).toBe(triggerBox.width);
    await page.keyboard.press("End");
    await expect(menu.getByRole("button", { name: "Shared parking", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("button", { name: "Private places", exact: true })).toBeFocused();
    await selector.click();
    await expect(menu).toBeHidden();
    await selector.click();
    await expect(menu).toBeVisible();
    await page.locator(".header-inner").click({ position: { x: 4, y: 4 } });
    await expect(menu).toBeHidden();
  } finally {
    for (const familyId of ids)
      await context.request.post("/api/family", { headers, data: { action: "delete", familyId } });
    await context.request.delete("/api/account", {
      headers,
      data: { confirm: "delete-places-account" },
    });
    await context.close();
  }
});
