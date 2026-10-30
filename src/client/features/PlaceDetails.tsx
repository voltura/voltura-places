import { MapPin, Navigation, ArrowUpRight, Share2, Pencil, Copy } from "lucide-react";
import type { LocalRecord, Place, Entity } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { formatAccuracy, type DistanceUnits } from "../foundation/distance";
import { PlacePhoto } from "./PlacePhoto";
export type PlaceRecord = LocalRecord & { kind: "place"; value: Place };
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
  chooseMaps,
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
  chooseMaps: (place: Place) => void;
  setSharePlace: (place: PlaceRecord) => void;
  setEditor: (value: { entity: Entity }) => void;
  copy: (text: string) => Promise<void>;
}) {
  return (
    <div className="details-content">
      <div className="details-header">
        <span className={`detail-marker ${categoryColor(record.value.categoryId)}`}>
          <MapPin size={20} aria-hidden="true" />
        </span>
        <span className="eyebrow">
          {categoryFor(record.value.categoryId)
            ? categoryLabel(categoryFor(record.value.categoryId)!)
            : t("other")}
        </span>
      </div>
      <h2>{record.value.name}</h2>
      <PlacePhoto workspace={workspace} id={record.value.photoId} t={t} />
      <div className="details-coordinates">
        <p className="coordinate-display">
          {record.value.latitude.toFixed(6)}, {record.value.longitude.toFixed(6)}
        </p>
        <button
          className="icon-button"
          aria-label={t("copyCoordinates")}
          title={t("copyCoordinates")}
          onClick={() => void copy(`${record.value.latitude}, ${record.value.longitude}`)}
        >
          <Copy size={20} />
        </button>
      </div>
      <dl>
        <div>
          <dt>{t("captured")}</dt>
          <dd>{formatDate(record.value.capturedAt)}</dd>
        </div>
        {record.value.accuracy !== null && (
          <div>
            <dt>{t("accuracy")}</dt>
            <dd>{formatAccuracy(record.value.accuracy, units)}</dd>
          </div>
        )}
      </dl>
      <div className="details-map-actions">
        <button className="button primary" onClick={() => openMaps(record.value)}>
          <Navigation size={20} />
          {t("openMaps")}
          <ArrowUpRight size={18} />
        </button>
        <button className="button outline" onClick={() => chooseMaps(record.value)}>
          {t("openWith")}
        </button>
      </div>
      <div className="details-secondary-actions">
        <button className="button outline" onClick={() => setSharePlace(record)}>
          <Share2 size={18} />
          {t("share")}
        </button>
        <button
          className="button outline"
          disabled={!canWrite}
          onClick={() => setEditor({ entity: record })}
        >
          <Pencil size={18} />
          {t("edit")}
        </button>
      </div>
    </div>
  );
}
