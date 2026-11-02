import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { test, expect, vi } from "vitest";
import {
  getPhoto,
  makeStoredPhoto,
  putPhotos,
  copyPhotos,
  clearAccountPhotos,
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
import { BACKUP_BYTES, PHOTO_QUOTA, jpegDimensions, PHOTO_BYTES } from "../src/shared/photos";
import { loadPhoto, preparePhoto, uploadPhoto } from "../src/client/foundation/photos";

test("a discarded photo request does not start a download or return a cached image", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  vi.stubGlobal("window", new EventTarget());
  const network = vi.spyOn(globalThis, "fetch");
  try {
    await expect(loadPhoto(key, id, () => false)).rejects.toThrow("accountChanged");
    const photo = await makeStoredPhoto(
      key,
      id,
      new Blob([await readFile("tests/fixtures/photo.jpg")]),
    );
    await putPhotos([photo]);
    let current = true;
    const pending = loadPhoto(key, id, () => current);
    current = false;
    await expect(pending).rejects.toThrow("accountChanged");
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("a cancelled upload response cannot mark the discarded workspace photo uploaded", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  vi.stubGlobal("window", new EventTarget());
  await putPhotos([
    await makeStoredPhoto(key, id, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  let current = true;
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    current = false;

    return new Response(null, { status: 204 });
  });
  try {
    await expect(uploadPhoto(key, id, () => current)).rejects.toThrow("accountChanged");
    expect((await getPhoto(key, id))?.uploaded).toBe(false);
    await uploadPhoto(key, id);
    expect((await getPhoto(key, id))?.uploaded).toBe(true);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("an edited cloud place recovers a missing local photo before synchronization", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
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
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
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
    const source = mode === "account" ? "guest" : crypto.randomUUID();
    const target = crypto.randomUUID();
    const id = crypto.randomUUID();
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
    if (mode === "account") {
      await reconcileDevicePlaces(target, [], "copy");
    } else {
      await copyPlaceToWorkspace(source, target, entity.id);
    }
    const copied = (await readWorkspace(target)).records.find(
      (r) => r.kind === "place" && !r.deleted,
    )!;
    if (copied.kind !== "place") {
      throw new Error();
    }
    expect(copied.value.photoId).not.toBe(id);
    expect((await getPhoto(target, copied.value.photoId!))?.hash).toBe(original.hash);
    expect((await getPhoto(target, id))?.hash).toBe(existing.hash);
    expect((await getPhoto(source, id))?.hash).toBe(original.hash);
  },
);

test("photo writes recheck cancellation inside the transaction before restoring account data", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
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
  const from = crypto.randomUUID();
  const to = crypto.randomUUID();
  const id = crypto.randomUUID();
  const photoId = crypto.randomUUID();
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
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
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
  const key = crypto.randomUUID();
  const target = crypto.randomUUID();
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
  const decodes = vi.spyOn(globalThis, "atob");
  try {
    await importBackup(target, backup);
    expect(decodes).toHaveBeenCalledTimes(backup.photos!.length);
  } finally {
    decodes.mockRestore();
  }
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

test("oversized image downloads stop while streaming and never enter local storage", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(PHOTO_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel,
  });
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));
  const workspace = crypto.randomUUID();
  const id = crypto.randomUUID();
  try {
    await expect(loadPhoto(workspace, id)).rejects.toThrow("invalidPhoto");
    expect(cancel).toHaveBeenCalledOnce();
    expect(await getPhoto(workspace, id)).toBeUndefined();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("account photo range deletion preserves similarly named accounts and their groups", async () => {
  const account = crypto.randomUUID();
  const neighbour = account + "a";
  const family = crypto.randomUUID();
  const id = crypto.randomUUID();
  const original = await makeStoredPhoto(
    account,
    id,
    new Blob([await readFile("tests/fixtures/photo.jpg")]),
  );
  const workspaces = [
    account,
    `family:${account}:${family}`,
    neighbour,
    `family:${neighbour}:${family}`,
  ];
  for (const workspace of workspaces) {
    await putPhotos([{ ...original, workspace }]);
  }
  await clearAccountPhotos(account);
  expect(
    await Promise.all(workspaces.map(async (workspace) => !!(await getPhoto(workspace, id)))),
  ).toEqual([false, false, true, true]);
});

test("malformed JPEG frame, coding table and scan references cannot enter a photo backup or the Worker", async () => {
  const bytes = await readFile("tests/fixtures/photo.jpg");
  const frame = bytes.indexOf(Buffer.from([255, 192]));
  const scan = bytes.indexOf(Buffer.from([255, 218]));
  const huffman = bytes.indexOf(Buffer.from([255, 196]));
  for (const [position, replacement] of [
    [frame + 11, 0], // A component with zero sampling.
    [frame + 13, bytes[frame + 10]], // Duplicate frame component ID.
    [frame + 12, 3], // An absent quantization table.
    [scan + 5, 88], // An unknown scan component.
    [scan + 7, bytes[scan + 5]], // Repeated scan component.
    [scan + 6, 0x33], // Missing DC/AC coding tables.
  ]) {
    const damaged = new Uint8Array(bytes);
    damaged[position] = replacement;
    expect(() => jpegDimensions(damaged)).toThrow("invalidPhoto");
  }
  const oversubscribed = new Uint8Array(bytes);
  oversubscribed[huffman + 5] += 2;
  oversubscribed[huffman + 7] -= 2;
  expect(() => jpegDimensions(oversubscribed)).toThrow("invalidPhoto");
  const scanEnd = scan + 2 + bytes.readUInt16BE(scan + 2);
  expect(() =>
    jpegDimensions(Buffer.concat([bytes.subarray(0, scanEnd), Buffer.from([255, 208, 255, 217])])),
  ).toThrow("invalidPhoto");
});

test("large JPEG colour profiles do not hide GPS beyond the initial metadata prefix", async () => {
  const jpeg = await readFile("tests/fixtures/photo-gps.jpg");
  const profile = Buffer.alloc(60004);
  profile.set([255, 226, 234, 98]);
  const file = new Blob([jpeg.subarray(0, 2), profile, profile, jpeg.subarray(2)]);
  expect(await photoPosition(file)).toEqual({ latitude: 59.5, longitude: 18.25 });
});

test("large JPEGs with early GPS avoid reading the complete image", async () => {
  const jpeg = await readFile("tests/fixtures/photo-gps.jpg");
  const file = new Blob([jpeg, new Uint8Array(100000)]);
  const readAll = vi.spyOn(file, "arrayBuffer");
  expect(await photoPosition(file)).toEqual({ latitude: 59.5, longitude: 18.25 });
  expect(readAll).not.toHaveBeenCalled();
});

test("impossible sequential or progressive JPEG scans are rejected", async () => {
  const valid = await readFile("tests/fixtures/photo.jpg");
  const frame = valid.indexOf(Buffer.from([255, 192]));
  const scan = valid.indexOf(Buffer.from([255, 218]));
  const parameters = scan + 2 + valid.readUInt16BE(scan + 2) - 3;
  for (const [marker, start, end, refinement] of [
    [192, 0, 48, 0],
    [194, 0, 63, 0],
    [194, 0, 0, 0x10],
    [194, 1, 63, 0],
  ]) {
    const jpeg = new Uint8Array(valid);
    jpeg[frame + 1] = marker;
    jpeg.set([start, end, refinement], parameters);
    expect(() => jpegDimensions(jpeg)).toThrow("invalidPhoto");
  }
});

test("concurrent destination collisions reuse a single remapped immutable photo", async () => {
  const from = crypto.randomUUID();
  const to = crypto.randomUUID();
  const id = crypto.randomUUID();
  const original = await readFile("tests/fixtures/photo.jpg");
  const other = new Uint8Array(original);
  other[10] ^= 1;
  await putPhotos([await makeStoredPhoto(from, id, new Blob([original]))]);
  await putPhotos([await makeStoredPhoto(to, id, new Blob([other]))]);
  const [first, second] = await Promise.all([
    copyPhotos(from, to, [id]),
    copyPhotos(from, to, [id]),
  ]);
  expect(first.get(id)).toBeTruthy();
  expect(first.get(id)).not.toBe(id);
  expect(first.get(id)).toBe(second.get(id));
});

test("abandoned photo response is cancelled before reading, and requests stay on this origin", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  let active = true;
  const cancel = vi.fn();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    active = false;

    return new Response(new ReadableStream({ cancel }));
  });
  try {
    await expect(loadPhoto(crypto.randomUUID(), crypto.randomUUID(), () => active)).rejects.toThrow(
      "accountChanged",
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(network.mock.calls[0][1]).toMatchObject({ mode: "same-origin", redirect: "error" });
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("backup file budget can accommodate escaped records and the entire photo quota", () => {
  const worstCase = {
    id: "x".repeat(80),
    value: {
      name: "\u0001".repeat(160),
      description: "\u0001".repeat(1000),
      categoryId: "y".repeat(80),
      latitude: 1,
      longitude: -1,
      accuracy: 3,
      photoId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  const maxPlaces = 5000 * Buffer.byteLength(JSON.stringify(worstCase, null, 2));
  const photoBytes = 4 * Math.ceil(PHOTO_QUOTA / 3);
  expect(maxPlaces + photoBytes).toBeGreaterThan(80 * 1024 * 1024);
  expect(maxPlaces + photoBytes + 3 * 1024 * 1024).toBeLessThan(BACKUP_BYTES);
});

test("review rejects a category in the private visit ID namespace before importing", () => {
  const category = { name: "A", color: "green" };
  expect(() =>
    validateBackup({
      format: "voltura-places",
      version: 1,
      exportedAt: new Date().toISOString(),
      places: [],
      categories: [
        { id: "other", value: category },
        { id: "visit-fake", value: category },
      ],
    }),
  ).toThrow();
});

test("an RGB JPEG cannot finish with missing chroma components or repeat a sequential scan", async () => {
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  const scan = jpeg.indexOf(Buffer.from([255, 218]));
  const grayscaleScan = Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1]);
  expect(() =>
    jpegDimensions(Buffer.concat([jpeg.subarray(0, scan), grayscaleScan, Buffer.from([255, 217])])),
  ).toThrow("invalidPhoto");
  expect(() => jpegDimensions(Buffer.concat([jpeg.subarray(0, -2), jpeg.subarray(scan)]))).toThrow(
    "invalidPhoto",
  );
});

test.each([200, 403])(
  "overlapping downloads share immutable bytes while cancellation remains per consumer on %i",
  async (status) => {
    vi.stubGlobal("navigator", { onLine: true });
    const key = crypto.randomUUID();
    const id = crypto.randomUUID();
    const jpeg = await readFile("tests/fixtures/photo.jpg");
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await gate;

      return new Response(status === 200 ? jpeg : null, { status });
    });
    let firstActive = true;
    let secondChecks = 0;
    try {
      const first = loadPhoto(key, id, () => firstActive);
      const second = loadPhoto(key, id, () => {
        secondChecks++;

        return true;
      });
      const all = Promise.allSettled([first, second]);
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(secondChecks).toBeGreaterThanOrEqual(2);
      });
      firstActive = false;
      resume();
      const [abandoned, current] = await all;
      expect(abandoned).toMatchObject({
        status: "rejected",
        reason: { message: "accountChanged" },
      });
      if (status === 200) {
        expect(current).toMatchObject({ status: "fulfilled", value: { size: jpeg.length } });
        expect(await getPhoto(key, id)).toBeDefined();
      } else {
        expect(current).toMatchObject({
          status: "rejected",
          reason: { message: "familyAccessEnded" },
        });
        expect(await getPhoto(key, id)).toBeUndefined();
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      resume();
      fetch.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);

test("backup encodes distinct photos concurrently within a four-image window and keeps order", async () => {
  vi.stubGlobal("navigator", { onLine: true });
  const key = crypto.randomUUID();
  const workspace = await readWorkspace(key);
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  let active = 0;
  let peak = 0;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 12));
    active--;

    return new Response(jpeg);
  });
  const ids = Array.from({ length: 7 }, () => crypto.randomUUID());
  const now = new Date().toISOString();
  for (const photoId of ids) {
    workspace.records.push({
      kind: "place",
      id: crypto.randomUUID(),
      value: {
        name: "Export",
        categoryId: "other",
        latitude: 0,
        longitude: 0,
        accuracy: null,
        photoId,
        capturedAt: now,
        updatedAt: now,
      },
      revision: 1,
      generation: 1,
      dirty: false,
      deleted: false,
    });
  }
  try {
    const backup = await exportWithPhotos(workspace);
    expect(backup.photos?.map((p) => p.id)).toEqual(ids);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  } finally {
    fetch.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("source dimensions guard pixel decoding and canvas output avoids decoding its own JPEG again", async () => {
  const jpg = await readFile("tests/fixtures/photo.jpg");
  let width = 20000;
  const decode = vi.fn();
  const bitmap = vi.fn();
  vi.stubGlobal("createImageBitmap", bitmap);
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = width;
      naturalHeight = 10000;
      onload = () => {};
      decode = decode;
      set src(_url: string) {
        this.onload();
      }
    },
  );
  const context = { fillRect: vi.fn(), drawImage: vi.fn() };
  const createElement = vi.fn(() => ({
    getContext: () => context,
    toBlob: (done: (value: Blob) => void) => done(new Blob([jpg], { type: "image/jpeg" })),
  }));
  vi.stubGlobal("document", { createElement });
  try {
    const file = new File([jpg], "fixture.jpg", { type: "image/jpeg" });
    await expect(preparePhoto(file, "guest")).rejects.toThrow("invalidPhoto");
    expect(decode).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    width = 100;
    const id = await preparePhoto(file, "guest");
    expect((await getPhoto("guest", id))?.blob.size).toBe(jpg.length);
    expect(bitmap).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a JPEG without EXIF and a discarded picker do not read a whole original for GPS", async () => {
  const jpg = await readFile("tests/fixtures/photo.jpg");
  const file = new Blob([jpg, new Uint8Array(150000)]);
  const readAll = vi.spyOn(file, "arrayBuffer");
  expect(await photoPosition(file)).toBeNull();
  expect(readAll).not.toHaveBeenCalled();
  const gps = new Blob([await readFile("tests/fixtures/photo-gps.jpg")]);
  const readDiscarded = vi.spyOn(gps, "arrayBuffer");
  expect(await photoPosition(gps, () => false)).toBeNull();
  expect(readDiscarded).not.toHaveBeenCalled();
});

test("oversized backup collections are rejected before individual elements are inspected", () => {
  const places = new Array(5001);
  let inspected = false;
  Object.defineProperty(places, 0, {
    get() {
      inspected = true;

      return {};
    },
  });
  expect(() => validateBackup({ places })).toThrow("invalidImport");
  expect(inspected).toBe(false);
});
