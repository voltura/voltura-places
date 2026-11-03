import { shareOrCopy, supportsNativeShare } from "../foundation/sharing";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Users,
  Copy,
  Check,
  Share,
  Share2,
  UserPlus,
  Trash2,
  UserMinus,
  LogOut,
  X,
  Pencil,
  RotateCw,
  Plus,
  UserRoundX,
  Download,
  KeyRound,
} from "lucide-react";
import { z } from "zod";
import { api } from "../foundation/http";
import { type Account } from "../foundation/account-contract";
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
  onChanged: (families: Family[], deletedGroup?: string) => void;
  onOpen: (id: string) => void;
  onSignIn: (focusDisplayName?: boolean) => void;
  onExport: (id: string) => void;
  preferredGroup?: string;
  focusParticipants?: boolean;
  focusCreate?: boolean;
  focusJoin?: boolean;
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
  focusCreate = false,
  focusJoin = false,
}: Props) {
  const [requestSent, setRequestSent] = useState(false);
  const actionPending = useRef(false);
  const pollVersion = useRef(0);
  const createName = useRef<HTMLInputElement>(null);
  const invitationCode = useRef<HTMLInputElement>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(focusCreate || focusJoin);
  useEffect(() => {
    if (!focusJoin || !account) {
      return;
    }
    setNewGroupOpen(true);
    const frame = requestAnimationFrame(() => {
      invitationCode.current?.focus();
      invitationCode.current?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frame);
  }, [focusJoin, account?.id]);
  useEffect(() => {
    if (!focusCreate) {
      return;
    }
    const frame = requestAnimationFrame(() => createName.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [focusCreate]);
  const participantsHeading = useRef<HTMLHeadingElement>(null);
  const requestDisplay = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [renameName, setRenameName] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    familyId: string;
    memberId?: string;
    action: "remove" | "transfer" | "delete" | "discard";
  } | null>(null);
  const [renamed, setRenamed] = useState(false);
  const [inviteCode, setInviteCode] = useState<{
    code: string;
    expiresAt: number;
    version?: string;
  } | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState<{ expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);
  const codeUsable = inviteCode && (inviteCode.expiresAt === 0 || inviteCode.expiresAt > now);
  const invitationMessage = inviteCode
    ? t("familyShareMessage").replace("{code}", inviteCode.code)
    : "";
  const invitationData = { text: invitationMessage };
  const canShareInvitation = supportsNativeShare(invitationData);
  // Device detection affects only the icon; sharing always uses capabilities.
  const ShareIcon = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? Share : Share2;

  const invitationEpoch = useRef(0);
  useLayoutEffect(() => {
    return () => {
      invitationEpoch.current++;
    };
  }, [inviteOpen, inviteCode]);

  const copyInvitationCode = async () => {
    if (!inviteCode || (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= Date.now())) {
      return;
    }
    const epoch = invitationEpoch.current;
    setError(null);
    try {
      await navigator.clipboard.writeText(inviteCode.code);
      if (epoch === invitationEpoch.current) {
        setCopied(true);
      }
    } catch {
      if (epoch === invitationEpoch.current) {
        setError("familyCopyFailed");
      }
    }
  };

  const shareInvitation = async () => {
    if (!inviteCode || (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= Date.now())) {
      return;
    }
    const epoch = invitationEpoch.current;
    setError(null);
    try {
      if (
        (await shareOrCopy(
          invitationData,
          invitationMessage,
          () => epoch === invitationEpoch.current,
        )) === "copied" &&
        epoch === invitationEpoch.current
      ) {
        setCopied(true);
      }
    } catch {
      if (epoch === invitationEpoch.current) {
        setError("familyShareFailed");
      }
    }
  };

  const [selectedGroup, setSelectedGroup] = useState(preferredGroup ?? cache.families[0]?.id ?? "");
  const family = cache.families.find((f) => f.id === selectedGroup) ?? cache.families[0] ?? null;
  const confirmationTarget =
    confirmation?.action === "discard"
      ? account && !cache.families.some((group) => group.id === confirmation.familyId)
        ? cache.inactive.find((group) => group.id === confirmation.familyId) && {
            id: confirmation.familyId,
            label: cache.inactive.find((group) => group.id === confirmation.familyId)!.name,
          }
        : undefined
      : account && family?.ownerId === account.id && confirmation?.familyId === family.id
        ? confirmation.action === "delete"
          ? { id: family.id, label: family.name }
          : family.members.find(
              (member) => member.id === confirmation.memberId && member.id !== account.id,
            )
        : undefined;
  const confirmationTitle: Message =
    confirmation?.action === "discard"
      ? "familyRemoveLocal"
      : confirmation?.action === "delete"
        ? "familyDelete"
        : confirmation?.action === "remove"
          ? "familyRemoveMember"
          : "familyMakeOwner";
  const confirmationBody: Message =
    confirmation?.action === "discard"
      ? "familyRemoveLocalConfirm"
      : confirmation?.action === "delete"
        ? "familyDeleteConfirm"
        : confirmation?.action === "remove"
          ? "familyRemoveConfirm"
          : "familyTransferConfirm";
  const selectedGroupRef = useRef(family?.id);
  selectedGroupRef.current = family?.id;
  const waiting = useRef(false);
  const knownGroups = useRef(new Set(cache.families.map((f) => f.id)));

  const scoped = (body: unknown) => {
    const value = body as { action: string };

    if (!family || ["create", "code-request"].includes(value.action)) {
      return value;
    }
    const version = value.action === "revoke" ? inviteCode?.version : family.invitationVersion;

    return {
      ...value,
      familyId: family.id,
      ...(["code-approve", "code-reject", "revoke"].includes(value.action) && version
        ? { invitationVersion: version }
        : {}),
    };
  };

  useEffect(() => {
    setInviteCode(null);
    setInviteOpen(false);
    setCopied(false);
    setRenameName(null);
    setConfirmation(null);
    setError(null);
    setRenamed(false);
  }, [family?.id, account?.id]);
  useEffect(() => {
    if (!focusParticipants) {
      return;
    }
    const frame = requestAnimationFrame(() => participantsHeading.current?.focus());

    return () => cancelAnimationFrame(frame);
  }, [focusParticipants, family?.id]);
  const requestIds = family?.requests.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    if (requestIds) {
      requestDisplay.current?.scrollIntoView({ block: "start" });
    }
  }, [requestIds]);
  useEffect(() => {
    if (!account) {
      return;
    }
    let active = true;
    let inFlight = false;

    const refresh = async () => {
      if (
        inFlight ||
        actionPending.current ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      inFlight = true;
      const version = pollVersion.current;
      try {
        const response = familyStateSchema.parse(await api("/api/family", undefined, account.id));
        if (active && version === pollVersion.current) {
          const groups = response.families;
          if (waiting.current) {
            const joined = groups.find((f) => !knownGroups.current.has(f.id));
            if (joined) {
              setSelectedGroup(joined.id);
            }
          }
          knownGroups.current = new Set(groups.map((f) => f.id));
          waiting.current = !!response.pendingRequest;
          setInviteCode((current) => {
            if (!current?.version) {
              return current;
            }
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
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refresh();
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [account?.id]);

  const codeAction = async (body: unknown) => {
    if (!account) {
      return;
    }
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
      if ((body as { action: string }).action === "code-request") {
        setRequestSent(true);
      }
      if ((body as { action: string }).action === "code-approve") {
        setInviteCode(null);
      }
    } catch (e) {
      setError(knownError(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };

  const createCode = async () => {
    if (!account) {
      return;
    }
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
      if (family?.id !== selectedGroupRef.current) {
        return;
      }
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
    if (!account) {
      return;
    }
    actionPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setError(null);
    try {
      const response = familyStateSchema.parse(await api("/api/family", scoped(body), account.id));
      const deletedGroup =
        (body as { action: string }).action === "delete" ? family?.id : undefined;
      if (deletedGroup && response.families.some((group) => group.id === deletedGroup)) {
        throw new Error("serviceUnavailable");
      }
      onChanged(response.families, deletedGroup);
      if ((body as { action: string }).action === "create" && response.familyId) {
        setSelectedGroup(response.familyId);
        setName("");
        setNewGroupOpen(false);
      }

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
        className="stack family-action-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void codeAction({ action: "code-request", code: joinCode });
        }}
      >
        <h4>{t("familyEnterCode")}</h4>
        <p className="muted small">{t("familyEnterCodeHint")}</p>
        <label>
          {t("familyInvitationCode")}
          <span className="family-code-entry">
            <input
              ref={invitationCode}
              name="invitationCode"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onPaste={(event) => {
                event.preventDefault();
                setJoinCode(event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4));
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
            />
            <span className="family-code-boxes" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} data-next={index === Math.min(joinCode.length, 3)}>
                  {joinCode[index] ?? ""}
                </span>
              ))}
            </span>
          </span>
        </label>
        <button className="button primary" disabled={busy || joinCode.length !== 4}>
          <UserPlus size={20} aria-hidden="true" />
          {t("familyRequestJoin")}
        </button>
      </form>
      <form
        className="stack family-action-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void action({ action: "create", name });
        }}
      >
        <h4>{t("familyCreate")}</h4>
        <label>
          {t("familyName")}
          <input
            ref={createName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </label>
        <button
          className="button primary"
          disabled={busy || !name.trim() || cache.families.length >= 20}
        >
          <Plus size={20} aria-hidden="true" />
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
        <button className="button primary" onClick={() => onSignIn()}>
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
          {cache.families.length === 1 && <h3 className="family-group-name">{family.name}</h3>}
          {family.ownerId === account.id &&
            (renameName === null ? (
              <button
                className="button outline"
                disabled={busy}
                onClick={() => {
                  setRenameName(family.name);
                  setRenamed(false);
                  setError(null);
                }}
              >
                <Pencil size={20} aria-hidden="true" />
                {t("familyRename")}
              </button>
            ) : (
              <form
                className="stack"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (busy || !renameName.trim()) {
                    return;
                  }
                  if (await action({ action: "rename", name: renameName.trim() })) {
                    setRenameName(null);
                    setRenamed(true);
                  }
                }}
              >
                <label>
                  {t("familyName")}
                  <input
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    required
                    maxLength={80}
                    disabled={busy}
                    autoFocus
                  />
                </label>
                <div className="account-actions">
                  <button className="button primary" disabled={busy || !renameName.trim()}>
                    <Check size={20} aria-hidden="true" />
                    {t("save")}
                  </button>
                  <button
                    type="button"
                    className="button outline"
                    disabled={busy}
                    onClick={() => {
                      setRenameName(null);
                      setError(null);
                    }}
                  >
                    {t("cancel")}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="error">
                    {t(error)}
                  </p>
                )}
              </form>
            ))}
          {renamed && (
            <p role="status" className="muted small">
              {t("familyRenamed")}
            </p>
          )}
          <p className="muted">{t("familySharedNotice")}</p>
          <button className="button primary" onClick={() => onOpen(family.id)}>
            {t("openFamilyLibrary")}
          </button>
          <h4 id="family-participants" ref={participantsHeading} tabIndex={-1}>
            {t("familyParticipants")} · {family.members.length}/10
          </h4>
          {family.ownerId === account.id && (
            <button
              className="button outline"
              disabled={busy || family.members.length >= 10}
              onClick={() => {
                setError(null);
                setInviteOpen(true);
                if (
                  !inviteCode ||
                  (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= Date.now())
                ) {
                  void createCode();
                }
              }}
            >
              <UserPlus size={20} />
              {t("familyCreateCode")}
            </button>
          )}
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
                      aria-label={`${t("familyMakeOwner")} · ${member.label}`}
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setConfirmation({
                          familyId: family.id,
                          memberId: member.id,
                          action: "transfer",
                        });
                      }}
                    >
                      <KeyRound size={20} aria-hidden="true" />
                      {t("familyMakeOwner")}
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      aria-label={`${t("familyRemoveMember")} · ${member.label}`}
                      onClick={() => {
                        setError(null);
                        setConfirmation({
                          familyId: family.id,
                          memberId: member.id,
                          action: "remove",
                        });
                      }}
                    >
                      <UserMinus size={20} aria-hidden="true" />
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
                        <Check size={20} aria-hidden="true" />
                        {t("familyApprove")}
                      </button>
                      <button
                        className="button outline"
                        disabled={busy}
                        aria-label={`${t("familyReject")} · ${member.label}`}
                        onClick={() =>
                          void codeAction({ action: "code-reject", member: member.id })
                        }
                      >
                        <UserRoundX size={20} aria-hidden="true" />
                        {t("familyReject")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                    {codeUsable && (
                      <>
                        <div className="stack family-code-field">
                          <span id="invitation-code-label">{t("familyInvitationCode")}</span>
                          <button
                            className="family-invite-code"
                            aria-label={t("familyCopyCode")}
                            aria-describedby="invitation-digits"
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
                          <span className="sr-only" id="invitation-digits">
                            {inviteCode.code.split("").join(" ")}
                          </span>
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
                    {inviteCode && !codeUsable && <p role="status">{t("familyCodeExpired")}</p>}
                    {!busy &&
                      (!inviteCode ||
                        (inviteCode.expiresAt !== 0 && inviteCode.expiresAt <= now)) && (
                        <button
                          className="button outline"
                          disabled={busy}
                          onClick={() => void createCode()}
                        >
                          {inviteCode ? (
                            <UserPlus size={20} aria-hidden="true" />
                          ) : (
                            <RotateCw size={20} aria-hidden="true" />
                          )}
                          {t(inviteCode ? "familyNewCode" : "familyRetryCode")}
                        </button>
                      )}
                    {inviteCode && (
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={async () => {
                          if (await action({ action: "revoke" })) {
                            setInviteCode(null);
                            setInviteOpen(false);
                          }
                        }}
                      >
                        <X size={20} aria-hidden="true" />
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
                    setError(null);
                    setConfirmation({ familyId: family.id, action: "delete" });
                  }}
                >
                  <Trash2 size={20} aria-hidden="true" />
                  {t("familyDelete")}
                </button>
              </details>
            </>
          ) : (
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (confirm(t("familyLeaveConfirm"))) {
                  void action({ action: "leave" });
                }
              }}
            >
              <LogOut size={20} aria-hidden="true" />
              {t("familyLeave")}
            </button>
          )}
        </>
      ) : (
        joinForms
      )}
      {account &&
        cache.inactive.map((group) => (
          <div className="stack notice" key={group.id}>
            <h4>{group.name}</h4>
            <p>{t("familyAccessEnded")}</p>
            <button className="button outline" onClick={() => onOpen(group.id)}>
              {t("familyLocalCopy")}
            </button>
            <button className="button outline" onClick={() => onExport(group.id)}>
              <Download size={20} aria-hidden="true" />
              {t("familyExportLocal")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                setError(null);
                setConfirmation({ familyId: group.id, action: "discard" });
              }}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t("familyRemoveLocal")}
            </button>
          </div>
        ))}
      {account && family && (
        <details>
          <summary>{t("familyHelp")}</summary>
          <p className="muted">{t("familySyncHelp")}</p>
        </details>
      )}
      {account && family && (
        <details
          open={newGroupOpen}
          onToggle={(event) => setNewGroupOpen(event.currentTarget.open)}
        >
          <summary>{t("familyAnotherGroup")}</summary>
          {joinForms}
        </details>
      )}
      {requestSent && account && (
        <Sheet
          title={t("familyRequestSentTitle")}
          closeLabel={t("close")}
          onClose={() => setRequestSent(false)}
        >
          <div className="stack">
            <p>{t("familyRequestSent")}</p>
            <p>{t("familyRequestNameHint")}</p>
            <div className="action-pair">
              <button
                className="button outline"
                data-initial-focus
                onClick={() => setRequestSent(false)}
              >
                {t("done")}
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setRequestSent(false);
                  onSignIn(true);
                }}
              >
                <Pencil size={20} aria-hidden="true" />
                {t(account.displayName ? "changeDisplayName" : "setDisplayName")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {confirmationTarget && confirmation && (
        <Sheet
          title={t(confirmationTitle)}
          closeLabel={t("close")}
          onClose={() => {
            if (!busy) {
              setConfirmation(null);
              setError(null);
            }
          }}
        >
          <div className="stack">
            <p>
              <strong>{confirmationTarget.label}</strong>
            </p>
            <p>{t(confirmationBody)}</p>
            {error && (
              <p className="error" role="alert">
                {t(error)}
              </p>
            )}
            <div className="action-pair">
              <button
                className="button outline subdued"
                data-initial-focus
                disabled={busy}
                onClick={() => {
                  setConfirmation(null);
                  setError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                className={
                  confirmation.action === "transfer" ? "button primary" : "button danger confirm"
                }
                disabled={busy}
                onClick={async () => {
                  if (
                    actionPending.current ||
                    (confirmation.action !== "discard" &&
                      selectedGroupRef.current !== confirmation.familyId)
                  ) {
                    return;
                  }
                  if (confirmation.action === "discard") {
                    onChanged(cache.families, confirmation.familyId);
                    setConfirmation(null);

                    return;
                  }
                  if (
                    await action({
                      action: confirmation.action,
                      ...(confirmation.action !== "delete"
                        ? { member: confirmationTarget.id }
                        : {}),
                    })
                  ) {
                    setConfirmation(null);
                  }
                }}
              >
                {confirmation.action === "delete" || confirmation.action === "discard" ? (
                  <Trash2 size={20} aria-hidden="true" />
                ) : confirmation.action === "remove" ? (
                  <UserMinus size={20} aria-hidden="true" />
                ) : (
                  <KeyRound size={20} aria-hidden="true" />
                )}
                {t(busy ? "working" : confirmationTitle)}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {error && !inviteOpen && !confirmationTarget && renameName === null && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
    </section>
  );
}
