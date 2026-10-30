import { CategoryIcon } from "./CategoryAppearance";
import { mapProviders } from "../foundation/map-providers";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Plus,
  Pencil,
  Trash2,
  ArrowUpRight,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  Tag,
  Archive,
  User,
  Users,
} from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { keepOfflineData } from "../foundation/storage";
import { AccountPanel } from "./Account";
import type { AccountState } from "../foundation/sync";
import type { Language, Message } from "../foundation/i18n";
import type { LocalRecord } from "../../shared/model";
import type { DistanceUnits } from "../foundation/distance";
import type { ReactNode } from "react";
const sectionIcons = {
  preferences: SlidersHorizontal,
  categories: Tag,
  backup: Archive,
  account: User,
  familySharing: Users,
};
type Section = keyof typeof sectionIcons;
export type Preferences = {
  language: Language;
  theme: "light" | "dark" | "system";
  provider: "google" | "apple" | "geo" | "";
  lastCategory: string;
  reviewGps: boolean;
  units: DistanceUnits;
};
export function Settings({
  canWrite,
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
  canWrite: boolean;
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
  useEffect(() => setTab(initial), [initial]);
  const [storageStatus, setStorageStatus] = useState<boolean | null>(null);
  const [requestingStorage, setRequestingStorage] = useState(false);
  const navigation = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLElement>(null);
  const [compactNavigation, setCompactNavigation] = useState(true);
  const sections = ["preferences", "categories", "backup", "account", "familySharing"] as const;
  const activeSection = sections.includes(tab as Section) ? (tab as Section) : "preferences";
  const SectionIcon = sectionIcons[activeSection];
  useLayoutEffect(() => {
    const container = navigation.current!;
    const strip = tabs.current!;
    const measure = () => setCompactNavigation(strip.scrollWidth > container.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(strip);
    measure();
    return () => observer.disconnect();
  }, []);
  return (
    <Sheet
      title={t("settings")}
      onClose={onClose}
      closeLabel={t("close")}
      wide
      topAligned
      className="settings-sheet"
    >
      <div ref={navigation} className="settings-navigation" data-compact={compactNavigation}>
        <div
          className="settings-section-selector"
          role="heading"
          aria-level={3}
          aria-label={t(activeSection)}
          hidden={!compactNavigation}
        >
          <div className="settings-section-label" aria-hidden="true">
            <SectionIcon size={22} />
            <span>{t(activeSection)}</span>
            <ChevronDown size={22} />
          </div>
          <select
            aria-label={t("settings")}
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            hidden={!compactNavigation}
          >
            {sections.map((k) => {
              const Icon = sectionIcons[k];
              return (
                <option key={k} value={k}>
                  <Icon size={22} aria-hidden="true" />
                  <span>{t(k)}</span>
                </option>
              );
            })}
          </select>
        </div>
        <nav
          ref={tabs}
          className="settings-tabs"
          aria-label={t("settings")}
          inert={compactNavigation}
          aria-hidden={compactNavigation}
        >
          {sections.map((k) => (
            <button key={k} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
              {t(k)}
            </button>
          ))}
        </nav>
      </div>
      {tab === "familySharing" && familyPanel}
      {tab === "preferences" && (
        <div className="stack preferences-panel">
          <h3>{t("preferences")}</h3>
          <div className="preferences-options">
            <label className="preference-row">
              <span>{t("appearance")}</span>
              <span className="preference-value" aria-hidden="true">
                {t(preferences.theme)}
              </span>
              <ChevronRight size={20} aria-hidden="true" />
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
            <label className="preference-row">
              <span>{t("language")}</span>
              <span className="preference-value" aria-hidden="true">
                {preferences.language === "sv" ? "Svenska" : "English"}
              </span>
              <ChevronRight size={20} aria-hidden="true" />
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
            <label className="preference-row">
              <span>{t("mapsPreference")}</span>
              <span className="preference-value" aria-hidden="true">
                {preferences.provider && mapProviders().includes(preferences.provider)
                  ? t(preferences.provider)
                  : t("chooseMaps")}
              </span>
              <ChevronRight size={20} aria-hidden="true" />
              <select
                value={
                  preferences.provider && mapProviders().includes(preferences.provider)
                    ? preferences.provider
                    : ""
                }
                onChange={(e) =>
                  onPreferences({
                    ...preferences,
                    provider: e.target.value as Preferences["provider"],
                  })
                }
              >
                <option value="">{t("chooseMaps")}</option>
                {mapProviders().map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="preference-row">
              <span>{t("distanceUnits")}</span>
              <span className="preference-value" aria-hidden="true">
                {t(preferences.units === "imperial" ? "feet" : "metres")}
              </span>
              <ChevronRight size={20} aria-hidden="true" />
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
          </div>
          <label className="gps-setting">
            <span>{t("reviewGpsSetting")}</span>
            <input
              type="checkbox"
              role="switch"
              aria-label={t("reviewGpsSetting")}
              aria-describedby="gps-review-help"
              checked={preferences.reviewGps}
              onChange={(e) => onPreferences({ ...preferences, reviewGps: e.target.checked })}
            />
            <small id="gps-review-help">{t("reviewGpsHint")}</small>
          </label>
          <div className="preferences-disclosures">
            <details>
              <summary>
                <span>{t("install")}</span>
                <ChevronRight aria-hidden="true" size={20} />
              </summary>
              <p className="muted">{t("installIOS")}</p>
              <p className="muted">{t("installOther")}</p>
            </details>
            <details>
              <summary>
                <span>{t("privacy")}</span>
                <ChevronRight aria-hidden="true" size={20} />
              </summary>
              <p className="muted">{t("privacyText")}</p>
              <p className="muted">{t("recoveryText")}</p>
            </details>
          </div>
          <button className="button outline" onClick={onCheckUpdates}>
            {t("checkUpdates")}
          </button>
          <footer className="preferences-footer">
            <div className="preferences-links">
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
          </footer>
        </div>
      )}
      {tab === "categories" && (
        <div className="stack">
          <h3>{t("categories")}</h3>
          <button className="button outline" disabled={!canWrite} onClick={() => onCategory()}>
            <Plus size={19} />
            {t("newCategory")}
          </button>
          <div className="category-list">
            {categories.map((c) => (
              <div key={c.id}>
                <CategoryIcon record={c} />
                <span>{categoryLabel(c)}</span>
                <button
                  className="icon-button"
                  aria-label={`${t("rename")} ${categoryLabel(c)}`}
                  disabled={!canWrite}
                  onClick={() => onCategory(c)}
                >
                  <Pencil size={18} />
                </button>
                {c.id !== "other" ? (
                  <button
                    className="icon-button"
                    aria-label={`${t("delete")} ${categoryLabel(c)}`}
                    disabled={!canWrite}
                    onClick={() => onDeleteCategory(c)}
                  >
                    <Trash2 size={18} />
                  </button>
                ) : (
                  <span aria-hidden="true" className="category-delete-slot" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === "backup" && (
        <div className="stack backup-panel">
          <h3>{t("backup")}</h3>
          <p className="muted">{t("recoveryText")}</p>
          <div className="backup-files stack">
            <p className="muted">{t("backupEncryption")}</p>
            <div className="backup-actions">
              <button className="button outline" onClick={onExport}>
                <Download size={19} />
                {t("export")}
              </button>
              <button className="button outline" disabled={!canWrite} onClick={onImport}>
                <Upload size={19} />
                {t("import")}
              </button>
            </div>
          </div>
          <div className="offline-storage stack">
            <button
              className="button outline"
              disabled={requestingStorage}
              aria-describedby="offline-storage-help"
              onClick={async () => {
                setRequestingStorage(true);
                setStorageStatus(await keepOfflineData());
                setRequestingStorage(false);
              }}
            >
              {t("persist")}
            </button>
            <p id="offline-storage-help" className="muted">
              {t("persistHelp")}
            </p>
            <p role="status" className="muted">
              {storageStatus !== null && t(storageStatus ? "persistGranted" : "persistNotGranted")}
            </p>
          </div>
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
