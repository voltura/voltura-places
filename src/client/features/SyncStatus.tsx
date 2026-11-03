import { Check, RefreshCw, CloudOff, TriangleAlert, Clock3 } from "lucide-react";
import type { Message } from "../foundation/i18n";

export function syncStatusWarning(status: Message) {
  return [
    "actionRequired",
    "syncSignIn",
    "syncAccessDenied",
    "syncLimitReached",
    "syncHistoryFull",
    "syncInvalidResponse",
    "syncStorageFailed",
    "syncConflict",
    "retryRefresh",
    "retryUpload",
    "syncPhotoUnavailable",
  ].includes(status);
}

export function syncStatusDetail(status: Message): Message | undefined {
  const details: Partial<Record<Message, Message>> = {
    actionRequired: "syncFailedDetail",
    syncGroupLocalOnly: "syncGroupLocalDetail",
    syncSignIn: "syncSignInDetail",
    syncAccessDenied: "syncAccessDeniedDetail",
    syncLimitReached: "syncLimitDetail",
    syncHistoryFull: "syncHistoryDetail",
    syncInvalidResponse: "syncInvalidDetail",
    syncStorageFailed: "syncStorageDetail",
    retryRefresh: "syncRetryDetail",
    retryUpload: "syncRetryDetail",
    offline: "syncOfflineDetail",
    syncPhotoUnavailable: "syncPhotoDetail",
    syncConflict: "syncConflictDetail",
    pending: "syncPendingDetail",
    reconcilePending: "syncReconcileDetail",
    savedPending: "syncPendingDetail",
  };

  return details[status];
}

export function SyncStatusIcon({ status }: { status: Message }) {
  const Icon =
    status === "synced"
      ? Check
      : status === "syncing"
        ? RefreshCw
        : status === "offline"
          ? CloudOff
          : syncStatusWarning(status)
            ? TriangleAlert
            : Clock3;

  return (
    <Icon size={18} className={status === "syncing" ? "spin" : undefined} aria-hidden="true" />
  );
}
