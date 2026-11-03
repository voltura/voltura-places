import { test, expect, chromium, webkit } from "./fixtures";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} popup buttons and background scroll isolation`, async ({}, testInfo) => {
    const browser = await engine.launch();
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      serviceWorkers: "block",
    });
    try {
      await page.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      await page.goto("http://127.0.0.1:5174/");
      await page.evaluate(() => {
        document.body.style.minHeight = "2400px";
        window.scrollTo(0, 160);
      });
      const trigger = page.getByRole("button", { name: "Save options", exact: true });
      await trigger.tap();
      const menu = page.getByRole("group", { name: "Save options", exact: true });
      await expect(menu).toBeVisible();
      const rows = menu.getByRole("button");
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        expect(await row.evaluate((el) => getComputedStyle(el).fontSize)).toBe("18px");
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(60);
      }
      const top = await page.evaluate(() => scrollY);
      if (engine === chromium) {
        await page.mouse.move(100, 200);
        await page.mouse.wheel(0, 300);
      }
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(top);
      expect(
        await page.evaluate(() => {
          const start = new Event("touchstart", { bubbles: true });
          Object.defineProperty(start, "touches", { value: [{ clientX: 100, clientY: 300 }] });
          document.body.dispatchEvent(start);
          const move = new Event("touchmove", { bubbles: true, cancelable: true });
          Object.defineProperty(move, "touches", { value: [{ clientX: 100, clientY: 100 }] });
          document.body.dispatchEvent(move);

          return move.defaultPrevented;
        }),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("save-options.png") });
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await expect(menu).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      const settings = page.getByRole("dialog", { name: "Settings", exact: true });
      await expect(settings).toBeVisible();
      await settings.getByRole("button", { name: "Close", exact: true }).click();
      await trigger.tap();

      await page.keyboard.press("End");
      await expect(menu.getByRole("button", { name: "Track route", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
      await trigger.tap();
      await page.getByRole("button", { name: "Settings", exact: true }).click({ button: "right" });
      await trigger.focus();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu).toBeVisible();
      await menu.getByRole("button", { name: "Save with details", exact: true }).tap();
      const editor = page.getByRole("dialog", { name: "Add place", exact: true });
      await expect(editor).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
      await editor.getByRole("button", { name: "Close", exact: true }).click();
      await expect(editor).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
      const account = { id: "popup-fixture", methods: [] };
      const groups = Array.from({ length: 15 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        name: `Demo group ${index + 1} with a long name`,
        ownerId: account.id,
        members: [{ id: account.id, label: "Demo member" }],
        requests: [],
      }));
      await page.route("**/api/account", (route) =>
        route.fulfill({ json: { enabled: true, providers: {}, account } }),
      );
      await page.route("**/api/family", (route) => route.fulfill({ json: { families: groups } }));
      await page.route("**/api/v1/sync", (route) =>
        route.fulfill({ json: { version: 1, accountId: account.id, records: [] } }),
      );
      await page.reload();
      const selector = page.getByRole("button", { name: "Choose group", exact: true });
      await expect(selector).toBeVisible();
      expect(await selector.evaluate((el) => getComputedStyle(el).fontSize)).toBe("18px");
      await selector.tap();
      const groupMenu = page.getByRole("group", { name: "Choose group", exact: true });
      await expect(groupMenu).toBeVisible();
      expect(await groupMenu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(
        await groupMenu
          .getByRole("button")
          .first()
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("18px");
      const allowed = await groupMenu.evaluate((el) => {
        const start = new Event("touchstart", { bubbles: true });
        Object.defineProperty(start, "touches", { value: [{ clientX: 50, clientY: 300 }] });
        el.dispatchEvent(start);
        const move = new Event("touchmove", { bubbles: true, cancelable: true });
        Object.defineProperty(move, "touches", { value: [{ clientX: 50, clientY: 200 }] });
        el.dispatchEvent(move);

        return !move.defaultPrevented;
      });
      expect(allowed).toBe(true);
      const blocked = await groupMenu.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        const wheel = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
        el.dispatchEvent(wheel);

        return wheel.defaultPrevented;
      });
      expect(blocked).toBe(true);
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      await expect(groupMenu).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
      await selector.tap();

      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
      await selector.tap();
      await groupMenu.getByRole("button", { name: groups[0].name, exact: true }).tap();
      await expect(selector.locator(".library-selector-members")).toContainText("1 member");
      const textLayout = selector.locator(".library-selector-text");
      const separator = selector.locator(".library-member-separator");
      await expect(textLayout).toHaveAttribute("data-members-inline", "false");
      await expect(separator).toBeHidden();
      await page.setViewportSize({ width: 1280, height: 844 });
      await expect(textLayout).toHaveAttribute("data-members-inline", "true");
      await expect(separator).toBeVisible();
      expect(
        await selector
          .locator(".library-selector-name")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("18px");
      expect(
        await selector
          .locator(".library-selector-members")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("14px");
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await expect(textLayout).toHaveAttribute("data-members-inline", "false");
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(textLayout).toHaveAttribute("data-members-inline", "false");
      await expect(page.locator(".library-members")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath("compact-member-count.png") });
      await selector.tap();
      await groupMenu.getByRole("button", { name: "Manage group", exact: true }).tap();
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Members · 1/10", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("dialog", { name: "Settings", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .tap();
      await selector.tap();
      await groupMenu.getByRole("button", { name: "Private places", exact: true }).tap();
      await expect(selector.locator(".library-selector-members")).toHaveCount(0);
      await selector.tap();
      await expect(
        groupMenu.getByRole("button", { name: "Manage group", exact: true }),
      ).toHaveCount(0);
    } finally {
      await browser.close();
    }
  });
}
