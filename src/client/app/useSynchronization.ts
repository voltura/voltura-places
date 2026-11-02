import { useCallback, useEffect, useRef, useState } from "react";
import { synchronizeAndWait, temporarySyncFailure, type SyncStatus } from "../foundation/sync";
import { visitOwner } from "../../shared/visits";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";

export function combineSyncStatus(library: SyncStatus, personal: SyncStatus): SyncStatus {
  const priority: SyncStatus[] = [
    "syncConflict",
    "actionRequired",
    "offline",
    "retryUpload",
    "syncPhotoUnavailable",
    "retryRefresh",
    "savedPending",
    "reconcilePending",
    "syncing",
    "pending",
    "synced",
    "localOnly",
  ];

  return priority.find((status) => status === library || status === personal) ?? library;
}

export function useSynchronization(
  session: Session,
  workspace: WorkspaceController,
  reconciling: boolean,
) {
  const { operations, refreshAccount } = session;
  const { scope, refresh } = workspace;
  const [status, setStatus] = useState<SyncStatus>(operations.account ? "pending" : "localOnly");
  const blocked = useRef(reconciling);
  blocked.current = reconciling;
  const active = useRef<{ isCurrent: () => boolean; changed: boolean; done: Promise<void> } | null>(
    null,
  );

  const requestSync = useCallback(
    (changed: boolean) => {
      const current = active.current;
      if (current?.isCurrent()) {
        current.changed ||= changed;

        return current.done;
      }
      const operation = operations.capture();
      const key = operation.workspace;
      if (key === "guest" || blocked.current) {
        return Promise.resolve();
      }
      const pass = { isCurrent: operation.isCurrent, changed: false, done: Promise.resolve() };
      active.current = pass;

      const run = async () => {
        do {
          pass.changed = false;
          let libraryStatus: SyncStatus = "pending";
          await synchronizeAndWait(
            key,
            (result) => {
              libraryStatus = result;
              if (operation.isCurrent()) {
                setStatus(result);
              }
            },
            operation.isCurrent,
          );
          if (!operation.isCurrent()) {
            return;
          }
          const owner = visitOwner(key);
          if (owner !== key) {
            await synchronizeAndWait(
              owner,
              (result) => {
                if (operation.isCurrent()) {
                  setStatus(combineSyncStatus(libraryStatus, result));
                }
              },
              operation.isCurrent,
            );
          }
          if (operation.isCurrent()) {
            await refresh();
          }
        } while (pass.changed && operation.isCurrent() && !blocked.current);
      };

      pass.done = run().finally(() => {
        if (active.current === pass) {
          active.current = null;
        }
      });

      return pass.done;
    },
    [operations, refresh],
  );

  const sync = useCallback(() => {
    void requestSync(true);
  }, [requestSync]);
  const refreshIdentity = useCallback(async () => {
    await refreshAccount();
    await refresh();
  }, [refreshAccount, refresh]);
  useEffect(() => {
    void refreshIdentity().catch(() => {});
  }, [refreshIdentity]);
  useEffect(() => {
    setStatus(scope === "guest" ? "localOnly" : "pending");
    if (scope !== "guest" && !reconciling) {
      void requestSync(false);
    }
  }, [scope, reconciling, requestSync]);
  useEffect(() => {
    let refreshing: Promise<void> | undefined;

    const refreshAndSync = async () => {
      const operation = operations.capture();
      try {
        await refreshIdentity();
      } catch (error) {
        if (operation.isCurrent() && operation.account && !blocked.current) {
          if (temporarySyncFailure(error) && navigator.onLine) {
            // The sync endpoint checks the expected account independently.
            await requestSync(false);
          } else {
            setStatus(navigator.onLine ? "actionRequired" : "offline");
          }
        }

        return;
      }
      if (operation.isCurrent()) {
        await requestSync(false);
      }
    };

    const foreground = () => {
      if (document.visibilityState === "visible" && !refreshing) {
        refreshing = refreshAndSync().finally(() => {
          refreshing = undefined;
        });
      }
    };

    const accountStorageChanged = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "places-account" ||
        event.key === "places-pending-logout"
      ) {
        void refreshAndSync();
      }
    };

    window.addEventListener("online", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("storage", accountStorageChanged);
    document.addEventListener("visibilitychange", foreground);
    const timer = setInterval(foreground, 30000);

    return () => {
      clearInterval(timer);
      window.removeEventListener("online", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("storage", accountStorageChanged);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [operations, refreshIdentity, requestSync]);

  const manualSync = () => {
    if (blocked.current) {
      setStatus("reconcilePending");

      return;
    }
    if (operations.workspace !== "guest") {
      if (!active.current?.isCurrent()) {
        setStatus(navigator.onLine ? "syncing" : "offline");
      }
      void requestSync(false);
    }
  };

  return { status, setStatus, sync, refreshAccount: refreshIdentity, manualSync };
}
