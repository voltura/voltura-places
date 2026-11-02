import { test, expect } from "./fixtures";
import { starters } from "../../src/shared/model";

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });

test("background map updates preserve pin focus and update its label and colour", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
  const records = starters.map((e) => ({
    ...e,
    revision: 0,
    generation: 0,
    dirty: false,
    deleted: false,
  }));

  const place = (id: string, name: string, latitude: number, longitude: number) => ({
    id,
    kind: "place",
    value: {
      name,
      latitude,
      longitude,
      categoryId: "other",
      accuracy: null,
      capturedAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
    revision: 0,
    generation: 1,
    dirty: true,
    deleted: false,
  });

  const write = async (records: unknown[]) =>
    page.evaluate(async (records) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("voltura-places");
        r.onsuccess = () => resolve(r.result);
      });
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put({
        key: "guest",
        records,
        reconciled: true,
        presetRevision: 2,
      });
      await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
      db.close();
      window.dispatchEvent(new Event("places-library"));
    }, records);

  const first = place("first", "First fixture", -35, -60);
  const second = place("second", "Second fixture", 35, 60);
  await write([...records, first, second]);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  const pin = page.locator('.places-map-pin[title="First fixture"]');
  await expect(pin).toBeVisible();
  await pin.focus();
  await expect(pin).toBeFocused();
  const third = place("third", "Third fixture", 0, 0);
  await write([...records, first, second, third]);
  await expect(page.locator('.places-map-pin[title="Third fixture"]')).toBeVisible();
  await expect(pin).toBeFocused();
  first.value.name = "Updated fixture";
  first.value.categoryId = "parking";
  await write([...records, first, second, third]);
  const updated = page.locator('.places-map-pin[title="Updated fixture"]');
  await expect(updated).toBeFocused();
  await expect(updated.locator(".places-map-dot")).toHaveClass(/blue/);
  await write([...records, first, second, third, place("fourth", "Fourth fixture", 0, 0)]);
  await expect(
    page.locator('.places-map-cluster span[aria-label="2 places on map"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("sv");
  await page.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(page.getByRole("button", { name: "Zooma in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zooma ut", exact: true })).toBeVisible();
  await expect(
    page.locator('.places-map-cluster span[aria-label="2 platser på kartan"]'),
  ).toBeVisible();
  // Moving an existing marker must update the cluster's spatial index too.
  first.value.latitude = 0;
  first.value.longitude = 0;
  const fourth = place("fourth", "Fourth fixture", 0, 0);
  await write([...records, first, second, third, fourth]);
  await expect(
    page.locator('.places-map-cluster span[aria-label="3 platser på kartan"]'),
  ).toBeVisible();
  first.value.latitude = -35;
  first.value.longitude = -60;
  await write([...records, first, third, fourth]);
  await expect(page.locator('.places-map-pin[title="Second fixture"]')).toHaveCount(0);
  await expect(updated).toBeVisible();
  await expect(
    page.locator('.places-map-cluster span[aria-label="2 platser på kartan"]'),
  ).toBeVisible();
  await updated.focus();
  await updated.press("Enter");
  await expect(page.locator(".detail-pane h2")).toHaveText("Updated fixture");
});
