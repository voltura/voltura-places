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
  removeWorkspace,
  setDraft,
  getDraft,
  flushDrafts,
} from "../src/client/foundation/library";
import { makeStoredPhoto, putPhotos, getPhoto } from "../src/client/foundation/photo-store";

test("removing device data drains queued family drafts before enumerating account partitions", async () => {
  vi.stubGlobal("window", new EventTarget());
  const account = crypto.randomUUID();
  const key = familyKey(account, crypto.randomUUID());
  const originalOpen = IDBFactory.prototype.open;
  let release: (() => void) | undefined;
  const opening = vi.spyOn(IDBFactory.prototype, "open").mockImplementationOnce(function (
    this: IDBFactory,
    name,
    version,
  ) {
    const request = originalOpen.call(this, name, version);
    const add = request.addEventListener.bind(request);
    request.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (!listener) {
        return;
      }
      if (type !== "success") {
        return add(type, listener, options);
      }
      add(
        type,
        (event) => {
          release = () => {
            if (typeof listener === "function") {
              listener.call(request, event);
            } else {
              listener.handleEvent(event);
            }
          };
        },
        options,
      );
    }) as typeof request.addEventListener;

    return request;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = setDraft(key, { name: "Uncommitted family draft" });
    await vi.waitFor(() => expect(release).toBeDefined());
    const removing = removeAccountWorkspaces(account);
    // The old remover finishes before this gated draft. The repaired remover
    // waits for it; release that wait without depending on transaction timing.
    void removing.then(() => release!());
    timer = setTimeout(() => release!(), 200);
    await removing;
    await pending;
    await flushDrafts();
    expect(await getDraft(key)).toBeUndefined();
  } finally {
    clearTimeout(timer);
    release?.();
    opening.mockRestore();
  }
});

test("single-group cache upgrades and keeps independent active and archived group selections", () => {
  const values = new Map<string, string>();
  const account = crypto.randomUUID();
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
  };
  const second = { ...first, id: crypto.randomUUID(), name: "Mother's group" };
  try {
    storage.setItem(`places-family:${account}`, JSON.stringify({ family: first, active: true }));
    expect(cachedFamily(account).families).toEqual([first]);
    storeFamilies(account, [first, second]);
    storage.setItem(`places-workspace:${account}`, familyKey(account, second.id));
    expect(initialWorkspace(account)).toBe(familyKey(account, second.id));
    const after = storeFamilies(account, [second]);
    expect(after.families).toEqual([second]);
    expect(after.inactive).toEqual([{ ...first, ownerId: "", members: [], requests: [] }]);
    const writes = vi.spyOn(storage, "setItem");
    expect(storeFamilies(account, [structuredClone(second)], after)).toBe(after);
    expect(writes).not.toHaveBeenCalled();
    storage.setItem(`places-workspace:${account}`, familyKey(account, first.id));
    expect(initialWorkspace(account)).toBe(familyKey(account, first.id));
    expect(cachedFamily(crypto.randomUUID()).families).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("one corrupt group cannot hide valid cached groups, and active groups take precedence over archived duplicates", () => {
  const group = { id: crypto.randomUUID(), name: "Group", ownerId: "a", members: [], requests: [] };
  const archived = { ...group, id: crypto.randomUUID() };
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ families: [null, group, group], inactive: [group, archived] }),
  });
  try {
    expect(cachedFamily("a")).toEqual({
      families: [group],
      inactive: [{ ...archived, ownerId: "" }],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a tab's unchanged membership poll retains another tab's newly archived library", () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  const first = { id: crypto.randomUUID(), name: "First", ownerId: "a", members: [], requests: [] };
  const another = { ...first, id: crypto.randomUUID(), name: "Second" };
  try {
    const old = storeFamilies("a", [first]);
    storeFamilies("a", [first, another]);
    storeFamilies("a", [first]);
    expect(storeFamilies("a", [first], old).inactive).toEqual([{ ...another, ownerId: "" }]);
    expect(cachedFamily("a").inactive).toEqual([{ ...another, ownerId: "" }]);
  } finally {
    vi.unstubAllGlobals();
  }
});
test.each(["private", "group"])(
  "%s copies preserve originals and keep account-owned local queues/photos separate",
  async (sourceKind) => {
    vi.stubGlobal("window", new EventTarget());
    const account = crypto.randomUUID();
    const source = sourceKind === "group" ? familyKey(account, crypto.randomUUID()) : account;
    const other = crypto.randomUUID();
    const group = crypto.randomUUID();
    const key = familyKey(account, group);
    const otherKey = familyKey(other, group);
    const id = crypto.randomUUID();
    const photoId = crypto.randomUUID();
    const categoryId = crypto.randomUUID();
    await saveEntity(source, {
      id: categoryId,
      kind: "category",
      value: { name: "Chanterelles", color: "amber" },
    });
    await putPhotos([
      await makeStoredPhoto(
        source,
        photoId,
        new Blob([await readFile("tests/fixtures/photo.jpg")]),
      ),
    ]);
    await saveEntity(source, {
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
    const copy = await copyPlaceToWorkspace(source, key, id);
    expect(copy.reconciled).toBe(true);
    const place = copy.records.find((r) => r.kind === "place")!;
    expect(place.id).not.toBe(id);
    expect(place.dirty).toBe(true);
    expect(copy.records.some((r) => r.kind === "category" && r.value.name === "Chanterelles")).toBe(
      true,
    );
    expect((await readWorkspace(source)).records.some((r) => r.id === id)).toBe(true);
    expect((await getPhoto(key, photoId))?.uploaded).toBe(false);
    expect((await readWorkspace(otherKey)).records.some((r) => r.kind === "place")).toBe(false);
    expect(await getPhoto(otherKey, photoId)).toBeUndefined();
    expect(workspaceHeaders(key)).toEqual({
      "X-Places-Account": account,
      "X-Places-Family": group,
    });
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
    expect(
      (await readWorkspace(other)).records.some(
        (r) => r.kind !== "visit" && r.value.name === "Keep me",
      ),
    ).toBe(true);
  },
);

test("archiving a group removes cached participant and applicant identities while keeping its offline library discoverable", () => {
  const group = {
    id: crypto.randomUUID(),
    name: "Library",
    ownerId: "former-owner",
    invitationVersion: "a".repeat(64),
    members: [{ id: "person", label: "member@example.test" }],
    requests: [{ id: "request", label: "applicant@example.test" }],
  };
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    const active = storeFamilies("member", [group]);
    storeFamilies("member", [], active);
    const raw = values.get("places-family:member")!;
    expect(raw).not.toContain("example.test");
    expect(raw).not.toContain("former-owner");
    expect(raw).not.toContain("invitationVersion");
    expect(cachedFamily("member").inactive[0]).toMatchObject({ id: group.id, name: "Library" });
  } finally {
    vi.unstubAllGlobals();
  }
});

test("deliberately deleted groups stay discarded across stale caches without hiding other recovery copies", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const account = crypto.randomUUID();
  const deleted = {
    id: crypto.randomUUID(),
    name: "Deleted",
    ownerId: account,
    members: [],
    requests: [],
  };
  const retained = { ...deleted, id: crypto.randomUUID(), name: "Retained" };
  try {
    const stale = storeFamilies(account, [deleted, retained]);
    const after = storeFamilies(account, [retained], stale, deleted.id);
    expect(after.inactive).toEqual([]);
    expect(after.discarded).toEqual([deleted.id]);
    const later = storeFamilies(account, [], stale);
    expect(later.inactive.map((group) => group.id)).toEqual([retained.id]);
    expect(later.discarded).toEqual([deleted.id]);
    const staleResponse = storeFamilies(account, [deleted, retained], stale);
    expect(staleResponse.families.map((group) => group.id)).toEqual([retained.id]);
    expect(cachedFamily(account).inactive).toEqual([]);
    values.set(`places-workspace:${account}`, familyKey(account, deleted.id));
    expect(initialWorkspace(account)).toBe(account);
    expect(cachedFamily(crypto.randomUUID()).discarded).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("deleting one local group copy removes its records, draft and photos while preserving other partitions", async () => {
  vi.stubGlobal("window", new EventTarget());
  const account = crypto.randomUUID();
  const group = crypto.randomUUID();
  const key = familyKey(account, group);
  const sibling = familyKey(account, crypto.randomUUID());
  const otherAccount = familyKey(crypto.randomUUID(), group);
  const photoId = crypto.randomUUID();
  const place = {
    id: crypto.randomUUID(),
    kind: "place" as const,
    value: {
      name: "Fixture",
      categoryId: "other",
      latitude: 0,
      longitude: 0,
      accuracy: null,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  try {
    for (const workspace of [key, sibling, otherAccount, account]) {
      await saveEntity(workspace, place);
      await setDraft(workspace, { name: "Fixture draft" });
      await putPhotos([
        await makeStoredPhoto(
          workspace,
          photoId,
          new Blob([await readFile("tests/fixtures/photo.jpg")]),
        ),
      ]);
    }
    await removeWorkspace(key);
    expect((await readWorkspace(key)).records.some((record) => record.kind === "place")).toBe(
      false,
    );
    expect(await getDraft(key)).toBeUndefined();
    expect(await getPhoto(key, photoId)).toBeUndefined();
    for (const workspace of [sibling, otherAccount, account]) {
      expect(
        (await readWorkspace(workspace)).records.some((record) => record.id === place.id),
      ).toBe(true);
      expect(await getDraft(workspace)).toBeDefined();
      expect(await getPhoto(workspace, photoId)).toBeDefined();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
