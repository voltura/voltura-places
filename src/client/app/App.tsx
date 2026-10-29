import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  LocateFixed,
  MapPin,
  Settings2,
  Share2,
  X,
  Pencil,
  Trash2,
  Copy,
  LoaderCircle,
  Map,
} from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { DialogLayer } from "../ui/DialogLayer";
import { watchForUpdates } from "../foundation/updates";
import { exportWithPhotos } from "../foundation/photo-backup";
import { BACKUP_BYTES } from "../../shared/photos";
import { Brand } from "../ui/Brand";
import { PlaceDetails } from "../features/PlaceDetails";
import { LibraryView } from "../features/LibraryView";
import { ImportDialog, ReconcileDialog } from "../features/LibraryTransfers";
import { FamilyPanel, FamilyInvitation } from "../features/Family";
import {
  cachedFamily,
  fetchFamily,
  storeFamily,
  initialWorkspace,
  familyInvitation,
  rememberInvitation,
  type FamilyCache,
} from "../foundation/family";
import { familyKey, workspaceIdentity, type Family } from "../../shared/families";
import { LocationReview } from "../features/LocationReview";
import { validPosition } from "../foundation/location-review";
import { Editor } from "../features/Editor";
import { Settings, type Preferences } from "../features/Settings";
import { messages, type Message } from "../foundation/i18n";
import { api, synchronize, type AccountState } from "../foundation/sync";
import { cachedAccount, currentAccount, signOutLocally } from "../foundation/account";
import {
  channel,
  deleteEntity,
  getDraft,
  flushDrafts,
  readWorkspace,
  removeAccountWorkspaces,
  copyPlaceToWorkspace,
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
  const requested = new URLSearchParams(location.search).get("lang");
  const linkedLanguage = requested === "sv" || requested === "en" ? requested : null;
  const defaults: Preferences = {
    language: linkedLanguage ?? (navigator.language.startsWith("sv") ? "sv" : "en"),
    theme: "dark",
    provider: "",
    lastCategory: "other",
    reviewGps: false,
    units: "metric",
  };
  try {
    const v = JSON.parse(localStorage.getItem("places-preferences") ?? "null");
    if (
      v &&
      ["en", "sv"].includes(v.language) &&
      ["light", "dark", "system"].includes(v.theme) &&
      ["", "google", "apple", "geo"].includes(v.provider)
    )
      return {
        ...defaults,
        ...v,
        language: linkedLanguage ?? v.language,
        reviewGps: v.reviewGps === true,
        units: v.units === "imperial" ? "imperial" : "metric",
      };
  } catch {}
  return defaults;
}
type PlaceRecord = LocalRecord & { kind: "place"; value: Place };
const isPlace = (r: LocalRecord): r is PlaceRecord => r.kind === "place";
export function App() {
  const [prefs, setPrefs] = useState(loadPreferences),
    t = useMemo(() => messages(prefs.language), [prefs.language]);
  useEffect(() => {
    const url = new URL(location.href);
    if (["sv", "en"].includes(url.searchParams.get("lang") ?? "")) {
      url.searchParams.delete("lang");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [scope, setScope] = useState(() => initialWorkspace(cachedAccount().account?.id)),
    [account, setAccount] = useState<AccountState>(cachedAccount);
  const authRef = useRef(account.account?.id);
  const familyRequest = useRef(0);
  authRef.current = account.account?.id;
  const [familyCache, setFamilyCache] = useState<FamilyCache>(() =>
    cachedFamily(cachedAccount().account?.id),
  );
  const [inviteToken, setInviteToken] = useState(familyInvitation);
  const selectedFamily = workspaceIdentity(scope).family;
  const canWrite =
    !selectedFamily || (familyCache.active && familyCache.family?.id === selectedFamily);
  const writeAllowed = useRef(canWrite);
  writeAllowed.current = canWrite;
  useEffect(() => {
    if (inviteToken) {
      rememberInvitation(inviteToken);
      if (location.hash.startsWith("#family="))
        history.replaceState(history.state, "", location.pathname + location.search);
    }
  }, [inviteToken]);
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
    [backup, setBackup] = useState<Backup | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null),
    [locating, setLocating] = useState(false),
    [gpsReview, setGpsReview] = useState(false),
    [status, setStatus] = useState(() => (cachedAccount().account ? "pending" : "localOnly")),
    [update, setUpdate] = useState(false);
  const [shared, setShared] = useState(() => parseShare(location.hash)),
    [sharePlace, setSharePlace] = useState<PlaceRecord | null>(null);
  const [reconciling, setReconciling] = useState(false),
    [menu, setMenu] = useState<PlaceRecord | null>(null),
    [mobile, setMobile] = useState(() => matchMedia("(max-width:700px)").matches);
  const capture = useRef(0),
    fileRef = useRef<HTMLInputElement>(null),
    swUpdate = useRef<((reload?: boolean) => Promise<void>) | null>(null),
    updateMonitor = useRef<ReturnType<typeof watchForUpdates> | null>(null),
    scopeRef = useRef(scope),
    accountRequest = useRef(0);
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
                mushrooms: "Mushrooms",
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
      if (scopeRef.current === key) {
        setWorkspace(w);
        setReconciling(key !== "guest" && !w.reconciled);
      }
    } catch {
      setNotice({ text: t("storageFailure"), error: true });
    }
  }, [t]);
  const sync = useCallback(() => {
    const key = scopeRef.current;
    if (key !== "guest")
      void synchronize(
        key,
        (s) => {
          if (scopeRef.current === key) setStatus(s);
        },
        () => scopeRef.current === key,
      ).then(refresh);
  }, [refresh]);
  const refreshAccount = useCallback(async () => {
    const request = ++accountRequest.current;
    const next = await currentAccount();
    if (request !== accountRequest.current) return;
    authRef.current = next.account?.id;
    setAccount(next);
    const key = next.account?.id ?? "guest";
    if (workspaceIdentity(scopeRef.current).account !== key) {
      scopeRef.current = key;
      setScope(key);
      setFamilyCache(cachedFamily(next.account?.id));
      setStatus(key === "guest" ? "localOnly" : "pending");
      setSelected(null);
      setEditor(null);
      setMaps(null);
      setSharePlace(null);
      setMenu(null);
      setBackup(null);
      setCategoryEdit(null);
      setNotice(null);
      setSearch("");
      setFilter("all");
      setGpsReview(false);
      capture.current++;
      setLocating(false);
    }
    const selectedKey = scopeRef.current;
    const w = await readWorkspace(selectedKey);
    if (request !== accountRequest.current || scopeRef.current !== selectedKey) return;
    setWorkspace(w);
    setReconciling(selectedKey !== "guest" && !w.reconciled);
    const familyCheck = ++familyRequest.current;
    if (next.account)
      void fetchFamily(next.account.id)
        .then((value) => {
          if (
            familyCheck === familyRequest.current &&
            request === accountRequest.current &&
            workspaceIdentity(scopeRef.current).account === next.account!.id
          ) {
            setFamilyCache(storeFamily(next.account!.id, value.active ? value.family : null));
            const selected = workspaceIdentity(scopeRef.current).family;
            if (selected && value.active && selected !== value.family?.id)
              switchLibrary(next.account!.id);
          }
        })
        .catch(() => {});
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
      foreground();
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
    if (location.hash && !shared && !inviteToken) notify("invalidShare", true);
    if (shared) history.replaceState(null, "", location.pathname + location.search);
    let disposed = false;
    if (import.meta.env.PROD)
      swUpdate.current = registerSW({
        onNeedRefresh: () => setUpdate(true),
        onRegisteredSW: (_url, registration) => {
          if (registration && !disposed)
            updateMonitor.current = watchForUpdates(registration, () => setUpdate(true));
        },
        onNeedReload: () =>
          void flushDrafts()
            .then(() => location.reload())
            .catch(() => notify("storageFailure", true)),
        onRegisterError: () => {},
      });
    return () => {
      disposed = true;
      updateMonitor.current?.dispose();
    };
  }, []);
  async function save(entity: Entity) {
    if (!writeAllowed.current) throw new Error("familyAccessEnded");
    await saveEntity(scopeRef.current, entity);
    if (entity.kind === "place") setPrefs((p) => ({ ...p, lastCategory: entity.value.categoryId }));
    await refresh();
    setStatus(scopeRef.current === "guest" ? "localOnly" : "pending");
    sync();
  }
  async function persistPosition(position: GeolocationPosition, operation: number, key: string) {
    if (operation !== capture.current || key !== scopeRef.current || !writeAllowed.current) return;
    if (!validPosition(position)) {
      setLocating(false);
      notify("gpsUnavailable", true);
      return;
    }
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
        capturedAt: new Date(position.timestamp).toISOString(),
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
  }
  function saveHere() {
    if (!writeAllowed.current) {
      notify("familyAccessEnded", true);
      return;
    }
    if (!navigator.geolocation) {
      notify("gpsUnsupported", true);
      return;
    }
    setNotice(null);
    if (prefs.reviewGps) {
      setGpsReview(true);
      return;
    }
    const operation = ++capture.current,
      key = scopeRef.current;
    setLocating(true);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => void persistPosition(position, operation, key),
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
    } catch {
      setLocating(false);
      notify("gpsUnavailable", true);
    }
  }
  const openMaps = (p: Place) => {
    if (prefs.provider) location.assign(mapURL(prefs.provider, p));
    else setMaps(p);
  };
  const remove = async (p: PlaceRecord) => {
    if (!writeAllowed.current) {
      notify("familyAccessEnded", true);
      return;
    }
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
  async function download(key = scopeRef.current) {
    try {
      const exporting = await readWorkspace(key);
      const blob = new Blob([JSON.stringify(await exportWithPhotos(exporting), null, 2)], {
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
    const key = scopeRef.current;
    try {
      if (file.size > BACKUP_BYTES) {
        notify("importLimit", true);
        return;
      }
      const parsed = validateBackup(JSON.parse(await file.text()));
      if (key !== scopeRef.current || !writeAllowed.current) return;
      setBackup(parsed);
      setSettings(null);
    } catch {
      notify("invalidImport", true);
    }
  }
  async function signOut() {
    const signingOutId = account.account?.id;
    authRef.current = undefined;
    accountRequest.current++;
    setAccount((previous) => ({ ...previous, account: null }));
    setFamilyCache({ family: null, active: false });
    setWorkspace(null);
    scopeRef.current = "guest";
    setScope("guest");
    setSelected(null);
    setEditor(null);
    setMaps(null);
    setSharePlace(null);
    setMenu(null);
    setBackup(null);
    setCategoryEdit(null);
    setNotice(null);
    setSearch("");
    setFilter("all");
    setReconciling(false);
    setGpsReview(false);
    capture.current++;
    setLocating(false);
    const logout = signOutLocally(signingOutId);
    await refresh();
    setStatus("localOnly");
    await logout;
    await refreshAccount().catch(() => {});
  }
  async function deleteAccount() {
    const id = account.account!.id;
    await api("/api/account", { confirm: "delete-places-account" }, id, "DELETE");
    await signOut();
    await removeAccountWorkspaces(id);
  }
  function switchLibrary(key: string) {
    if (!authRef.current || workspaceIdentity(key).account !== authRef.current) return;
    scopeRef.current = key;
    setScope(key);
    setReconciling(false);
    setWorkspace(null);
    setSelected(null);
    setEditor(null);
    setMaps(null);
    setSharePlace(null);
    setBackup(null);
    setCategoryEdit(null);
    setGpsReview(false);
    setMenu(null);
    setSettings(null);
    setSearch("");
    setFilter("all");
    capture.current++;
    setLocating(false);
    try {
      localStorage.setItem(`places-workspace:${authRef.current}`, key);
    } catch {}
    void refresh();
  }
  function familyChanged(family: Family | null) {
    familyRequest.current++;
    if (account.account && authRef.current === account.account.id)
      setFamilyCache(storeFamily(account.account.id, family));
  }
  async function copyToFamily(id: string) {
    if (!account.account || !familyCache.active || !familyCache.family) return;
    const key = familyKey(account.account.id, familyCache.family.id);
    try {
      await copyPlaceToWorkspace(scopeRef.current, key, id);
      await synchronize(
        key,
        () => {},
        () => workspaceIdentity(scopeRef.current).account === account.account!.id,
      );
      setMenu(null);
      notify("copiedToFamily");
    } catch {
      notify("storageFailure", true);
    }
  }
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(prefs.language, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const categoryColor = (id: string) => {
    const c = categoryFor(id);
    return c?.kind === "category" ? c.value.color : "slate";
  };
  const renderDetails = (record: PlaceRecord) => (
    <PlaceDetails
      canWrite={canWrite}
      record={record}
      workspace={scope}
      units={prefs.units}
      categoryColor={categoryColor}
      categoryFor={categoryFor}
      categoryLabel={categoryLabel}
      t={t}
      formatDate={formatDate}
      openMaps={openMaps}
      chooseMaps={setMaps}
      setSharePlace={setSharePlace}
      setEditor={(value) => {
        if (writeAllowed.current) setEditor(value);
        else notify("familyAccessEnded", true);
      }}
      copy={copy}
    />
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
      {account.account && familyCache.family && (
        <section className="library-switcher" aria-label={t("libraryChoice")}>
          <button
            className={`button ${!selectedFamily ? "primary" : "outline"}`}
            onClick={() => switchLibrary(account.account!.id)}
            aria-pressed={!selectedFamily}
          >
            {t("privateLibrary")}
          </button>
          <button
            className={`button ${selectedFamily ? "primary" : "outline"}`}
            onClick={() => switchLibrary(familyKey(account.account!.id, familyCache.family!.id))}
            aria-pressed={!!selectedFamily}
          >
            {familyCache.family.name}
            {!familyCache.active && ` · ${t("familyLocalCopy")}`}
          </button>
        </section>
      )}
      {selectedFamily && (
        <p className="shared-library-notice">
          {t(canWrite ? "familyLibraryHint" : "familyReadonly")}
        </p>
      )}
      <LibraryView
        canWrite={canWrite}
        title={selectedFamily ? (familyCache.family?.name ?? t("familyLibrary")) : undefined}
        {...{
          t,
          places,
          filtered,
          categories,
          filter,
          setFilter,
          search,
          setSearch,
          sort,
          setSort,
          selected,
          setSelected,
          categoryLabel,
          categoryFor,
          categoryColor,
          openMaps,
          setMenu,
          conflicts,
          current,
          renderDetails,
          prefs,
        }}
        setEditor={(value) => {
          if (canWrite) setEditor(value);
        }}
        onResolve={(id, choice) =>
          void (
            canWrite
              ? resolveConflict(scope, id, choice)
              : Promise.reject(new Error("familyAccessEnded"))
          )
            .then(() => {
              void refresh();
              sync();
            })
            .catch(() => notify(canWrite ? "storageFailure" : "familyAccessEnded", true))
        }
      />

      <div className="save-dock">
        <div className="dock-inner">
          <div className="dock-hint">
            <span className="status-dot" />
            {t("emptyTip")}
          </div>
          <button
            className="button primary save-here"
            disabled={locating || !workspace || reconciling || !canWrite}
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
      {notice && <Toast {...notice} closeLabel={t("close")} onClose={() => setNotice(null)} />}
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
          units={prefs.units}
          reviewGps={prefs.reviewGps}
          onClose={() => setEditor(null)}
          onSave={save}
          workspace={scope}
          updateReady={update}
          onUpdate={() =>
            void flushDrafts()
              .then(() => swUpdate.current?.(true))
              .catch(() => notify("storageFailure", true))
          }
        />
      )}
      {settings && (
        <Settings
          initial={settings}
          familyPanel={
            <FamilyPanel
              key={account.account?.id ?? "guest"}
              account={account.account}
              cache={familyCache}
              t={t}
              onChanged={familyChanged}
              onOpen={() => {
                if (account.account && familyCache.family)
                  switchLibrary(familyKey(account.account.id, familyCache.family.id));
              }}
              onSignIn={() => setSettings("account")}
              onExport={() => {
                if (account.account && familyCache.family)
                  void download(familyKey(account.account.id, familyCache.family.id));
              }}
            />
          }
          t={t}
          preferences={prefs}
          onPreferences={setPrefs}
          onClose={() => setSettings(null)}
          onCheckUpdates={() => {
            void updateMonitor.current
              ?.check(true)
              .then((result) =>
                notify(
                  result === "current"
                    ? "upToDate"
                    : result === "offline"
                      ? "offline"
                      : result === "ready"
                        ? "updateReady"
                        : "checkingUpdates",
                ),
              )
              .catch(() => notify("serviceUnavailable", true));
          }}
          onExport={() => void download()}
          onImport={() => {
            if (canWrite) fileRef.current?.click();
            else notify("familyAccessEnded", true);
          }}
          categories={categories}
          categoryLabel={categoryLabel}
          onCategory={(entity) =>
            canWrite &&
            setCategoryEdit({
              entity,
              name: entity ? categoryLabel(entity) : "",
              color: entity?.kind === "category" ? entity.value.color : "green",
            })
          }
          onDeleteCategory={(r) => {
            if (canWrite && confirm(`${t("deleteCategory")}\n${t("deleteCategoryBody")}`))
              void deleteEntity(scope, r.id)
                .then(() => {
                  void refresh();
                  sync();
                })
                .catch(() => notify("storageFailure", true));
          }}
          account={account}
          onAccount={async () => {
            await refreshAccount();
            if (inviteToken) setSettings(null);
          }}
          onSignOut={signOut}
          onSync={sync}
          onDeleteAccount={deleteAccount}
          onRemoveDevice={async () => {
            const id = account.account!.id;
            await signOut();
            await removeAccountWorkspaces(id);
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
        <ImportDialog
          key={scope}
          backup={backup}
          workspace={scope}
          t={t}
          onClose={() => setBackup(null)}
          onComplete={() => {
            setBackup(null);
            notify("imported");
            void refresh();
            sync();
          }}
        />
      )}
      {reconciling && account.account && !inviteToken && (
        <ReconcileDialog
          key={account.account.id}
          accountId={account.account.id}
          t={t}
          onClose={() => {
            void signOut();
          }}
          onComplete={() => {
            setReconciling(false);
            void refresh();
            sync();
          }}
        />
      )}
      {menu && (
        <Sheet title={menu.value.name} onClose={() => setMenu(null)} closeLabel={t("close")}>
          <div className="stack">
            <button
              className="button outline"
              disabled={!canWrite}
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
            {account.account && !selectedFamily && familyCache.active && (
              <button className="button outline" onClick={() => void copyToFamily(menu.id)}>
                {t("copyToFamily")}
              </button>
            )}
            <button
              className="button danger"
              disabled={!canWrite}
              onClick={() => void remove(menu)}
            >
              <Trash2 size={18} />
              {t("delete")}
            </button>
          </div>
        </Sheet>
      )}
      {current && mobile && !editor && !menu && !sharePlace && !settings && !maps && (
        <Sheet title={current.value.name} onClose={() => setSelected(null)} closeLabel={t("close")}>
          {renderDetails(current)}
        </Sheet>
      )}
      {inviteToken && !settings && (
        <FamilyInvitation
          token={inviteToken}
          account={account.account}
          t={t}
          onClose={() => {
            rememberInvitation(null);
            setInviteToken(null);
          }}
          onSignIn={() => setSettings("account")}
          onJoined={(family) => {
            if (authRef.current !== account.account?.id) return;
            familyChanged(family);
            rememberInvitation(null);
            setInviteToken(null);
            switchLibrary(familyKey(account.account!.id, family.id));
          }}
        />
      )}
      {gpsReview && (
        <LocationReview
          units={prefs.units}
          t={t}
          onClose={() => setGpsReview(false)}
          onConfirm={(position) => {
            setGpsReview(false);
            setLocating(true);
            void persistPosition(position, ++capture.current, scopeRef.current);
          }}
        />
      )}
      {update && !editor && (
        <DialogLayer>
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
        </DialogLayer>
      )}
    </>
  );
}
