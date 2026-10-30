import { test, expect } from "@playwright/test";
test("two signed-in family members share photos and offline saves while private places stay private", async ({
  browser,
}, testInfo) => {
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
    await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
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
  await b.page.clock.install();
  let mainGroupId: string | undefined;
  const familyAction = (actor: typeof a, data: unknown) => {
    const headers = { Origin: origin, "X-Places-Account": actor.account };
    if (data === undefined) return actor.context.request.get("/api/family", { headers });
    const body = data as { action: string; familyId?: string };
    return actor.context.request.post("/api/family", {
      headers,
      data: ["create", "code-request"].includes(body.action)
        ? body
        : { ...body, familyId: body.familyId ?? mainGroupId },
    });
  };
  try {
    await a.page.goto("/");
    await a.page.getByRole("button", { name: "Use the account library", exact: true }).click();
    await a.page.getByRole("button", { name: "Save position", exact: true }).click();
    await a.page.getByRole("textbox", { name: "Name", exact: true }).fill("Private chanterelles");
    await a.page
      .locator('input[type="file"][accept="image/*"]:not([capture])')
      .setInputFiles("tests/fixtures/photo.jpg");
    await expect(a.page.locator(".photo-picker img")).toBeVisible();
    await a.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await a.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page
      .getByRole("combobox", { name: "Settings", exact: true })
      .selectOption("familySharing");
    await a.page.getByRole("textbox", { name: "Group name", exact: true }).fill("Forest family");
    await a.page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Open shared library", exact: true }),
    ).toBeVisible();
    mainGroupId = (await (await familyAction(a, undefined)).json()).families[0].id;
    await a.page.getByRole("button", { name: "Create invitation code", exact: true }).click();
    const code = await a.page
      .getByRole("textbox", { name: "Invitation code", exact: true })
      .inputValue();
    expect(code).toMatch(/^\d{4}$/);
    await a.page.screenshot({ path: testInfo.outputPath("family-code.png") });
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
    await b.page.goto("/");
    await b.page.getByRole("button", { name: "Use the account library", exact: true }).click();
    await b.page.getByRole("button", { name: "Settings", exact: true }).click();
    await b.page
      .getByRole("combobox", { name: "Settings", exact: true })
      .selectOption("familySharing");
    await b.page.getByRole("textbox", { name: "Invitation code", exact: true }).fill(code);
    await b.page.getByRole("button", { name: "Request to join", exact: true }).click();
    await expect(b.page.getByRole("status")).toContainText("Request sent");
    await b.page.screenshot({ path: testInfo.outputPath("family-code-request.png") });
    await expect(
      b.page.getByRole("button", { name: "Edit place: Private chanterelles", exact: true }),
    ).toHaveCount(0);
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page
      .getByRole("combobox", { name: "Settings", exact: true })
      .selectOption("familySharing");
    await a.page
      .getByRole("button", { name: "Approve · family-1@example.invalid", exact: true })
      .click();
    await a.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await b.page.clock.fastForward(5000);
    await b.page.getByRole("button", { name: "Open shared library", exact: true }).click();
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
    await a.page.getByRole("button", { name: "Save position", exact: true }).click();
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
    const secondResponse = await familyAction(a, { action: "create", name: "Mother and family" });
    expect(secondResponse.ok()).toBe(true);
    const secondState = await secondResponse.json();
    const second = secondState.families.find((g: { id: string }) => g.id === secondState.familyId);
    const secondCode = await (
      await familyAction(a, { action: "code-create", familyId: second.id })
    ).json();
    expect((await familyAction(b, { action: "code-request", code: secondCode.code })).ok()).toBe(
      true,
    );
    expect(
      (
        await familyAction(a, { action: "code-approve", member: b.account, familyId: second.id })
      ).ok(),
    ).toBe(true);
    await b.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await b.page.getByRole("button", { name: "Mother and family", exact: true }).click();
    await expect(
      b.page.getByRole("heading", { name: "Mother and family 0", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "Edit place: Shared chanterelles", exact: true }),
    ).toHaveCount(0);
    await b.page.getByRole("button", { name: "Save position", exact: true }).click();
    await b.page.getByRole("textbox", { name: "Name", exact: true }).fill("Family picnic");
    await b.page.getByRole("button", { name: "Save changes", exact: true }).click();
    await b.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await expect(b.page.getByRole("button", { name: "Account & sync", exact: true })).toContainText(
      "Synced",
    );
    await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await a.page.getByRole("button", { name: "Mother and family", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Family picnic", exact: true }),
    ).toBeVisible();
    await a.page.getByRole("button", { name: "Forest family", exact: true }).click();
    await b.page.getByRole("button", { name: "Forest family", exact: true }).click();
    await b.page.getByRole("button", { name: "Participants · 2", exact: true }).click();
    await expect(
      b.page.getByRole("list", { name: "Participants · 2/10" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expect(b.page.getByRole("button", { name: /Remove member/ })).toHaveCount(0);
    await b.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Participants · 2", exact: true }).click();
    const participants = a.page.getByRole("list", { name: "Participants · 2/10" });
    await expect(participants.getByText("Owner", { exact: true })).toBeVisible();
    await expect(participants.getByText("You", { exact: true })).toBeVisible();
    for (const [width, scale] of [
      [320, 1],
      [390, 1],
      [375, 2],
    ]) {
      await a.page.setViewportSize({ width, height: 844 });
      await a.page.evaluate((value) => {
        document.documentElement.style.fontSize = `${value * 100}%`;
      }, scale);
      expect(
        await a.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const content = a.page.locator("dialog[open] .sheet-content");
      expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(
        await content.evaluate((el) => {
          el.scrollLeft = 100;
          return el.scrollLeft;
        }),
      ).toBe(0);
    }
    await a.page.setViewportSize({ width: 390, height: 844 });
    await a.page.evaluate(() => {
      document.documentElement.style.fontSize = "100%";
    });
    await participants.scrollIntoViewIfNeeded();
    await a.page.screenshot({ path: testInfo.outputPath("group-participants.png") });
    const remove = a.page.getByRole("button", {
      name: "Remove member",
      exact: true,
    });
    a.page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("family-1@example.invalid");
      await dialog.dismiss();
    });
    await remove.click();
    await expect(participants.getByRole("listitem")).toHaveCount(2);
    a.page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await expect(
      a.page.getByRole("list", { name: "Participants · 1/10" }).getByRole("listitem"),
    ).toHaveCount(1);
    await a.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Mother and family", exact: true }).click();
    await a.page.getByRole("button", { name: "Participants · 2", exact: true }).click();
    await expect(
      a.page.getByRole("heading", { name: "Mother and family", exact: true }),
    ).toBeVisible();
    await expect(
      a.page.getByRole("list", { name: "Participants · 2/10" }).getByRole("listitem"),
    ).toHaveCount(2);
    await a.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await b.page.clock.fastForward(30000);
    await expect(
      b.page.getByText(
        "This is a local copy. Shared access has ended; you can view and export it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(b.page.getByRole("button", { name: "Save position", exact: true })).toBeDisabled();
    await expect(b.page.getByRole("button", { name: "Add place", exact: true })).toBeDisabled();
    await expect(b.page.getByRole("button", { name: /Participants/ })).toHaveCount(0);
    expect((await familyAction(b, { action: "create", name: "A different family" })).ok()).toBe(
      true,
    );
    await b.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await b.page.getByRole("button", { name: "A different family", exact: true }).click();
    await expect(
      b.page.getByRole("heading", { name: "A different family 0", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "A different family", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "Edit place: Shared chanterelles", exact: true }),
    ).toHaveCount(0);
  } finally {
    for (const actor of actors) await actor.context.setOffline(false);
    for (const actor of actors) {
      const groups = (await (await familyAction(actor, undefined)).json()).families ?? [];
      for (const group of groups)
        if (group.ownerId === actor.account)
          await familyAction(actor, { action: "delete", familyId: group.id });
    }
    for (const actor of actors) {
      await actor.context.request.delete("/api/account", {
        headers: { Origin: origin, "X-Places-Account": actor.account },
        data: { confirm: "delete-places-account" },
      });
      await actor.context.close();
    }
  }
});
