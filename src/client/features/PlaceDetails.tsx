import { CategoryIcon } from "./CategoryAppearance";
import { mapProviders } from "../foundation/map-providers";
import { placeDetailsName } from "../foundation/place-labels";
import { Map, Route, ChevronDown, Share2, Pencil, Copy, Info } from "lucide-react";
import { lazy, Suspense, useId, useState } from "react";
import type { LocalRecord, Place, Entity } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { formatAccuracy, type DistanceUnits } from "../foundation/distance";
import { PlacePhoto } from "./PlacePhoto";
import { Tooltip } from "../ui/Tooltip";
export type PlaceRecord = LocalRecord & { kind: "place"; value: Place };
const PlacesMap = lazy(() => import("./PlacesMap"));
export function PlaceDetails({
  canWrite,
  record,
  workspace,
  units,
  categoryColor,
  categoryFor,
  categoryLabel,
  t,
  formatDate,
  openMaps,
  navigate,
  expandMap,
  chooseMapProvider,
  setSharePlace,
  setEditor,
  copy,
}: {
  canWrite: boolean;
  record: PlaceRecord;
  workspace: string;
  units: DistanceUnits;
  categoryColor: (id: string) => string;
  categoryFor: (id: string) => LocalRecord | undefined;
  categoryLabel: (r: LocalRecord) => string;
  t: (key: Message) => string;
  formatDate: (date: string) => string;
  openMaps: (place: Place) => void;
  navigate: (place: Place) => void;
  expandMap: (record: PlaceRecord) => void;
  chooseMapProvider: (place: Place, provider: "google" | "apple" | "geo") => void;
  setSharePlace: (place: PlaceRecord) => void;
  setEditor: (value: { entity: Entity }) => void;
  copy: (text: string) => Promise<void>;
}) {
  const [accuracyHelp, setAccuracyHelp] = useState(false);
  const accuracyHelpId = useId();
  const coordinates = [record.value.latitude, record.value.longitude].map((value) =>
    Number(value.toFixed(6)),
  );
  const decimals = Math.max(
    ...coordinates.map((value) => value.toString().split(".")[1]?.length ?? 0),
  );
  return (
    <div className="details-content">
      <h2>{placeDetailsName(record.value)}</h2>
      <div className="details-header">
        <span className={`detail-marker ${categoryColor(record.value.categoryId)}`}>
          <CategoryIcon record={categoryFor(record.value.categoryId)} size={20} />
        </span>
        <span className="details-category">
          {categoryFor(record.value.categoryId)
            ? categoryLabel(categoryFor(record.value.categoryId)!)
            : t("other")}
        </span>
      </div>
      <PlacePhoto workspace={workspace} id={record.value.photoId} t={t} />
      <div className="details-map-actions split-actions">
        <button className="button primary" onClick={() => openMaps(record.value)}>
          <Map size={20} />
          {t("openMaps")}
        </button>
        <div className="details-map-picker split-picker">
          <select
            aria-label={t("openWith")}
            value=""
            onChange={(event) => {
              const provider = event.target.value;
              if (provider === "google" || provider === "apple" || provider === "geo")
                chooseMapProvider(record.value, provider);
            }}
          >
            <option value="" disabled hidden>
              {t("openWith")}
            </option>
            {mapProviders().map((provider) => (
              <option key={provider} value={provider}>
                {t(provider)}
              </option>
            ))}
          </select>
          <ChevronDown size={20} aria-hidden="true" />
        </div>
      </div>
      <button className="button outline navigate-place" onClick={() => navigate(record.value)}>
        <Route size={20} />
        {t("navigate")}
      </button>
      <div className="details-secondary-actions">
        <button className="button outline" onClick={() => setSharePlace(record)}>
          <Share2 size={18} />
          {t("shareAction")}
        </button>
        <button
          className="button outline"
          disabled={!canWrite}
          onClick={() => setEditor({ entity: record })}
        >
          <Pencil size={18} />
          {t("editAction")}
        </button>
      </div>
      <dl className="details-metadata">
        <div>
          <dt>{t("coordinates")}</dt>
          <dd className="details-coordinates">
            <p className="coordinate-display">
              {coordinates.map((value) => value.toFixed(decimals)).join(", ")}
            </p>
            <Tooltip text={t("copyCoordinates")}>
              <button
                className="icon-button"
                aria-label={t("copyCoordinates")}
                onClick={() => void copy(`${record.value.latitude}, ${record.value.longitude}`)}
              >
                <Copy size={20} />
              </button>
            </Tooltip>
          </dd>
        </div>
        <div>
          <dt>{t("captured")}</dt>
          <dd className="metadata-date">{formatDate(record.value.capturedAt)}</dd>
        </div>
        {record.value.accuracy !== null && (
          <div>
            <dt>{t("accuracy")}</dt>
            <dd className="metadata-accuracy">
              <span className={record.value.accuracy >= 500 ? "accuracy-imprecise" : undefined}>
                {record.value.accuracy >= 500 && (
                  <span className="accuracy-dot" aria-hidden="true" />
                )}
                {formatAccuracy(record.value.accuracy, units)}
              </span>
              <button
                className="icon-button"
                aria-label={t("accuracyInfo")}
                aria-expanded={accuracyHelp}
                aria-controls={accuracyHelpId}
                onClick={() => setAccuracyHelp(!accuracyHelp)}
              >
                <Info size={20} />
              </button>
            </dd>
          </div>
        )}
      </dl>
      {record.value.accuracy !== null && (
        <p id={accuracyHelpId} className="accuracy-help" hidden={!accuracyHelp}>
          {t("accuracyExplanation")}
        </p>
      )}
      <div className="details-map-preview">
        <Suspense
          fallback={
            <div className="map-preview-loading" role="status">
              {t("working")}
            </div>
          }
        >
          <PlacesMap
            key={`${workspace}:${record.id}`}
            preview
            onExpand={() => expandMap(record)}
            places={[record]}
            fitKey={`${record.value.latitude},${record.value.longitude}`}
            selected={null}
            onSelect={() => {}}
            categoryColor={categoryColor}
            t={t}
          />
        </Suspense>
      </div>
    </div>
  );
}
