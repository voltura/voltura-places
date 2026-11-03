import { mockMapTiles } from "./fixtures";
import { test, expect } from "./fixtures";

test("copy destination is explicit and only the chosen group receives a copy", async ({
  browser,
}, testInfo) => {
  const origin = "http://127.0.0.1:5174";
  const context = await browser.newContext({
    baseURL: origin,
    locale: "en-US",
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 0, longitude: 0, accuracy: 6 },
  });
  await mockMapTiles(context);
  await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
  const response = await context.request.post("/api/account/connect", {
    headers: {
      Origin: origin,
      "oai-authenticated-user-id": `copy-test-${crypto.randomUUID()}`,
      "oai-authenticated-user-email": "copy@example.invalid",
    },
    data: { provider: "chatgpt" },
  });
  expect(response.ok()).toBe(true);
  const account = (await response.json()).account.id;
  const headers = { Origin: origin, "X-Places-Account": account };
  const groups: string[] = [];

  const create = async (name: string) => {
    const result = await context.request.post("/api/family", {
      headers,
      data: { action: "create", name },
    });
    expect(result.ok()).toBe(true);
    const id = (await result.json()).familyId;
    groups.push(id);

    return id;
  };

  const records = async (id: string) => {
    const result = await context.request.get("/api/v1/sync", {
      headers: { ...headers, "X-Places-Family": id },
    });
    expect(result.ok()).toBe(true);

    return (await result.json()).records.filter(
      (r: { kind: string; deleted: boolean }) => r.kind === "place" && !r.deleted,
    );
  };

  try {
    const first = await create("Familjen");
    const longName = "Averylonggroupnamewhichwrapswithoutspacesandstillneedstobefullyreadable";
    const second = await create(longName);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Svampstället");
    await page.getByRole("button", { name: /^(Save|Done)$/, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Edit place: Svampstället", exact: true }).click();
    await page.getByRole("button", { name: "Copy to group…", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Copy to group", exact: true });
    await expect(picker.getByText(/The original stays/)).toBeVisible();
    await expect(picker.getByRole("button", { name: longName, exact: true })).toBeVisible();
    for (const [width, scale] of [
      [320, 1],
      [375, 2],
      [390, 1],
    ]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = `${value * 100}%`;
      }, scale);
      const content = picker.locator(".sheet-content");
      expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("copy-group-picker.png") });
    await picker.getByRole("button", { name: /^(Cancel|Done)$/, exact: true }).click();
    expect(await records(first)).toHaveLength(0);
    expect(await records(second)).toHaveLength(0);
    await page.getByRole("button", { name: "Copy to group…", exact: true }).click();
    await picker.getByRole("button", { name: longName, exact: true }).click();
    await expect(page.locator(".toast[role=status]")).toContainText("Copied to the selected group");
    expect(await records(first)).toHaveLength(0);
    expect(await records(second)).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: "Edit place: Svampstället", exact: true }),
    ).toBeVisible();
    // Share a saved group place into another group through the details action.
    await page.getByRole("button", { name: "Choose group", exact: true }).click();
    await page
      .getByRole("group", { name: "Choose group", exact: true })
      .getByRole("button", { name: longName, exact: true })
      .click();
    await page.getByRole("button", { name: /^Svampstället/ }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const sharing = page.getByRole("dialog", { name: "Share place", exact: true });
    await expect(sharing.getByRole("button", { name: "Share link…", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("share-options.png") });
    await sharing.getByRole("button", { name: "Share with a group", exact: true }).click();
    const sharePicker = page.getByRole("dialog", { name: "Share with a group", exact: true });
    await expect(sharePicker.getByRole("button", { name: longName, exact: true })).toHaveCount(0);
    await expect(sharePicker.getByRole("button", { name: "Familjen", exact: true })).toBeVisible();
    await sharePicker.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await records(first)).toHaveLength(0);
    await sharing.getByRole("button", { name: "Share with a group", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("share-group-picker.png") });
    await sharePicker.getByRole("button", { name: "Familjen", exact: true }).dblclick();
    await expect(page.locator(".toast[role=status]")).toContainText("Copied to the selected group");
    const sourcePlaces = await records(second);
    const destinationPlaces = await records(first);
    expect(sourcePlaces).toHaveLength(1);
    expect(destinationPlaces).toHaveLength(1);
    expect(destinationPlaces[0].id).not.toBe(sourcePlaces[0].id);
    expect(destinationPlaces[0].value.name).toBe("Svampstället");
    // Repeat the group-to-group action after its first completion.
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await sharing.getByRole("button", { name: "Share with a group", exact: true }).click();
    await sharePicker.getByRole("button", { name: "Familjen", exact: true }).click();
    await expect(page.locator(".toast[role=status]")).toContainText("Already in this group");
    expect(await records(first)).toEqual(destinationPlaces);

    // Review the live checkout on its single shared preview, in Swedish.
    await create("Vännerna");
    await page.goto("http://127.0.0.1:5173/?lang=sv");
    await page.getByRole("button", { name: "Välj grupp", exact: true }).click();
    await page
      .getByRole("group", { name: "Välj grupp", exact: true })
      .getByRole("button", { name: longName, exact: true })
      .click();
    await page.getByRole("button", { name: /^Svampstället/ }).click();
    await page.getByRole("button", { name: "Dela", exact: true }).click();
    const swedishShare = page.getByRole("dialog", { name: "Dela plats", exact: true });
    await expect(
      swedishShare.getByRole("button", { name: "Dela länk…", exact: true }),
    ).toBeVisible();
    await swedishShare.screenshot({ path: testInfo.outputPath("dela-plats.png") });
    await swedishShare.getByRole("button", { name: "Dela med en grupp", exact: true }).click();
    const swedishPicker = page.getByRole("dialog", { name: "Dela med en grupp", exact: true });
    await expect(
      swedishPicker.getByRole("button", { name: "Familjen", exact: true }),
    ).toBeVisible();
    await expect(
      swedishPicker.getByRole("button", { name: "Vännerna", exact: true }),
    ).toBeVisible();
    await swedishPicker.screenshot({ path: testInfo.outputPath("valj-grupp.png") });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await swedishPicker
        .locator(".sheet-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  } finally {
    for (const familyId of groups) {
      await context.request.post("/api/family", { headers, data: { action: "delete", familyId } });
    }
    await context.request.delete("/api/account", {
      headers,
      data: { confirm: "delete-places-account" },
    });
    await context.close();
  }
});
