import { useState } from "react";
import { Cloud, ArrowRight, Mail } from "lucide-react";
import { api, type AccountState } from "../foundation/sync";
import type { Message } from "../foundation/i18n";
export function AccountPanel({
  state,
  t,
  onRefresh,
  onSignOut,
  onSync,
  onDelete,
  onRemoveDevice,
}: {
  state: AccountState;
  t: (k: Message) => string;
  onRefresh: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => void;
  onDelete: () => Promise<void>;
  onRemoveDevice: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [otp, setOtp] = useState(""),
    [sent, setSent] = useState(false),
    [linking, setLinking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(t("serviceUnavailable"));
    } finally {
      setBusy(false);
    }
  };
  const startLink = async (provider: string) => {
    if (state.account) await api("/api/account/link", { provider }, state.account.id);
  };
  const google = () =>
    execute(async () => {
      await startLink("google");
      const result = await api<{ url: string }>("/api/auth/sign-in/social", {
        provider: "google",
        linking: !!state.account,
      });
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com")
        throw new Error("Invalid provider");
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
      setSent(true);
    });
  const verify = () =>
    execute(async () => {
      await api("/api/auth/sign-in/email-otp", { email, otp });
      await api("/api/account/connect", { provider: "email", linking });
      setSent(false);
      setOtp("");
      await onRefresh();
    });
  return (
    <section className="stack">
      <div className="section-icon">
        <Cloud />
      </div>
      <h3>{t("account")}</h3>
      <p className="muted">{t("accountIntro")}</p>
      {!state.enabled && <p className="notice">{t("accountUnavailable")}</p>}
      {state.account && (
        <>
          <div className="account-summary">
            <span className="status-dot" />
            {state.account.methods.map((m) => m.label).join(" · ")}
          </div>
          <h4>{t("linkedMethods")}</h4>
          <ul className="methods">
            {state.account.methods.map((m) => (
              <li key={m.provider}>
                {m.provider === "email" ? "Email" : m.provider === "google" ? "Google" : "ChatGPT"}
                <span>{m.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {state.providers.google &&
        (!state.account || !state.account.methods.some((m) => m.provider === "google")) && (
          <button className="button outline" disabled={busy} onClick={() => void google()}>
            <span className="google-g">G</span>
            {t(state.account ? "linkGoogle" : "continueGoogle")}
            <ArrowRight size={18} />
          </button>
        )}
      {state.providers.chatgpt &&
        (!state.account || !state.account.methods.some((m) => m.provider === "chatgpt")) && (
          <button className="button outline" disabled={busy} onClick={() => void native()}>
            {t("continueChatGPT")}
            <ArrowRight size={18} />
          </button>
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
                disabled={sent}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {sent && (
              <>
                <p className="notice">{t("codeSent")}</p>
                <label>
                  {t("code")}
                  <input
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
            <button className="button outline" disabled={busy} type="submit">
              <Mail size={18} />
              {t(sent ? "verify" : state.account ? "linkEmail" : "sendCode")}
            </button>
            {sent && (
              <button className="button quiet" type="button" onClick={() => setSent(false)}>
                {t("cancel")}
              </button>
            )}
          </form>
        )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state.account && (
        <>
          <button className="button outline" onClick={onSync}>
            {t("syncNow")}
          </button>
          <hr />
          <p className="muted small">{t("signOutNotice")}</p>
          <button
            className="button outline"
            disabled={busy}
            onClick={() => void execute(onSignOut)}
          >
            {t("signOut")}
          </button>
          <details>
            <summary>{t("deleteAccount")}</summary>
            <p className="muted small">{t("deleteAccountBody")}</p>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (confirm(t("deleteAccountBody"))) void execute(onDelete);
              }}
            >
              {t("deleteAccount")}
            </button>
          </details>
          <details>
            <summary>{t("removeDevice")}</summary>
            <p className="muted small">{t("removeDeviceBody")}</p>
            <button
              className="button outline"
              disabled={busy}
              onClick={() => {
                if (confirm(t("removeDeviceBody"))) void execute(onRemoveDevice);
              }}
            >
              {t("removeDevice")}
            </button>
          </details>
        </>
      )}
    </section>
  );
}
