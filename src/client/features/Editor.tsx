import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { getDraft, setDraft } from "../foundation/library";
import { placeSchema, type Entity, type LocalRecord, type Place } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { z } from "zod";
import { formatAccuracy, type DistanceUnits } from "../foundation/distance";
import { LocationReview } from "./LocationReview";
import { captureLocation, refineLocation } from "../foundation/location-review";
import { PhotoPicker } from "./PlacePhoto";
const draftSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  latitude: z.string(),
  longitude: z.string(),
  photoId: z.string().uuid().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  capturedAt: z.string().datetime().optional(),
});
export function Editor({
  entity,
  categories,
  categoryLabel,
  t,
  onClose,
  onSave,
  workspace,
  fresh = false,
  draftId,
  updateReady = false,
  onUpdate,
  reviewGps,
  units,
}: {
  entity?: Entity;
  categories: LocalRecord[];
  categoryLabel: (r: LocalRecord) => string;
  t: (k: Message) => string;
  onClose: () => void;
  onSave: (entity: Entity) => Promise<void>;
  workspace: string;
  reviewGps: boolean;
  units: DistanceUnits;
  fresh?: boolean;
  draftId?: string;
  updateReady?: boolean;
  onUpdate?: () => void;
}) {
  const initial = entity?.kind === "place" ? entity.value : null;
  const [name, setName] = useState(initial?.name ?? ""),
    [categoryId, setCategory] = useState(initial?.categoryId ?? "other");
  const [latitude, setLat] = useState(initial ? String(initial.latitude) : ""),
    [longitude, setLng] = useState(initial ? String(initial.longitude) : "");
  const [accuracy, setAccuracy] = useState<number | null>(initial?.accuracy ?? null),
    [capturedAt, setCapturedAt] = useState(initial?.capturedAt ?? new Date().toISOString());
  const [error, setError] = useState(""),
    [photoId, setPhoto] = useState<string | null>(initial?.photoId ?? null),
    [photoBusy, setPhotoBusy] = useState(false),
    [locating, setLocating] = useState(false),
    [gpsReview, setGpsReview] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const id = useRef(entity?.id ?? draftId ?? crypto.randomUUID());
  const stopCapture = useRef(() => {});
  const stopRefinement = useRef(() => {});
  useEffect(
    () => () => {
      stopCapture.current();
      stopRefinement.current();
    },
    [],
  );
  const selectPosition = (p: GeolocationPosition) => {
    setLat(String(p.coords.latitude));
    setLng(String(p.coords.longitude));
    setAccuracy(p.coords.accuracy);
    setCapturedAt(new Date(p.timestamp).toISOString());
  };
  const startRefinement = (accuracy: number) => {
    stopRefinement.current();
    stopRefinement.current = refineLocation(accuracy, selectPosition);
  };
  const latest = useRef<Record<string, unknown>>({});
  latest.current = {
    name,
    categoryId,
    latitude,
    longitude,
    photoId,
    accuracy,
    capturedAt,
    id: id.current,
  };
  useEffect(() => {
    let active = true;
    void getDraft(workspace)
      .then((d) => {
        const parsed = draftSchema.safeParse(d);
        if (active && parsed.success && parsed.data.id === id.current) {
          const v = parsed.data;
          setName(v.name);
          setCategory(v.categoryId);
          setLat(v.latitude);
          setLng(v.longitude);
          setPhoto(v.photoId !== undefined ? v.photoId : (initial?.photoId ?? null));
          setAccuracy(v.accuracy !== undefined ? v.accuracy : (initial?.accuracy ?? null));
          setCapturedAt(v.capturedAt ?? initial?.capturedAt ?? new Date().toISOString());
        }
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  useEffect(() => {
    // Only a just-captured place may refine automatically. An existing place
    // or restored photo selection must retain its explicitly selected location.
    if (
      ready &&
      fresh &&
      initial?.accuracy != null &&
      latest.current.latitude === String(initial.latitude) &&
      latest.current.longitude === String(initial.longitude) &&
      latest.current.accuracy === initial.accuracy
    ) {
      startRefinement(initial.accuracy);
    }
    return () => stopRefinement.current();
  }, [ready, workspace]);
  useEffect(() => {
    if (ready) void setDraft(workspace, latest.current).catch(() => {});
  }, [name, categoryId, latitude, longitude, photoId, accuracy, capturedAt, workspace, ready]);
  const save = async () => {
    if (!latitude.trim() || !longitude.trim()) {
      setError(t("chooseLocation"));
      return;
    }
    const now = new Date().toISOString();
    const parsed = placeSchema.safeParse({
      name,
      categoryId,
      latitude: latitude.trim() ? Number(latitude) : NaN,
      longitude: longitude.trim() ? Number(longitude) : NaN,
      accuracy,
      capturedAt,
      updatedAt: now,
      photoId,
    });
    if (!parsed.success) {
      setError(t("invalidCoordinates"));
      return;
    }
    setBusy(true);
    stopCapture.current();
    stopRefinement.current();
    try {
      await onSave({ id: id.current, kind: "place", value: parsed.data as Place });
      await setDraft(workspace, null);
      onClose();
    } catch (error) {
      setError(
        t(
          error instanceof Error && error.message === "familyAccessEnded"
            ? "familyAccessEnded"
            : "storageFailure",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    stopCapture.current();
    stopRefinement.current();
    void setDraft(workspace, null)
      .then(onClose)
      .catch(() => setError(t("storageFailure")));
  };
  return (
    <>
      <Sheet
        title={fresh ? t("saved") : initial ? t("edit") : t("manual")}
        onClose={dismiss}
        closeLabel={t("close")}
      >
        {updateReady && (
          <div className="notice stack">
            <strong>{t("updateReady")}</strong>
            <p>{t("updateHint")}</p>
            <button type="button" className="button outline" onClick={onUpdate}>
              {t("update")}
            </button>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="stack"
        >
          <label>
            {t("name")}
            <input
              autoComplete="off"
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            {t("category")}
            <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button outline"
            disabled={locating}
            onClick={() => {
              stopRefinement.current();
              if (reviewGps) {
                setGpsReview(true);
                return;
              }
              if (!navigator.geolocation) {
                setError(t("gpsUnsupported"));
                return;
              }
              setLocating(true);
              setError("");
              stopCapture.current();
              stopCapture.current = captureLocation(
                (p) => {
                  selectPosition(p);
                  startRefinement(p.coords.accuracy);
                  setLocating(false);
                },
                (error) => {
                  setError(t(error));
                  setLocating(false);
                },
              );
            }}
          >
            {t(locating ? "working" : "useCurrentLocation")}
          </button>
          {latitude && longitude && <p className="success-note">{t("locationSet")}</p>}
          {accuracy != null && (
            <p className="muted small" role="status">
              <MapPin size={15} /> {t("accuracy")}: {formatAccuracy(accuracy, units)}
            </p>
          )}
          <PhotoPicker
            workspace={workspace}
            id={photoId}
            t={t}
            onChange={setPhoto}
            onBusy={setPhotoBusy}
            onPosition={(position) => {
              stopCapture.current();
              stopRefinement.current();
              setLocating(false);
              setLat(String(position.latitude));
              setLng(String(position.longitude));
              setAccuracy(null);
              setCapturedAt(new Date().toISOString());
              setError("");
            }}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="button primary"
            disabled={busy || photoBusy || locating || !ready}
          >
            {busy ? t("working") : t("save")}
          </button>
          <button type="button" className="button quiet" onClick={dismiss}>
            {fresh ? t("done") : t("cancel")}
          </button>
        </form>
      </Sheet>
      {gpsReview && (
        <LocationReview
          units={units}
          t={t}
          onClose={() => setGpsReview(false)}
          onConfirm={(position) => {
            selectPosition(position);
            startRefinement(position.coords.accuracy);
            setError("");
            setGpsReview(false);
          }}
        />
      )}
    </>
  );
}
