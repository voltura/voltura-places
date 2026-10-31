import { CategoryIcon } from "./CategoryAppearance";
import { lazy, Suspense, type ReactNode } from "react";
import { Plus, Search, X, ArrowDownUp, Map, List, MoreHorizontal } from "lucide-react";
import type { LocalRecord, Place } from "../../shared/model";
import type { Language, Message } from "../foundation/i18n";
import type { PlaceRecord } from "./PlaceDetails";
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
  workspace: string;
  canWrite: boolean;
  title?: string;
  t: (key: Message) => string;
  places: PlaceRecord[];
  filtered: PlaceRecord[];
  categories: LocalRecord[];
  filter: string;
  setFilter: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  sort: string;
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
  workspace,
  canWrite,
  title,
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
                    <Map size={20} aria-hidden="true" />
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
                  </select>
                </label>
              )}
            </div>
            <nav className="category-chips" aria-label={t("categories")}>
              <button
                aria-pressed={filter === "all"}
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                {t("all")}
              </button>
              {categories
                .filter((c) =>
                  places.some((p) => (categoryFor(p.value.categoryId)?.id ?? "other") === c.id),
                )
                .map((c) => (
                  <button
                    key={c.id}
                    aria-pressed={filter === c.id}
                    className={filter === c.id ? "active" : ""}
                    onClick={() => setFilter(c.id)}
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
              className="button quiet"
              onClick={() => {
                setSearch("");
                setFilter("all");
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
              fitKey={`${search}\u0000${filter}`}
              selected={selected}
              onSelect={setSelected}
              categoryColor={categoryColor}
              t={t}
            />
          </Suspense>
        ) : (
          <div className="place-list">
            {filtered.map((p) => (
              <article key={p.id} className={`place-card ${selected === p.id ? "selected" : ""}`}>
                <button className="card-main" onClick={() => setSelected(p.id)}>
                  <span className={`place-marker ${categoryColor(p.value.categoryId)}`}>
                    <CategoryIcon record={categoryFor(p.value.categoryId)} size={24} />
                  </span>
                  <span className="card-text">
                    <strong>{p.value.name}</strong>
                    <span>
                      {categoryFor(p.value.categoryId)
                        ? categoryLabel(categoryFor(p.value.categoryId)!)
                        : t("other")}
                      {!dateAppearsInPlaceName(p.value) && (
                        <>
                          <span className="middle-dot">·</span>
                          <span className="card-date">
                            {new Intl.DateTimeFormat(prefs.language, {
                              day: "numeric",
                              month: "short",
                            }).format(new Date(p.value.capturedAt))}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
                <div className="card-actions">
                  <button className="card-maps" onClick={() => openMaps(p.value)}>
                    <Map size={17} />
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
                      disabled={!canWrite}
                      onClick={() => onResolve(r.id, choice)}
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
      {current && showDetails && <aside className="detail-pane">{renderDetails(current)}</aside>}
    </main>
  );
}
