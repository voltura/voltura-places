import { useId, useRef, useState } from "react";
import { Cloud, ArrowRight, Mail, Trash2, MonitorX } from "lucide-react";
import { api, ApiError } from "../foundation/http";
import { displayNameSchema } from "../../shared/display-name";
import { type Account, type AccountState } from "../foundation/account-contract";
import type { Message } from "../foundation/i18n";

function ProfileName({
  account,
  t,
  busy,
  setBusy,
  onRefresh,
}: {
  account: Account;
  t: (k: Message) => string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Message | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string | null>();
  const pending = useRef(false);
  const hint = useId();
  const error = useId();
  const saved = acknowledged !== undefined ? acknowledged : (account.displayName ?? null);
  const value = draft ?? saved ?? "";
  const parsed = displayNameSchema.safeParse(value);
  const changed = parsed.success && parsed.data !== saved;
  const failed = feedback !== null && feedback !== "profileSaved";

  async function submit() {
    if (busy || pending.current || !parsed.success || (!needsRefresh && !changed)) {
      return;
    }
    pending.current = true;
    setBusy(true);
    let persisted = needsRefresh;
    try {
      if (!persisted) {
        const result = await api<{ account?: { id?: unknown; displayName?: unknown } }>(
          "/api/account/display-name",
          { displayName: parsed.data },
          account.id,
        );
        if (result?.account?.id !== account.id || result.account.displayName !== parsed.data) {
          throw new Error("invalidResponse");
        }
        persisted = true;
        setAcknowledged(parsed.data);
        setNeedsRefresh(true);
        setDraft(parsed.data ?? "");
      }
      await onRefresh();
      setAcknowledged(undefined);
      setNeedsRefresh(false);
      setDraft(null);
      setFeedback("profileSaved");
    } catch (error) {
      setFeedback(
        persisted
          ? "profileRefreshFailed"
          : error instanceof ApiError && (error.status === 401 || error.status === 409)
            ? "accountChanged"
            : "profileSaveFailed",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      className="stack profile-name"
      aria-label={t("profileName")}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        {t("profileName")}
        <input
          autoComplete="nickname"
          value={value}
          disabled={busy}
          aria-invalid={!parsed.success}
          aria-describedby={parsed.success ? hint : hint + " " + error}
          onChange={(event) => {
            setDraft(event.target.value);
            setFeedback(null);
            setNeedsRefresh(false);
          }}
        />
      </label>
      <p id={hint} className="muted small">
        {t("profileNameHint")}
      </p>
      {!parsed.success && (
        <p id={error} className="error" role="alert">
          {t("profileInvalid")}
        </p>
      )}
      <div className="account-actions">
        <button
          type="submit"
          className="button outline"
          disabled={busy || (!changed && !needsRefresh) || !parsed.success}
        >
          {t(needsRefresh ? "retry" : "profileSave")}
        </button>
        {value && (
          <button
            type="button"
            className="button outline subdued"
            disabled={busy}
            onClick={() => {
              setDraft("");
              setNeedsRefresh(false);
              setFeedback(null);
            }}
          >
            {t("profileClear")}
          </button>
        )}
      </div>
      {feedback && (
        <p role={failed ? "alert" : "status"} className={failed ? "error" : "muted small"}>
          {t(feedback)}
        </p>
      )}
    </form>
  );
}

export function AccountPanel({
  state,
  t,
  onRefresh,
  onSignOut,
  onSync,
  syncStatus,
  onDelete,
  onRemoveDevice,
}: {
  state: AccountState;
  t: (k: Message) => string;
  onRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => void;
  syncStatus: Message;
  onDelete: () => Promise<void>;
  onRemoveDevice: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [phase, setPhase] = useState<"email" | "code" | "verified" | "connected">("email");
  const sent = phase !== "email";
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        t(
          error instanceof Error && error.message === "familyTransferFirst"
            ? "familyTransferFirst"
            : "serviceUnavailable",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const startLink = async (provider: string) => {
    if (state.account) {
      await api("/api/account/link", { provider }, state.account.id);
    }
  };

  const google = () =>
    execute(async () => {
      await startLink("google");
      const result = await api<{ url: string }>("/api/auth/sign-in/social", {
        provider: "google",
        linking: !!state.account,
      });
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") {
        throw new Error("Invalid provider");
      }
      location.assign(url.href);
    });

  const native = () =>
    execute(async () => {
      await startLink("chatgpt");
      const returnTo = `/?account=chatgpt${state.account ? "-link" : ""}`;
      location.assign(`/signin-with-chatgpt?returnTo=${encodeURIComponent(returnTo)}`);
    });

  const send = () =>
    execute(async () => {
      await startLink("email");
      setLinking(!!state.account);
      await api("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
      setPhase("code");
    });

  const verify = () =>
    execute(async () => {
      if (phase === "code") {
        try {
          await api("/api/auth/sign-in/email-otp", { email, otp });
        } catch (error) {
          if (error instanceof ApiError && [400, 401, 403].includes(error.status)) {
            setError(t("invalidSignInCode"));

            return;
          }
          throw error;
        }
        setPhase("verified");
      }
      if (phase !== "connected") {
        try {
          await api("/api/account/connect", { provider: "email", linking });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            setPhase("email");
            setOtp("");
            setError(t("invalidSignInCode"));

            return;
          }
          throw error;
        }
        setPhase("connected");
      }
      await onRefresh();
      setPhase("email");
      setOtp("");
    });

  const signInControls = (
    <div className="stack">
      {state.providers.google &&
        (!state.account || !state.account.methods.some((m) => m.provider === "google")) && (
          <button className="button outline" disabled={busy} onClick={() => void google()}>
            <span className="google-g">G</span>
            {t(state.account ? "linkGoogle" : "continueGoogle")}
            <ArrowRight size={18} />
          </button>
        )}
      {import.meta.env.DEV &&
        !state.providers.google &&
        !state.account?.methods.some((m) => m.provider === "google") && (
          <p className="muted small">{t("googlePreviewUnavailable")}</p>
        )}
      {import.meta.env.DEV && !state.account?.methods.some((m) => m.provider === "chatgpt") && (
        <p className="muted small">{t("chatGPTPublishedOnly")}</p>
      )}
      {!import.meta.env.DEV &&
        state.providers.chatgpt &&
        (!state.account || !state.account.methods.some((m) => m.provider === "chatgpt")) && (
          <button className="button outline" disabled={busy} onClick={() => void native()}>
            {t(state.account ? "linkChatGPT" : "continueChatGPT")}
            <ArrowRight size={18} />
          </button>
        )}
      {import.meta.env.DEV &&
        !state.providers.email &&
        !state.account?.methods.some((m) => m.provider === "email") && (
          <p className="muted small">{t("emailPreviewUnavailable")}</p>
        )}
      {state.providers.email &&
        (!state.account || !state.account.methods.some((m) => m.provider === "email")) && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void (sent ? verify() : send());
            }}
          >
            <label>
              {t("email")}
              <input
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                disabled={sent || busy}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {sent && (
              <>
                <p className="notice">{t("codeSent")}</p>
                <label>
                  {t("code")}
                  <input
                    disabled={busy || phase !== "code"}
                    value={otp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </label>
              </>
            )}
            <button className="button primary" disabled={busy} type="submit">
              <Mail size={18} />
              {t(sent ? "verify" : state.account ? "linkEmail" : "sendCode")}
            </button>
            {sent && (
              <button
                className="button outline subdued"
                type="button"
                disabled={busy}
                onClick={() => {
                  setPhase("email");
                  setOtp("");
                  setError("");
                }}
              >
                {t("cancel")}
              </button>
            )}
          </form>
        )}
    </div>
  );

  return (
    <section className="stack">
      <h3>{t("account")}</h3>
      {!state.account && (
        <>
          <p className="notice account-status">
            <span className="account-cloud" aria-hidden="true">
              <Cloud />
              <svg className="account-cloud-slash" viewBox="0 0 24 24">
                <path d="M5 19 19 5" />
              </svg>
            </span>
            {t("notSignedIn")}
          </p>
          <p className="muted">{t("accountIntro")}</p>
        </>
      )}
      {!state.enabled && <p className="notice">{t("accountUnavailable")}</p>}
      {state.account && (
        <>
          <div className="account-summary">
            <Cloud className="account-cloud" aria-hidden="true" />
            <div>
              <strong>{state.account.displayName || t("signedIn")}</strong>
              <span>
                {state.account.displayName
                  ? t("signedIn")
                  : [...new Set(state.account.methods.map((m) => m.label))].join(" · ")}
              </span>
            </div>
          </div>
          <ProfileName
            key={state.account.id}
            account={state.account}
            t={t}
            busy={busy}
            setBusy={setBusy}
            onRefresh={onRefresh}
          />
          <p className="muted">{t("accountSyncIntro")}</p>
          <div className="account-actions">
            <button
              className="button outline"
              onClick={onSync}
              disabled={busy || syncStatus === "syncing"}
              aria-describedby="settings-sync-status"
            >
              {t(syncStatus === "syncing" ? "syncing" : "syncNow")}
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={() => void execute(onSignOut)}
            >
              {t("signOut")}
            </button>
          </div>
          <p
            id="settings-sync-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={
              syncStatus === "actionRequired" || syncStatus === "syncConflict"
                ? "error"
                : "muted small"
            }
          >
            {t(syncStatus)}
          </p>
          <p className="muted small">{t("signOutNotice")}</p>
          <details>
            <summary>{t("linkedMethods")}</summary>
            <div className="stack">
              <p className="muted small">{t("linkedMethodsIntro")}</p>
              <ul className="methods">
                {state.account.methods.map((m) => (
                  <li key={m.provider}>
                    {m.provider === "email"
                      ? t("email")
                      : m.provider === "google"
                        ? "Google"
                        : "ChatGPT"}
                    <span>{m.label}</span>
                  </li>
                ))}
              </ul>
              {signInControls}
            </div>
          </details>
        </>
      )}
      {!state.account && signInControls}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state.account && (
        <>
          <details>
            <summary>{t("deleteAccount")}</summary>
            <p className="muted small">{t("deleteAccountBody")}</p>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (confirm(t("deleteAccountBody"))) {
                  void execute(onDelete);
                }
              }}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t("deleteAccount")}
            </button>
          </details>
          <details>
            <summary>{t("removeDevice")}</summary>
            <p className="muted small">{t("removeDeviceBody")}</p>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (confirm(t("removeDeviceBody"))) {
                  void execute(onRemoveDevice);
                }
              }}
            >
              <MonitorX size={20} aria-hidden="true" />
              {t("removeDevice")}
            </button>
          </details>
        </>
      )}
    </section>
  );
}
