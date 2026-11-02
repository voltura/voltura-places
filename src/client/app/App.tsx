import { Editor } from "../features/Editor";
import { CategoryEditor } from "../features/CategoryEditor";
import { Settings } from "../features/Settings";
import { FamilyPanel } from "../features/Family";
import { visitOwner, visitStatuses } from "../../shared/visits";
import { GroupCopyPicker } from "../features/GroupCopyPicker";
import { categoryName } from "../../shared/category-names";
import { distanceMetres } from "../foundation/distance";
import { usePreferences } from "./usePreferences";
import { startActivityReporting } from "../foundation/activity";
import { useAutoHideSaveBar } from "./useAutoHideSaveBar";
import { useCurrentPosition } from "./useCurrentPosition";
import { shareOrCopy } from "../foundation/sharing";
import { categoryAppearance } from "../features/CategoryAppearance";
import { mapProviders } from "../foundation/map-providers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocateFixed,
  ChevronDown,
  MapPin,
  Settings2,
  Share2,
  X,
  Pencil,
  Trash2,
  Copy,
  LoaderCircle,
  Users,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import { watchForUpdates } from "../foundation/updates";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { exportWithPhotos } from "../foundation/photo-backup";
import { BACKUP_BYTES } from "../../shared/photos";
import { Brand } from "../ui/Brand";
import { MapAppChooser } from "../features/MapAppChooser";
import { PlaceDetails } from "../features/PlaceDetails";
import { LibraryView } from "../features/LibraryView";
import { LibrarySelector } from "../features/LibrarySelector";
import { ImportDialog, DevicePlaceTransfer } from "../features/LibraryTransfers";
import { JoinRequests } from "../features/JoinRequests";
import {
  cachedFamily,
  fetchFamily,
  storeFamilies,
  initialWorkspace,
  type FamilyCache,
} from "../foundation/family";
import { familyKey, workspaceIdentity, type Family } from "../../shared/families";
import { LocationReview } from "../features/LocationReview";
import { validPosition, captureLocation } from "../foundation/location-review";
import { InstallPlaces } from "../features/InstallPlaces";
import { libraryErrorMessage, messages, type Message } from "../foundation/i18n";
import { keepOfflineData } from "../foundation/storage";
import { api, synchronize, type AccountState } from "../foundation/sync";
import { cachedAccount, currentAccount, signOutLocally } from "../foundation/account";
import {
  channel,
  deleteEntity,
  getDraft,
  flushDrafts,
  readWorkspace,
  devicePlacePlan,
  removeAccountWorkspaces,
  copyPlaceToWorkspace,
  resolveConflict,
  saveEntity,
  saveVisit,
  type Workspace,
} from "../foundation/library";
import {
  mapURL,
  directionsURL,
  type MapAction,
  parseShare,
  placeSchema,
  shareURL,
  validateBackup,
  type Backup,
  type Entity,
  type LocalRecord,
  type Place,
  type PlaceRecord,
} from "../../shared/model";

const isPlace = (r: LocalRecord): r is PlaceRecord => r.kind === "place";
export function App() {
  useEffect(() => startActivityReporting(), []);
  const { position: currentPosition, rememberPosition } = useCurrentPosition();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const retentionRequested = useRef(false);
  useEffect(() => {
    if (!retentionRequested.current) {
      retentionRequested.current = true;
      void keepOfflineData();
    }
  }, []);
  const [accountChoice, setAccountChoice] = useState(() => {
    try {
      return !cachedAccount().account && localStorage.getItem("places-account-choice") !== "done";
    } catch {
      return false;
    }
  });
  const completeAccountChoice = () => {
    try {
      localStorage.setItem("places-account-choice", "done");
    } catch {}
    setAccountChoice(false);
  };
  const [prefs, setPrefs] = usePreferences();
  const t = useMemo(() => messages(prefs.language), [prefs.language]);
  const [personalWorkspace, setPersonalWorkspace] = useState<Workspace | null>(null);
  const [visitFilter, setVisitFilter] = useState("all");
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [scope, setScope] = useState(() => initialWorkspace(cachedAccount().account?.id)),
    [account, setAccount] = useState<AccountState>(cachedAccount);
  const authRef = useRef(account.account?.id);
  const [libraryOpen, setLibraryOpen] = useState<false | "selector" | "dock">(false);
  const changeLibraryOpen = useCallback(
    (open: boolean) => setLibraryOpen(open ? "selector" : false),
    [],
  );
  useEffect(() => setLibraryOpen(false), [account.account?.id]);
  const saveDock = useRef<HTMLDivElement>(null);
  const [deletePlace, setDeletePlace] = useState<{ place: PlaceRecord; scope: string } | null>(
    null,
  );
  const [deleteCategory, setDeleteCategory] = useState<{
    entity: LocalRecord;
    scope: string;
  } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const categoryDeletePending = useRef(false);
  useEffect(() => {
    setDeletePlace(null);
    setDeleteCategory(null);
  }, [scope, account.account?.id]);
  useEffect(() => {
    if (account.account) completeAccountChoice();
  }, [account.account?.id]);
  const familyRequest = useRef(0);
  const familyActionPending = useRef(false);
  const [verifiedFamilyAccount, setVerifiedFamilyAccount] = useState<string | null>(null);
  authRef.current = account.account?.id;
  const [familyCache, setFamilyCache] = useState<FamilyCache>(() =>
    cachedFamily(cachedAccount().account?.id),
  );
  const activeGroups = useRef(familyCache.families);
  activeGroups.current = familyCache.families;
  const selectedFamily = workspaceIdentity(scope).family;
  const copyDestinations = familyCache.families.filter((group) => group.id !== selectedFamily);
  const selectedGroup = [...familyCache.families, ...familyCache.inactive].find(
    (f) => f.id === selectedFamily,
  );
  const canWrite = !selectedFamily || familyCache.families.some((f) => f.id === selectedFamily);
  const writeAllowed = useRef(canWrite);
  writeAllowed.current = canWrite;
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("newest"),
    [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!currentPosition && sort === "closest") setSort("newest");
  }, [currentPosition, sort]);
  const [libraryView, setLibraryView] = useState<"list" | "map">("list");
  const [fullscreenDetails, setFullscreenDetails] = useState(false);
  const [fullscreenScope, setFullscreenScope] = useState<string | null>(null);
  useEffect(() => setFullscreenScope(null), [scope, libraryView]);
  const [mapFocus, setMapFocus] = useState<{
    workspace: string;
    id: string;
    request: number;
  } | null>(null);
  const [editor, setEditor] = useState<{
      entity?: Entity;
      fresh?: boolean;
      draftId?: string;
    } | null>(null),
    [settings, setSettings] = useState<string | null>(null),
    [maps, setMaps] = useState<{ place: Place; action: MapAction } | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<{ entity?: LocalRecord } | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null),
    [locating, setLocating] = useState(false),
    [gpsReview, setGpsReview] = useState(false),
    [status, setStatus] = useState(() => (cachedAccount().account ? "pending" : "localOnly"));
  const [update, setUpdate] = useState(false);
  const [shared, setShared] = useState(() => parseShare(location.hash)),
    [sharePlace, setSharePlace] = useState<PlaceRecord | null>(null);
  const [savingShared, setSavingShared] = useState(false);
  const sharedSavePending = useRef(false);
  const sharedRevision = useRef(0);
  const [reconciling, setReconciling] = useState(false),
    [menu, setMenu] = useState<PlaceRecord | null>(null),
    [mobile, setMobile] = useState(() => matchMedia("(max-width:700px)").matches);
  const deferredTransfers = useRef(new Set<string>());
  const [copyGroupPicker, setCopyGroupPicker] = useState(false);
  const [copyingToGroup, setCopyingToGroup] = useState(false);
  const copyInProgress = useRef(false);
  useEffect(() => setCopyGroupPicker(false), [menu, sharePlace]);
  const capture = useRef(0),
    stopCapture = useRef(() => {}),
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
    (r: LocalRecord) => (r.kind === "category" ? categoryName(r.value, prefs.language) : ""),
    [prefs.language],
  );
  const categoryIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryFor = useCallback(
    (id: string) => categoryIndex.get(id) ?? categoryIndex.get("other"),
    [categoryIndex],
  );
  const places = useMemo(
    () =>
      workspace?.records.filter(
        (record): record is PlaceRecord => isPlace(record) && !record.deleted,
      ) ?? [],
    [workspace],
  );
  const visits = useMemo(() => {
    const owner = visitOwner(scope);
    const personal = owner === scope ? workspace : personalWorkspace;
    return visitStatuses(personal?.key === owner ? personal.records : [], scope);
  }, [scope, workspace, personalWorkspace]);
  const filtered = useMemo(() => {
    const query = search.toLocaleLowerCase(prefs.language);
    const matches = places.filter((p) => {
      const category = categoryFor(p.value.categoryId);
      return (
        (filter === "all" || (category?.id ?? "other") === filter) &&
        (visitFilter === "all" || (visits.get(p.id) ?? "none") === visitFilter) &&
        (!query ||
          `${p.value.name} ${p.value.description ?? ""} ${category ? categoryLabel(category) : ""}`
            .toLocaleLowerCase(prefs.language)
            .includes(query))
      );
    });
    if (sort === "name") {
      const collator = new Intl.Collator(prefs.language);
      return matches.sort((a, b) => collator.compare(a.value.name, b.value.name));
    }
    // Compute dates and great-circle distances once per place, rather than
    // repeating parsing/trigonometry for each comparison in the sort.
    return matches
      .map((place) => ({
        place,
        captured: Date.parse(place.value.capturedAt),
        distance:
          sort === "closest" && currentPosition
            ? distanceMetres(currentPosition.coords, place.value)
            : 0,
      }))
      .sort((a, b) => a.distance - b.distance || b.captured - a.captured)
      .map(({ place }) => place);
  }, [
    places,
    filter,
    visitFilter,
    visits,
    search,
    sort,
    currentPosition,
    prefs.language,
    categoryFor,
    categoryLabel,
  ]);
  useEffect(() => {
    if (!filtered.length) setFullscreenScope(null);
  }, [filtered.length]);
  const current = places.find((p) => p.id === selected),
    conflicts = [
      ...(workspace?.records.filter((r) => r.conflict) ?? []),
      ...(visitOwner(scope) !== scope && personalWorkspace?.key === visitOwner(scope)
        ? personalWorkspace.records.filter(
            (r) => r.kind === "visit" && r.conflict && r.value.libraryId === selectedFamily,
          )
        : []),
    ];
  const notify = (key: Message, error = false) => setNotice({ text: t(key), error });
  const refresh = useCallback(async () => {
    const key = scopeRef.current;
    const accountId = authRef.current;
    try {
      const w = await readWorkspace(key);
      const personal = visitOwner(key) === key ? w : await readWorkspace(visitOwner(key));
      const plan = await devicePlacePlan(accountId ?? "guest");
      if (scopeRef.current === key && authRef.current === accountId) {
        setWorkspace(w);
        setPersonalWorkspace(personal);
        setReconciling(
          (previous) =>
            !!accountId && !deferredTransfers.current.has(accountId) && (plan.needed || previous),
        );
      }
    } catch {
      setNotice({ text: t("storageFailure"), error: true });
    }
  }, [t]);
  const sync = useCallback(() => {
    const key = scopeRef.current;
    if (key !== "guest") {
      let libraryStatus = "pending";
      void synchronize(
        key,
        (s) => {
          libraryStatus = s;
          if (scopeRef.current === key) setStatus(s);
        },
        () => scopeRef.current === key,
      ).then(async () => {
        const owner = visitOwner(key);
        if (owner !== key && scopeRef.current === key)
          await synchronize(
            owner,
            (s) => {
              if (scopeRef.current === key)
                setStatus(
                  s === "syncing"
                    ? s
                    : libraryStatus === "actionRequired"
                      ? libraryStatus
                      : s === "synced"
                        ? libraryStatus
                        : s,
                );
            },
            () => scopeRef.current === key,
          );
        await refresh();
      });
    }
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
      setMapFocus(null);
      setWorkspace(null);
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
      stopCapture.current();
      setLocating(false);
    }
    const selectedKey = scopeRef.current;
    const w = await readWorkspace(selectedKey);
    const plan = await devicePlacePlan(key);
    if (request !== accountRequest.current || scopeRef.current !== selectedKey) return;
    setWorkspace(w);
    setReconciling(
      (previous) =>
        !!next.account &&
        !deferredTransfers.current.has(next.account.id) &&
        (plan.needed || previous),
    );
    const familyCheck = ++familyRequest.current;
    if (next.account && !familyActionPending.current)
      void fetchFamily(next.account.id)
        .then((value) => {
          if (
            familyCheck === familyRequest.current &&
            request === accountRequest.current &&
            workspaceIdentity(scopeRef.current).account === next.account!.id
          ) {
            setFamilyCache((previous) => storeFamilies(next.account!.id, value, previous));
            setVerifiedFamilyAccount(next.account!.id);
          }
        })
        .catch(() => {});
  }, []);
  useEffect(() => {
    const id = account.account?.id;
    setVerifiedFamilyAccount(null);
    familyActionPending.current = false;
    if (!id) return;
    let active = true,
      inFlight = false;
    const refreshGroups = async () => {
      if (
        !active ||
        inFlight ||
        familyActionPending.current ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      )
        return;
      inFlight = true;
      const version = ++familyRequest.current;
      try {
        const groups = await fetchFamily(id);
        if (active && authRef.current === id && version === familyRequest.current) {
          setFamilyCache((previous) => storeFamilies(id, groups, previous));
          setVerifiedFamilyAccount(id);
        }
      } catch {
      } finally {
        inFlight = false;
      }
    };
    void refreshGroups();
    const timer = setInterval(() => void refreshGroups(), 5000);
    window.addEventListener("online", refreshGroups);
    window.addEventListener("focus", refreshGroups);
    document.addEventListener("visibilitychange", refreshGroups);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", refreshGroups);
      window.removeEventListener("focus", refreshGroups);
      document.removeEventListener("visibilitychange", refreshGroups);
    };
  }, [account.account?.id]);
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
  useEffect(() => () => stopCapture.current(), []);
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
    const accountStorageChanged = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "places-account" ||
        event.key === "places-pending-logout"
      )
        void refreshAccount()
          .then(sync)
          .catch(() => {});
    };
    window.addEventListener("online", foreground);
    window.addEventListener("focus", foreground);
    window.addEventListener("storage", accountStorageChanged);
    document.addEventListener("visibilitychange", foreground);
    const timer = setInterval(() => {
      foreground();
    }, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", foreground);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("storage", accountStorageChanged);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [sync, refreshAccount]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 12000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const consume = () => {
      const hash = location.hash;
      if (!hash) return;
      const incoming = parseShare(hash);
      if (hash.startsWith("#place="))
        history.replaceState(history.state, "", location.pathname + location.search);
      if (incoming) {
        sharedRevision.current++;
        setShared(incoming);
        setNotice(null);
      } else setNotice({ text: t("invalidShare"), error: true });
    };
    consume();
    window.addEventListener("hashchange", consume);
    return () => window.removeEventListener("hashchange", consume);
  }, [t]);
  useEffect(() => {
    let disposed = false;
    if (import.meta.env.PROD)
      swUpdate.current = registerSW({
        // Workbox's time-based "external install" heuristic can also fire on
        // a slow first installation. Only the monitor's actual active+waiting
        // replacement state may offer an update; Workbox still owns activation.
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
  async function save(
    entity: Entity,
    base?: Entity | null,
    clearDraft = false,
    visitedHere = false,
  ) {
    const key = scopeRef.current;
    const isCurrent = () => scopeRef.current === key && writeAllowed.current;
    if (!writeAllowed.current) throw new Error("familyAccessEnded");
    if (!(await readWorkspace(key)).reconciled) throw new Error("syncBusy");
    if (scopeRef.current !== key) throw new Error("accountChanged");
    await saveEntity(key, entity, base, clearDraft, isCurrent, visitedHere ? "visited" : undefined);
    if (!isCurrent()) return;
    if (entity.kind === "place") setPrefs((p) => ({ ...p, lastCategory: entity.value.categoryId }));
    await refresh();
    if (!isCurrent()) return;
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
    rememberPosition(position);
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
      const isCurrent = () =>
        operation === capture.current && key === scopeRef.current && writeAllowed.current;
      await saveEntity(key, entity, undefined, false, isCurrent, "visited");
      if (isCurrent()) {
        await refresh();
        if (!isCurrent()) return;
        setSelected(entity.id);
        setEditor({ entity, fresh: true });
        sync();
      }
    } catch {
      if (operation === capture.current && key === scopeRef.current) notify("storageFailure", true);
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
    stopCapture.current();
    stopCapture.current = captureLocation(
      (position) => void persistPosition(position, operation, key),
      (error) => {
        if (operation !== capture.current) return;
        setLocating(false);
        notify(error, true);
      },
    );
  }
  const openMaps = (p: Place) => {
    if (prefs.provider && mapProviders().includes(prefs.provider))
      window.open(mapURL(prefs.provider, p), "_blank", "noopener,noreferrer");
    else setMaps({ place: p, action: "show" });
  };
  const navigate = (p: Place) => {
    if (prefs.provider === "google" || prefs.provider === "apple")
      window.open(directionsURL(prefs.provider, p), "_blank", "noopener,noreferrer");
    else setMaps({ place: p, action: "navigate" });
  };
  const remove = async (p: PlaceRecord, key: string) => {
    setDeletePlace(null);
    if (scopeRef.current !== key || !writeAllowed.current) {
      notify("familyAccessEnded", true);
      return;
    }
    try {
      await deleteEntity(key, p.id, () => scopeRef.current === key && writeAllowed.current);
      if (scopeRef.current !== key) return;
      setSelected(null);
      setMenu(null);
      setEditor((current) => (current?.entity?.id === p.id ? null : current));
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
      const result = await shareOrCopy({ title: p.value.name, text: p.value.name, url }, url);
      if (result === "copied") notify("shareReady");
      if (result !== "dismissed") setSharePlace(null);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) await copy(url);
    }
  };
  async function download(key = scopeRef.current) {
    const accountAtStart = authRef.current;
    const isCurrent = () => authRef.current === accountAtStart;
    try {
      const exporting = await readWorkspace(key);
      const exported = await exportWithPhotos(exporting, isCurrent);
      if (!isCurrent()) return;
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
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
      if (isCurrent()) notify("exportFailed", true);
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
    setFamilyCache(cachedFamily());
    setWorkspace(null);
    scopeRef.current = "guest";
    setScope("guest");
    setMapFocus(null);
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
    stopCapture.current();
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
    setMapFocus(null);
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
    stopCapture.current();
    setLocating(false);
    try {
      localStorage.setItem(`places-workspace:${authRef.current}`, key);
    } catch {}
    void refresh();
  }
  function familyChanged(families: Family[]) {
    familyRequest.current++;
    if (account.account && authRef.current === account.account.id) {
      setFamilyCache((previous) => storeFamilies(account.account!.id, families, previous));
    }
  }
  async function copyToFamily(id: string, groupId: string) {
    if (
      copyInProgress.current ||
      !account.account ||
      !canWrite ||
      groupId === selectedFamily ||
      !copyDestinations.some((f) => f.id === groupId)
    )
      return;
    copyInProgress.current = true;
    setCopyingToGroup(true);
    const accountId = account.account.id;
    const source = scopeRef.current;
    const isCurrent = () =>
      authRef.current === accountId &&
      scopeRef.current === source &&
      writeAllowed.current &&
      activeGroups.current.some((group) => group.id === groupId);
    const key = familyKey(accountId, groupId);
    try {
      await copyPlaceToWorkspace(source, key, id, isCurrent);
      if (!isCurrent()) return;
      await synchronize(key, () => {}, isCurrent);
      if (!isCurrent()) return;
      setMenu(null);
      setSharePlace(null);
      notify("copiedToGroup");
    } catch (error) {
      if (isCurrent()) notify(libraryErrorMessage(error), true);
    } finally {
      copyInProgress.current = false;
      setCopyingToGroup(false);
    }
  }
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(prefs.language, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  const categoryColor = (id: string) => {
    const c = categoryFor(id);
    return categoryAppearance(c).color;
  };
  const mapFullscreen = fullscreenScope === scope && libraryView === "map" && filtered.length > 0;
  const controls = useAutoHideSaveBar(
    prefs.autoHideControls,
    !!(
      locating ||
      reconciling ||
      libraryOpen ||
      editor ||
      settings ||
      maps ||
      categoryEdit ||
      backup ||
      shared ||
      sharePlace ||
      menu ||
      deletePlace ||
      deleteCategory ||
      copyGroupPicker ||
      (accountChoice && !account.account) ||
      mapFullscreen ||
      (current && mobile)
    ),
    `${scope}:${libraryView}:${mapFullscreen}`,
  );
  useEffect(() => {
    const dock = saveDock.current!;
    const reveal = document.querySelector<HTMLElement>(".show-controls");
    const measure = () => {
      const clearance = reveal
        ? reveal.getBoundingClientRect().height + parseFloat(getComputedStyle(reveal).bottom)
        : dock.getBoundingClientRect().height;
      document.documentElement.style.setProperty(
        "--save-dock-height",
        `${reveal ? 0 : clearance}px`,
      );
      document.documentElement.style.setProperty(
        "--floating-controls-clearance",
        `${reveal ? clearance + 8 : 0}px`,
      );
      // Changing bottom clearance can clamp the document scroll at its end.
      // That layout adjustment is not an upward browsing gesture.
      controls.rebase();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    if (reveal) observer.observe(reveal);
    measure();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--save-dock-height");
      document.documentElement.style.removeProperty("--floating-controls-clearance");
    };
  }, [controls.hidden]);
  const renderDetails = (record: PlaceRecord) => (
    <PlaceDetails
      key={`${scope}:${record.id}`}
      canWrite={canWrite}
      record={record}
      visitStatus={visits.get(record.id) ?? "none"}
      onVisitStatus={async (status) => {
        const key = scope;
        const isCurrent = () =>
          scopeRef.current === key && (authRef.current ?? "guest") === visitOwner(key);
        await saveVisit(key, record.id, status, isCurrent);
        if (!isCurrent()) return;
        await refresh();
        if (isCurrent()) sync();
      }}
      workspace={scope}
      units={prefs.units}
      categoryColor={categoryColor}
      categoryFor={categoryFor}
      categoryLabel={categoryLabel}
      t={t}
      formatDate={formatDate}
      openMaps={openMaps}
      navigate={navigate}
      expandMap={(place) => {
        setSearch("");
        setFilter("all");
        setLibraryView("map");
        setMapFocus((previous) => ({
          workspace: scope,
          id: place.id,
          request: (previous?.request ?? 0) + 1,
        }));
        if (mobile || mapFullscreen) setSelected(null);
      }}
      chooseMapProvider={(place, provider) => {
        window.open(mapURL(provider, place), "_blank", "noopener,noreferrer");
        setPrefs({ ...prefs, provider });
      }}
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
      {controls.hidden && (
        <button
          className="button outline show-controls"
          onClick={(event) => {
            controls.reveal();
            if (event.detail === 0)
              requestAnimationFrame(() =>
                saveDock.current
                  ?.querySelector<HTMLButtonElement>(".save-here")
                  ?.focus({ preventScroll: true }),
              );
          }}
        >
          {t("showControls")}
        </button>
      )}
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          <div className="header-actions">
            <button
              className={`sync-pill ${status === "actionRequired" ? "warning" : ""}`}
              onClick={() => setSettings("account")}
              aria-describedby={account.account ? "account-sync-status" : undefined}
              aria-label={
                account.account
                  ? t("account")
                  : `${!navigator.onLine ? `${t("offline")} · ` : ""}${t("signIn")}`
              }
            >
              <span className="account-indicator">
                <UserRound size={24} aria-hidden="true" />
                {account.account && <span className="status-dot" aria-hidden="true" />}
              </span>
              <span
                id="account-sync-status"
                className="account-label"
                role={account.account ? "status" : undefined}
                aria-live="polite"
                aria-atomic="true"
              >
                {!account.account
                  ? `${!navigator.onLine ? `${t("offline")} · ` : ""}${t("signIn")}`
                  : t(
                      (!navigator.onLine
                        ? "offline"
                        : scope === "guest"
                          ? "localOnly"
                          : status) as Message,
                    )}
              </span>
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
      {account.account && (familyCache.families.length > 0 || familyCache.inactive.length > 0) && (
        <div className="library-switcher">
          <LibrarySelector
            value={scope}
            privateValue={account.account.id}
            privateLabel={t("privateLibrary")}
            label={t("libraryChoice")}
            open={!!libraryOpen}
            placement={libraryOpen === "dock" ? "dock" : "selector"}
            onOpenChange={changeLibraryOpen}
            groups={[...familyCache.families, ...familyCache.inactive].map((group) => ({
              value: familyKey(account.account!.id, group.id),
              label:
                group.name +
                (!familyCache.families.some((f) => f.id === group.id)
                  ? ` · ${t("familyLocalCopy")}`
                  : ""),
            }))}
            onChange={switchLibrary}
            createGroupLabel={t("familyCreateNew")}
            onCreateGroup={() => setSettings("createGroup")}
          />
        </div>
      )}
      {selectedFamily && (
        <div className="shared-library-notice">
          <p>{t(canWrite ? "familyLibraryHint" : "familyReadonly")}</p>
          {canWrite && selectedGroup && (
            <button className="button outline" onClick={() => setSettings("participants")}>
              <Users size={20} />
              {t("groupMembers")} · {selectedGroup.members.length}
            </button>
          )}
        </div>
      )}
      {account.account && (reconciling || deferredTransfers.current.has(account.account.id)) && (
        <DevicePlaceTransfer
          key={account.account.id}
          accountId={account.account.id}
          t={t}
          onDeferred={() => {
            deferredTransfers.current.add(account.account!.id);
            setReconciling(false);
            void refresh();
            sync();
          }}
          onRetry={() => {
            deferredTransfers.current.delete(account.account!.id);
            setReconciling(true);
          }}
          onComplete={(added) => {
            deferredTransfers.current.delete(account.account!.id);
            setReconciling(false);
            if (added > 0)
              setNotice({
                text: t(added === 1 ? "transferAddedOne" : "transferAddedMany").replace(
                  "{count}",
                  String(added),
                ),
              });
            void refresh();
            sync();
          }}
        />
      )}
      <LibraryView
        onBrowse={controls.browse}
        view={libraryView}
        setView={setLibraryView}
        showDetails={!mobile && !mapFullscreen}
        fullscreen={mapFullscreen}
        onFullscreenChange={(value) => {
          setFullscreenDetails(false);
          setFullscreenScope(value ? scope : null);
        }}
        setSelected={(id) => {
          setSelected(id);
          if (mapFullscreen) setFullscreenDetails(true);
        }}
        mapFocus={mapFocus}
        onClearMapFocus={() => setMapFocus(null)}
        workspace={scope}
        canWrite={canWrite}
        title={selectedFamily ? (selectedGroup?.name ?? t("familyLibrary")) : undefined}
        {...{
          t,
          places,
          filtered,
          categories,
          visitFilter,
          setVisitFilter,
          visits,
          filter,
          setFilter,
          search,
          setSearch,
          sort,
          canSortClosest: !!currentPosition,
          setSort,
          selected,
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
              ? resolveConflict(
                  conflicts.find((r) => r.id === id)?.kind === "visit" ? visitOwner(scope) : scope,
                  id,
                  choice,
                  () => scopeRef.current === scope && writeAllowed.current,
                )
              : Promise.reject(new Error("familyAccessEnded"))
          )
            .then(() => {
              if (scopeRef.current !== scope) return;
              void refresh();
              sync();
            })
            .catch(() => {
              if (scopeRef.current === scope)
                notify(writeAllowed.current ? "storageFailure" : "familyAccessEnded", true);
            })
        }
      />

      <div
        className={`save-dock${prefs.autoHideControls ? " auto-hide-dock" : ""}${controls.hidden ? " controls-hidden" : ""}`}
        ref={saveDock}
        inert={controls.hidden}
        aria-hidden={controls.hidden || undefined}
      >
        <div className={`dock-inner${current ? "" : " library-only"}`}>
          <div className="save-action">
            {!online && workspace && (
              <div className="dock-hint" role="status">
                {t("offlineSaved")}
              </div>
            )}
            {account.account && (
              <button
                className="save-destination"
                id="save-destination"
                aria-expanded={libraryOpen === "dock"}
                onClick={() =>
                  account.account &&
                  (familyCache.families.length > 0 || familyCache.inactive.length > 0)
                    ? setLibraryOpen(libraryOpen === "dock" ? false : "dock")
                    : setSettings("familySharing")
                }
              >
                {selectedFamily ? (
                  <Users size={18} aria-hidden="true" />
                ) : (
                  <LockKeyhole size={18} aria-hidden="true" />
                )}
                <span className="save-destination-name">
                  {selectedFamily
                    ? (selectedGroup?.name ?? t("familyLibrary"))
                    : t("privateLibrary")}
                </span>
              </button>
            )}
            <div className="save-controls">
              <div className={`save-split${locating ? "" : " split-actions"}`}>
                <button
                  className="button primary save-here"
                  disabled={locating || !workspace || reconciling || !canWrite}
                  onClick={saveHere}
                  aria-describedby={account.account ? "save-destination" : undefined}
                >
                  {locating ? (
                    <LoaderCircle className="spin" size={22} />
                  ) : (
                    <LocateFixed size={24} />
                  )}{" "}
                  {t(locating ? "locating" : "saveHere")}
                </button>
                {!locating && (
                  <div className="split-picker save-picker">
                    <select
                      aria-label={t("saveOptions")}
                      value=""
                      disabled={locating || !workspace || reconciling || !canWrite}
                      onChange={(event) => {
                        if (event.target.value === "details") setEditor({});
                      }}
                    >
                      <option value="" disabled hidden>
                        {t("saveOptions")}
                      </option>
                      <option value="details">{t("addWithDetails")}</option>
                    </select>
                    <ChevronDown size={20} aria-hidden="true" />
                  </div>
                )}
              </div>
              {locating && (
                <button
                  className="icon-button"
                  aria-label={t("cancelCapture")}
                  onClick={() => {
                    capture.current++;
                    stopCapture.current();
                    setLocating(false);
                  }}
                >
                  <X />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {notice && <Toast {...notice} closeLabel={t("close")} onClose={() => setNotice(null)} />}
      {accountChoice && !account.account && !settings && !shared && (
        <Sheet
          title={t("accountChoiceTitle")}
          headerActions={
            <label className="onboarding-language">
              <img
                className="language-flag"
                src={`/flags/${prefs.language === "sv" ? "se" : "gb"}.svg`}
                width="24"
                height="18"
                alt=""
              />
              <select
                aria-label={t("language")}
                value={prefs.language}
                onChange={(e) => {
                  const language = e.target.value;
                  if (language === "en" || language === "sv")
                    setPrefs((previous) => ({ ...previous, language }));
                }}
              >
                <option value="en" lang="en">
                  English
                </option>
                <option value="sv" lang="sv">
                  Svenska
                </option>
              </select>
            </label>
          }
          closeLabel={t("close")}
          onClose={completeAccountChoice}
        >
          <div className="stack onboarding-steps">
            <InstallPlaces t={t} firstUse />
            <section className="onboarding-step stack" aria-labelledby="onboarding-account-title">
              <h3 className="onboarding-step-heading" id="onboarding-account-title">
                <span className="onboarding-step-number" aria-hidden="true" />
                {t("accountChoiceAccount")}
              </h3>
              <p className="onboarding-account-help">{t("accountChoiceBody")}</p>
              <button
                className="button outline"
                onClick={() => {
                  completeAccountChoice();
                  setSettings("account");
                }}
              >
                {t("signInOrCreate")}
              </button>
              <button className="button outline" onClick={completeAccountChoice}>
                {t("continueGuest")}
              </button>
            </section>
          </div>
        </Sheet>
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
      {account.account && verifiedFamilyAccount === account.account.id && (
        <JoinRequests
          key={`join-requests:${account.account.id}`}
          account={account.account.id}
          families={familyCache.families}
          t={t}
          onChanged={familyChanged}
          onPending={(pending) => {
            familyActionPending.current = pending;
            familyRequest.current++;
          }}
        />
      )}
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
          onClose={() => {
            if (scopeRef.current === scope) setEditor(null);
          }}
          onSave={(value, base, visitedHere) => save(value, base, true, visitedHere)}
          onDelete={
            canWrite && editor.entity && !editor.fresh
              ? () => {
                  const place = places.find((p) => p.id === editor.entity?.id);
                  if (place) setDeletePlace({ place, scope });
                }
              : undefined
          }
          onDiscardPlace={async (id) => {
            const key = scope;
            if (scopeRef.current !== key || !writeAllowed.current)
              throw new Error("familyAccessEnded");
            await deleteEntity(key, id, () => scopeRef.current === key && writeAllowed.current);
            if (scopeRef.current !== key) return;
            setSelected(null);
            await refresh();
            sync();
          }}
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
          canWrite={canWrite}
          initial={
            settings === "participants" || settings === "createGroup" ? "familySharing" : settings
          }
          familyPanel={(onSignIn) => (
            <FamilyPanel
              key={account.account?.id ?? "guest"}
              account={account.account}
              cache={familyCache}
              t={t}
              onChanged={familyChanged}
              preferredGroup={selectedFamily ?? undefined}
              focusParticipants={settings === "participants"}
              focusCreate={settings === "createGroup"}
              onOpen={(groupId) => {
                if (account.account) switchLibrary(familyKey(account.account.id, groupId));
              }}
              onSignIn={onSignIn}
              onExport={(groupId) => {
                if (account.account) void download(familyKey(account.account.id, groupId));
              }}
            />
          )}
          t={t}
          preferences={prefs}
          onPreferences={setPrefs}
          onClose={() => setSettings(null)}
          onCheckUpdates={() => {
            void updateMonitor.current
              ?.check(true)
              ?.then((result) => {
                if (result === "ready") {
                  setNotice(null);
                  setUpdate(true);
                  return;
                }
                notify(
                  result === "current"
                    ? "upToDate"
                    : result === "offline"
                      ? "offline"
                      : "checkingUpdates",
                );
              })
              .catch(() => notify("serviceUnavailable", true));
          }}
          onExport={() => void download()}
          onImport={() => {
            if (canWrite) fileRef.current?.click();
            else notify("familyAccessEnded", true);
          }}
          categories={categories}
          categoryLabel={categoryLabel}
          onCategory={(entity) => canWrite && setCategoryEdit({ entity })}
          onDeleteCategory={(entity) => {
            if (canWrite && entity.id !== "other") setDeleteCategory({ entity, scope });
          }}
          account={account}
          onAccount={async () => {
            await refreshAccount();
          }}
          onSignOut={signOut}
          syncStatus={
            (!navigator.onLine ? "offline" : scope === "guest" ? "localOnly" : status) as Message
          }
          onSync={() => {
            if (reconciling) {
              setStatus("reconcilePending");
              return;
            }
            if (scopeRef.current !== "guest") {
              setStatus(navigator.onLine ? "syncing" : "offline");
              sync();
            }
          }}
          onDeleteAccount={deleteAccount}
          onRemoveDevice={async () => {
            const id = account.account!.id;
            await signOut();
            await removeAccountWorkspaces(id);
          }}
        />
      )}
      {categoryEdit && (
        <CategoryEditor
          key={`${scope}:${categoryEdit.entity?.id ?? "new"}`}
          entity={categoryEdit.entity}
          language={prefs.language}
          t={t}
          onSave={save}
          onClose={() => setCategoryEdit(null)}
          onError={(error) => notify(libraryErrorMessage(error), true)}
        />
      )}
      {deleteCategory && deleteCategory.scope === scope && (
        <Sheet
          title={t("deleteCategory")}
          closeLabel={t("cancel")}
          onClose={() => {
            if (!deletingCategory) setDeleteCategory(null);
          }}
        >
          <div className="stack">
            <p>
              <strong>{categoryLabel(deleteCategory.entity)}</strong>
            </p>
            <p>{t("deleteCategoryBody")}</p>
            <div className="action-pair">
              <button
                className="button outline subdued"
                data-initial-focus
                disabled={deletingCategory}
                onClick={() => setDeleteCategory(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger confirm"
                disabled={deletingCategory || !canWrite}
                onClick={() =>
                  void (async () => {
                    if (categoryDeletePending.current) return;
                    const { entity, scope: key } = deleteCategory;
                    const isCurrent = () => scopeRef.current === key && writeAllowed.current;
                    if (!isCurrent()) return;
                    categoryDeletePending.current = true;
                    setDeletingCategory(true);
                    try {
                      await deleteEntity(key, entity.id, isCurrent);
                      if (!isCurrent()) return;
                      setDeleteCategory(null);
                      setFilter((previous) => (previous === entity.id ? "all" : previous));
                      await refresh();
                      sync();
                    } catch (error) {
                      if (isCurrent()) notify(libraryErrorMessage(error), true);
                    } finally {
                      categoryDeletePending.current = false;
                      setDeletingCategory(false);
                    }
                  })()
                }
              >
                <Trash2 size={20} aria-hidden="true" />
                {t(deletingCategory ? "working" : "delete")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {maps && (
        <MapAppChooser
          place={maps.place}
          action={maps.action}
          t={t}
          onClose={() => setMaps(null)}
          onChoose={(provider) => {
            setPrefs({ ...prefs, provider });
            setMaps(null);
          }}
          copy={copy}
        />
      )}
      {sharePlace && (
        <Sheet
          key={copyGroupPicker ? "share-group" : "share-place"}
          title={copyGroupPicker ? t("shareToGroup") : t("share")}
          onClose={() => setSharePlace(null)}
          closeLabel={t("close")}
        >
          <h3>{sharePlace.value.name}</h3>
          {copyGroupPicker ? (
            <GroupCopyPicker
              groups={copyDestinations}
              busy={copyingToGroup}
              t={t}
              onChoose={(id) => void copyToFamily(sharePlace.id, id)}
              onCancel={() => setCopyGroupPicker(false)}
            />
          ) : (
            <div className="stack">
              {account.account && canWrite && copyDestinations.length > 0 && (
                <button
                  className="button primary"
                  disabled={copyingToGroup}
                  onClick={() => setCopyGroupPicker(true)}
                >
                  <Users size={19} aria-hidden="true" />
                  {t("shareToGroup")}
                </button>
              )}
              <button className="button outline" onClick={() => void share(sharePlace)}>
                <Share2 size={19} aria-hidden="true" />
                {t("shareLink")}
              </button>
              <p className="muted">{t("shareNotice")}</p>
              <p className="muted small">{t("photoHint")}</p>
            </div>
          )}
        </Sheet>
      )}
      {shared && (
        <Sheet title={t("sharedTitle")} onClose={() => setShared(null)} closeLabel={t("close")}>
          <div className="stack">
            <div className="section-icon">
              <MapPin />
            </div>
            <h3>{shared.name}</h3>
            {shared.description && <p className="place-description">{shared.description}</p>}
            <p className="muted">
              {shared.category} · {shared.latitude.toFixed(6)}, {shared.longitude.toFixed(6)}
            </p>
            <button
              className="button primary"
              disabled={savingShared || !workspace?.reconciled || reconciling || !canWrite}
              onClick={() =>
                void (async () => {
                  if (sharedSavePending.current) return;
                  sharedSavePending.current = true;
                  setSavingShared(true);
                  const key = scopeRef.current;
                  const revision = sharedRevision.current;
                  const now = new Date().toISOString(),
                    cat = categories.find((c) => categoryLabel(c) === shared.category);
                  try {
                    await save({
                      id: crypto.randomUUID(),
                      kind: "place",
                      value: {
                        name: shared.name,
                        ...(shared.description ? { description: shared.description } : {}),
                        latitude: shared.latitude,
                        longitude: shared.longitude,
                        accuracy: null,
                        capturedAt: now,
                        updatedAt: now,
                        categoryId: cat?.id ?? "other",
                      },
                    });
                    if (key === scopeRef.current && revision === sharedRevision.current) {
                      setShared(null);
                      notify("saved");
                    }
                  } catch {
                    if (key === scopeRef.current && revision === sharedRevision.current)
                      notify("storageFailure", true);
                  } finally {
                    sharedSavePending.current = false;
                    setSavingShared(false);
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
          canWrite={canWrite}
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
      {menu && (
        <Sheet
          key={copyGroupPicker ? "copy-group" : "place-menu"}
          title={copyGroupPicker ? t("copyToGroup") : menu.value.name}
          onClose={() => setMenu(null)}
          closeLabel={t("close")}
        >
          {copyGroupPicker ? (
            <GroupCopyPicker
              groups={copyDestinations}
              busy={copyingToGroup}
              t={t}
              onChoose={(id) => void copyToFamily(menu.id, id)}
              onCancel={() => setCopyGroupPicker(false)}
            />
          ) : (
            <div className="stack place-actions">
              <button
                className="button outline"
                disabled={!canWrite}
                onClick={() => {
                  setEditor({ entity: menu });
                  setMenu(null);
                }}
              >
                <Pencil size={18} />
                {t("editAction")}
              </button>
              <button
                className="button outline"
                onClick={() => {
                  setSharePlace(menu);
                  setMenu(null);
                }}
              >
                <Share2 size={18} />
                {t("shareAction")}
              </button>
              {account.account && canWrite && copyDestinations.length > 0 && (
                <button
                  className="button outline copy-group-action"
                  disabled={copyingToGroup}
                  onClick={() =>
                    copyDestinations.length === 1
                      ? void copyToFamily(menu.id, copyDestinations[0].id)
                      : setCopyGroupPicker(true)
                  }
                >
                  <Copy size={18} aria-hidden="true" />
                  <span>
                    {copyDestinations.length === 1
                      ? `${t("copyTo")} ${copyDestinations[0].name}`
                      : `${t("copyToGroup")}…`}
                  </span>
                </button>
              )}
              <button
                className="button danger"
                disabled={!canWrite}
                onClick={() => setDeletePlace({ place: menu, scope })}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t("delete")}
              </button>
            </div>
          )}
        </Sheet>
      )}
      {current &&
        (mobile || (mapFullscreen && fullscreenDetails)) &&
        !editor &&
        !menu &&
        !sharePlace &&
        !settings &&
        !maps && (
          <Sheet
            title={t("placeDetails")}
            onClose={() => setSelected(null)}
            closeLabel={t("close")}
          >
            {renderDetails(current)}
          </Sheet>
        )}
      {deletePlace && deletePlace.scope === scope && (
        <Sheet
          title={t("deletePlace")}
          closeLabel={t("cancel")}
          onClose={() => setDeletePlace(null)}
        >
          <div className="stack">
            <p>
              <strong>{deletePlace.place.value.name}</strong>
            </p>
            <p>{t("deletePlaceBody")}</p>
            <div className="action-pair">
              <button
                className="button outline subdued"
                data-initial-focus
                onClick={() => setDeletePlace(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger confirm"
                disabled={!canWrite}
                onClick={() => void remove(deletePlace.place, deletePlace.scope)}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t("delete")}
              </button>
            </div>
          </div>
        </Sheet>
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
        <Sheet
          title={t("updateReady")}
          closeLabel={t("updateLater")}
          onClose={() => setUpdate(false)}
        >
          <div className="stack">
            <p>{t("updateHint")}</p>
            <button
              className="button primary"
              onClick={() =>
                void flushDrafts()
                  .then(() => swUpdate.current?.(true))
                  .catch(() => notify("storageFailure", true))
              }
            >
              {t("update")}
            </button>
            <button className="button outline subdued" onClick={() => setUpdate(false)}>
              {t("updateLater")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
