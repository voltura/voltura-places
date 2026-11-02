import { ImportDialog, DevicePlaceTransfer } from "../features/LibraryTransfers";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";
import type { useBackups } from "./useBackups";
import type { Message } from "../foundation/i18n";

export function BackupDialogs({
  backups,
  session,
  workspaceController,
  t,
  notify,
  sync,
  onAdded,
}: {
  backups: ReturnType<typeof useBackups>;
  session: Session;
  workspaceController: WorkspaceController;
  t: (key: Message) => string;
  notify: (key: Message, error?: boolean) => void;
  sync: () => void;
  onAdded: (text: string) => void;
}) {
  const { account } = session;
  const { scope, canWrite, refresh } = workspaceController;
  const { backup, setBackup, reconciling, setReconciling, deferredTransfers } = backups;

  return (
    <>
      {account.account && (reconciling || deferredTransfers.current.has(account.account.id)) && (
        <DevicePlaceTransfer
          key={account.account.id}
          accountId={account.account.id}
          t={t}
          captureOperation={() => session.operations.capture("account").isCurrent}
          onDeferred={() => {
            deferredTransfers.current.add(account.account!.id);
            setReconciling(false);
            void refresh();
            sync();
          }}
          onRetry={() => {
            deferredTransfers.current.delete(account.account!.id);
            setReconciling(true);
          }}
          onComplete={(added) => {
            deferredTransfers.current.delete(account.account!.id);
            setReconciling(false);
            if (added > 0) {
              onAdded(
                t(added === 1 ? "transferAddedOne" : "transferAddedMany").replace(
                  "{count}",
                  String(added),
                ),
              );
            }
            void refresh();
            sync();
          }}
        />
      )}
      {backup && (
        <ImportDialog
          key={scope}
          canWrite={canWrite}
          captureOperation={() => workspaceController.beginWrite().isCurrent}
          backup={backup}
          workspace={scope}
          t={t}
          onClose={() => setBackup(null)}
          onComplete={() => {
            setBackup(null);
            notify("imported");
            void refresh();
            sync();
          }}
        />
      )}
    </>
  );
}
