import { test, expect, chooseSaveOption } from "./fixtures";

test.use({ serviceWorkers: "block" });

for (const width of [390, 1280]) {
  test(`description, personal status and shared list/map filtering at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 59.3, longitude: 18.2, accuracy: 8 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Place saved", exact: true });
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Lakeside fixture");
    await expect(editor.getByRole("textbox", { name: "Description", exact: true })).toHaveCount(0);
    await editor.getByRole("button", { name: "Add description", exact: true }).click();
    await editor
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Quiet water\nBring a picnic.");
    await editor.getByRole("button", { name: "Done", exact: true }).click();
    const details = page.locator(".details-content:visible");
    await expect(
      details.getByRole("combobox", { name: "My visit status", exact: true }),
    ).toHaveValue("visited");
    await expect(details.locator(".place-description")).toHaveText("Quiet water\nBring a picnic.");
    await details
      .getByRole("combobox", { name: "My visit status", exact: true })
      .selectOption("want");
    await expect(
      details.getByRole("combobox", { name: "My visit status", exact: true }),
    ).toBeEnabled();
    const statusLabel = await details.locator(".visit-status-row > span").boundingBox();
    const statusChoice = await details.locator(".visit-status-row select").boundingBox();
    const statusBlock = await details.locator(".personal-visit").boundingBox();
    await expect(details.locator(".visit-status-row")).toHaveCSS("font-size", "16px");
    await expect(details.locator(".visit-status-row select")).toHaveCSS("font-size", "16px");
    expect(statusChoice!.x).toBeGreaterThanOrEqual(statusLabel!.x + statusLabel!.width);
    expect(
      Math.abs(
        statusLabel!.y + statusLabel!.height / 2 - statusChoice!.y - statusChoice!.height / 2,
      ),
    ).toBeLessThan(2);
    expect(statusBlock!.height).toBeLessThanOrEqual(statusChoice!.height + 1);
    await page.screenshot({ path: testInfo.outputPath("personal-status-details.png") });
    if (width < 700) {
      await page
        .getByRole("dialog", { name: "Place details", exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
    const statusFilter = page.getByRole("combobox", {
      name: "Filter content",
      exact: true,
    });
    const row = await page.locator(".search-row").boundingBox();
    expect(row!.height).toBeLessThanOrEqual(58);
    await statusFilter.selectOption("visited");
    await expect(page.locator(".place-card")).toHaveCount(0);
    await expect(page.getByText("No matching places", { exact: true })).toBeVisible();
    await statusFilter.selectOption("want");
    await expect(page.locator(".place-card")).toHaveCount(1);
    await expect(page.locator(".visit-filter")).toHaveClass(/active/);
    await page.getByRole("textbox", { name: "Search your places", exact: true }).fill("picnic");
    await expect(page.locator(".place-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.locator(".library-pane .map-toolbar")).toContainText("1 place");
    expect((await page.locator(".search-row").boundingBox())!.height).toBe(row!.height);
    await statusFilter.selectOption("none");
    await expect(page.locator(".library-pane .places-map")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(statusFilter).toHaveValue("all");
    await expect(page.locator(".library-pane .map-toolbar")).toContainText("1 place");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("personal-status-list.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await page.locator(".place-card .card-main").click();
    await expect(
      page
        .locator(".details-content:visible")
        .getByRole("combobox", { name: "My visit status", exact: true }),
    ).toHaveValue("want");
    expect(errors).toEqual([]);
  });
}

test("a received share preserves description without inferring the recipient visited", async ({
  page,
}) => {
  const data = {
    version: 1,
    name: "Shared clearing",
    description: "Meet near the old oak.",
    category: "Other",
    latitude: 59,
    longitude: 18,
  };
  await page.goto(`/#place=${Buffer.from(JSON.stringify(data)).toString("base64url")}`);
  const shared = page.getByRole("dialog");
  await expect(shared).toContainText(data.description);
  await shared.getByRole("button", { name: "Save a copy", exact: true }).click();
  await page.locator(".place-card .card-main").click();
  const details = page.locator(".details-content:visible");
  await expect(details).toContainText(data.description);
  await expect(details.getByRole("combobox", { name: "My visit status", exact: true })).toHaveValue(
    "none",
  );
});

test("description drafts recover after reload and manual places start without a visit", async ({
  page,
}) => {
  await page.goto("/");
  await chooseSaveOption(page, "details");
  let editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Draft clearing");
  await editor.getByRole("button", { name: "Add description", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Bring binoculars.\nLook east.");
  // Draft writes are queued after rendering; let the existing durable queue settle.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open("voltura-places", 1);
          request.onsuccess = () => resolve(request.result);
        });
        try {
          return await new Promise<string>((resolve) => {
            const request = db.transaction("drafts").objectStore("drafts").get("guest");
            request.onsuccess = () => resolve(request.result?.description ?? "");
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe("Bring binoculars.\nLook east.");
  await page.reload();
  editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await expect(editor.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(
    "Bring binoculars.\nLook east.",
  );
  await editor.getByRole("button", { name: "Enter coordinates manually", exact: true }).click();
  await editor.getByRole("textbox", { name: "Latitude", exact: true }).fill("59");
  await editor.getByRole("textbox", { name: "Longitude", exact: true }).fill("18");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".place-card .card-main").click();
  await expect(page.getByRole("combobox", { name: "My visit status", exact: true })).toHaveValue(
    "none",
  );
  await expect(page.locator(".place-description")).toHaveText("Bring binoculars.\nLook east.");
});

test("two group members retain independent visit statuses across real account sync and reload", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const origin = "http://127.0.0.1:5174";
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({
        baseURL: origin,
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
      }),
    ),
  );
  try {
    const accounts = await Promise.all(
      contexts.map(async (context) => {
        const response = await context.request.post("/api/account/connect", {
          headers: { Origin: origin, "oai-authenticated-user-id": `visit-${crypto.randomUUID()}` },
          data: { provider: "chatgpt" },
        });
        expect(response.ok()).toBe(true);

        return (await response.json()).account;
      }),
    );

    const familyAction = async (index: number, data: unknown) => {
      const response = await contexts[index].request.post("/api/family", {
        headers: { Origin: origin, "X-Places-Account": accounts[index].id },
        data,
      });
      expect(response.ok()).toBe(true);

      return response.json();
    };

    const created = await familyAction(0, { action: "create", name: "Visit test group" });
    const familyId = created.familyId;
    const invitation = await familyAction(0, { action: "code-create", familyId });
    await familyAction(1, { action: "code-request", code: invitation.code });
    await familyAction(0, { action: "code-approve", familyId, member: accounts[1].id });
    const placeId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const saved = await contexts[0].request.post("/api/v1/sync", {
      headers: { Origin: origin, "X-Places-Account": accounts[0].id, "X-Places-Family": familyId },
      data: {
        version: 1,
        mutationId: crypto.randomUUID(),
        baseRevision: 0,
        deleted: false,
        entity: {
          id: placeId,
          kind: "place",
          value: {
            name: "Shared shore",
            description: "Follow the lakeside path.",
            categoryId: "other",
            latitude: 59,
            longitude: 18,
            accuracy: null,
            capturedAt: stamp,
            updatedAt: stamp,
          },
        },
      },
    });
    expect(saved.ok()).toBe(true);
    const pages = [];
    for (const [index, context] of contexts.entries()) {
      const state = await context.request.get("/api/family", {
        headers: { "X-Places-Account": accounts[index].id },
      });
      const families = (await state.json()).families;
      await context.addInitScript(
        ({ account, families, familyId }) => {
          localStorage.setItem("places-account-choice", "done");
          localStorage.setItem(
            "places-account",
            JSON.stringify({ enabled: true, providers: { chatgpt: true }, account }),
          );
          localStorage.setItem(
            `places-family:${account.id}`,
            JSON.stringify({ families, inactive: [] }),
          );
          localStorage.setItem(
            `places-workspace:${account.id}`,
            `family:${account.id}:${familyId}`,
          );
        },
        { account: accounts[index], families, familyId },
      );
      const page = await context.newPage();
      await page.goto("/");
      await page.locator(".place-card .card-main").click();
      await expect(
        page.getByRole("combobox", { name: "My visit status", exact: true }),
      ).toHaveValue("none");
      await page
        .getByRole("combobox", { name: "My visit status", exact: true })
        .selectOption(index === 0 ? "visited" : "want");
      await expect
        .poll(async () => {
          const response = await context.request.get("/api/v1/sync", {
            headers: { "X-Places-Account": accounts[index].id },
          });
          const records = (await response.json()).records;

          return records.find(
            (r: { kind: string; value: { placeId?: string } }) =>
              r.kind === "visit" && r.value.placeId === placeId,
          )?.value.status;
        })
        .toBe(index === 0 ? "visited" : "want");
      pages.push(page);
    }
    for (const [index, page] of pages.entries()) {
      await page.reload();
      await page.locator(".place-card .card-main").click();
      await expect(
        page.getByRole("combobox", { name: "My visit status", exact: true }),
      ).toHaveValue(index === 0 ? "visited" : "want");
      await expect(page.locator(".place-description")).toHaveText("Follow the lakeside path.");
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
