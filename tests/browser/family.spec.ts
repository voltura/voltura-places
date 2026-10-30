import { mockMapTiles } from "./fixtures";
import { test, expect } from "./fixtures";
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
    await mockMapTiles(context);
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
    await expect(a.page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
    await a.page.getByRole("button", { name: "Save position", exact: true }).click();
    await a.page.getByRole("textbox", { name: "Name", exact: true }).fill("Private chanterelles");
    await a.page
      .locator('input[type="file"][accept="image/*"]:not([capture])')
      .setInputFiles("tests/fixtures/photo.jpg");
    await expect(a.page.locator(".photo-picker img")).toBeVisible();
    await a.page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    await a.page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page
      .getByRole("combobox", { name: "Settings", exact: true })
      .selectOption("familySharing");
    await a.page.getByRole("textbox", { name: "Group name", exact: true }).fill("Forest family");
    await a.page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(
      a.page.getByRole("button", { name: "Open shared places", exact: true }),
    ).toBeVisible();
    await expect(
      a.page.getByText("Members can add, edit and delete shared places and photos.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      a.page.getByText("Share places with family or other groups.", { exact: false }),
    ).toHaveCount(0);
    await expect(
      a.page
        .getByRole("list", { name: "Members · 1/10", exact: true })
        .getByText("Owner · You", { exact: true }),
    ).toBeVisible();
    await expect(a.page.getByRole("textbox", { name: "Invitation code", exact: true })).toHaveCount(
      0,
    );
    mainGroupId = (await (await familyAction(a, undefined)).json()).families[0].id;
    // A failed creation offers retry without pretending an invitation exists.
    await a.page.route("**/api/family", async (route) => {
      if (route.request().postDataJSON()?.action === "code-create")
        await route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
      else await route.continue();
    });
    await a.page.getByRole("button", { name: "Invite member", exact: true }).click();
    const failedInvitation = a.page.getByRole("dialog", { name: "Invite member", exact: true });
    await expect(failedInvitation.getByRole("alert")).toHaveText("Couldn’t create a code.");
    await expect(
      failedInvitation.getByRole("button", { name: "Cancel invitation", exact: true }),
    ).toHaveCount(0);
    await expect(
      failedInvitation.getByRole("button", { name: "Create new code", exact: true }),
    ).toHaveCount(0);
    await a.page.unroute("**/api/family");
    await failedInvitation.getByRole("button", { name: "Try again", exact: true }).click();
    const codeBox = a.page.getByRole("button", { name: "Copy invitation code", exact: true });
    const code = (await codeBox.locator(".family-code-digits").textContent())!;
    expect(code).toMatch(/^\d{4}$/);
    await expect(
      failedInvitation.getByRole("button", { name: "Cancel invitation", exact: true }),
    ).toBeVisible();
    await expect(failedInvitation.getByRole("alert")).toHaveCount(0);
    const invitation = a.page.getByRole("dialog", { name: "Invite member", exact: true });
    await expect(invitation.locator(".family-code-field > span").first()).toHaveText(
      "Invitation code",
    );
    await expect(invitation.getByRole("button", { name: "Copy code", exact: true })).toHaveCount(0);
    await expect(invitation.locator(".family-invitation > p")).toHaveText(
      "They enter it in Family sharing. You approve.",
    );
    await a.page.evaluate(() => {
      const state = window as unknown as {
        copied: string[];
        shared: ShareData[];
        sharing: string;
        shareSupport: boolean;
      };
      state.copied = [];
      state.shared = [];
      state.sharing = "success";
      state.shareSupport = true;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            state.copied.push(text);
          },
        },
      });
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => state.shareSupport,
      });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          if (state.sharing === "cancel") throw new DOMException("Dismissed", "AbortError");
          state.shared.push(data);
        },
      });
    });
    await invitation.getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Invite member", exact: true }).click();
    await expect(codeBox.locator(".family-code-digits")).toHaveText(code);
    const beforeCopy = await invitation.boundingBox();
    const codeBeforeCopy = await codeBox.boundingBox();
    await codeBox.click();
    await expect(invitation.getByRole("status")).toHaveText("Copied");
    await expect(codeBox.locator(".family-code-feedback")).toHaveText("Copied");
    await expect(codeBox.locator(".family-code-digits")).toBeHidden();
    expect(await codeBox.boundingBox()).toEqual(codeBeforeCopy);
    expect(await invitation.boundingBox()).toEqual(beforeCopy);
    await expect(codeBox.locator(".lucide-check")).toBeVisible();
    expect(await a.page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(
      [code],
    );
    await expect(invitation.getByRole("status")).toBeEmpty({ timeout: 4000 });
    await expect(codeBox.locator(".family-code-digits")).toBeVisible();
    expect(await invitation.boundingBox()).toEqual(beforeCopy);
    const message = `Join my group in Voltura Places. Enter code ${code} in Family sharing, then I’ll approve your request.`;
    // Desktop support uses the same native path as phones.
    await a.page.setViewportSize({ width: 1280, height: 900 });
    await invitation.getByRole("button", { name: "Share code", exact: true }).click();
    expect(
      await a.page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared),
    ).toEqual([{ text: message }]);
    await a.page.evaluate(() => {
      (window as unknown as { sharing: string }).sharing = "cancel";
    });
    await invitation.getByRole("button", { name: "Share code", exact: true }).click();
    await expect(invitation.getByRole("alert")).toHaveCount(0);
    await expect(invitation).toBeVisible();
    expect(await a.page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(
      [code],
    );
    // Capability failure offers the complete message on PC too.
    await a.page.evaluate(() => {
      (window as unknown as { shareSupport: boolean }).shareSupport = false;
    });
    await invitation.getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Invite member", exact: true }).click();
    await invitation.getByRole("button", { name: "Copy invitation", exact: true }).click();
    expect(await a.page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual(
      [code, message],
    );
    await expect(invitation.getByRole("status")).toBeEmpty({ timeout: 4000 });
    await a.page.evaluate(() => {
      (window as unknown as { shareSupport: boolean; sharing: string }).shareSupport = true;
      (window as unknown as { sharing: string }).sharing = "success";
      Object.defineProperty(navigator, "userAgent", { configurable: true, value: "iPhone" });
    });
    await invitation.getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Invite member", exact: true }).click();
    await a.page.setViewportSize({ width: 390, height: 844 });
    await expect(
      invitation.getByRole("button", { name: "Share code", exact: true }).locator(".lucide-share"),
    ).toBeVisible();
    for (const [width, scale] of [
      [320, 1],
      [375, 2],
    ]) {
      await a.page.setViewportSize({ width, height: 844 });
      await a.page.evaluate((scale) => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      }, scale);
      await codeBox.click();
      expect(await codeBox.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect((await codeBox.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect(
        await invitation
          .locator(".sheet-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    await a.page.evaluate(() => {
      document.documentElement.style.fontSize = "100%";
    });
    await a.page.setViewportSize({ width: 390, height: 844 });
    await expect(invitation.getByRole("status")).toBeEmpty({ timeout: 4000 });
    await a.page.screenshot({ path: testInfo.outputPath("family-code.png") });
    await a.page
      .getByRole("dialog", { name: "Invite member", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await a.page
      .getByRole("dialog", { name: "Settings", exact: true })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await a.page
      .getByRole("button", { name: "Edit place: Private chanterelles", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Copy to Forest family", exact: true }).click();
    await expect(a.page.getByRole("status")).toContainText("Copied to the selected group");
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Forest family", exact: true })
      .click();
    await expect(
      a.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    await b.page.goto("/");
    await expect(b.page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
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
    await b.page.getByRole("button", { name: "Open shared places", exact: true }).click();
    await expect(
      b.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    await b.page
      .getByRole("button", { name: "Edit place: Private chanterelles", exact: true })
      .click();
    await b.page.getByRole("dialog").getByRole("button", { name: "Edit", exact: true }).click();
    await expect(b.page.locator(".photo-picker img")).toBeVisible();
    await b.page.getByRole("textbox", { name: "Name", exact: true }).fill("Shared chanterelles");
    await b.page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    await expect(b.page.getByRole("button", { name: "Account & sync", exact: true })).toContainText(
      "Synced",
    );
    await a.page.reload();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Shared chanterelles", exact: true }),
    ).toBeVisible();
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Private places", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Private chanterelles", exact: true }),
    ).toBeVisible();
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Forest family", exact: true })
      .click();
    await a.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await a.context.setOffline(true);
    await a.page.reload();
    await expect(
      a.page.getByRole("heading", { name: "Forest family 1", exact: true }),
    ).toBeVisible();
    // Refresh the emulated provider after the lengthy sharing sequence. This
    // fixture checks offline durability rather than real GPS acquisition.
    await a.context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 6 });
    await a.page.getByRole("button", { name: "Save position", exact: true }).click();
    await a.page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Offline mushroom clearing");
    await a.page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
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
    if (await b.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await b.page.getByRole("button", { name: "Later", exact: true }).click();
    await b.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await b.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Mother and family", exact: true })
      .click();
    await expect(
      b.page.getByRole("heading", { name: "No places saved yet", exact: true }),
    ).toBeVisible();
    await expect(
      b.page.getByRole("button", { name: "Edit place: Shared chanterelles", exact: true }),
    ).toHaveCount(0);
    // Match the real device timestamp used by Chromium's geolocation fixture.
    await b.page.clock.setSystemTime(new Date());
    await b.context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 6 });
    await b.page.getByRole("button", { name: "Save position", exact: true }).click();
    await b.page.getByRole("textbox", { name: "Name", exact: true }).fill("Family picnic");
    await b.page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    await b.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await expect(b.page.getByRole("button", { name: "Account & sync", exact: true })).toContainText(
      "Synced",
    );
    await a.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Mother and family", exact: true })
      .click();
    await expect(
      a.page.getByRole("button", { name: "Edit place: Family picnic", exact: true }),
    ).toBeVisible();
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Forest family", exact: true })
      .click();
    if (await b.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await b.page.getByRole("button", { name: "Later", exact: true }).click();
    await b.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await b.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Forest family", exact: true })
      .click();
    await b.page.getByRole("button", { name: "Members · 2", exact: true }).click();
    await expect(
      b.page.getByRole("list", { name: "Members · 2/10" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expect(b.page.getByRole("button", { name: /Remove member/ })).toHaveCount(0);
    await b.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    await a.page.getByRole("button", { name: "Members · 2", exact: true }).click();
    const participants = a.page.getByRole("list", { name: "Members · 2/10" });
    await expect(participants.getByText("Owner · You", { exact: true })).toBeVisible();
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
      a.page.getByRole("list", { name: "Members · 1/10" }).getByRole("listitem"),
    ).toHaveCount(1);
    await a.page.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
    if (await a.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await a.page.getByRole("button", { name: "Later", exact: true }).click();
    await a.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await a.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "Mother and family", exact: true })
      .click();
    await a.page.getByRole("button", { name: "Members · 2", exact: true }).click();
    await expect(
      a.page.getByRole("heading", { name: "Mother and family", exact: true }),
    ).toBeVisible();
    await expect(
      a.page.getByRole("list", { name: "Members · 2/10" }).getByRole("listitem"),
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
    await expect(
      b.page.getByRole("combobox", { name: "Save options", exact: true }),
    ).toBeDisabled();
    await expect(b.page.getByRole("button", { name: "Add place", exact: true })).toBeDisabled();
    await expect(b.page.getByRole("button", { name: /Members/ })).toHaveCount(0);
    expect((await familyAction(b, { action: "create", name: "A different family" })).ok()).toBe(
      true,
    );
    await b.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    if (await b.page.getByRole("button", { name: "Later", exact: true }).isVisible())
      await b.page.getByRole("button", { name: "Later", exact: true }).click();
    await b.page.getByRole("button", { name: "Choose group", exact: true }).click();
    await b.page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: "A different family", exact: true })
      .click();
    await expect(
      b.page.getByRole("heading", { name: "No places saved yet", exact: true }),
    ).toBeVisible();
    await expect(b.page.locator(".library-selector-label")).toBeVisible();
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
