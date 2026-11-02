import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceIdentity } from "../../shared/families";
import { BACKUP_BYTES } from "../../shared/photos";
import { validateBackup, type Backup } from "../../shared/model";
import { exportWithPhotos } from "../foundation/photo-backup";
import { devicePlacePlan, readWorkspace } from "../foundation/library";
import type { Message } from "../foundation/i18n";
import type { Session } from "./useSession";
import { observeWorkspaceChanges, type WorkspaceController } from "./useWorkspace";

export function useBackups(
  session: Session,
  workspace: WorkspaceController,
  notify: (key: Message, error?: boolean) => void,
  onImport: () => void,
) {
  const { operations } = session;
  const [backup, setBackup] = useState<Backup | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [checkedAccount, setCheckedAccount] = useState<string | undefined>(undefined);
  const exportsInProgress = useRef(new Map<string, { isCurrent: () => boolean }>());
  const fileRequest = useRef(0);
  const planRequest = useRef(0);
  const deferredTransfers = useRef(new Set<string>());
  const callbacks = useRef({ notify, onImport });
  callbacks.current = { notify, onImport };
  const checkTransfer = useCallback(async () => {
    const operation = operations.capture("account");
    if (!operation.account) {
      setReconciling(false);
      setCheckedAccount(undefined);

      return;
    }
    const request = ++planRequest.current;
    const plan = await devicePlacePlan(operation.account);
    if (operation.isCurrent() && request === planRequest.current) {
      setReconciling(
        (previous) =>
          !deferredTransfers.current.has(operation.account!) && (plan.needed || previous),
      );
      setCheckedAccount(operation.account);
    }
  }, [operations]);
  useEffect(() => {
    if (!session.account.account) {
      return;
    }

    const check = () => void checkTransfer().catch(() => {});

    return observeWorkspaceChanges(["guest"], check);
  }, [session.account.account?.id, checkTransfer]);

  const accountId = session.account.account?.id;
  const privateReconciled = workspace.personalWorkspace?.reconciled;
  useEffect(() => {
    if (
      accountId &&
      checkedAccount === accountId &&
      privateReconciled === false &&
      !deferredTransfers.current.has(accountId)
    ) {
      setReconciling(true);
    }
  }, [accountId, checkedAccount, privateReconciled]);

  async function download(key = operations.workspace) {
    const operation = operations.capture("account");
    if (
      workspaceIdentity(key).account !== (operation.account ?? "guest") ||
      exportsInProgress.current.get(key)?.isCurrent()
    ) {
      return;
    }
    exportsInProgress.current.set(key, operation);
    try {
      const exporting = await readWorkspace(key);
      if (!operation.isCurrent()) {
        return;
      }
      const exported = await exportWithPhotos(exporting, operation.isCurrent);
      if (!operation.isCurrent()) {
        return;
      }
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `voltura-places-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      callbacks.current.notify("exported");
    } catch {
      if (operation.isCurrent()) {
        callbacks.current.notify("exportFailed", true);
      }
    } finally {
      if (exportsInProgress.current.get(key) === operation) {
        exportsInProgress.current.delete(key);
      }
    }
  }

  async function loadFile(file?: File) {
    if (!file) {
      return;
    }
    const operation = workspace.beginWrite();
    const request = ++fileRequest.current;

    const isCurrent = () => operation.isCurrent() && request === fileRequest.current;

    if (!isCurrent()) {
      return;
    }
    try {
      if (file.size > BACKUP_BYTES) {
        callbacks.current.notify("importLimit", true);

        return;
      }
      const text = await file.text();
      if (!isCurrent()) {
        return;
      }
      setBackup(validateBackup(JSON.parse(text)));
      callbacks.current.onImport();
    } catch {
      if (isCurrent()) {
        callbacks.current.notify("invalidImport", true);
      }
    }
  }

  const reset = (reason: "account" | "workspace") => {
    setBackup(null);
    if (reason === "account") {
      deferredTransfers.current.clear();
      setReconciling(false);
      setCheckedAccount(undefined);
    }
  };

  return {
    backup,
    setBackup,
    reconciling: !!accountId && (checkedAccount !== accountId || reconciling),
    setReconciling: (pending: boolean) => {
      planRequest.current++;
      setCheckedAccount(operations.account);
      setReconciling(pending);
    },
    deferredTransfers,
    download,
    loadFile,
    reset,
  };
}
