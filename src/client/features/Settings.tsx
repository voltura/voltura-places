import { useState } from "react";
import { Download, Upload, Plus, Pencil, Trash2, ArrowUpRight } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { keepOfflineData } from "../foundation/storage";
import { AccountPanel } from "./Account";
import type { AccountState } from "../foundation/sync";
import type { Language, Message } from "../foundation/i18n";
import type { LocalRecord } from "../../shared/model";
import type { DistanceUnits } from "../foundation/distance";
import type { ReactNode } from "react";
export type Preferences = {
  language: Language;
  theme: "light" | "dark" | "system";
  provider: "google" | "apple" | "geo" | "";
  lastCategory: string;
  reviewGps: boolean;
  units: DistanceUnits;
};
export function Settings({
  t,
  preferences,
  onPreferences,
  onClose,
  onCheckUpdates,
  onExport,
  onImport,
  categories,
  categoryLabel,
  onCategory,
  onDeleteCategory,
  account,
  onAccount,
  onSignOut,
  onSync,
  onDeleteAccount,
  onRemoveDevice,
  initial = "preferences",
  familyPanel,
}: {
  t: (k: Message) => string;
  preferences: Preferences;
  onPreferences: (p: Preferences) => void;
  onClose: () => void;
  onCheckUpdates: () => void;
  onExport: () => void;
  onImport: () => void;
  categories: LocalRecord[];
  categoryLabel: (r: LocalRecord) => string;
  onCategory: (r?: LocalRecord) => void;
  onDeleteCategory: (r: LocalRecord) => void;
  account: AccountState;
  onAccount: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => void;
  onDeleteAccount: () => Promise<void>;
  onRemoveDevice: () => Promise<void>;
  initial?: string;
  familyPanel: ReactNode;
}) {
  const [tab, setTab] = useState(initial);
  return (
    <Sheet title={t("settings")} onClose={onClose} closeLabel={t("close")} wide>
      <nav className="settings-tabs" aria-label={t("settings")}>
        {(["preferences", "categories", "backup", "account", "familySharing"] as const).map((k) => (
          <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            {t(k)}
          </button>
        ))}
      </nav>
      {tab === "familySharing" && familyPanel}
      {tab === "preferences" && (
        <div className="stack">
          <h3>{t("preferences")}</h3>
          <label>
            {t("appearance")}
            <select
              value={preferences.theme}
              onChange={(e) =>
                onPreferences({ ...preferences, theme: e.target.value as Preferences["theme"] })
              }
            >
              {(["light", "dark", "system"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("language")}
            <select
              value={preferences.language}
              onChange={(e) =>
                onPreferences({ ...preferences, language: e.target.value as Language })
              }
            >
              <option value="en">English</option>
              <option value="sv">Svenska</option>
            </select>
          </label>
          <label>
            {t("mapsPreference")}
            <select
              value={preferences.provider}
              onChange={(e) =>
                onPreferences({
                  ...preferences,
                  provider: e.target.value as Preferences["provider"],
                })
              }
            >
              <option value="">{t("chooseMaps")}</option>
              {(["google", "apple", "geo"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("distanceUnits")}
            <select
              value={preferences.units}
              onChange={(e) =>
                onPreferences({ ...preferences, units: e.target.value as DistanceUnits })
              }
            >
              <option value="metric">{t("metres")}</option>
              <option value="imperial">{t("feet")}</option>
            </select>
          </label>
          <label className="gps-setting">
            <input
              type="checkbox"
              checked={preferences.reviewGps}
              onChange={(e) => onPreferences({ ...preferences, reviewGps: e.target.checked })}
            />
            <span>
              {t("reviewGpsSetting")}
              <small>{t("reviewGpsHint")}</small>
            </span>
          </label>
          <details>
            <summary>{t("install")}</summary>
            <p className="muted">{t("installIOS")}</p>
            <p className="muted">{t("installOther")}</p>
          </details>
          <button className="button outline" onClick={onCheckUpdates}>
            {t("checkUpdates")}
          </button>
          <details>
            <summary>{t("privacy")}</summary>
            <p className="muted">{t("privacyText")}</p>
            <p className="muted">{t("recoveryText")}</p>
          </details>
          <p className="eyebrow">{t("freeware")}</p>
          <a
            className="text-link"
            href="https://voltura.se/places/"
            target="_blank"
            rel="noreferrer"
          >
            {t("promo")}
            <ArrowUpRight size={17} />
          </a>
          <a
            className="text-link"
            href="https://github.com/voltura/voltura-places"
            target="_blank"
            rel="noreferrer"
          >
            {t("github")}
            <ArrowUpRight size={17} />
          </a>
        </div>
      )}
      {tab === "categories" && (
        <div className="stack">
          <h3>{t("categories")}</h3>
          <div className="category-list">
            {categories.map((c) => (
              <div key={c.id}>
                <span
                  className={`category-dot ${c.value && "color" in c.value ? c.value.color : "slate"}`}
                />
                <span>{categoryLabel(c)}</span>
                <button
                  className="icon-button"
                  aria-label={`${t("rename")} ${categoryLabel(c)}`}
                  onClick={() => onCategory(c)}
                >
                  <Pencil size={18} />
                </button>
                {c.id !== "other" && (
                  <button
                    className="icon-button"
                    aria-label={`${t("delete")} ${categoryLabel(c)}`}
                    onClick={() => onDeleteCategory(c)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button className="button outline" onClick={() => onCategory()}>
            <Plus size={19} />
            {t("newCategory")}
          </button>
        </div>
      )}
      {tab === "backup" && (
        <div className="stack">
          <h3>{t("backup")}</h3>
          <p className="muted">{t("recoveryText")}</p>
          <button className="button outline" onClick={onExport}>
            <Download size={19} />
            {t("export")}
          </button>
          <button className="button outline" onClick={onImport}>
            <Upload size={19} />
            {t("import")}
          </button>
          <button
            className="button quiet"
            onClick={() =>
              void keepOfflineData().then((ok) =>
                alert(t(ok ? "persistGranted" : "persistNotGranted")),
              )
            }
          >
            {t("persist")}
          </button>
        </div>
      )}
      {tab === "account" && (
        <AccountPanel
          state={account}
          t={t}
          onRefresh={onAccount}
          onSignOut={onSignOut}
          onSync={onSync}
          onDelete={onDeleteAccount}
          onRemoveDevice={onRemoveDevice}
        />
      )}
    </Sheet>
  );
}
