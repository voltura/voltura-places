import { test, expect, chromium, webkit, devices } from "@playwright/test";

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} touch switches from a group to private and retains the destination`, async () => {
    const browser = await engine.launch();
    const origin = "http://127.0.0.1:5174";
    const context = await browser.newContext({
      ...devices[engine === webkit ? "iPhone 13" : "Pixel 7"],
      baseURL: origin,
      locale: "en-US",
    });
    await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
    const response = await context.request.post("/api/account/connect", {
      headers: {
        Origin: origin,
        "oai-authenticated-user-id": `touch-${crypto.randomUUID()}`,
        "oai-authenticated-user-email": "touch@example.invalid",
      },
      data: { provider: "chatgpt" },
    });
    expect(response.ok()).toBe(true);
    const account = (await response.json()).account.id as string;
    const headers = { Origin: origin, "X-Places-Account": account };
    let familyId: string | undefined;
    try {
      const created = await context.request.post("/api/family", {
        headers,
        data: { action: "create", name: "Touch group" },
      });
      expect(created.ok()).toBe(true);
      familyId = (await created.json()).familyId;
      const page = await context.newPage();
      await page.goto("/");
      const selector = page.getByRole("button", { name: "Choose group", exact: true });
      const menu = page.getByRole("group", { name: "Choose group", exact: true });
      for (const destination of [
        "Touch group",
        "Private places",
        "Touch group",
        "Private places",
      ]) {
        await selector.tap();
        await expect(menu).toBeVisible();
        await menu.getByRole("button", { name: destination, exact: true }).tap();
        await expect(menu).toBeHidden();
        await expect(selector).toHaveText(destination);
        await expect(page.locator(".save-destination")).toHaveText(destination);
      }
      await page.reload();
      await expect(selector).toHaveText("Private places");
      await expect(page.locator(".save-destination")).toHaveText("Private places");
    } finally {
      if (familyId)
        await context.request.post("/api/family", {
          headers,
          data: { action: "delete", familyId },
        });
      await context.request.delete("/api/account", {
        headers,
        data: { confirm: "delete-places-account" },
      });
      await browser.close();
    }
  });
}
