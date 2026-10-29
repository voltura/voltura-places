import { useEffect, useRef, useState } from "react";
import { Users, Copy, UserPlus } from "lucide-react";
import { z } from "zod";
import { api, type Account } from "../foundation/sync";
import { type FamilyCache } from "../foundation/family";
import { familyStateSchema, type Family } from "../../shared/families";
import { type Message } from "../foundation/i18n";
const knownError = (error: unknown): Message =>
  error instanceof Error &&
  [
    "familyAlreadyJoined",
    "familyFull",
    "familyTransferFirst",
    "familyOwnerOnly",
    "familyAccessEnded",
    "invalidFamilyAction",
    "invalidFamilyCode",
    "familyCodeLimited",
    "familyCodeChanged",
    "familyGroupLimit",
  ].includes(error.message)
    ? (error.message as Message)
    : "serviceUnavailable";
type Props = {
  account: Account | null;
  cache: FamilyCache;
  t: (key: Message) => string;
  onChanged: (families: Family[]) => void;
  onOpen: (id: string) => void;
  onSignIn: () => void;
  onExport: (id: string) => void;
  preferredGroup?: string;
};
export function FamilyPanel({
  account,
  cache,
  t,
  onChanged,
  onOpen,
  onSignIn,
  onExport,
  preferredGroup,
}: Props) {
  const actionPending = useRef(false),
    pollVersion = useRef(0);
  const codeDisplay = useRef<HTMLDivElement>(null),
    requestDisplay = useRef<HTMLDivElement>(null),
    groupHeading = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Message | null>(null),
    [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState<{ code: string; expiresAt: number } | null>(null),
    [joinCode, setJoinCode] = useState(""),
    [pending, setPending] = useState<{ expiresAt: number } | null>(null),
    [now, setNow] = useState(Date.now);
  const [selectedGroup, setSelectedGroup] = useState(preferredGroup ?? cache.families[0]?.id ?? "");
  const family = cache.families.find((f) => f.id === selectedGroup) ?? cache.families[0] ?? null;
  const waiting = useRef(false),
    knownGroups = useRef(new Set(cache.families.map((f) => f.id)));
  const scoped = (body: unknown) => {
    const value = body as { action: string };
    return family && !["create", "code-request"].includes(value.action)
      ? { ...value, familyId: family.id }
      : value;
  };
  useEffect(() => {
    setInviteCode(null);
    setCopied(false);
    groupHeading.current?.scrollIntoView({ block: "start" });
  }, [family?.id]);
  useEffect(() => {
    if (inviteCode) codeDisplay.current?.scrollIntoView({ block: "center" });
  }, [inviteCode?.code]);
  const requestIds = family?.requests.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    if (requestIds) requestDisplay.current?.scrollIntoView({ block: "start" });
  }, [requestIds]);
  useEffect(() => {
    if (!account) return;
    let active = true,
      inFlight = false;
    const refresh = async () => {
      if (inFlight || actionPending.current || !navigator.onLine) return;
      inFlight = true;
      const version = pollVersion.current;
      try {
        const response = familyStateSchema.parse(await api("/api/family", undefined, account.id));
        if (active && version === pollVersion.current) {
          const groups = response.families;
          if (waiting.current) {
            const joined = groups.find((f) => !knownGroups.current.has(f.id));
            if (joined) setSelectedGroup(joined.id);
          }
          knownGroups.current = new Set(groups.map((f) => f.id));
          waiting.current = !!response.pendingRequest;
          onChanged(groups);
          setPending(response.pendingRequest ?? null);
          setNow(Date.now());
        }
      } catch {
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [account?.id]);
  const codeAction = async (body: unknown) => {
    if (!account) return;
    actionPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setError(null);
    try {
      await api("/api/family", scoped(body), account.id);
      const result = familyStateSchema.parse(await api("/api/family", undefined, account.id));
      onChanged(result.families);
      waiting.current = !!result.pendingRequest;
      setPending(result.pendingRequest ?? null);
      setJoinCode("");
      if ((body as { action: string }).action === "code-approve") setInviteCode(null);
    } catch (e) {
      setError(knownError(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const createCode = async () => {
    if (!account) return;
    actionPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setError(null);
    try {
      const result = z
        .object({ code: z.string().regex(/^\d{4}$/), expiresAt: z.number() })
        .parse(await api("/api/family", scoped({ action: "code-create" }), account.id));
      setInviteCode(result);
      setCopied(false);
      setNow(Date.now());
    } catch (e) {
      setError(knownError(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const action = async (body: unknown) => {
    if (!account) return;
    actionPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setError(null);
    try {
      const response = familyStateSchema.parse(await api("/api/family", scoped(body), account.id));
      onChanged(response.families);
      if ((body as { action: string }).action === "create" && response.familyId)
        setSelectedGroup(response.familyId);
    } catch (e) {
      setError(knownError(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const joinForms = (
    <div className="stack">
      {pending && pending.expiresAt > now && (
        <p className="notice" role="status">
          {t("familyRequestSent")}
        </p>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void codeAction({ action: "code-request", code: joinCode });
        }}
      >
        <h4>{t("familyEnterCode")}</h4>
        <p className="muted small">{t("familyEnterCodeHint")}</p>
        <label>
          {t("familyInvitationCode")}
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            minLength={4}
            maxLength={4}
            required
          />
        </label>
        <button className="button primary" disabled={busy || joinCode.length !== 4}>
          {t("familyRequestJoin")}
        </button>
      </form>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void action({ action: "create", name });
        }}
      >
        <label>
          {t("familyName")}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        </label>
        <button className="button primary" disabled={busy || cache.families.length >= 20}>
          {t("familyCreate")}
        </button>
      </form>
    </div>
  );
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
          {cache.families.length > 1 && (
            <label>
              {t("groupChoice")}
              <select
                value={family.id}
                disabled={busy}
                onChange={(e) => setSelectedGroup(e.target.value)}
              >
                {cache.families.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <h4 ref={groupHeading}>{family.name}</h4>
          <p className="notice">{t("familySharedNotice")}</p>
          <button className="button primary" onClick={() => onOpen(family.id)}>
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
              {(family.requests ?? []).length > 0 && (
                <div className="stack notice" ref={requestDisplay}>
                  <h4>{t("familyRequests")}</h4>
                  <p>{t("familyApproveNotice")}</p>
                  {family.requests.map((member) => (
                    <div className="stack" key={member.id}>
                      <strong>{member.label}</strong>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void codeAction({ action: "code-approve", member: member.id })
                        }
                      >
                        {t("familyApprove")} · {member.label}
                      </button>
                      <button
                        className="button outline"
                        disabled={busy}
                        onClick={() =>
                          void codeAction({ action: "code-reject", member: member.id })
                        }
                      >
                        {t("familyReject")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted small">{t("familyCodeNotice")}</p>
              <button
                className="button outline"
                disabled={busy || family.members.length >= 10}
                onClick={() => void createCode()}
              >
                <UserPlus size={20} />
                {t("familyCreateCode")}
              </button>
              {inviteCode && (
                <div className="notice stack" ref={codeDisplay}>
                  <label>
                    {t("familyInvitationCode")}
                    <input
                      className="family-invite-code"
                      readOnly
                      value={inviteCode.code}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <p role="status">
                    {inviteCode.expiresAt > now
                      ? `${t("familyCodeExpires")} ${new Intl.DateTimeFormat(document.documentElement.lang, { hour: "2-digit", minute: "2-digit" }).format(inviteCode.expiresAt)}`
                      : t("familyCodeExpired")}
                  </p>
                  <button
                    className="button outline"
                    disabled={inviteCode.expiresAt <= now}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(inviteCode.code)
                        .then(() => setCopied(true))
                        .catch(() => setError("familyCopyFailed"))
                    }
                  >
                    <Copy size={20} />
                    {t("familyCopyCode")}
                  </button>
                  {copied && <p role="status">{t("copied")}</p>}
                </div>
              )}
              <button
                className="button quiet"
                disabled={busy}
                onClick={() => {
                  setInviteCode(null);
                  void action({ action: "revoke" });
                }}
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
          {cache.inactive.map((group) => (
            <div className="stack notice" key={group.id}>
              <h4>{group.name}</h4>
              <p>{t("familyAccessEnded")}</p>
              <button className="button outline" onClick={() => onOpen(group.id)}>
                {t("familyLocalCopy")}
              </button>
              <button className="button outline" onClick={() => onExport(group.id)}>
                {t("familyExportLocal")}
              </button>
            </div>
          ))}
          {joinForms}
        </>
      )}
      {account && family && (
        <details>
          <summary>{t("familyAnotherGroup")}</summary>
          {joinForms}
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
