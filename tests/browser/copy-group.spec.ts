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
    const first = await create("Forest friends");
    const longName = "Averylonggroupnamewhichwrapswithoutspacesandstillneedstobefullyreadable";
    const second = await create(longName);
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Account & sync", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Private copy source");
    await page.getByRole("button", { name: /^(Save changes|Done)$/, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit place: Private copy source", exact: true })
      .click();
    await page.getByRole("button", { name: "Copy to group…", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Copy to group", exact: true });
    await expect(picker.getByText(/The original stays private/)).toBeVisible();
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
      page.getByRole("button", { name: "Edit place: Private copy source", exact: true }),
    ).toBeVisible();
  } finally {
    for (const familyId of groups)
      await context.request.post("/api/family", { headers, data: { action: "delete", familyId } });
    await context.request.delete("/api/account", {
      headers,
      data: { confirm: "delete-places-account" },
    });
    await context.close();
  }
});
