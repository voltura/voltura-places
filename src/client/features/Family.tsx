import { shareOrCopy, supportsNativeShare } from "../foundation/sharing";
import { useEffect, useRef, useState } from "react";
import { Users, Copy, Check, Share, Share2, UserPlus } from "lucide-react";
import { z } from "zod";
import { api, type Account } from "../foundation/sync";
import { type FamilyCache } from "../foundation/family";
import { familyStateSchema, type Family } from "../../shared/families";
import { Sheet } from "../ui/Sheet";
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
  focusParticipants?: boolean;
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
  focusParticipants = false,
}: Props) {
  const actionPending = useRef(false),
    pollVersion = useRef(0);
  const participantsHeading = useRef<HTMLHeadingElement>(null),
    requestDisplay = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Message | null>(null),
    [copied, setCopied] = useState(false),
    [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<{
      code: string;
      expiresAt: number;
      version?: string;
    } | null>(null),
    [joinCode, setJoinCode] = useState(""),
    [pending, setPending] = useState<{ expiresAt: number } | null>(null),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const invitationMessage = inviteCode
    ? t("familyShareMessage").replace("{code}", inviteCode.code)
    : "";
  const invitationData = { text: invitationMessage };
  const canShareInvitation = supportsNativeShare(invitationData);
  // Device detection affects only the icon; sharing always uses capabilities.
  const ShareIcon = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? Share : Share2;
  const copyInvitationCode = async () => {
    if (!inviteCode) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(inviteCode.code);
      setCopied(true);
    } catch {
      setError("familyCopyFailed");
    }
  };
  const shareInvitation = async () => {
    setError(null);
    try {
      if ((await shareOrCopy(invitationData, invitationMessage)) === "copied") setCopied(true);
    } catch {
      setError("familyShareFailed");
    }
  };
  const [selectedGroup, setSelectedGroup] = useState(preferredGroup ?? cache.families[0]?.id ?? "");
  const family = cache.families.find((f) => f.id === selectedGroup) ?? cache.families[0] ?? null;
  const selectedGroupRef = useRef(family?.id);
  selectedGroupRef.current = family?.id;
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
    setInviteOpen(false);
    setCopied(false);
  }, [family?.id]);
  useEffect(() => {
    if (!focusParticipants) return;
    const frame = requestAnimationFrame(() => participantsHeading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusParticipants, family?.id]);
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
          setInviteCode((current) => {
            if (!current?.version) return current;
            const group = groups.find((g) => g.id === selectedGroupRef.current);
            return group &&
              group.invitationVersion !== undefined &&
              group.invitationVersion !== current.version
              ? null
              : current;
          });
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
        .object({
          code: z.string().regex(/^\d{4}$/),
          expiresAt: z.number(),
          version: z.string().optional(),
        })
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
      return true;
    } catch (e) {
      setError(knownError(e));
      return false;
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const joinForms = (
    <div className="stack">
      {pending && (pending.expiresAt === 0 || pending.expiresAt > now) && (
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
      <div className="family-heading">
        <div className="section-icon" aria-hidden="true">
          <Users />
        </div>
        <h3>{t("familySharing")}</h3>
      </div>
      {!family && <p className="muted">{t("familyIntro")}</p>}
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
          <h3 className="family-group-name">{family.name}</h3>
          <p className="muted">{t("familySharedNotice")}</p>
          <button className="button primary" onClick={() => onOpen(family.id)}>
            {t("openFamilyLibrary")}
          </button>
          <h4 id="family-participants" ref={participantsHeading} tabIndex={-1}>
            {t("familyParticipants")} · {family.members.length}/10
          </h4>
          <ul className="family-members" aria-labelledby="family-participants">
            {family.members.map((member) => (
              <li key={member.id}>
                <div>
                  <strong>{member.label}</strong>
                  {(member.id === family.ownerId || member.id === account.id) && (
                    <span className="muted small">
                      {[
                        member.id === family.ownerId ? t("familyOwner") : null,
                        member.id === account.id ? t("familyYou") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
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
                        if (confirm(`${member.label}\n\n${t("familyRemoveConfirm")}`))
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
                <div className="stack family-requests" ref={requestDisplay}>
                  <h4>{t("familyRequests")}</h4>
                  <p>{t("familyApproveNotice")}</p>
                  {family.requests.map((member) => (
                    <div className="stack" key={member.id}>
                      <strong>{member.label}</strong>
                      <button
                        className="button primary"
                        aria-label={`${t("familyApprove")} · ${member.label}`}
                        disabled={busy}
                        onClick={() =>
                          void codeAction({ action: "code-approve", member: member.id })
                        }
                      >
                        {t("familyApprove")}
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
              <button
                className="button outline"
                disabled={busy || family.members.length >= 10}
                onClick={() => {
                  setError(null);
                  setInviteOpen(true);
                  if (
                    !inviteCode ||
                    (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= Date.now())
                  )
                    void createCode();
                }}
              >
                <UserPlus size={20} />
                {t("familyCreateCode")}
              </button>
              {inviteOpen && (
                <Sheet
                  title={t("familyCreateCode")}
                  closeLabel={t("close")}
                  onClose={() => {
                    setInviteOpen(false);
                    setCopied(false);
                    setError(null);
                  }}
                >
                  <div className="stack family-invitation" aria-busy={busy}>
                    {busy && !inviteCode && <p role="status">{t("familyCreatingCode")}</p>}
                    {inviteCode && (
                      <>
                        <div className="stack family-code-field">
                          <span id="invitation-code-label">{t("familyInvitationCode")}</span>
                          <button
                            className="family-invite-code"
                            aria-label={t("familyCopyCode")}
                            disabled={busy}
                            onClick={() => void copyInvitationCode()}
                          >
                            <span className="family-code-value" data-copied={copied}>
                              <span className="family-code-digits" aria-hidden={copied}>
                                {inviteCode.code}
                              </span>
                              {copied && (
                                <span className="family-code-feedback" aria-hidden="true">
                                  {t("copied")}
                                </span>
                              )}
                            </span>
                            <span className="family-code-copy" aria-hidden="true">
                              {copied ? <Check size={22} /> : <Copy size={22} />}
                            </span>
                          </button>
                          <span className="sr-only" role="status">
                            {copied ? t("copied") : ""}
                          </span>
                        </div>
                        <p className="muted">{t("familyCodeNotice")}</p>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void shareInvitation()}
                        >
                          {canShareInvitation ? <ShareIcon size={20} /> : <Copy size={20} />}
                          {t(canShareInvitation ? "familyShareCode" : "familyCopyInvitation")}
                        </button>
                      </>
                    )}
                    {!busy &&
                      (!inviteCode ||
                        (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= now)) && (
                        <button
                          className="button outline"
                          disabled={busy}
                          onClick={() => void createCode()}
                        >
                          {t(inviteCode ? "familyNewCode" : "familyRetryCode")}
                        </button>
                      )}
                    {inviteCode && (
                      <button
                        className="button quiet"
                        disabled={busy}
                        onClick={async () => {
                          if (await action({ action: "revoke" })) {
                            setInviteCode(null);
                            setInviteOpen(false);
                          }
                        }}
                      >
                        {t("familyRevokeInvite")}
                      </button>
                    )}
                    {error && (
                      <p role="alert" className="error">
                        {t(error === "serviceUnavailable" ? "familyCodeFailed" : error)}
                      </p>
                    )}
                  </div>
                </Sheet>
              )}
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
          <summary>{t("familyHelp")}</summary>
          <p className="muted">{t("familySyncHelp")}</p>
        </details>
      )}
      {account && family && (
        <details>
          <summary>{t("familyAnotherGroup")}</summary>
          {joinForms}
        </details>
      )}
      {error && !inviteOpen && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
