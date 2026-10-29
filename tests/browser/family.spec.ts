import { test, expect } from "@playwright/test";
test("two signed-in family members share photos and offline saves while private places stay private", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const origin = "http://127.0.0.1:5174";
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({
        baseURL: origin,
        locale: "en-US",
        viewport: { width: 390, height: 844 },
        permissions: ["geolocation"],
        geolocation: { latitude: 0, longitude: 0, accuracy: 6 },
      }),
    ),
  );
  const actors = [];
  for (const [index, context] of contexts.entries()) {
    const response = await context.request.post("/api/account/connect", {
      headers: {
        Origin: origin,
        "oai-authenticated-user-id": `family-test-${crypto.randomUUID()}`,
        "oai-authenticated-user-email": `family-${index}@example.invalid`,
      },
      data: { provider: "chatgpt" },
    });
    expect(response.ok()).toBe(true);
    actors.push({
      context,
      account: (await response.json()).account.id as string,
      page: await context.newPage(),
    });
    actors.at(-1)!.page.setDefaultTimeout(10000);
  }
  const [a, b] = actors;
  const familyAction = (actor: typeof a, data: unknown) =>
    actor.context.request.post("/api/family", {
      headers: { Origin: origin, "X-Places-Account": actor.account },
      data,
    });
  try {
    await a.page.goto("/");
    await a.page.getByRole("button", { name: "Use the account library", exact: true }).click();
    await a.page.getByRole("button", { name: "Save here", exact: true }).click();
    await a.page.getByRole("textbox", { name: "Name", exact: true }).fill("Private chanterelles");
    await a.page
      .locator('input[type="file"][accept="image/*"]:not([capture])')
      .setInputFiles("tests/fixtures/photo.jpg");
    await expect(a.page.locator(".photo-picker img")).toBeVisible();
    await a.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await a.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page
      .getByRole("navigation", { name: "Settings", exact: true })
      .getByRole("button", { name: "Family sharing", exact: true })
      .click();
    await a.page.getByRole("textbox", { name: "Family name", exact: true }).fill("Forest family");
    await a.page.getByRole("button", { name: "Create family library", exact: true }).click();
    await a.page.getByRole("button", { name: "Create invitation link", exact: true }).click();
    const link = await a.page
      .getByRole("textbox", { name: "Invitation link", exact: true })
      .inputValue();
    expect(link).toContain("#family=");
    await a.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await a.page
      .getByRole("button", { name: "Edit place: Private chanterelles", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Copy to family", exact: true }).click();
    await expect(a.page.getByRole("status")).toContainText("Copied to your family library");
    await a.page.getByRole("button", { name: "Forest family", exact: true }).click();
    await expect(
      a.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    await b.page.goto(link);
    await b.page.getByRole("button", { name: "Join family library", exact: true }).click();
    await expect(
      b.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    await b.page
      .getByRole("button", { name: "Edit place: Private chanterelles", exact: true })
      .click();
    await b.page
      .getByRole("dialog")
      .getByRole("button", { name: "Edit place", exact: true })
      .click();
    await expect(b.page.locator(".photo-picker img")).toBeVisible();
    await b.page.getByRole("textbox", { name: "Name", exact: true }).fill("Shared chanterelles");
    await b.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(b.page.getByRole("button", { name: "Account & sync", exact: true })).toContainText(
      "Synced",
    );
    await a.page.reload();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Shared chanterelles", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "My private places", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Private chanterelles", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "Forest family", exact: true }).click();
    await a.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await a.context.setOffline(true);
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "Save here", exact: true }).click();
    await a.page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Offline mushroom clearing");
    await a.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await a.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      a.page.getByRole("heading", { name: "Forest family 2", exact: true }),
    ).toBeVisible();
    await a.context.setOffline(false);
    await expect(a.page.getByRole("button", { name: "Account & sync", exact: true })).toContainText(
      "Synced",
    );
    await b.page.reload();
    await expect(
      b.page.getByRole("button", { name: "Edit place: Offline mushroom clearing", exact: true }),
    ).toBeVisible();
    expect((await familyAction(a, { action: "remove", member: b.account })).ok()).toBe(true);
    await b.page.reload();
    await expect(
      b.page.getByText(
        "This is a local copy. Shared access has ended; you can view and export it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Save here", exact: true })).toBeDisabled();
  } finally {
    for (const actor of actors) await actor.context.setOffline(false);
    await familyAction(a, { action: "delete" });
    for (const actor of actors) {
      await actor.context.request.delete("/api/account", {
        headers: { Origin: origin, "X-Places-Account": actor.account },
        data: { confirm: "delete-places-account" },
      });
      await actor.context.close();
    }
  }
});
