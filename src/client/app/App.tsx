import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Cloud,
  LocateFixed,
  MapPin,
  MoreHorizontal,
  Navigation,
  Plus,
  Search,
  Settings2,
  Share2,
  Signal,
  Trees,
  X,
  Pencil,
  Trash2,
  Copy,
  LoaderCircle,
  Map,
} from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import { Sheet } from "../ui/Sheet";
import { Brand, TrailArt } from "../ui/Brand";
import { Editor } from "../features/Editor";
import { Settings, type Preferences } from "../features/Settings";
import { messages, type Message } from "../foundation/i18n";
import { api, fetchSnapshot, synchronize, type AccountState } from "../foundation/sync";
import { cachedAccount, currentAccount, signOutLocally } from "../foundation/account";
import {
  channel,
  deleteEntity,
  exportBackup,
  getDraft,
  flushDrafts,
  importBackup,
  readWorkspace,
  reconcileAccount,
  removeWorkspace,
  resolveConflict,
  saveEntity,
  type Workspace,
} from "../foundation/library";
import {
  categorySchema,
  mapURL,
  parseShare,
  placeSchema,
  shareURL,
  validateBackup,
  type Backup,
  type Entity,
  type LocalRecord,
  type Place,
} from "../../shared/model";

function loadPreferences(): Preferences {
  const defaults: Preferences = {
    language: navigator.language.startsWith("sv") ? "sv" : "en",
    theme: "light",
    provider: "",
    lastCategory: "other",
  };
  try {
    const v = JSON.parse(localStorage.getItem("places-preferences") ?? "null");
    if (
      v &&
      ["en", "sv"].includes(v.language) &&
      ["light", "dark", "system"].includes(v.theme) &&
      ["", "google", "apple", "geo"].includes(v.provider)
    )
      return { ...defaults, ...v };
  } catch {}
  return defaults;
}
type PlaceRecord = LocalRecord & { kind: "place"; value: Place };
const isPlace = (r: LocalRecord): r is PlaceRecord => r.kind === "place";
const defaults: AccountState = { enabled: false, providers: {}, account: null };
export function App() {
  const [prefs, setPrefs] = useState(loadPreferences),
    t = useMemo(() => messages(prefs.language), [prefs.language]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [scope, setScope] = useState(() => cachedAccount().account?.id ?? "guest"),
    [account, setAccount] = useState<AccountState>(cachedAccount);
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("newest"),
    [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{
      entity?: Entity;
      fresh?: boolean;
      draftId?: string;
    } | null>(null),
    [settings, setSettings] = useState<string | null>(null),
    [maps, setMaps] = useState<Place | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<{
      entity?: LocalRecord;
      name: string;
      color: string;
    } | null>(null),
    [backup, setBackup] = useState<Backup | null>(null),
    [replace, setReplace] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null),
    [locating, setLocating] = useState(false),
    [status, setStatus] = useState("localOnly"),
    [update, setUpdate] = useState(false);
  const [shared, setShared] = useState(() => parseShare(location.hash)),
    [sharePlace, setSharePlace] = useState<PlaceRecord | null>(null);
  const [reconciling, setReconciling] = useState(false),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState<PlaceRecord | null>(null),
    [mobile, setMobile] = useState(() => matchMedia("(max-width:700px)").matches);
  const capture = useRef(0),
    fileRef = useRef<HTMLInputElement>(null),
    swUpdate = useRef<((reload?: boolean) => Promise<void>) | null>(null),
    scopeRef = useRef(scope);
  scopeRef.current = scope;
  const categories = useMemo(
    () => workspace?.records.filter((r) => r.kind === "category" && !r.deleted) ?? [],
    [workspace],
  );
  const categoryLabel = useCallback(
    (r: LocalRecord) =>
      r.kind === "category"
        ? r.value.builtIn &&
          r.value.name ===
            (
              {
                parking: "Parking",
                food: "Food & drink",
                outdoors: "Outdoors",
                accommodation: "Accommodation",
                other: "Other",
              } as Record<string, string>
            )[r.value.builtIn]
          ? t(r.value.builtIn as Message)
          : r.value.name
        : "",
    [t],
  );
  const categoryFor = (id: string) =>
    categories.find((c) => c.id === id) ?? categories.find((c) => c.id === "other");
  const places = useMemo(
    () => workspace?.records.filter(isPlace).filter((p) => !p.deleted) ?? [],
    [workspace],
  );
  const filtered = places
    .filter(
      (p) =>
        (filter === "all" || p.value.categoryId === filter) &&
        `${p.value.name} ${categoryFor(p.value.categoryId) ? categoryLabel(categoryFor(p.value.categoryId)!) : ""}`
          .toLocaleLowerCase(prefs.language)
          .includes(search.toLocaleLowerCase(prefs.language)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.value.name.localeCompare(b.value.name, prefs.language)
        : b.value.capturedAt.localeCompare(a.value.capturedAt),
    );
  const current = places.find((p) => p.id === selected),
    conflicts = workspace?.records.filter((r) => r.conflict) ?? [];
  const notify = (key: Message, error = false) => setNotice({ text: t(key), error });
  const refresh = useCallback(async () => {
    const key = scopeRef.current;
    try {
      const w = await readWorkspace(key);
      if (scopeRef.current === key) setWorkspace(w);
    } catch {
      setNotice({ text: t("storageFailure"), error: true });
    }
  }, [t]);
  const sync = useCallback(() => {
    const key = scopeRef.current;
    if (key !== "guest")
      void synchronize(key, (s) => {
        if (scopeRef.current === key) setStatus(s);
      }).then(refresh);
  }, [refresh]);
  const refreshAccount = useCallback(async () => {
    const next = await currentAccount();
    setAccount(next);
    const key = next.account?.id ?? "guest";
    if (scopeRef.current !== key) {
      scopeRef.current = key;
      setScope(key);
      setSelected(null);
      setEditor(null);
      capture.current++;
      setLocating(false);
    }
    const w = await readWorkspace(key);
    setWorkspace(w);
    setReconciling(key !== "guest" && !w.reconciled);
  }, []);
  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener("places-library", listener);
    channel?.addEventListener("message", listener);
    return () => {
      window.removeEventListener("places-library", listener);
      channel?.removeEventListener("message", listener);
    };
  }, [refresh]);
  useEffect(() => {
    void refreshAccount().catch(() => {});
  }, [refreshAccount]);
  useEffect(() => {
    let active = true;
    void Promise.all([getDraft(scope), readWorkspace(scope)])
      .then(([draft, w]) => {
        if (
          active &&
          draft &&
          typeof draft === "object" &&
          "id" in draft &&
          typeof draft.id === "string"
        ) {
          const entity = w.records.find((r) => r.id === draft.id && !r.deleted);
          setEditor({ entity, draftId: draft.id });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [scope]);
  useEffect(() => {
    const query = matchMedia("(max-width:700px)");
    const change = () => setMobile(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const value = new URL(location.href).searchParams.get("account");
    if (value && /^(google|chatgpt)(-link)?$/.test(value)) {
      void api("/api/account/connect", {
        provider: value.startsWith("google") ? "google" : "chatgpt",
        linking: value.endsWith("-link"),
      })
        .then(refreshAccount)
        .catch(() => setNotice({ text: t("serviceUnavailable"), error: true }));
      history.replaceState(null, "", location.pathname + location.hash);
    }
    if (value === "error") {
      setNotice({ text: t("serviceUnavailable"), error: true });
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }, [refreshAccount, t]);
  useEffect(() => {
    if (scope === "guest") setStatus("localOnly");
    else if (!reconciling) sync();
  }, [scope, reconciling, sync]);
  useEffect(() => {
    const foreground = () => {
      if (document.visibilityState === "visible") {
        void refreshAccount()
          .then(sync)
          .catch(() => {});
      }
    };
    window.addEventListener("online", foreground);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", foreground);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [sync, refreshAccount]);
  useEffect(() => {
    document.documentElement.lang = prefs.language;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        prefs.theme === "system" ? (m.matches ? "dark" : "light") : prefs.theme);
    apply();
    m.addEventListener("change", apply);
    try {
      localStorage.setItem("places-preferences", JSON.stringify(prefs));
    } catch {}
    return () => m.removeEventListener("change", apply);
  }, [prefs]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 12000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (location.hash && !shared) notify("invalidShare", true);
    if (shared) history.replaceState(null, "", location.pathname + location.search);
    if (import.meta.env.PROD)
      swUpdate.current = registerSW({
        onNeedRefresh: () => setUpdate(true),
        onRegisterError: () => {},
      });
  }, []);
  async function save(entity: Entity) {
    await saveEntity(scopeRef.current, entity);
    if (entity.kind === "place") setPrefs((p) => ({ ...p, lastCategory: entity.value.categoryId }));
    await refresh();
    setStatus(scopeRef.current === "guest" ? "localOnly" : "pending");
    sync();
  }
  function saveHere() {
    if (!navigator.geolocation) {
      notify("gpsUnsupported", true);
      return;
    }
    const operation = ++capture.current,
      key = scopeRef.current;
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          if (operation !== capture.current || key !== scopeRef.current) return;
          const now = new Date().toISOString(),
            categoryId = categories.some((c) => c.id === prefs.lastCategory)
              ? prefs.lastCategory
              : "other";
          const entity: Entity = {
            id: crypto.randomUUID(),
            kind: "place",
            value: placeSchema.parse({
              name: `${t("currentLocation")} · ${new Intl.DateTimeFormat(prefs.language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date())}`,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              categoryId,
              capturedAt: now,
              updatedAt: now,
            }),
          };
          try {
            await saveEntity(key, entity);
            if (key === scopeRef.current) {
              await refresh();
              setSelected(entity.id);
              setEditor({ entity, fresh: true });
              sync();
            }
          } catch {
            notify("storageFailure", true);
          } finally {
            if (operation === capture.current) setLocating(false);
          }
        })();
      },
      (error) => {
        if (operation !== capture.current) return;
        setLocating(false);
        notify(
          error.code === 1 ? "gpsDenied" : error.code === 3 ? "gpsTimeout" : "gpsUnavailable",
          true,
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }
  const openMaps = (p: Place) => {
    if (prefs.provider) location.assign(mapURL(prefs.provider, p));
    else setMaps(p);
  };
  const remove = async (p: PlaceRecord) => {
    if (!confirm(`${t("deletePlace")}\n\n${t("deletePlaceBody")}`)) return;
    try {
      await deleteEntity(scope, p.id);
      setSelected(null);
      setMenu(null);
      await refresh();
      sync();
    } catch {
      notify("storageFailure", true);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("copied");
    } catch {
      setNotice({ text, error: false });
    }
  };
  const share = async (p: PlaceRecord) => {
    const cat = categoryFor(p.value.categoryId),
      url = shareURL(p.value, cat ? categoryLabel(cat) : t("other"), location.origin);
    try {
      if (navigator.share) await navigator.share({ title: p.value.name, text: p.value.name, url });
      else {
        await navigator.clipboard.writeText(url);
        notify("shareReady");
      }
      setSharePlace(null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) await copy(url);
    }
  };
  function download() {
    try {
      if (!workspace) return;
      const blob = new Blob([JSON.stringify(exportBackup(workspace), null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `voltura-places-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("exported");
    } catch {
      notify("invalidImport", true);
    }
  }
  async function loadFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) {
        notify("importLimit", true);
        return;
      }
      setBackup(validateBackup(JSON.parse(await file.text())));
      setReplace(false);
      setSettings(null);
    } catch {
      notify("invalidImport", true);
    }
  }
  async function signOut() {
    await signOutLocally(account.account?.id);
    setAccount(defaults);
    scopeRef.current = "guest";
    setScope("guest");
    setSelected(null);
    setEditor(null);
    setReconciling(false);
    await refresh();
    setStatus("localOnly");
  }
  async function deleteAccount() {
    const id = account.account!.id;
    await api("/api/account", { confirm: "delete-places-account" }, id, "DELETE");
    await removeWorkspace(id);
    await refreshAccount();
  }
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(prefs.language, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const categoryColor = (id: string) => {
    const c = categoryFor(id);
    return c?.kind === "category" ? c.value.color : "slate";
  };
  const Details = ({ record }: { record: PlaceRecord }) => (
    <div className="details-content">
      <div className={`detail-marker ${categoryColor(record.value.categoryId)}`}>
        <MapPin size={38} />
      </div>
      <span className="eyebrow">
        {categoryFor(record.value.categoryId)
          ? categoryLabel(categoryFor(record.value.categoryId)!)
          : t("other")}
      </span>
      <h2>{record.value.name}</h2>
      <p className="coordinate-display">
        {record.value.latitude.toFixed(6)}, {record.value.longitude.toFixed(6)}
      </p>
      <dl>
        <div>
          <dt>{t("captured")}</dt>
          <dd>{formatDate(record.value.capturedAt)}</dd>
        </div>
        {record.value.accuracy !== null && (
          <div>
            <dt>{t("accuracy")}</dt>
            <dd>±{Math.round(record.value.accuracy)} m</dd>
          </div>
        )}
      </dl>
      <button className="button primary" onClick={() => openMaps(record.value)}>
        <Navigation size={20} />
        {t("openMaps")}
        <ArrowUpRight size={18} />
      </button>
      <div className="action-pair">
        <button className="button outline" onClick={() => setSharePlace(record)}>
          <Share2 size={18} />
          {t("share")}
        </button>
        <button className="button outline" onClick={() => setEditor({ entity: record })}>
          <Pencil size={18} />
          {t("edit")}
        </button>
      </div>
      <button
        className="button quiet"
        onClick={() => void copy(`${record.value.latitude}, ${record.value.longitude}`)}
      >
        <Copy size={17} />
        {t("copyCoordinates")}
      </button>
    </div>
  );
  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          <div className="header-actions">
            <button
              className={`sync-pill ${status === "actionRequired" ? "warning" : ""}`}
              onClick={() => setSettings("account")}
              aria-label={t("account")}
            >
              <span className="status-dot" />
              {t(
                (!navigator.onLine
                  ? "offline"
                  : scope === "guest"
                    ? "localOnly"
                    : status) as Message,
              )}
            </button>
            <button
              className="icon-button"
              aria-label={t("settings")}
              onClick={() => setSettings("preferences")}
            >
              <Settings2 size={22} />
            </button>
          </div>
        </div>
      </header>
      <main className="app-main">
        <section className="library-pane">
          <div className="library-title">
            <div>
              <span className="eyebrow">{t("tagline")}</span>
              <h1>
                {t("library")}
                <span className="count">{places.length}</span>
              </h1>
            </div>
            <button
              className="icon-button add-manual"
              onClick={() => setEditor({})}
              aria-label={t("manual")}
              title={t("manual")}
            >
              <Plus />
            </button>
          </div>
          <div className="search-row">
            <div className="search-field">
              <Search size={20} />
              <input
                aria-label={t("search")}
                placeholder={t("search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label={t("clearSearch")}
                  onClick={() => setSearch("")}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <label className="sort-button">
              <ArrowDownUp size={20} />
              <select aria-label={t("sort")} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">{t("newest")}</option>
                <option value="name">{t("byName")}</option>
              </select>
            </label>
          </div>
          <nav className="category-chips" aria-label={t("categories")}>
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              {t("all")}
            </button>
            {categories
              .filter((c) => places.some((p) => p.value.categoryId === c.id))
              .map((c) => (
                <button
                  key={c.id}
                  className={filter === c.id ? "active" : ""}
                  onClick={() => setFilter(c.id)}
                >
                  <span className={`category-dot ${c.kind === "category" ? c.value.color : ""}`} />
                  {categoryLabel(c)}
                </button>
              ))}
          </nav>
          {!places.length ? (
            <div className="empty-state">
              <TrailArt />
              <h2>{t("emptyTitle")}</h2>
              <p>{t("emptyBody")}</p>
              <span className="offline-tip">
                <Signal size={16} />
                {t("emptyTip")}
              </span>
              <button className="button quiet" onClick={() => setEditor({})}>
                {t("manual")}
                <ChevronRight size={17} />
              </button>
            </div>
          ) : !filtered.length ? (
            <div className="no-results">
              <Search size={30} />
              <h2>{t("noResults")}</h2>
              <button
                className="button quiet"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                {t("clearSearch")}
              </button>
            </div>
          ) : (
            <div className="place-list">
              {filtered.map((p) => (
                <article key={p.id} className={`place-card ${selected === p.id ? "selected" : ""}`}>
                  <button className="card-main" onClick={() => setSelected(p.id)}>
                    <span className={`place-marker ${categoryColor(p.value.categoryId)}`}>
                      <MapPin size={24} />
                    </span>
                    <span className="card-text">
                      <strong>{p.value.name}</strong>
                      <span>
                        {categoryFor(p.value.categoryId)
                          ? categoryLabel(categoryFor(p.value.categoryId)!)
                          : t("other")}
                        <span className="middle-dot">·</span>
                        {new Intl.DateTimeFormat(prefs.language, {
                          day: "numeric",
                          month: "short",
                        }).format(new Date(p.value.capturedAt))}
                      </span>
                    </span>
                  </button>
                  <div className="card-actions">
                    <button className="card-maps" onClick={() => openMaps(p.value)}>
                      <Navigation size={17} />
                      {t("openMaps")}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`${t("edit")}: ${p.value.name}`}
                      onClick={() => setMenu(p)}
                    >
                      <MoreHorizontal size={21} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {conflicts.length > 0 && (
            <section className="conflict-notice">
              <h2>{t("conflicts")}</h2>
              <p>{t("conflictBody")}</p>
              {conflicts.map((r) => (
                <div className="conflict" key={r.id}>
                  <strong>{r.kind === "place" ? r.value.name : categoryLabel(r)}</strong>
                  <p>
                    {t("device")}: {r.deleted ? t("deleted") : r.value.name}
                    <br />
                    {t("cloud")}: {r.conflict?.deleted ? t("deleted") : r.conflict?.value.name}
                  </p>
                  <div className="stack">
                    {(["device", "cloud", "both"] as const).map((choice) => (
                      <button
                        key={choice}
                        className="button outline"
                        onClick={() =>
                          void resolveConflict(scope, r.id, choice).then(() => {
                            void refresh();
                            sync();
                          })
                        }
                      >
                        {t(
                          choice === "device"
                            ? "keepDevice"
                            : choice === "cloud"
                              ? "keepCloud"
                              : "keepBoth",
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </section>
        <aside className="detail-pane">
          {current ? (
            <Details record={current} />
          ) : (
            <div className="detail-welcome">
              <div className="terrain-lines" />
              <Trees size={34} />
              <h2>{t("selectedTitle")}</h2>
              <p>{t("selectedBody")}</p>
              <span className="eyebrow">VOLTURA PLACES</span>
            </div>
          )}
        </aside>
      </main>
      <div className="save-dock">
        <div className="dock-inner">
          <div className="dock-hint">
            <span className="status-dot" />
            {t("emptyTip")}
          </div>
          <button
            className="button primary save-here"
            disabled={locating || !workspace || reconciling}
            onClick={saveHere}
          >
            {locating ? <LoaderCircle className="spin" size={22} /> : <LocateFixed size={24} />}{" "}
            {t(locating ? "locating" : "saveHere")}
          </button>
          {locating && (
            <button
              className="icon-button"
              aria-label={t("cancelCapture")}
              onClick={() => {
                capture.current++;
                setLocating(false);
              }}
            >
              <X />
            </button>
          )}
        </div>
      </div>
      {notice && (
        <div
          className={`toast ${notice.error ? "error-toast" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <MapPin size={18} /> : <Check size={18} />}
          <span>{notice.text}</span>
          <button className="icon-button" aria-label={t("close")} onClick={() => setNotice(null)}>
            <X size={17} />
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        hidden
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          void loadFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {editor && (
        <Editor
          key={`${scope}-${editor.entity?.id ?? editor.draftId ?? "new"}`}
          entity={editor.entity}
          fresh={editor.fresh}
          draftId={editor.draftId}
          categories={categories}
          categoryLabel={categoryLabel}
          t={t}
          onClose={() => setEditor(null)}
          onSave={save}
          workspace={scope}
        />
      )}
      {settings && (
        <Settings
          initial={settings}
          t={t}
          preferences={prefs}
          onPreferences={setPrefs}
          onClose={() => setSettings(null)}
          onExport={download}
          onImport={() => fileRef.current?.click()}
          categories={categories}
          categoryLabel={categoryLabel}
          onCategory={(entity) =>
            setCategoryEdit({
              entity,
              name: entity ? categoryLabel(entity) : "",
              color: entity?.kind === "category" ? entity.value.color : "green",
            })
          }
          onDeleteCategory={(r) => {
            if (confirm(`${t("deleteCategory")}\n${t("deleteCategoryBody")}`))
              void deleteEntity(scope, r.id)
                .then(() => {
                  void refresh();
                  sync();
                })
                .catch(() => notify("storageFailure", true));
          }}
          account={account}
          onAccount={refreshAccount}
          onSignOut={signOut}
          onDeleteAccount={deleteAccount}
          onRemoveDevice={async () => {
            const id = account.account!.id;
            await api("/api/account/sign-out", {}, id);
            await removeWorkspace(id);
            await refreshAccount();
          }}
        />
      )}
      {categoryEdit && (
        <Sheet
          title={t(categoryEdit.entity ? "rename" : "newCategory")}
          onClose={() => setCategoryEdit(null)}
          closeLabel={t("close")}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = categorySchema.safeParse({
                name: categoryEdit.name,
                color: categoryEdit.color,
              });
              if (!parsed.success) return;
              void save({
                id: categoryEdit.entity?.id ?? crypto.randomUUID(),
                kind: "category",
                value: parsed.data,
              })
                .then(() => setCategoryEdit(null))
                .catch(() => notify("storageFailure", true));
            }}
          >
            <label>
              {t("categoryName")}
              <input
                value={categoryEdit.name}
                maxLength={60}
                required
                onChange={(e) => setCategoryEdit({ ...categoryEdit, name: e.target.value })}
              />
            </label>
            <label>
              {t("color")}
              <select
                value={categoryEdit.color}
                onChange={(e) => setCategoryEdit({ ...categoryEdit, color: e.target.value })}
              >
                {(["green", "blue", "amber", "purple", "slate"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(k)}
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary">{t("save")}</button>
          </form>
        </Sheet>
      )}
      {maps && (
        <Sheet title={t("openWith")} onClose={() => setMaps(null)} closeLabel={t("close")}>
          <p className="muted">{maps.name}</p>
          <div className="stack">
            {(["google", "apple", "geo"] as const).map((k) => (
              <a
                key={k}
                className="button outline"
                href={mapURL(k, maps)}
                onClick={() => {
                  setPrefs({ ...prefs, provider: k });
                  setMaps(null);
                }}
              >
                <Map size={19} />
                {t(k)}
                <ArrowUpRight size={17} />
              </a>
            ))}
            <button
              className="button quiet"
              onClick={() => void copy(`${maps.latitude}, ${maps.longitude}`)}
            >
              <Copy size={18} />
              {t("copyCoordinates")}
            </button>
          </div>
        </Sheet>
      )}
      {sharePlace && (
        <Sheet title={t("share")} onClose={() => setSharePlace(null)} closeLabel={t("close")}>
          <h3>{sharePlace.value.name}</h3>
          <p className="muted">{t("shareNotice")}</p>
          <button className="button primary" onClick={() => void share(sharePlace)}>
            <Share2 size={19} />
            {t("share")}
          </button>
        </Sheet>
      )}
      {shared && (
        <Sheet title={t("sharedTitle")} onClose={() => setShared(null)} closeLabel={t("close")}>
          <div className="stack">
            <div className="section-icon">
              <MapPin />
            </div>
            <h3>{shared.name}</h3>
            <p className="muted">
              {shared.category} · {shared.latitude.toFixed(6)}, {shared.longitude.toFixed(6)}
            </p>
            <button
              className="button primary"
              onClick={() =>
                void (async () => {
                  const now = new Date().toISOString(),
                    cat = categories.find((c) => categoryLabel(c) === shared.category);
                  try {
                    await save({
                      id: crypto.randomUUID(),
                      kind: "place",
                      value: {
                        name: shared.name,
                        latitude: shared.latitude,
                        longitude: shared.longitude,
                        accuracy: null,
                        capturedAt: now,
                        updatedAt: now,
                        categoryId: cat?.id ?? "other",
                      },
                    });
                    setShared(null);
                    notify("saved");
                  } catch {
                    notify("storageFailure", true);
                  }
                })()
              }
            >
              {t("saveCopy")}
            </button>
            <button
              className="button outline"
              onClick={() => {
                openMaps({
                  name: shared.name,
                  latitude: shared.latitude,
                  longitude: shared.longitude,
                } as Place);
                setShared(null);
              }}
            >
              {t("openMaps")}
            </button>
          </div>
        </Sheet>
      )}
      {backup && (
        <Sheet title={t("importTitle")} onClose={() => setBackup(null)} closeLabel={t("close")}>
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
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (replace && !confirm(t("confirmReplace"))) return;
                setBusy(true);
                void importBackup(scope, backup, replace)
                  .then(() => {
                    setBackup(null);
                    notify("imported");
                    void refresh();
                    sync();
                  })
                  .catch((error) =>
                    notify(
                      error instanceof Error && error.message === "syncBusy"
                        ? "syncBusy"
                        : "storageFailure",
                      true,
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {t(busy ? "working" : "import")}
            </button>
          </div>
        </Sheet>
      )}
      {reconciling && account.account && (
        <Sheet
          title={t("reconcileTitle")}
          onClose={() => {
            void signOut();
          }}
          closeLabel={t("close")}
        >
          <div className="stack">
            <p className="muted">{t("reconcileBody")}</p>
            {[true, false].map((merge) => (
              <button
                key={String(merge)}
                className={`button ${merge ? "primary" : "outline"}`}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  const id = account.account!.id;
                  void fetchSnapshot(id)
                    .then((snapshot) => reconcileAccount(id, snapshot.records, merge))
                    .then(() => {
                      setReconciling(false);
                      void refresh();
                      sync();
                    })
                    .catch(() => notify("serviceUnavailable", true))
                    .finally(() => setBusy(false));
                }}
              >
                {t(merge ? "mergeGuest" : "cloudOnly")}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {menu && (
        <Sheet title={menu.value.name} onClose={() => setMenu(null)} closeLabel={t("close")}>
          <div className="stack">
            <button
              className="button outline"
              onClick={() => {
                setEditor({ entity: menu });
                setMenu(null);
              }}
            >
              <Pencil size={18} />
              {t("edit")}
            </button>
            <button
              className="button outline"
              onClick={() => {
                setSharePlace(menu);
                setMenu(null);
              }}
            >
              <Share2 size={18} />
              {t("share")}
            </button>
            <button className="button danger" onClick={() => void remove(menu)}>
              <Trash2 size={18} />
              {t("delete")}
            </button>
          </div>
        </Sheet>
      )}
      {current && mobile && !editor && !menu && !sharePlace && !settings && !maps && (
        <Sheet title={current.value.name} onClose={() => setSelected(null)} closeLabel={t("close")}>
          <Details record={current} />
        </Sheet>
      )}
      {update && (
        <div className="update-banner" role="status">
          <span>
            <strong>{t("updateReady")}</strong>
            <small>{t("updateHint")}</small>
          </span>
          <button
            className="button primary"
            onClick={() => void flushDrafts().then(() => swUpdate.current?.(true))}
          >
            {t("update")}
          </button>
          <button
            className="icon-button"
            aria-label={t("updateLater")}
            onClick={() => setUpdate(false)}
          >
            <X />
          </button>
        </div>
      )}
    </>
  );
}
