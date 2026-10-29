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
      <div className={`detail-marker ${categoryColor(record.value.categoryId)}`}>
        <MapPin size={38} />
      </div>
      <span className="eyebrow">
        {categoryFor(record.value.categoryId)
          ? categoryLabel(categoryFor(record.value.categoryId)!)
          : t("other")}
      </span>
      <h2>{record.value.name}</h2>
      <PlacePhoto workspace={workspace} id={record.value.photoId} t={t} />
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
            <dd>{formatAccuracy(record.value.accuracy, units)}</dd>
          </div>
        )}
      </dl>
      <button className="button primary" onClick={() => openMaps(record.value)}>
        <Navigation size={20} />
        {t("openMaps")}
        <ArrowUpRight size={18} />
      </button>
      <button className="button quiet" onClick={() => chooseMaps(record.value)}>
        {t("openWith")}
      </button>
      <div className="action-pair">
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
      <button
        className="button quiet"
        onClick={() => void copy(`${record.value.latitude}, ${record.value.longitude}`)}
      >
        <Copy size={17} />
        {t("copyCoordinates")}
      </button>
    </div>
  );
}
