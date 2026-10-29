import { useEffect, useState } from "react";
import { Users, Copy, UserPlus } from "lucide-react";
import { z } from "zod";
import { api, type Account } from "../foundation/sync";
import { type FamilyCache } from "../foundation/family";
import { familyStateSchema, type Family } from "../../shared/families";
import { type Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";
const knownError = (error: unknown): Message =>
  error instanceof Error &&
  [
    "familyAlreadyJoined",
    "invalidFamilyInvite",
    "familyFull",
    "familyTransferFirst",
    "familyOwnerOnly",
    "familyAccessEnded",
    "invalidFamilyAction",
  ].includes(error.message)
    ? (error.message as Message)
    : "serviceUnavailable";
type Props = {
  account: Account | null;
  cache: FamilyCache;
  t: (key: Message) => string;
  onChanged: (family: Family | null) => void;
  onOpen: () => void;
  onSignIn: () => void;
  onExport: () => void;
};
export function FamilyPanel({ account, cache, t, onChanged, onOpen, onSignIn, onExport }: Props) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Message | null>(null),
    [invite, setInvite] = useState(""),
    [copied, setCopied] = useState(false);
  const family = cache.active ? cache.family : null;
  const action = async (body: unknown) => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const response = familyStateSchema.parse(await api("/api/family", body, account.id));
      onChanged(response.family);
      setInvite("");
    } catch (e) {
      setError(knownError(e));
    } finally {
      setBusy(false);
    }
  };
  const createInvite = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const data = z
        .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .parse(await api("/api/family", { action: "invite" }, account.id));
      setInvite(`${location.origin}/#family=${data.token}`);
      setCopied(false);
    } catch (e) {
      setError(knownError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="stack family-panel">
      <div className="section-icon">
        <Users />
      </div>
      <h3>{t("familySharing")}</h3>
      <p className="muted">{t("familyIntro")}</p>
      {!account ? (
        <button className="button primary" onClick={onSignIn}>
          {t("familySignIn")}
        </button>
      ) : family ? (
        <>
          <h4>{family.name}</h4>
          <p className="notice">{t("familySharedNotice")}</p>
          <button className="button primary" onClick={onOpen}>
            {t("openFamilyLibrary")}
          </button>
          <ul className="family-members">
            {family.members.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.label}</strong>
                  {member.id === family.ownerId && (
                    <span className="muted small">{t("familyOwner")}</span>
                  )}
                </div>
                {family.ownerId === account.id && member.id !== account.id && (
                  <div className="stack">
                    <button
                      className="button outline"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(t("familyTransferConfirm")))
                          void action({ action: "transfer", member: member.id });
                      }}
                    >
                      {t("familyMakeOwner")}
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(t("familyRemoveConfirm")))
                          void action({ action: "remove", member: member.id });
                      }}
                    >
                      {t("familyRemoveMember")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {family.ownerId === account.id ? (
            <>
              <p className="muted small">{t("familyInviteNotice")}</p>
              <button
                className="button outline"
                disabled={busy || family.members.length >= 10}
                onClick={() => void createInvite()}
              >
                <UserPlus size={20} />
                {t("familyCreateInvite")}
              </button>
              {invite && (
                <div className="stack">
                  <label>
                    {t("familyInviteLink")}
                    <input readOnly value={invite} onFocus={(e) => e.target.select()} />
                  </label>
                  <button
                    className="button outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(invite)
                        .then(() => setCopied(true))
                        .catch(() => setError("familyCopyFailed"));
                    }}
                  >
                    <Copy size={20} />
                    {t("familyCopyInvite")}
                  </button>
                  {copied && <p role="status">{t("copied")}</p>}
                </div>
              )}
              <button
                className="button quiet"
                disabled={busy}
                onClick={() => void action({ action: "revoke" })}
              >
                {t("familyRevokeInvite")}
              </button>
              <details>
                <summary>{t("familyDelete")}</summary>
                <p className="muted small">{t("familyDeleteConfirm")}</p>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(t("familyDeleteConfirm"))) void action({ action: "delete" });
                  }}
                >
                  {t("familyDelete")}
                </button>
              </details>
            </>
          ) : (
            <button
              className="button outline"
              disabled={busy}
              onClick={() => {
                if (confirm(t("familyLeaveConfirm"))) void action({ action: "leave" });
              }}
            >
              {t("familyLeave")}
            </button>
          )}
        </>
      ) : (
        <>
          {cache.family && (
            <div className="stack notice">
              <p>{t("familyAccessEnded")}</p>
              <button className="button outline" onClick={onOpen}>
                {t("familyLocalCopy")}
              </button>
              <button className="button outline" onClick={onExport}>
                {t("familyExportLocal")}
              </button>
            </div>
          )}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void action({ action: "create", name });
            }}
          >
            <label>
              {t("familyName")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {t("familyCreate")}
            </button>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
export function FamilyInvitation({
  token,
  account,
  t,
  onClose,
  onSignIn,
  onJoined,
}: {
  token: string;
  account: Account | null;
  t: (key: Message) => string;
  onClose: () => void;
  onSignIn: () => void;
  onJoined: (family: Family) => void;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Message | null>(null);
  useEffect(() => {
    let active = true;
    setName("");
    setError(null);
    if (account)
      void api("/api/family", { action: "preview", token }, account.id)
        .then((data) => {
          const v = z.object({ invitation: z.object({ name: z.string().max(80) }) }).parse(data);
          if (active) setName(v.invitation.name);
        })
        .catch((e) => {
          if (active) setError(knownError(e));
        });
    return () => {
      active = false;
    };
  }, [account?.id, token]);
  async function join() {
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const result = familyStateSchema.parse(
        await api("/api/family", { action: "join", token }, account.id),
      );
      if (result.family) onJoined(result.family);
    } catch (e) {
      setError(knownError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={t("familyJoin")} closeLabel={t("close")} onClose={onClose}>
      <div className="stack">
        {name && <h3>{name}</h3>}
        <p>{t("familyJoinNotice")}</p>
        {!account ? (
          <button className="button primary" onClick={onSignIn}>
            {t("familySignIn")}
          </button>
        ) : (
          <button className="button primary" disabled={busy || !name} onClick={() => void join()}>
            {t("familyJoin")}
          </button>
        )}
        {error && (
          <p role="alert" className="error">
            {t(error)}
          </p>
        )}
        <button className="button quiet" onClick={onClose}>
          {t("cancel")}
        </button>
      </div>
    </Sheet>
  );
}
