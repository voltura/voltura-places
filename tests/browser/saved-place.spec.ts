import { test, expect } from "@playwright/test";

test("just-saved place stays editable and discard deletes only after confirmation", async ({
  page,
  context,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const saved = page.getByRole("dialog", { name: "Place saved", exact: true });
  const name = saved.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Saved fixture");
  await saved.getByRole("combobox", { name: "Category", exact: true }).selectOption("mushrooms");
  await saved.getByRole("button", { name: "Discard place", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Discard this place?", exact: true });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(name).toHaveValue("Saved fixture");
  await saved.getByRole("button", { name: "Done", exact: true }).click();
  await expect(saved).toHaveCount(0);
  await page.reload();
  await page.locator("article .card-main").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit place", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit place", exact: true });
  await expect(edit.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Saved fixture",
  );
  await expect(edit.getByRole("combobox", { name: "Category", exact: true })).toHaveValue(
    "mushrooms",
  );
  await expect(edit.getByRole("button", { name: "Discard place", exact: true })).toHaveCount(0);
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  await saved.getByRole("textbox", { name: "Name", exact: true }).fill("Discarded fixture");
  await page.screenshot({ path: testInfo.outputPath("place-saved.png") });
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const value = args[0] as { records?: { deleted: boolean }[] };
      if (this.name === "workspaces" && value.records?.some((r) => r.deleted))
        throw new DOMException("Storage fixture", "QuotaExceededError");
      return originalPut.apply(this, args);
    };
    Object.assign(window, {
      restoreSavedPlaceStorage: () => {
        IDBObjectStore.prototype.put = originalPut;
      },
    });
  });
  await saved.getByRole("button", { name: "Discard place", exact: true }).click();
  await confirm.getByRole("button", { name: "Discard place", exact: true }).click();
  await expect(saved.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue("Discarded fixture");
  await expect(page.locator(".place-card")).toHaveCount(2);
  await page.evaluate(() =>
    (window as unknown as { restoreSavedPlaceStorage: () => void }).restoreSavedPlaceStorage(),
  );
  await saved.getByRole("button", { name: "Discard place", exact: true }).click();
  await confirm.getByRole("button", { name: "Discard place", exact: true }).click();
  await expect(saved).toHaveCount(0);
  await expect(page.locator(".place-card")).toHaveCount(1);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".place-card")).toHaveCount(1);
  await expect(page.locator(".place-card")).toContainText("Saved fixture");
  const state = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("voltura-places", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const read = (store: string) =>
        new Promise<unknown>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).get("guest");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      return { workspace: await read("workspaces"), draft: await read("drafts") };
    } finally {
      db.close();
    }
  });
  const workspace = state.workspace as {
    records: { kind: string; deleted: boolean; dirty: boolean }[];
  };
  expect(workspace.records.filter((r) => r.kind === "place" && r.deleted && r.dirty)).toHaveLength(
    1,
  );
  expect(state.draft).toBeUndefined();
});
