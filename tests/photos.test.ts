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
import { importBackup, readWorkspace, saveEntity } from "../src/client/foundation/library";
import { validateBackup, type Entity } from "../src/shared/model";

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
