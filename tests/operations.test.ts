import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { Operations } from "../src/client/app/operations";
import { combineSyncStatus } from "../src/client/app/useSynchronization";
import { changeWorkspace, readWorkspace, saveEntity } from "../src/client/foundation/library";
import { synchronize } from "../src/client/foundation/sync";
import type { Entity } from "../src/shared/model";

afterEach(() => vi.unstubAllGlobals());

test("account and workspace operations never revive after an A → B → A transition", () => {
  const operations = new Operations("account-a", "account-a");
  const account = operations.capture("account");
  const workspace = operations.capture();
  operations.changeWorkspace("family:account-a:group");
  expect(account.isCurrent()).toBe(true);
  expect(workspace.isCurrent()).toBe(false);
  operations.changeWorkspace("account-a");
  expect(workspace.isCurrent()).toBe(false);
  const returning = operations.capture();
  operations.changeAccount("account-b");
  operations.changeAccount("account-a");
  expect(account.isCurrent()).toBe(false);
  expect(returning.isCurrent()).toBe(false);
  expect(operations.capture().isCurrent()).toBe(true);
});

test("membership revocation and disposal invalidate pending operations without removing the cached workspace", () => {
  const operations = new Operations("account", "family:account:group");
  const account = operations.capture("account");
  const write = operations.capture();
  operations.invalidateWorkspace();
  expect(operations.workspace).toBe("family:account:group");
  expect(write.isCurrent()).toBe(false);
  expect(account.isCurrent()).toBe(true);
  operations.invalidate();
  expect(account.isCurrent()).toBe(false);
  const beforeDisposal = operations.capture();
  operations.dispose();
  expect(operations.capture().isCurrent()).toBe(false);
  operations.activate();
  expect(beforeDisposal.isCurrent()).toBe(false);
  expect(operations.capture().isCurrent()).toBe(true);
});

test("an invalidated save aborts inside the transaction and retains existing records", async () => {
  vi.stubGlobal("window", new EventTarget());
  const key = `epoch-${crypto.randomUUID()}`;
  const operations = new Operations(key, key);
  const entity: Entity = {
    id: crypto.randomUUID(),
    kind: "place",
    value: {
      name: "Synthetic place",
      categoryId: "other",
      latitude: 0,
      longitude: 0,
      accuracy: null,
      capturedAt: "2026-11-02T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
    },
  };
  await saveEntity(key, entity);
  const original = await readWorkspace(key);
  const operation = operations.capture();
  let checks = 0;

  const valid = () => {
    if (++checks === 2) {
      operations.changeWorkspace("guest");
      operations.changeWorkspace(key);
    }

    return operation.isCurrent();
  };

  await expect(
    saveEntity(
      key,
      { ...entity, value: { ...entity.value, name: "Discarded edit" } },
      entity,
      false,
      valid,
    ),
  ).rejects.toThrow();
  expect((await readWorkspace(key)).records).toEqual(original.records);
});

test("private sync success or progress cannot hide a group failure", () => {
  for (const status of ["synced", "syncing", "pending", "offline"] as const) {
    expect(combineSyncStatus("actionRequired", status)).toBe("actionRequired");
  }
  for (const problem of [
    "syncConflict",
    "retryUpload",
    "retryRefresh",
    "syncPhotoUnavailable",
    "syncSignIn",
    "syncAccessDenied",
    "syncLimitReached",
    "syncHistoryFull",
    "syncInvalidResponse",
    "syncStorageFailed",
  ] as const) {
    expect(combineSyncStatus(problem, "synced")).toBe(problem);
    expect(combineSyncStatus("synced", problem)).toBe(problem);
  }
  expect(combineSyncStatus("offline", "synced")).toBe("offline");
  expect(combineSyncStatus("pending", "synced")).toBe("pending");
  expect(combineSyncStatus("synced", "synced")).toBe("synced");
  expect(combineSyncStatus("syncGroupLocalOnly", "synced")).toBe("syncGroupLocalOnly");
  expect(combineSyncStatus("syncGroupLocalOnly", "retryUpload")).toBe("retryUpload");
});

test("a sync response from the previous visit to an account cannot merge or report success", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  const key = `sync-epoch-${crypto.randomUUID()}`;
  await changeWorkspace(key, (w) => {
    w.reconciled = true;
  });
  const operations = new Operations(key, key);
  const operation = operations.capture();
  let respond!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(() => response);
  const status = vi.fn();
  try {
    const run = synchronize(key, status, operation.isCurrent);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    operations.changeAccount("another-account");
    operations.changeAccount(key);
    respond(
      Response.json({
        version: 1,
        accountId: key,
        records: [
          {
            id: "old-response",
            kind: "category",
            revision: 1,
            deleted: false,
            value: { name: "Synthetic category", color: "slate" },
          },
        ],
      }),
    );
    await run;
    expect((await readWorkspace(key)).records.some((r) => r.id === "old-response")).toBe(false);
    expect(status).not.toHaveBeenCalledWith("synced");
    expect(status).not.toHaveBeenCalledWith("actionRequired");
  } finally {
    fetcher.mockRestore();
  }
});
