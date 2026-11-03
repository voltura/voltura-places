import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  synchronizeAndWait,
  temporarySyncFailure,
  syncFailureStatus,
  type SyncStatus,
} from "../foundation/sync";
import { visitOwner } from "../../shared/visits";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";

export function combineSyncStatus(library: SyncStatus, personal: SyncStatus): SyncStatus {
  const priority: SyncStatus[] = [
    "syncConflict",
    "actionRequired",
    "syncSignIn",
    "syncAccessDenied",
    "syncLimitReached",
    "syncHistoryFull",
    "syncInvalidResponse",
    "syncStorageFailed",
    "offline",
    "retryUpload",
    "syncPhotoUnavailable",
    "retryRefresh",
    "savedPending",
    "reconcilePending",
    "syncing",
    "pending",
    "syncGroupLocalOnly",
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
  const { scope, refresh, canWrite, canWriteNow } = workspace;
  const discardStaleIdentity = useEffectEvent(session.discardStaleIdentity);
  const [status, updateStatus] = useState<SyncStatus>(operations.account ? "pending" : "localOnly");
  const latestStatus = useRef(status);
  const setStatus = useCallback((next: SyncStatus) => {
    latestStatus.current = next;
    updateStatus(next);
  }, []);
  const blocked = useRef(reconciling);
  blocked.current = reconciling;
  const active = useRef<{
    isCurrent: () => boolean;
    changed: boolean;
    writable: boolean;
    cancelled: boolean;
    done: Promise<void>;
  } | null>(null);

  const requestSync = useCallback(
    (changed: boolean) => {
      const current = active.current;
      if (current?.isCurrent()) {
        current.changed ||= changed || current.writable !== canWriteNow();

        return current.done;
      }
      const operation = operations.capture();
      const key = operation.workspace;
      if (key === "guest" || blocked.current) {
        return Promise.resolve();
      }
      const pass = {
        isCurrent: (): boolean => !pass.cancelled && !blocked.current && operation.isCurrent(),
        cancelled: false,
        changed: false,
        writable: canWriteNow(),
        done: Promise.resolve(),
      };
      active.current = pass;

      const run = async () => {
        do {
          pass.changed = false;
          const owner = visitOwner(key);
          let libraryStatus: SyncStatus = "syncGroupLocalOnly";
          pass.writable = canWriteNow();
          if (pass.writable) {
            await synchronizeAndWait(
              key,
              (result) => {
                libraryStatus = result;
                if (pass.isCurrent()) {
                  setStatus(owner === key ? result : combineSyncStatus(result, "syncing"));
                }
              },
              pass.isCurrent,
            );
          } else {
            setStatus(libraryStatus);
          }
          if (!pass.isCurrent()) {
            return;
          }
          if (owner !== key) {
            await synchronizeAndWait(
              owner,
              (result) => {
                if (pass.isCurrent()) {
                  setStatus(combineSyncStatus(libraryStatus, result));
                }
              },
              pass.isCurrent,
            );
          }
          if (pass.isCurrent()) {
            await refresh();
          }
        } while (pass.changed && pass.isCurrent() && !blocked.current);
      };

      pass.done = run().finally(() => {
        if (active.current === pass) {
          active.current = null;
        }
      });

      return pass.done;
    },
    [operations, refresh, canWriteNow],
  );

  const sync = useCallback(() => {
    void requestSync(true);
  }, [requestSync]);
  const refreshIdentity = useCallback(async () => {
    await refreshAccount();
    await refresh();
  }, [refreshAccount, refresh]);
  useEffect(() => {
    void refreshAccount().catch(() => {});
  }, [refreshAccount]);
  useEffect(() => {
    if (reconciling && active.current) {
      active.current.cancelled = true;
    }
    setStatus(scope === "guest" ? "localOnly" : reconciling ? "reconcilePending" : "pending");
    if (scope !== "guest" && !reconciling) {
      void requestSync(false);
    }
  }, [scope, reconciling, canWrite, requestSync]);
  useEffect(() => {
    let refreshing: Promise<void> | undefined;

    const refreshAndSync = async () => {
      const operation = operations.capture();
      try {
        await refreshAccount();
      } catch (error) {
        if (operation.isCurrent() && operation.account && !blocked.current) {
          if (temporarySyncFailure(error) && navigator.onLine) {
            // The sync endpoint checks the expected account independently.
            await requestSync(false);
          } else {
            setStatus(syncFailureStatus(error));
          }
        }

        return;
      }
      if (operation.isCurrent()) {
        if (operation.workspace === "guest" || blocked.current) {
          await refresh();
        } else {
          await requestSync(false);
        }
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
        discardStaleIdentity();
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
  }, [operations, refreshAccount, refresh, requestSync]);

  const manualSync = async () => {
    const operation = operations.capture();
    if (blocked.current) {
      setStatus("reconcilePending");

      return "reconcilePending" as const;
    }
    if (operations.workspace !== "guest") {
      if (!active.current?.isCurrent()) {
        setStatus(navigator.onLine ? "syncing" : "offline");
      }
      try {
        await requestSync(true);
      } catch (error) {
        if (operation.isCurrent()) {
          setStatus(syncFailureStatus(error));
        }
      }
    }

    return operation.isCurrent() ? latestStatus.current : undefined;
  };

  return { status, setStatus, sync, refreshAccount: refreshIdentity, manualSync };
}
