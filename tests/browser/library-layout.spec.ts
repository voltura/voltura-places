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
    await expect(page.getByRole("heading", { name: "Your places", exact: true })).toBeVisible();
    await expect(page.locator(".count, .search-row, .category-chips")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add place with details", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".account-indicator > svg")).toBeVisible();
    await expect(page.locator(".account-indicator .status-dot")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("library-empty.png") });
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
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      if (width < 640)
        await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      else await expect(page.getByRole("dialog")).toBeHidden();
    }
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
    const reconcile = page.getByRole("button", { name: "Use the account library", exact: true });
    await reconcile.click();
    const selector = page.getByRole("combobox", { name: "Library", exact: true });
    await expect(selector.locator("option")).toHaveCount(4);
    await expect(page.locator(".account-indicator .status-dot")).toBeVisible();
    await selector.selectOption({ index: 1 });
    await expect(page.locator(".save-destination")).toContainText("Shared places");
    await expect(page.getByRole("heading", { name: /Averylonggroupname/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await selector.selectOption(account);
    await expect(page.locator(".save-destination")).toHaveText("Private places");
    await expect(page.locator(".place-card")).toHaveCount(0);
    await selector.click();
    await page.screenshot({ path: testInfo.outputPath("library-groups.png") });
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
