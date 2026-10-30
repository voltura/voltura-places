import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/Sheet";
import { importBackup, devicePlacePlan, reconcileDevicePlaces } from "../foundation/library";
import { fetchSnapshot } from "../foundation/sync";
import type { Backup } from "../../shared/model";
import type { Message } from "../foundation/i18n";
type Common = { t: (key: Message) => string; onClose: () => void; onComplete: () => void };
export function ImportDialog({
  backup,
  workspace,
  t,
  onClose,
  onComplete,
}: Common & { backup: Backup; workspace: string }) {
  const [replace, setReplace] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [workspace]);
  async function apply() {
    if (replace && !confirm(t("confirmReplace"))) return;
    setBusy(true);
    setError("");
    try {
      await importBackup(workspace, backup, replace, () => active.current);
      if (active.current) onComplete();
    } catch (e) {
      setError(t(e instanceof Error && e.message === "syncBusy" ? "syncBusy" : "storageFailure"));
    } finally {
      setBusy(false);
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
          <input type="radio" checked={!replace} onChange={() => setReplace(false)} />
          <span>
            <strong>{t("merge")}</strong>
            <small>{t("mergeBody")}</small>
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={replace} onChange={() => setReplace(true)} />
          <span>
            <strong>{t("replace")}</strong>
            <small>{t("replaceBody")}</small>
          </span>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy} onClick={() => void apply()}>
          {t(busy ? "working" : "import")}
        </button>
      </div>
    </Sheet>
  );
}
export function ReconcileDialog({
  accountId,
  t,
  onClose,
  onComplete,
}: Omit<Common, "onComplete"> & { accountId: string; onComplete: (added: number) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(true),
    [hasPlaces, setHasPlaces] = useState(false),
    [attempt, setAttempt] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    let current = true;
    void (async () => {
      try {
        const plan = await devicePlacePlan(accountId);
        if (!current) return;
        setHasPlaces(plan.ask);
        if (!plan.ask) await choose("auto", () => current);
      } catch {
        if (current) setError(t("storageFailure"));
      } finally {
        if (current) setChecking(false);
      }
    })();
    return () => {
      current = false;
      active.current = false;
    };
  }, [accountId, attempt]);
  async function choose(decision: "auto" | "copy" | "skip", isCurrent = () => active.current) {
    setBusy(true);
    setError("");
    try {
      const snapshot = await fetchSnapshot(accountId);
      if (!isCurrent()) return;
      const added = await reconcileDevicePlaces(accountId, snapshot.records, decision, isCurrent);
      if (isCurrent()) onComplete(added);
    } catch (error) {
      if (isCurrent()) {
        if (error instanceof Error && error.message === "accountChoiceRequired") setHasPlaces(true);
        else setError(t("serviceUnavailable"));
      }
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  if (checking || (!hasPlaces && !error)) return null;
  return (
    <Sheet
      title={t(hasPlaces ? "reconcileTitle" : "privateLibrary")}
      onClose={onClose}
      closeLabel={t("signOut")}
    >
      <div className="stack">
        {hasPlaces && <p className="muted">{t("reconcileBody")}</p>}
        {(hasPlaces ? [true, false] : [false]).map((merge) => (
          <button
            key={String(merge)}
            className={`button ${merge ? "primary" : "outline"}`}
            disabled={busy}
            onClick={() => {
              if (hasPlaces) void choose(merge ? "copy" : "skip");
              else {
                setChecking(true);
                setError("");
                setAttempt((value) => value + 1);
              }
            }}
          >
            {t(hasPlaces ? (merge ? "mergeGuest" : "cloudOnly") : "retry")}
          </button>
        ))}
        <p className="muted small">{t("reconcileCloseHint")}</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
