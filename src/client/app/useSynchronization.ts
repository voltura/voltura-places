import { useCallback, useEffect, useRef, useState } from "react";
import { synchronize, type SyncStatus } from "../foundation/sync";
import { visitOwner } from "../../shared/visits";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";

export function combineSyncStatus(library: SyncStatus, personal: SyncStatus): SyncStatus {
  if (library === "actionRequired" || personal === "actionRequired") {
    return "actionRequired";
  }
  if (library === "offline" || personal === "offline") {
    return "offline";
  }
  if (personal === "syncing") {
    return "syncing";
  }

  return personal === "synced" ? library : personal;
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
  const sync = useCallback(() => {
    const operation = operations.capture();
    const key = operation.workspace;
    if (key === "guest") {
      return;
    }
    let libraryStatus: SyncStatus = "pending";
    void synchronize(
      key,
      (s) => {
        libraryStatus = s;
        if (operation.isCurrent()) {
          setStatus(s);
        }
      },
      operation.isCurrent,
    ).then(async () => {
      if (!operation.isCurrent()) {
        return;
      }
      const owner = visitOwner(key);
      if (owner !== key) {
        await synchronize(
          owner,
          (s) => {
            if (operation.isCurrent()) {
              setStatus(combineSyncStatus(libraryStatus, s));
            }
          },
          operation.isCurrent,
        );
      }
      if (operation.isCurrent()) {
        await refresh();
      }
    });
  }, [operations, refresh]);
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
      sync();
    }
  }, [scope, reconciling, sync]);
  useEffect(() => {
    const foreground = () => {
      if (document.visibilityState === "visible") {
        void refreshIdentity()
          .then(() => {
            if (!blocked.current) {
              sync();
            }
          })
          .catch(() => {});
      }
    };

    const accountStorageChanged = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "places-account" ||
        event.key === "places-pending-logout"
      ) {
        void refreshIdentity()
          .then(() => {
            if (!blocked.current) {
              sync();
            }
          })
          .catch(() => {});
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
  }, [refreshIdentity, sync]);

  const manualSync = () => {
    if (blocked.current) {
      setStatus("reconcilePending");

      return;
    }
    if (operations.workspace !== "guest") {
      setStatus(navigator.onLine ? "syncing" : "offline");
      sync();
    }
  };

  return { status, setStatus, sync, refreshAccount: refreshIdentity, manualSync };
}
