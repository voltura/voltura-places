import { BackupDialogs } from "./BackupDialogs";
import { PlaceEditingDialogs } from "./PlaceEditingDialogs";
import { SharingDialogs } from "./SharingDialogs";
import { usePlaceEditing } from "./usePlaceEditing";
import { useSharing } from "./useSharing";
import { useSession } from "./useSession";
import { useWorkspace } from "./useWorkspace";
import { useSynchronization } from "./useSynchronization";
import { useBrowsing } from "./useBrowsing";
import { useBackups } from "./useBackups";
import { useLibraryQueries } from "./useLibraryQueries";
import { Settings } from "../features/Settings";
import { FamilyPanel } from "../features/Family";
import { visitOwner } from "../../shared/visits";
import { usePreferences } from "./usePreferences";
import { startActivityReporting } from "../foundation/activity";
import { useAutoHideSaveBar } from "./useAutoHideSaveBar";
import { useCurrentPosition } from "./useCurrentPosition";
import { SyncStatusIcon, syncStatusWarning } from "../features/SyncStatus";
import { categoryAppearance } from "../features/CategoryAppearance";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocateFixed,
  ChevronDown,
  Users,
  Settings2,
  X,
  LoaderCircle,
  LockKeyhole,
  UserRound,
  CircleArrowUp,
  PanelBottomOpen,
  Plus,
} from "lucide-react";
import { registerSW } from "virtual:pwa-register";
import { watchForUpdates } from "../foundation/updates";
import { Sheet } from "../ui/Sheet";
import { Toast } from "../ui/Toast";
import { Brand } from "../ui/Brand";
import { Tooltip } from "../ui/Tooltip";
import { MapAppChooser } from "../features/MapAppChooser";
import { PlaceDetails } from "../features/PlaceDetails";
import { LibraryView } from "../features/LibraryView";
import { LibrarySelector } from "../features/LibrarySelector";
import { JoinRequests } from "../features/JoinRequests";
import { familyKey } from "../../shared/families";
import { InstallPlaces } from "../features/InstallPlaces";
import { messages, type Message } from "../foundation/i18n";
import { keepOfflineData } from "../foundation/storage";
import { cachedAccount } from "../foundation/account";
import { flushDrafts, saveVisit } from "../foundation/library";
import { mapURL, type PlaceRecord } from "../../shared/model";

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
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const notify = (key: Message, error = false) => setNotice({ text: t(key), error });

  const session = useSession((next) => workspaceController.changeAccount(next), notify);
  const { account, operations } = session;
  const workspaceController = useWorkspace(
    session,
    (reason) => {
      browsing.reset();
      editing.reset();
      sharing.reset();
      backups.reset(reason);
      setNotice(null);
      if (reason === "workspace") {
        setSettings(null);
      }
    },
    () => notify("storageFailure", true),
  );
  const {
    scope,
    workspace,
    personalWorkspace,
    familyCache,
    verifiedFamilyAccount,
    selectedFamily,
    selectedGroup,
    canWrite,
    refresh,
    switchLibrary,
    familyChanged,
  } = workspaceController;
  const accountId = account.account?.id;
  const accountCaption =
    account.account?.displayName || account.account?.methods.find((method) => method.label)?.label;
  const groupOptions = useMemo(() => {
    if (!accountId) {
      return [];
    }

    return [
      ...familyCache.families.map((group) => ({
        value: familyKey(accountId, group.id),
        label: group.name,
      })),
      ...familyCache.inactive.map((group) => ({
        value: familyKey(accountId, group.id),
        label: group.name + " � " + t("familyLocalCopy"),
      })),
    ];
  }, [accountId, familyCache, t]);
  const browsing = useBrowsing(scope, !!currentPosition, prefs, setPrefs);
  const {
    maps,
    openMaps,
    navigate,
    search,
    setSearch,
    filter,
    setFilter,
    visitFilter,
    setVisitFilter,
    sort,
    setSort,
    selected,
    setSelected,
    libraryView,
    setLibraryView,
    fullscreenDetails,
    setFullscreenDetails,
    fullscreenScope,
    setFullscreenScope,
    mapFocus,
    setMapFocus,
  } = browsing;
  const backups = useBackups(session, workspaceController, notify, () => setSettings(null));
  const { backup, reconciling, download, loadFile } = backups;
  const { status, setStatus, sync, refreshAccount, manualSync } = useSynchronization(
    session,
    workspaceController,
    reconciling,
  );
  const syncStatus = useMemo(() => {
    if (!online && scope !== "guest") {
      const libraries =
        workspace === personalWorkspace ? [workspace] : [workspace, personalWorkspace];
      if (libraries.some((library) => library?.records.some((r) => r.conflict))) {
        return "syncConflict";
      }

      return libraries.some(
        (library) =>
          library?.flight ||
          library?.deferredFlights?.length ||
          library?.records.some((r) => r.dirty),
      )
        ? "savedPending"
        : "offline";
    }

    return scope === "guest" ? (online ? "localOnly" : "offline") : status;
  }, [online, scope, workspace, personalWorkspace, status]);
  const syncWarning = syncStatusWarning(syncStatus);
  const renderedOperation = operations.capture();
  const [libraryOpen, setLibraryOpen] = useState<false | "selector" | "dock">(false);
  const changeLibraryOpen = useCallback(
    (open: boolean) => setLibraryOpen(open ? "selector" : false),
    [],
  );
  useEffect(() => setLibraryOpen(false), [account.account?.id]);
  const saveDock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (account.account) {
      completeAccountChoice();
    }
  }, [account.account?.id]);
  const [settings, setSettings] = useState<string | null>(null);
  const [update, setUpdate] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia("(max-width:700px)").matches);
  const fileRef = useRef<HTMLInputElement>(null);
  const importSelection = useRef<(() => boolean) | null>(null);
  const swUpdate = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const applyingUpdate = useRef(false);
  const updateMonitor = useRef<ReturnType<typeof watchForUpdates> | null>(null);
  const { categories, categoryLabel, categoryFor, places, visits, filtered, current, conflicts } =
    useLibraryQueries({
      workspace,
      personalWorkspace,
      scope,
      selectedFamily,
      prefs,
      search,
      filter,
      visitFilter,
      sort,
      selected,
      currentPosition,
    });
  useEffect(() => {
    if (workspace && filter !== "all" && !categories.some((category) => category.id === filter)) {
      setFilter("all");
    }
  }, [workspace, categories, filter, setFilter]);
  useEffect(() => {
    if (!filtered.length) {
      setFullscreenScope(null);
    }
  }, [filtered.length]);
  const editing = usePlaceEditing({
    session,
    workspace: workspaceController,
    reconciling,
    prefs,
    setPrefs,
    categories,
    t,
    notify,
    sync,
    setStatus,
    setSelected,
    rememberPosition,
    onRemoved: (id) => sharing.setMenu((current) => (current?.id === id ? null : current)),
  });
  const {
    editor,
    setEditor,
    categoryEdit,
    setCategoryEdit,
    deletePlace,
    deleteCategory,
    setDeleteCategory,
    locating,
    save,
    saveHere,
  } = editing;
  const sharing = useSharing({
    session,
    workspace: workspaceController,
    categories,
    categoryFor,
    categoryLabel,
    save,
    t,
    notify,
    showText: (text) => setNotice({ text, error: false }),
  });
  const { shared, sharePlace, setSharePlace, menu, setMenu, copyGroupPicker, copy } = sharing;
  useEffect(() => {
    const query = matchMedia("(max-width:700px)");

    const change = () => setMobile(query.matches);

    query.addEventListener("change", change);

    return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), notice.error ? 12000 : 5000);

    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
      return;
    }
    let disposed = false;
    let reloading = false;
    const workers = navigator.serviceWorker;
    let controller = workers.controller;

    const reloadAfterDrafts = () => {
      if (disposed || reloading) {
        return;
      }
      reloading = true;
      void flushDrafts()
        .then(() => {
          if (!disposed) {
            location.reload();
          }
        })
        .catch(() => {
          reloading = false;
          if (!disposed) {
            notify("storageFailure", true);
          }
        });
    };

    // A replacement can take control before Workbox has announced its waiting event.
    const controllerChanged = () => {
      const previous = controller;
      controller = workers.controller;
      if (previous && controller && previous !== controller) {
        reloadAfterDrafts();
      }
    };

    workers.addEventListener("controllerchange", controllerChanged);
    swUpdate.current = registerSW({
      onRegisteredSW: (_url, registration) => {
        if (registration && !disposed) {
          updateMonitor.current = watchForUpdates(registration, () => setUpdate(true));
        }
      },
      onNeedReload: reloadAfterDrafts,
      onRegisterError: () => {},
    });

    return () => {
      disposed = true;
      workers.removeEventListener("controllerchange", controllerChanged);
      updateMonitor.current?.dispose();
    };
  }, []);

  const applyUpdate = async () => {
    if (applyingUpdate.current) {
      return;
    }
    applyingUpdate.current = true;
    try {
      await flushDrafts();
    } catch {
      notify("storageFailure", true);
      applyingUpdate.current = false;

      return;
    }
    try {
      await swUpdate.current?.(true);
    } catch {
      notify("serviceUnavailable", true);
    } finally {
      applyingUpdate.current = false;
    }
  };

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(prefs.language, { dateStyle: "medium", timeStyle: "short" }),
    [prefs.language],
  );

  const formatDate = (value: string) => dateFormatter.format(new Date(value));

  const categoryColor = useCallback(
    (id: string) => categoryAppearance(categoryFor(id)).color,
    [categoryFor],
  );

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
    if (reveal) {
      observer.observe(reveal);
    }
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
        const operation = operations.capture();

        const isCurrent = () =>
          renderedOperation.isCurrent() &&
          operation.isCurrent() &&
          (operations.account ?? "guest") === visitOwner(key);

        await saveVisit(key, record.id, status, isCurrent);
        if (!isCurrent()) {
          return;
        }
        await refresh();
        if (isCurrent()) {
          sync();
        }
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
        setVisitFilter("all");
        setLibraryView("map");
        setMapFocus((previous) => ({
          workspace: scope,
          id: place.id,
          request: (previous?.request ?? 0) + 1,
        }));
        if (mobile || mapFullscreen) {
          setSelected(null);
        }
      }}
      chooseMapProvider={(place, provider) => {
        window.open(mapURL(provider, place), "_blank", "noopener,noreferrer");
        setPrefs({ ...prefs, provider });
      }}
      setSharePlace={setSharePlace}
      setEditor={(value) => {
        if (workspaceController.canWriteNow()) {
          setEditor(value);
        } else {
          notify("familyAccessEnded", true);
        }
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
            if (event.detail === 0) {
              requestAnimationFrame(() =>
                saveDock.current
                  ?.querySelector<HTMLButtonElement>(".save-here")
                  ?.focus({ preventScroll: true }),
              );
            }
          }}
        >
          <PanelBottomOpen size={20} aria-hidden="true" />
          {t("showControls")}
        </button>
      )}
      <header className="app-header">
        <div className="header-inner">
          <Brand />
          <div className="header-actions">
            <Tooltip text={account.account ? t(syncStatus) : t("signIn")}>
              <button
                className={`sync-pill ${syncWarning ? "warning" : ""}`}
                onClick={() => setSettings("account")}
                aria-describedby={
                  account.account
                    ? accountCaption
                      ? "header-account-identity account-sync-status"
                      : "account-sync-status"
                    : undefined
                }
                aria-label={
                  account.account
                    ? t("account")
                    : `${!navigator.onLine ? `${t("offline")} · ` : ""}${t("signIn")}`
                }
              >
                <span className="account-indicator" aria-hidden="true">
                  {account.account ? (
                    <span className="header-sync-icon">
                      <SyncStatusIcon status={syncStatus} />
                    </span>
                  ) : (
                    <UserRound size={24} />
                  )}
                </span>
                <span className="header-account-copy">
                  {account.account && (
                    <bdi id="header-account-identity" className="header-account-identity">
                      {accountCaption || t("account")}
                    </bdi>
                  )}
                  <span
                    id="account-sync-status"
                    className={account.account ? "account-label sr-only" : "account-label"}
                    role={account.account ? "status" : undefined}
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {!account.account
                      ? `${!navigator.onLine ? `${t("offline")} · ` : ""}${t("signIn")}`
                      : t(syncStatus)}
                  </span>
                </span>
              </button>
            </Tooltip>
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
      {account.account && (
        <div
          className={`library-switcher${mobile && places.length > 0 ? " library-switcher-with-add" : ""}`}
        >
          <LibrarySelector
            value={scope}
            privateValue={account.account.id}
            privateLabel={t("privateLibrary")}
            label={t("libraryChoice")}
            count={
              search.trim() || filter !== "all" || visitFilter !== "all"
                ? `${filtered.length} / ${places.length}`
                : `${places.length}`
            }
            countLabel={
              search.trim() || filter !== "all" || visitFilter !== "all"
                ? t("matchingPlacesCount")
                    .replace("{matching}", `${filtered.length}`)
                    .replace("{total}", `${places.length}`)
                : t("placesCount").replace("{total}", `${places.length}`)
            }
            open={!!libraryOpen}
            placement={libraryOpen === "dock" ? "dock" : "selector"}
            onOpenChange={changeLibraryOpen}
            groups={groupOptions}
            onChange={switchLibrary}
            createGroupLabel={t("familyCreateNew")}
            onCreateGroup={() => setSettings("createGroup")}
            joinGroupLabel={t("familyJoinWithCode")}
            onJoinGroup={() => setSettings("joinGroup")}
          />
          {mobile && places.length > 0 && (
            <Tooltip text={t("manual")}>
              <button
                className="icon-button add-manual"
                disabled={!canWrite}
                onClick={() => {
                  if (canWrite) {
                    setEditor({});
                  }
                }}
                aria-label={t("manual")}
              >
                <Plus aria-hidden="true" />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      {selectedFamily && (!mobile || !canWrite) && (
        <div className="shared-library-notice">
          <p>{t(canWrite ? "familyLibraryHint" : "familyReadonly")}</p>
          {canWrite && selectedGroup && (
            <button className="button outline" onClick={() => setSettings("participants")}>
              <Users size={20} />
              {t(selectedGroup.members.length === 1 ? "groupMember" : "groupMembers").replace(
                "{count}",
                `${selectedGroup.members.length}`,
              )}
            </button>
          )}
        </div>
      )}
      <BackupDialogs
        {...{ backups, session, workspaceController, t, notify, sync }}
        onAdded={(text) => setNotice({ text })}
      />
      <LibraryView
        compactHeader={mobile && !!account.account}
        headerActions={
          mobile && canWrite && selectedGroup ? (
            <button
              className="button outline library-members"
              onClick={() => setSettings("participants")}
            >
              <Users size={20} aria-hidden="true" />
              {t(selectedGroup.members.length === 1 ? "groupMember" : "groupMembers").replace(
                "{count}",
                `${selectedGroup.members.length}`,
              )}
            </button>
          ) : undefined
        }
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
          if (mapFullscreen) {
            setFullscreenDetails(true);
          }
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
          if (canWrite) {
            setEditor(value);
          }
        }}
        onResolve={(id, choice) =>
          void editing.resolve(
            conflicts.find((r) => r.id === id)?.kind === "visit" ? visitOwner(scope) : scope,
            id,
            choice,
          )
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
                onClick={() => setLibraryOpen(libraryOpen === "dock" ? false : "dock")}
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
                        if (event.target.value === "details") {
                          setEditor({});
                        }
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
                  onClick={editing.cancelCapture}
                >
                  <X />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {notice && (
        <Toast {...notice} closeLabel={t("dismissMessage")} onClose={() => setNotice(null)} />
      )}
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
                  if (language === "en" || language === "sv") {
                    setPrefs((previous) => ({ ...previous, language }));
                  }
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
          if (!importSelection.current || importSelection.current()) {
            void loadFile(e.target.files?.[0]);
          }
          importSelection.current = null;
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
          onPending={workspaceController.membershipAction}
        />
      )}
      <PlaceEditingDialogs
        {...{
          editing,
          scope,
          canWrite,
          categories,
          places,
          categoryLabel,
          prefs,
          t,
          notify,
          update,
          renderedOperation,
          setFilter,
        }}
        onUpdate={applyUpdate}
      />
      <SharingDialogs
        {...{ sharing, editing, workspaceController, session, reconciling, t, openMaps }}
      />
      {settings && (
        <Settings
          canWrite={canWrite}
          initial={
            settings === "participants" || settings === "createGroup" || settings === "joinGroup"
              ? "familySharing"
              : settings
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
              focusJoin={settings === "joinGroup"}
              onOpen={(groupId) => {
                if (account.account) {
                  switchLibrary(familyKey(account.account.id, groupId));
                  setSettings(null);
                }
              }}
              onSignIn={onSignIn}
              onExport={(groupId) => {
                if (account.account) {
                  void download(familyKey(account.account.id, groupId));
                }
              }}
            />
          )}
          t={t}
          preferences={prefs}
          onPreferences={setPrefs}
          onClose={() => setSettings(null)}
          onCheckUpdates={() => {
            const monitor = updateMonitor.current;
            if (!monitor) {
              notify(navigator.onLine ? "serviceUnavailable" : "offline", true);

              return;
            }
            void monitor
              .check(true)
              .then((result) => {
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
            if (workspaceController.canWriteNow()) {
              importSelection.current = workspaceController.beginWrite().isCurrent;
              fileRef.current?.click();
            } else {
              notify("familyAccessEnded", true);
            }
          }}
          categories={categories}
          categoryLabel={categoryLabel}
          onCategory={(entity) => canWrite && setCategoryEdit({ entity })}
          onDeleteCategory={(entity) => {
            if (canWrite && entity.id !== "other") {
              setDeleteCategory({ entity, scope });
            }
          }}
          account={account}
          onAccount={async () => {
            await refreshAccount();
            await workspaceController.refreshFamilyData().catch(() => {});
          }}
          onSignOut={session.signOut}
          syncStatus={syncStatus}
          onSync={manualSync}
          onDeleteAccount={session.deleteAccount}
          onRemoveDevice={session.removeDevice}
        />
      )}
      {maps && (
        <MapAppChooser
          place={maps.place}
          action={maps.action}
          t={t}
          onClose={() => browsing.setMaps(null)}
          onChoose={browsing.chooseProvider}
          copy={copy}
        />
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
      {update && !editor && (
        <Sheet
          title={t("updateReady")}
          closeLabel={t("updateLater")}
          onClose={() => setUpdate(false)}
        >
          <div className="stack">
            <p>{t("updateHint")}</p>
            <button className="button primary" onClick={() => void applyUpdate()}>
              <CircleArrowUp size={20} aria-hidden="true" />
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
