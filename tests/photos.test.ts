import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { test, expect, vi } from "vitest";
import {
  getPhoto,
  makeStoredPhoto,
  putPhotos,
  copyPhotos,
} from "../src/client/foundation/photo-store";
import { exportWithPhotos } from "../src/client/foundation/photo-backup";
import {
  copyPlaceToWorkspace,
  importBackup,
  readWorkspace,
  reconcileDevicePlaces,
  saveEntity,
} from "../src/client/foundation/library";
import { validateBackup, type Entity } from "../src/shared/model";
import { photoPosition } from "../src/client/foundation/photo-location";
import { loadPhoto, uploadPhoto } from "../src/client/foundation/photos";

test("an edited cloud place recovers a missing local photo before synchronization", async () => {
  const key = crypto.randomUUID(),
    id = crypto.randomUUID();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(await readFile("tests/fixtures/photo.jpg")));
  try {
    await uploadPhoto(key, id);
    expect((await getPhoto(key, id))?.uploaded).toBe(true);
    expect(network).toHaveBeenCalledTimes(1);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("cancelled backup exports cannot download photos back into a removed account", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  const key = crypto.randomUUID(),
    id = crypto.randomUUID();
  await saveEntity(key, {
    id: crypto.randomUUID(),
    kind: "place",
    value: {
      name: "Export fixture",
      categoryId: "other",
      photoId: id,
      latitude: 0,
      longitude: 0,
      accuracy: null,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  let current = true;
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    current = false;
    return new Response(jpeg);
  });
  try {
    await expect(exportWithPhotos(await readWorkspace(key), () => current)).rejects.toThrow(
      "accountChanged",
    );
    expect(await getPhoto(key, id)).toBeUndefined();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test.each(["group", "account"])(
  "%s copying remaps a photo identity collision without overwriting either image",
  async (mode) => {
    vi.stubGlobal("window", new EventTarget());
    const source = mode === "account" ? "guest" : crypto.randomUUID(),
      target = crypto.randomUUID(),
      id = crypto.randomUUID();
    const original = await makeStoredPhoto(
      source,
      id,
      new Blob([await readFile("tests/fixtures/photo.jpg")]),
    );
    const changed = new Uint8Array(await original.blob.arrayBuffer());
    changed[10] ^= 1;
    const existing = await makeStoredPhoto(target, id, new Blob([changed]));
    await putPhotos([original]);
    await putPhotos([existing]);
    const entity: Entity = {
      id: crypto.randomUUID(),
      kind: "place",
      value: {
        name: "Collision fixture",
        categoryId: "other",
        photoId: id,
        latitude: 0,
        longitude: 0,
        accuracy: null,
        capturedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    await saveEntity(source, entity);
    if (mode === "account") await reconcileDevicePlaces(target, [], "copy");
    else await copyPlaceToWorkspace(source, target, entity.id);
    const copied = (await readWorkspace(target)).records.find(
      (r) => r.kind === "place" && !r.deleted,
    )!;
    if (copied.kind !== "place") throw new Error();
    expect(copied.value.photoId).not.toBe(id);
    expect((await getPhoto(target, copied.value.photoId!))?.hash).toBe(original.hash);
    expect((await getPhoto(target, id))?.hash).toBe(existing.hash);
    expect((await getPhoto(source, id))?.hash).toBe(original.hash);
  },
);

test("photo writes recheck cancellation inside the transaction before restoring account data", async () => {
  const key = crypto.randomUUID(),
    id = crypto.randomUUID();
  const photo = await makeStoredPhoto(
    key,
    id,
    new Blob([await readFile("tests/fixtures/photo.jpg")]),
  );
  let checks = 0;
  await expect(putPhotos([photo], () => ++checks === 1)).rejects.toThrow("accountChanged");
  expect(await getPhoto(key, id)).toBeUndefined();
});

test("a cancelled group copy cannot restore removed records or photos", async () => {
  vi.stubGlobal("window", new EventTarget());
  const from = crypto.randomUUID(),
    to = crypto.randomUUID(),
    id = crypto.randomUUID(),
    photoId = crypto.randomUUID();
  await putPhotos([
    await makeStoredPhoto(from, photoId, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  await saveEntity(from, {
    id,
    kind: "place",
    value: {
      name: "Cancelled copy",
      categoryId: "other",
      latitude: 0,
      longitude: 0,
      accuracy: null,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      photoId,
    },
  });
  await expect(copyPlaceToWorkspace(from, to, id, () => false)).rejects.toThrow("accountChanged");
  expect(await getPhoto(to, photoId)).toBeUndefined();
  expect((await readWorkspace(to)).records.some((r) => r.kind === "place")).toBe(false);
});

test("a late photo download cannot restore data after its view/account is discarded", async () => {
  const key = crypto.randomUUID(),
    id = crypto.randomUUID();
  vi.stubGlobal("navigator", { onLine: true });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(await readFile("tests/fixtures/photo.jpg")));
  try {
    await expect(loadPhoto(key, id, () => false)).rejects.toThrow("accountChanged");
    expect(await getPhoto(key, id)).toBeUndefined();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});
test("photo GPS is read before compression and absent or malformed metadata is harmless", async () => {
  expect(await photoPosition(new Blob([await readFile("tests/fixtures/photo-gps.jpg")]))).toEqual({
    latitude: 59.5,
    longitude: 18.25,
  });
  expect(await photoPosition(new Blob([await readFile("tests/fixtures/photo.jpg")]))).toBeNull();
  expect(await photoPosition(new Blob(["invalid"]))).toBeNull();
});

test("photo backups round trip offline and reject missing images without changing places", async () => {
  vi.stubGlobal("window", new EventTarget());
  const key = crypto.randomUUID(),
    target = crypto.randomUUID();
  const id = crypto.randomUUID();
  const photo = await makeStoredPhoto(
    key,
    id,
    new Blob([await readFile("tests/fixtures/photo.jpg")]),
  );
  await putPhotos([photo]);
  const entity: Entity = {
    id: crypto.randomUUID(),
    kind: "place",
    value: {
      name: "Photo fixture",
      latitude: 0,
      longitude: 0,
      categoryId: "other",
      accuracy: null,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      photoId: id,
    },
  };
  await saveEntity(key, entity);
  const backup = await exportWithPhotos(await readWorkspace(key));
  expect(backup.version).toBe(2);
  await importBackup(target, backup);
  expect((await getPhoto(target, id))?.hash).toBe(photo.hash);
  await importBackup(target, backup);
  expect((await readWorkspace(target)).records.filter((r) => r.kind === "place")).toHaveLength(1);
  const before = await readWorkspace(target);
  await expect(importBackup(target, { ...backup, photos: [] }, true)).rejects.toThrow();
  expect(await readWorkspace(target)).toEqual(before);
  expect(() =>
    validateBackup({ ...backup, photos: [{ id, data: "data:image/jpeg;base64,AAAA" }] }),
  ).toThrow();
  expect(await getPhoto("unrelated-account", id)).toBeUndefined();
  await copyPhotos(key, "explicit-merge", [id]);
  expect((await getPhoto("explicit-merge", id))?.uploaded).toBe(false);
});
