import { useCallback, useEffect, useRef, useState } from "react";
import { BACKUP_BYTES } from "../../shared/photos";
import { validateBackup, type Backup } from "../../shared/model";
import { exportWithPhotos } from "../foundation/photo-backup";
import { devicePlacePlan, readWorkspace } from "../foundation/library";
import type { Message } from "../foundation/i18n";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";

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
    const plan = await devicePlacePlan(operation.account);
    if (operation.isCurrent()) {
      setReconciling(
        (previous) =>
          !deferredTransfers.current.has(operation.account!) && (plan.needed || previous),
      );
      setCheckedAccount(operation.account);
    }
  }, [operations]);
  useEffect(() => {
    void checkTransfer().catch(() => {});
  }, [session.account.account?.id, workspace.workspace, checkTransfer]);

  async function download(key = operations.workspace) {
    const operation = operations.capture("account");
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
    }
  }

  async function loadFile(file?: File) {
    if (!file) {
      return;
    }
    const operation = workspace.beginWrite();
    try {
      if (file.size > BACKUP_BYTES) {
        callbacks.current.notify("importLimit", true);

        return;
      }
      const parsed = validateBackup(JSON.parse(await file.text()));
      if (!operation.isCurrent()) {
        return;
      }
      setBackup(parsed);
      callbacks.current.onImport();
    } catch {
      if (operation.isCurrent()) {
        callbacks.current.notify("invalidImport", true);
      }
    }
  }

  const reset = () => {
    setBackup(null);
    setReconciling(false);
    setCheckedAccount(undefined);
  };

  const accountId = session.account.account?.id;

  return {
    backup,
    setBackup,
    reconciling: !!accountId && (checkedAccount !== accountId || reconciling),
    setReconciling,
    deferredTransfers,
    checkTransfer,
    download,
    loadFile,
    reset,
  };
}
