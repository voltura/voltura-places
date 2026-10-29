import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { test, expect, vi } from "vitest";
import { familyKey, workspaceHeaders } from "../src/shared/families";
import { cachedFamily, storeFamilies, initialWorkspace } from "../src/client/foundation/family";
import {
  saveEntity,
  copyPlaceToWorkspace,
  readWorkspace,
  removeAccountWorkspaces,
  setDraft,
  getDraft,
} from "../src/client/foundation/library";
import { makeStoredPhoto, putPhotos, getPhoto } from "../src/client/foundation/photo-store";

test("single-group cache upgrades and keeps independent active and archived group selections", () => {
  const values = new Map<string, string>(),
    account = crypto.randomUUID();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  vi.stubGlobal("localStorage", storage);
  const first = {
      id: crypto.randomUUID(),
      name: "Couple",
      ownerId: account,
      members: [{ id: account, label: "Fixture" }],
      requests: [],
    },
    second = { ...first, id: crypto.randomUUID(), name: "Mother's group" };
  try {
    storage.setItem(`places-family:${account}`, JSON.stringify({ family: first, active: true }));
    expect(cachedFamily(account).families).toEqual([first]);
    storeFamilies(account, [first, second]);
    storage.setItem(`places-workspace:${account}`, familyKey(account, second.id));
    expect(initialWorkspace(account)).toBe(familyKey(account, second.id));
    const after = storeFamilies(account, [second]);
    expect(after.families).toEqual([second]);
    expect(after.inactive).toEqual([first]);
    storage.setItem(`places-workspace:${account}`, familyKey(account, first.id));
    expect(initialWorkspace(account)).toBe(familyKey(account, first.id));
    expect(cachedFamily(crypto.randomUUID()).families).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
test("family copies preserve private originals and keep account-owned local queues/photos separate", async () => {
  vi.stubGlobal("window", new EventTarget());
  const account = crypto.randomUUID(),
    other = crypto.randomUUID(),
    group = crypto.randomUUID(),
    key = familyKey(account, group),
    otherKey = familyKey(other, group),
    id = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    categoryId = crypto.randomUUID();
  await saveEntity(account, {
    id: categoryId,
    kind: "category",
    value: { name: "Chanterelles", color: "amber" },
  });
  await putPhotos([
    await makeStoredPhoto(account, photoId, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  await saveEntity(account, {
    id,
    kind: "place",
    value: {
      name: "Private mushroom spot",
      categoryId,
      photoId,
      latitude: 0,
      longitude: 0,
      accuracy: 6,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const copy = await copyPlaceToWorkspace(account, key, id);
  expect(copy.reconciled).toBe(true);
  const place = copy.records.find((r) => r.kind === "place")!;
  expect(place.id).not.toBe(id);
  expect(place.dirty).toBe(true);
  expect(copy.records.some((r) => r.kind === "category" && r.value.name === "Chanterelles")).toBe(
    true,
  );
  expect((await readWorkspace(account)).records.some((r) => r.id === id)).toBe(true);
  expect((await getPhoto(key, photoId))?.uploaded).toBe(false);
  expect((await readWorkspace(otherKey)).records.some((r) => r.kind === "place")).toBe(false);
  expect(await getPhoto(otherKey, photoId)).toBeUndefined();
  expect(workspaceHeaders(key)).toEqual({ "X-Places-Account": account, "X-Places-Family": group });
  await saveEntity(other, {
    id: crypto.randomUUID(),
    kind: "category",
    value: { name: "Keep me", color: "green" },
  });
  await setDraft(key, { name: "Unfinished shared draft" });
  await removeAccountWorkspaces(account);
  expect((await readWorkspace(key)).records.some((r) => r.kind === "place")).toBe(false);
  expect(await getDraft(key)).toBeUndefined();
  expect(await getPhoto(key, photoId)).toBeUndefined();
  expect((await readWorkspace(other)).records.some((r) => r.value.name === "Keep me")).toBe(true);
});
