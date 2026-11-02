import { CategoryIcon } from "./CategoryAppearance";
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Plus,
  Search,
  X,
  ArrowDownUp,
  Map as MapIcon,
  List,
  MoreHorizontal,
  ListFilter,
  Check,
  Bookmark,
} from "lucide-react";
import type { LocalRecord, Place, VisitStatus } from "../../shared/model";
import type { Language, Message } from "../foundation/i18n";
import type { PlaceRecord } from "../../shared/model";
import { Tooltip } from "../ui/Tooltip";
import { dateAppearsInPlaceName } from "../foundation/place-labels";

const PlacesMap = lazy(() => import("./PlacesMap"));
type Props = {
  view: "list" | "map";
  setView: (view: "list" | "map") => void;
  showDetails: boolean;
  fullscreen: boolean;
  onFullscreenChange: (value: boolean) => void;
  onBrowse?: () => void;
  mapFocus: { workspace: string; id: string; request: number } | null;
  onClearMapFocus: () => void;
  workspace: string;
  canWrite: boolean;
  title?: string;
  t: (key: Message) => string;
  places: PlaceRecord[];
  filtered: PlaceRecord[];
  categories: LocalRecord[];
  visitFilter: string;
  setVisitFilter: (value: string) => void;
  visits: Map<string, VisitStatus>;
  filter: string;
  setFilter: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  sort: string;
  canSortClosest: boolean;
  setSort: (value: string) => void;
  selected: string | null;
  setSelected: (id: string) => void;
  setEditor: (v: {}) => void;
  categoryLabel: (r: LocalRecord) => string;
  categoryFor: (id: string) => LocalRecord | undefined;
  categoryColor: (id: string) => string;
  openMaps: (p: Place) => void;
  setMenu: (p: PlaceRecord) => void;
  conflicts: LocalRecord[];
  onResolve: (id: string, choice: "device" | "cloud" | "both") => void;
  current: PlaceRecord | undefined;
  renderDetails: (p: PlaceRecord) => ReactNode;
  prefs: { language: Language };
};

export function LibraryView({
  view,
  setView,
  showDetails,
  fullscreen,
  onFullscreenChange,
  onBrowse,
  mapFocus,
  onClearMapFocus,
  workspace,
  canWrite,
  title,
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
  canSortClosest,
  setSort,
  selected,
  setSelected,
  setEditor,
  categoryLabel,
  categoryFor,
  categoryColor,
  openMaps,
  setMenu,
  conflicts,
  onResolve,
  current,
  renderDetails,
  prefs,
}: Props) {
  const [fitRequest, setFitRequest] = useState(0);
  const searchField = useRef<HTMLInputElement>(null);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(prefs.language, { day: "numeric", month: "short" }),
    [prefs.language],
  );
  const usedCategories = useMemo(
    () => new Set(places.map((p) => categoryFor(p.value.categoryId)?.id ?? "other")),
    [places, categoryFor],
  );

  const cards = useMemo(
    () =>
      view === "list"
        ? filtered.map((place) => {
            const category = categoryFor(place.value.categoryId);

            return {
              place,
              category,
              color: categoryColor(place.value.categoryId),
              label: category ? categoryLabel(category) : t("other"),
              visit: visits.get(place.id),
              date: dateAppearsInPlaceName(place.value)
                ? null
                : dateFormat.format(new Date(place.value.capturedAt)),
            };
          })
        : [],
    [view, filtered, categoryFor, categoryColor, categoryLabel, visits, t, dateFormat],
  );

  const conflictPlaceNames = useMemo(() => {
    if (!conflicts.some((r) => r.kind === "visit")) {
      return null;
    }

    return new Map(places.map((place) => [place.id, place.value.name]));
  }, [places, conflicts]);

  return (
    <main
      className={`app-main${current ? "" : " library-only"}${view === "map" ? " map-view" : ""}`}
    >
      <section className="library-pane">
        {places.length > 0 && (
          <div className="library-title">
            <h1>
              {title ?? t("library")}
              <span className="count">{places.length}</span>
            </h1>
            <Tooltip text={t("manual")}>
              <button
                className="icon-button add-manual"
                disabled={!canWrite}
                onClick={() => setEditor({})}
                aria-label={t("manual")}
              >
                <Plus />
              </button>
            </Tooltip>
          </div>
        )}
        {places.length > 0 && (
          <>
            <div className="library-view-switch" role="group" aria-label={t("libraryView")}>
              {(["list", "map"] as const).map((mode) => (
                <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>
                  {mode === "list" ? (
                    <List size={20} aria-hidden="true" />
                  ) : (
                    <MapIcon size={20} aria-hidden="true" />
                  )}
                  {t(mode === "list" ? "listView" : "mapView")}
                </button>
              ))}
            </div>
            <div className="search-row">
              <div className="search-field">
                <Search size={20} />
                <input
                  aria-label={t("search")}
                  ref={searchField}
                  placeholder={t("search")}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    onClearMapFocus();
                  }}
                />
                {search && (
                  <button
                    className="icon-button"
                    aria-label={t("clearSearch")}
                    onClick={() => {
                      setSearch("");
                      onClearMapFocus();
                      searchField.current?.focus();
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              <label
                className={`visit-filter sort-button${visitFilter !== "all" ? " active" : ""}`}
                title={`${t("visitFilter")}: ${t(visitFilter === "want" ? "visitWant" : visitFilter === "visited" ? "visitVisited" : visitFilter === "none" ? "visitNone" : "visitAll")}`}
              >
                <ListFilter size={20} aria-hidden="true" />
                {visitFilter !== "all" && <span className="filter-dot" aria-hidden="true" />}
                <select
                  aria-label={t("visitFilter")}
                  value={visitFilter}
                  onChange={(e) => {
                    setVisitFilter(e.target.value);
                    onClearMapFocus();
                  }}
                >
                  <option value="all">{t("visitAll")}</option>
                  <option value="want">{t("visitWant")}</option>
                  <option value="visited">{t("visitVisited")}</option>
                  <option value="none">{t("visitNone")}</option>
                </select>
              </label>
              {view === "list" && (
                <label className="sort-button">
                  <ArrowDownUp size={20} />
                  <select
                    aria-label={t("sort")}
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="newest">{t("newest")}</option>
                    <option value="name">{t("byName")}</option>
                    {canSortClosest && <option value="closest">{t("closest")}</option>}
                  </select>
                </label>
              )}
            </div>
            <nav className="category-chips" aria-label={t("categories")}>
              <button
                aria-pressed={filter === "all"}
                className={filter === "all" ? "active" : ""}
                onClick={() => {
                  setFilter("all");
                  onClearMapFocus();
                  setFitRequest((request) => request + 1);
                }}
              >
                {t("all")}
              </button>
              {categories
                .filter((c) => usedCategories.has(c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    aria-pressed={filter === c.id}
                    className={filter === c.id ? "active" : ""}
                    onClick={() => {
                      setFilter(c.id);
                      onClearMapFocus();
                    }}
                  >
                    <CategoryIcon record={c} size={18} />
                    {categoryLabel(c)}
                  </button>
                ))}
            </nav>
          </>
        )}
        {!places.length ? (
          <div className="empty-state">
            <h1>{t("emptyTitle")}</h1>
            <p>{t("emptyBody")}</p>
          </div>
        ) : !filtered.length ? (
          <div className="no-results">
            <Search size={30} />
            <h2>{t("noResults")}</h2>
            <button
              className="button outline"
              onClick={() => {
                setSearch("");
                setFilter("all");
                setVisitFilter("all");
                onClearMapFocus();
                searchField.current?.focus();
              }}
            >
              {t("clearSearch")}
            </button>
          </div>
        ) : view === "map" ? (
          <Suspense fallback={<p role="status">{t("working")}</p>}>
            <PlacesMap
              onBrowse={onBrowse}
              fullscreen={fullscreen}
              onFullscreenChange={onFullscreenChange}
              focusId={mapFocus?.workspace === workspace ? mapFocus.id : null}
              focusRequest={mapFocus?.workspace === workspace ? mapFocus.request : 0}
              key={workspace}
              places={filtered}
              fitKey={`${search}\u0000${filter}\u0000${visitFilter}\u0000${fitRequest}`}
              selected={selected}
              onSelect={setSelected}
              categoryColor={categoryColor}
              t={t}
            />
          </Suspense>
        ) : (
          <div className="place-list">
            {cards.map(({ place: p, category, color, label, visit, date }) => (
              <article key={p.id} className={`place-card ${selected === p.id ? "selected" : ""}`}>
                <button
                  className="card-main"
                  aria-current={selected === p.id ? "true" : undefined}
                  onClick={() => setSelected(p.id)}
                >
                  <span className={`place-marker ${color}`}>
                    <CategoryIcon record={category} size={24} />
                  </span>
                  <span className="card-text">
                    <strong>
                      {p.value.name}
                      {visit && visit !== "none" && (
                        <span
                          className="card-visit"
                          role="img"
                          aria-label={t(visit === "visited" ? "visitVisited" : "visitWant")}
                        >
                          {visit === "visited" ? <Check size={15} /> : <Bookmark size={15} />}
                        </span>
                      )}
                    </strong>
                    <span>
                      {label}
                      {date && (
                        <>
                          <span className="middle-dot">·</span>
                          <span className="card-date">{date}</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
                <div className="card-actions">
                  <button className="card-maps" onClick={() => openMaps(p.value)}>
                    <MapIcon size={17} />
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
            {conflicts.map((r) => (
              <div className="conflict stack" key={r.id}>
                {(r.kind === "visit" || r.deleted || r.conflict?.deleted) && (
                  <strong>
                    {r.kind === "visit"
                      ? (conflictPlaceNames?.get(r.value.placeId) ?? t("myVisitStatus"))
                      : r.value.name}
                  </strong>
                )}
                {(["device", "cloud"] as const).map((choice) => {
                  const version = choice === "device" ? r : r.conflict;
                  if (!version) {
                    return null;
                  }
                  const label = version.deleted
                    ? t("deleted")
                    : version.kind === "visit"
                      ? t(
                          version.value.status === "visited"
                            ? "visitVisited"
                            : version.value.status === "want"
                              ? "visitWant"
                              : "visitNone",
                        )
                      : version.value.name;

                  return (
                    <div className="conflict-version" key={choice}>
                      <div>
                        <span>{t(choice)}</span>
                        <strong>{label}</strong>
                      </div>
                      <button
                        className="button outline"
                        aria-label={`${t("keepVersion")} · ${t(choice)} · ${label}`}
                        disabled={!canWrite}
                        onClick={() => onResolve(r.id, choice)}
                      >
                        {t("keepVersion")}
                      </button>
                    </div>
                  );
                })}
                {r.kind !== "visit" && (
                  <button
                    className="button outline"
                    disabled={!canWrite}
                    onClick={() => onResolve(r.id, "both")}
                  >
                    {t(
                      r.kind === "place" && !r.deleted && !r.conflict?.deleted
                        ? "keepBothPlaces"
                        : "keepBoth",
                    )}
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </section>
      {current && showDetails && <aside className="detail-pane">{renderDetails(current)}</aside>}
    </main>
  );
}
