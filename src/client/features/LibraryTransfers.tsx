import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/Sheet";
import {
  importBackup,
  devicePlacePlan,
  reconcileDevicePlaces,
  finishDevicePlaceTransfer,
  initializePrivateAccount,
} from "../foundation/library";
import { fetchSnapshot, synchronizeAndWait } from "../foundation/sync";
import type { Backup } from "../../shared/model";
import { libraryErrorMessage, type Message } from "../foundation/i18n";

type Common = { t: (key: Message) => string; onClose: () => void; onComplete: () => void };

export function ImportDialog({
  backup,
  workspace,
  canWrite,
  t,
  onClose,
  onComplete,
  captureOperation,
}: Common & {
  backup: Backup;
  workspace: string;
  canWrite: boolean;
  captureOperation?: () => () => boolean;
}) {
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const writeAllowed = useRef(canWrite);
  writeAllowed.current = canWrite;
  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, [workspace]);

  async function apply() {
    if (!writeAllowed.current) {
      return;
    }
    if (replace && !confirm(t("confirmReplace"))) {
      return;
    }
    setBusy(true);
    setError("");
    const valid = captureOperation?.() ?? (() => true);

    const isCurrent = () => active.current && writeAllowed.current && valid();

    try {
      await importBackup(workspace, backup, replace, isCurrent);
      if (isCurrent()) {
        onComplete();
      }
    } catch (e) {
      if (isCurrent()) {
        setError(t(libraryErrorMessage(e)));
      }
    } finally {
      if (active.current) {
        setBusy(false);
      }
    }
  }

  return (
    <Sheet title={t("importTitle")} onClose={onClose} closeLabel={t("close")}>
      <div className="stack">
        <p>
          {backup.places.length} {t("places")} · {backup.categories.length}{" "}
          {t("categories").toLowerCase()}
        </p>
        <p className="muted">{t("importDescription")}</p>
        <label className="radio-card">
          <input
            type="radio"
            name="backup-import-mode"
            disabled={busy || !canWrite}
            checked={!replace}
            onChange={() => setReplace(false)}
          />
          <span>
            <strong>{t("merge")}</strong>
            <small>{t("mergeBody")}</small>
          </span>
        </label>
        <label className="radio-card">
          <input
            type="radio"
            name="backup-import-mode"
            disabled={busy || !canWrite}
            checked={replace}
            onChange={() => setReplace(true)}
          />
          <span>
            <strong>{t("replace")}</strong>
            <small>{t("replaceBody")}</small>
          </span>
        </label>
        {(error || !canWrite) && (
          <p className="error" role="alert">
            {canWrite ? error : t("familyAccessEnded")}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !canWrite}
          onClick={() => void apply()}
        >
          {t(busy ? "working" : "import")}
        </button>
      </div>
    </Sheet>
  );
}

export function DevicePlaceTransfer({
  accountId,
  t,
  onComplete,
  onDeferred,
  onRetry,
  captureOperation,
}: {
  accountId: string;
  t: (key: Message) => string;
  onComplete: (added: number) => void;
  onDeferred: () => void;
  onRetry: () => void;
  captureOperation?: () => () => boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [deferred, setDeferred] = useState(false);
  const callbacks = useRef({ t, onComplete, onDeferred, onRetry });
  callbacks.current = { t, onComplete, onDeferred, onRetry };
  useEffect(() => {
    let current = true;
    const valid = captureOperation?.() ?? (() => true);

    const isCurrent = () => current && valid();

    setBusy(true);
    void (async () => {
      try {
        if (!(await devicePlacePlan(accountId)).needed) {
          if (isCurrent()) {
            callbacks.current.onComplete(0);
          }

          return;
        }
        const snapshot = await fetchSnapshot(accountId, isCurrent);
        if (!isCurrent()) {
          return;
        }
        await initializePrivateAccount(accountId, snapshot.records, isCurrent);
        await reconcileDevicePlaces(accountId, snapshot.records, "auto", isCurrent);
        if (!(await devicePlacePlan(accountId)).pending) {
          if (isCurrent()) {
            callbacks.current.onComplete(0);
          }

          return;
        }
        await synchronizeAndWait(accountId, () => {}, isCurrent);
        if (!isCurrent()) {
          return;
        }
        const completed = await finishDevicePlaceTransfer(accountId, isCurrent);
        if ((await devicePlacePlan(accountId)).pending) {
          throw new Error("transferSaveFailed");
        }
        if (isCurrent()) {
          callbacks.current.onComplete(completed);
        }
      } catch (error) {
        if (isCurrent()) {
          setError(callbacks.current.t(libraryErrorMessage(error, "transferSaveFailed")));
        }
      } finally {
        if (isCurrent()) {
          setBusy(false);
        }
      }
    })();

    return () => {
      current = false;
    };
  }, [accountId, attempt]);
  if (!error) {
    return null;
  }

  return (
    <section
      className="device-transfer-notice"
      role={busy || deferred ? "status" : "alert"}
      aria-label={t("privateLibrary")}
    >
      <p>{t(deferred ? "transferDeferred" : busy ? "reconcilePending" : "transferSaveFailed")}</p>
      {!busy && !deferred && error !== t("transferSaveFailed") && (
        <p className="muted small">{error}</p>
      )}
      <button
        className="button outline"
        disabled={busy}
        onClick={() => {
          callbacks.current.onRetry();
          setDeferred(false);
          setAttempt((value) => value + 1);
        }}
      >
        {t(busy ? "working" : "retry")}
      </button>
      {!deferred && (
        <button
          className="button outline"
          disabled={busy}
          onClick={() => {
            setDeferred(true);
            callbacks.current.onDeferred();
          }}
        >
          {t("skipTransfer")}
        </button>
      )}
    </section>
  );
}
