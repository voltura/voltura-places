import { Check, RefreshCw, CloudOff, TriangleAlert, Clock3 } from "lucide-react";
import type { Message } from "../foundation/i18n";

export function syncStatusWarning(status: Message) {
  return [
    "actionRequired",
    "syncConflict",
    "retryRefresh",
    "retryUpload",
    "syncPhotoUnavailable",
  ].includes(status);
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
