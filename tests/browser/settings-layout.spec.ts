import { test, expect } from "./fixtures";

for (const [width, height, scale] of [
  [320, 568, 1],
  [390, 844, 1],
  [375, 500, 2],
  [1280, 800, 1],
]) {
  test(`signed-out family layout ${width}px at ${scale}x text`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    if (scale !== 1)
      await page.evaluate(
        (scale) => (document.documentElement.style.fontSize = `${16 * scale}px`),
        scale,
      );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const selector = page.getByRole("combobox", { name: "Settings", exact: true });
    if (await selector.isVisible()) await selector.selectOption("familySharing");
    else await page.getByRole("button", { name: "Family sharing", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(
      dialog.getByText(
        "Share places with family or other groups. Each group has its own members and places. Your private places stay private.",
      ),
    ).toBeVisible();
    const geometry = await dialog.evaluate((el) => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      const head = box(".sheet-head");
      const compact =
        el.querySelector(".settings-navigation")!.getAttribute("data-compact") === "true";
      const icon = box(
        compact ? ".settings-section-label > svg:first-child" : ".family-heading .section-icon",
      );
      const title = box(compact ? ".settings-section-label > span" : ".family-heading h3");
      const close = box(".sheet-head button");
      const body = el.querySelector(".sheet-content")!;
      return {
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
        iconWidth: icon.width,
        compact,
        gap: title.left - icon.right,
        centres: Math.abs((icon.top + icon.bottom - title.top - title.bottom) / 2),
        closeWidth: close.width,
        closeHeight: close.height,
        headTop: head.top,
        overflow: body.scrollWidth > body.clientWidth,
        padding: getComputedStyle(body).paddingLeft,
      };
    });
    expect(geometry.top).toBe(20);
    expect(geometry.bottom).toBeLessThanOrEqual(height - 20);
    expect(geometry.gap).toBe(12);
    expect(geometry.iconWidth).toBe(geometry.compact ? 22 : 44);
    expect(geometry.centres).toBeLessThan(1);
    expect(geometry.closeWidth).toBeGreaterThanOrEqual(48);
    expect(geometry.closeHeight).toBeGreaterThanOrEqual(48);
    expect(geometry.overflow).toBe(false);
    expect(geometry.padding).toBe(width <= 640 ? "16px" : "24px");
    if (width < 640) await expect(selector).toBeVisible();
    const action = dialog.getByRole("button", { name: "Sign in to share", exact: true });
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await action.scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("family-signed-out.png") });
    await action.click();
    await expect(
      page.getByRole("dialog").getByText("Not signed in", { exact: true }),
    ).toBeVisible();
  });
}

test("backup actions adapt and the section selector uses the app theme", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const selector = page.getByRole("combobox", { name: "Settings", exact: true });
  if (await selector.isVisible()) await selector.selectOption("backup");
  else await page.getByRole("button", { name: "Backup & restore", exact: true }).click();
  const actions = page.locator(".backup-actions .button");
  const first = (await actions.nth(0).boundingBox())!;
  const second = (await actions.nth(1).boundingBox())!;
  expect(first.width).toBeCloseTo(second.width);
  expect(second.x - first.x - first.width).toBeCloseTo(12);
  expect(first.y).toBe(second.y);
  await expect(page.getByText("Backup files are not encrypted.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Keep data on this device", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(selector).toBeVisible();
  expect((await actions.nth(1).boundingBox())!.y).toBeGreaterThan(
    (await actions.nth(0).boundingBox())!.y,
  );
  await page.screenshot({ path: testInfo.outputPath("backup-phone.png") });
  await selector.click();
  const themed = await selector.evaluate((el) => ({
    supported: CSS.supports("appearance", "base-select"),
    appearance: getComputedStyle(el).appearance,
    selectedBackground: getComputedStyle(el.querySelector("option:checked")!).backgroundColor,
    accent: getComputedStyle(el).getPropertyValue("--accent-soft").trim(),
  }));
  expect(themed.supported).toBe(true);
  expect(themed.appearance).toBe("base-select");
  expect(themed.selectedBackground).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("themed-selector.png") });
  await page.keyboard.press("Escape");
});

test("categories keep action columns aligned and explain deletion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("categories");
  await expect(page.getByRole("heading", { name: "Categories", exact: true })).toHaveCount(1);
  const create = page.getByRole("button", { name: "New category", exact: true });
  const rows = page.locator(".category-list > div");
  expect((await create.boundingBox())!.y).toBeLessThan((await rows.first().boundingBox())!.y);
  const editColumns = await rows.evaluateAll((els) =>
    els.map((el) => el.querySelector("button")!.getBoundingClientRect().left),
  );
  expect(new Set(editColumns).size).toBe(1);
  expect(
    await rows.first().evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(64);
  await page.getByRole("button", { name: "Edit category Parking", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Category name", exact: true })
    .fill("Averylongunbrokencategorynamewithmultiplewordsandmore");
  await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
  expect(
    await page
      .locator(".settings-sheet .sheet-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("categories-phone.png") });
  await page
    .getByRole("button", {
      name: "Delete Averylongunbrokencategorynamewithmultiplewordsandmore",
      exact: true,
    })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Delete category?", exact: true });
  await expect(confirmation).toContainText("Its places move to Other.");
  await expect(
    confirmation.locator(".sheet-content").getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await confirmation
    .locator(".sheet-content")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
});

test("Preferences switch, disclosures and footer stay usable with enlarged text", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto("/");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", {
    name: "Review GPS accuracy before saving",
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText("Refine the position before confirming. Turn off to save immediately.", {
      exact: true,
    }),
  ).toBeVisible();
  for (const name of ["Install Places", "Privacy"]) {
    const row = page.locator("summary").filter({ hasText: name });
    await row.click();
    expect(await row.evaluate((el) => el.parentElement!.hasAttribute("open"))).toBe(true);
    await row.click();
    expect(await row.evaluate((el) => el.parentElement!.hasAttribute("open"))).toBe(false);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  const footer = page.locator(".preferences-footer");
  await footer.scrollIntoViewIfNeeded();
  for (const link of await footer.getByRole("link").all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await expect(footer.getByText("Freeware · MIT open source", { exact: true })).toHaveCount(0);
  expect(
    await page
      .locator(".settings-sheet .sheet-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("preferences-large-text.png") });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Review GPS accuracy before saving", exact: true }),
  ).toBeChecked();
});

test("grouped preference rows wrap and keep native selections in sync", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const rows = page.locator(".preference-row");
  await expect(rows).toHaveCount(5);
  await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("light");
  await expect(rows.nth(0).locator(".preference-value")).toHaveText("Light");
  await page
    .getByRole("combobox", { name: "Preferred map app", exact: true })
    .selectOption("apple");
  await expect(rows.nth(3).locator(".preference-value")).toHaveText("Apple Maps");
  await page
    .getByRole("combobox", { name: "Distance units", exact: true })
    .selectOption("imperial");
  await expect(rows.nth(4).locator(".preference-value")).toHaveText("Feet (ft)");
  await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption("dark");
  await page.screenshot({ path: testInfo.outputPath("preference-rows-phone.png") });
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("sv");
  await expect(rows.nth(2).locator(".preference-value")).toHaveText("Svenska");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.locator(".sheet-content").evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(
    await rows.evaluateAll((els) => els.every((el) => el.getBoundingClientRect().height >= 48)),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(rows.nth(2).locator(".preference-value")).toHaveText("Svenska");
  await expect(rows.nth(3).locator("select")).toHaveValue("apple");
  await expect(rows.nth(4).locator("select")).toHaveValue("imperial");
});

for (const theme of ["light", "dark"]) {
  test(`preference dropdown hover and focus follow the ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Color mode", exact: true }).selectOption(theme);
    const menu = page.getByRole("combobox", { name: "Language", exact: true });
    await menu.click();
    const hovered = menu.getByRole("option", { name: "Svenska", exact: true });
    await hovered.hover();
    const colors = await menu.evaluate((el) => ({
      selected: getComputedStyle(el.querySelector("option:checked")!).backgroundColor,
      hovered: getComputedStyle(el.querySelector("option:hover")!).backgroundColor,
      picker: getComputedStyle(el, "::picker(select)").backgroundColor,
      text: getComputedStyle(el.querySelector("option:hover")!).color,
    }));
    expect(colors.hovered).toBe(colors.selected);
    expect(colors.hovered).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.text).not.toBe(colors.hovered);
    await page.screenshot({ path: testInfo.outputPath(`preference-menu-${theme}.png`) });
    await page.keyboard.press("Escape");
    await menu.focus();
    const focus = await menu.evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      shadow: getComputedStyle(el.parentElement!).boxShadow,
    }));
    expect(focus.outline).toBe("none");
    expect(focus.shadow).toContain("1px");
  });
}

for (const [width, scale] of [
  [320, 1],
  [390, 1],
  [375, 2],
]) {
  test(`section selector is the heading with aligned icon options at ${width}px ${scale}x`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.evaluate(
      (scale) => (document.documentElement.style.fontSize = `${16 * scale}px`),
      scale,
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const selector = page.getByRole("combobox", { name: "Settings", exact: true });
    const sections = [
      ["preferences", "Preferences", "sliders-horizontal"],
      ["categories", "Categories", "tag"],
      ["backup", "Backup & restore", "archive"],
      ["account", "Account & sync", "user"],
      ["familySharing", "Family sharing", "users"],
    ];
    for (const [key, label, icon] of sections) {
      await selector.selectOption(key);
      await expect(page.getByRole("heading", { name: label, exact: true })).toHaveCount(1);
      await expect(page.locator(`.settings-section-label > svg.lucide-${icon}`)).toBeVisible();
      expect(
        (await page.locator(".settings-section-label").boundingBox())!.height,
      ).toBeGreaterThanOrEqual(56);
      await expect(page.locator(".settings-section-label > svg.lucide-chevron-down")).toBeVisible();
    }
    await expect(page.locator(".family-heading")).toBeHidden();
    await selector.click();
    const options = selector.locator("option");
    for (const [index, [, , icon]] of sections.entries()) {
      const option = options.nth(index);
      await expect(option.locator(`svg.lucide-${icon}`)).toBeVisible();
      const layout = await option.evaluate((el) => {
        const icon = el.querySelector("svg")!.getBoundingClientRect();
        const label = el.querySelector("span")!.getBoundingClientRect();
        return {
          icon: icon.width,
          gap: label.left - icon.right,
          labelWidth: label.width,
          checkColumn: getComputedStyle(el, "::checkmark").gridColumnStart,
        };
      });
      expect(layout.icon).toBe(22);
      expect(layout.gap).toBe(12);
      expect(layout.labelWidth).toBeGreaterThan(100);
      expect(layout.checkColumn).toBe("3");
    }
    await page.screenshot({ path: testInfo.outputPath("section-options.png") });
  });
}

test("tab navigation keeps a separate section heading", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.evaluate(() => (document.documentElement.style.fontSize = "12px"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Settings", exact: true })).toBeHidden();
  for (const name of [
    "Preferences",
    "Categories",
    "Backup & restore",
    "Account & sync",
    "Family sharing",
  ]) {
    await page
      .getByRole("navigation", { name: "Settings", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
});
