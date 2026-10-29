import { useEffect, useRef, useState } from "react";
import { Sheet } from "../ui/Sheet";
import { importBackup, reconcileAccount } from "../foundation/library";
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
}: Common & { accountId: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, [accountId]);
  async function choose(merge: boolean) {
    setBusy(true);
    setError("");
    try {
      const snapshot = await fetchSnapshot(accountId);
      if (!active.current) return;
      await reconcileAccount(accountId, snapshot.records, merge, () => active.current);
      if (active.current) onComplete();
    } catch {
      setError(t("serviceUnavailable"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("reconcileTitle")} onClose={onClose} closeLabel={t("close")}>
      <div className="stack">
        <p className="muted">{t("reconcileBody")}</p>
        {[true, false].map((merge) => (
          <button
            key={String(merge)}
            className={`button ${merge ? "primary" : "outline"}`}
            disabled={busy}
            onClick={() => void choose(merge)}
          >
            {t(merge ? "mergeGuest" : "cloudOnly")}
          </button>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
