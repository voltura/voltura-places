import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, LocateFixed, Plus, RotateCw, Search } from "lucide-react";
import { mapSearchQuery, mapSearchResults, type MapSearchResult } from "../../shared/map-search";
import { distanceMetres } from "../foundation/distance";
import { api, ApiError } from "../foundation/http";
import type { Message } from "../foundation/i18n";
import { validPosition } from "../foundation/location-review";
import type { Preferences } from "../foundation/preferences";
import { Sheet } from "../ui/Sheet";
import type { MapSearchPoint } from "./MapSearchMap";

const SearchMap = lazy(() => import("./MapSearchMap").catch(() => ({ default: UnavailableMap })));
type SearchState =
  | {
      status:
        | "mapSearchLoading"
        | "mapSearchOffline"
        | "mapSearchFailed"
        | "mapSearchRateLimited"
        | "mapSearchInvalid";
    }
  | { status: "results"; results: MapSearchResult[] };

function UnavailableMap({ t }: { t: (key: Message) => string }) {
  return <p role="status">{t("mapModuleUnavailable")}</p>;
}

export function MapSearch({
  initialQuery,
  isCurrent,
  position,
  rememberPosition,
  online,
  prefs,
  t,
  canAdd,
  onAdd,
  onClose,
}: {
  initialQuery: string;
  isCurrent: () => boolean;
  position: GeolocationPosition | null;
  rememberPosition: (position: GeolocationPosition) => void;
  online: boolean;
  prefs: Pick<Preferences, "units" | "language">;
  t: (key: Message) => string;
  canAdd: boolean;
  onAdd: (result: MapSearchResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<SearchState>({ status: "mapSearchLoading" });
  const [selected, select] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [point, setPoint] = useState<MapSearchPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<Message | null>(null);
  const search = useRef<AbortController | null>(null);
  const locate = useRef<AbortController | null>(null);
  const lastQuery = useRef(initialQuery);
  const results = state.status === "results" ? state.results : null;
  const activeResult = results?.find(({ id }) => selected === id);
  const pickerResults = useMemo(() => (activeResult ? [activeResult] : []), [activeResult]);
  const ordered = useMemo(() => {
    const rows =
      results?.map((result) => ({
        result,
        distance: position ? distanceMetres(position.coords, result) : null,
      })) ?? [];

    return position ? rows.sort((a, b) => a.distance! - b.distance!) : rows;
  }, [results, position]);
  const imperial = prefs.units === "imperial";
  const distanceFormats = useMemo(
    () => ({
      short: new Intl.NumberFormat(prefs.language, {
        style: "unit",
        unit: imperial ? "foot" : "meter",
        maximumFractionDigits: 0,
      }),
      long: new Intl.NumberFormat(prefs.language, {
        style: "unit",
        unit: imperial ? "mile" : "kilometer",
        maximumFractionDigits: 1,
      }),
    }),
    [prefs.language, imperial],
  );

  const distanceLabel = (metres: number) => {
    const longDistance = metres / (imperial ? 1609.344 : 1000);

    return longDistance >= 1
      ? distanceFormats.long.format(longDistance)
      : distanceFormats.short.format(metres / (imperial ? 0.3048 : 1));
  };

  const submit = async (value: string) => {
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    select(null);
    lastQuery.current = value;
    const parsed = mapSearchQuery.safeParse(value);
    if (!parsed.success) {
      setState({ status: "mapSearchInvalid" });

      return;
    }
    if (!navigator.onLine) {
      setState({ status: "mapSearchOffline" });

      return;
    }
    setState({ status: "mapSearchLoading" });
    try {
      const response = await api<{ results: unknown }>(
        "/api/v1/map-search",
        { query: parsed.data },
        undefined,
        "POST",
        controller.signal,
      );
      if (!controller.signal.aborted && isCurrent()) {
        setState({ status: "results", results: mapSearchResults.parse(response.results) });
      }
    } catch (error) {
      if (!controller.signal.aborted && isCurrent()) {
        const status = !navigator.onLine
          ? "mapSearchOffline"
          : error instanceof ApiError && error.status === 429
            ? "mapSearchRateLimited"
            : "mapSearchFailed";
        setState({ status });
      }
    }
  };

  useEffect(() => {
    const start = new AbortController();
    queueMicrotask(() => {
      if (!start.signal.aborted && isCurrent()) {
        void submit(initialQuery);
      }
    });

    return () => {
      start.abort();
      search.current?.abort();
      locate.current?.abort();
    };
  }, []);

  const sortByDistance = () => {
    locate.current?.abort();
    const controller = new AbortController();
    locate.current = controller;
    setLocationStatus("mapSearchLocating");

    const complete = (message: Message | null) => {
      if (!controller.signal.aborted && isCurrent()) {
        setLocationStatus(message);

        return true;
      }

      return false;
    };

    try {
      navigator.geolocation.getCurrentPosition(
        (next) => {
          if (validPosition(next)) {
            if (complete(null)) {
              rememberPosition(next);
            }
          } else {
            complete("mapSearchLocationUnavailable");
          }
        },
        (error) =>
          complete(error.code === 1 ? "mapSearchLocationDenied" : "mapSearchLocationUnavailable"),
        { maximumAge: 0, timeout: 15000, enableHighAccuracy: false },
      );
    } catch {
      complete("mapSearchLocationUnavailable");
    }
  };

  const retry = state.status === "mapSearchFailed" || state.status === "mapSearchOffline";

  return (
    <>
      <Sheet
        title={t("mapSearch")}
        closeLabel={t("mapSearchBack")}
        onClose={onClose}
        className="map-search-view"
        footer={
          activeResult &&
          canAdd && (
            <div className="map-search-actions">
              <button
                className="button outline"
                onClick={() => {
                  setPoint(null);
                  setAdjusting(true);
                }}
              >
                <Crosshair size={20} aria-hidden="true" />
                {t("mapSearchAdjust")}
              </button>
              <button className="button primary" onClick={() => onAdd(activeResult)}>
                <Plus size={20} aria-hidden="true" />
                {t("mapSearchAdd")}
              </button>
            </div>
          )
        }
      >
        <div className="map-search-content stack">
          <form
            className="map-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(query);
            }}
          >
            <input
              aria-label={t("mapSearchQuery")}
              placeholder={t("mapSearchQuery")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="button primary" type="submit" disabled={!query.trim()}>
              <Search size={20} aria-hidden="true" />
              {t("mapSearchSubmit")}
            </button>
          </form>
          {state.status !== "results" ? (
            <div className="stack">
              <p role="status">{t(state.status)}</p>
              {retry && (
                <button
                  className="button outline"
                  disabled={!online}
                  onClick={() => void submit(lastQuery.current)}
                >
                  <RotateCw size={20} aria-hidden="true" />
                  {t("retry")}
                </button>
              )}
            </div>
          ) : !state.results.length ? (
            <p role="status">{t("mapSearchEmpty")}</p>
          ) : (
            <>
              <Suspense fallback={<p role="status">{t("working")}</p>}>
                <SearchMap results={state.results} selected={selected} onSelect={select} t={t} />
              </Suspense>
              <div className="map-search-list-heading">
                <h3>{t("mapSearchResults")}</h3>
                {!position && (
                  <button
                    className="button outline"
                    onClick={sortByDistance}
                    disabled={locationStatus === "mapSearchLocating"}
                  >
                    <LocateFixed size={18} aria-hidden="true" />
                    {t("mapSearchDistance")}
                  </button>
                )}
              </div>
              {position && <p className="muted small">{t("mapSearchDistanceEstimate")}</p>}
              {!position && locationStatus && <p role="status">{t(locationStatus)}</p>}
              <ul className="map-search-list">
                {ordered.map(({ result, distance }) => (
                  <li key={result.id}>
                    <button
                      className="button outline"
                      aria-pressed={result.id === selected}
                      onClick={() => select(result.id)}
                    >
                      <span>
                        <strong>{result.name}</strong>
                        <span className="muted small">
                          {[result.municipality, result.county].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {distance !== null && <span>≈ {distanceLabel(distance)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">{t("mapSearchAttribution")}</p>
        </div>
      </Sheet>
      {adjusting && canAdd && activeResult && (
        <Sheet
          title={t("mapSearchAdjust")}
          subtitle={activeResult.name}
          closeLabel={t("cancel")}
          onClose={() => setAdjusting(false)}
          className="map-search-view map-search-picker"
          footer={
            <button
              className="button primary"
              disabled={!point}
              onClick={() => {
                if (point && isCurrent()) {
                  setAdjusting(false);
                  onAdd({ ...activeResult, ...point });
                }
              }}
            >
              <Crosshair size={20} aria-hidden="true" />
              {t("mapSearchUsePoint")}
            </button>
          }
        >
          <div className="map-search-content stack">
            <p>{t("mapSearchAdjustHint")}</p>
            <Suspense fallback={<p role="status">{t("working")}</p>}>
              <SearchMap results={pickerResults} selected={null} onPick={setPoint} t={t} />
            </Suspense>
          </div>
        </Sheet>
      )}
    </>
  );
}
