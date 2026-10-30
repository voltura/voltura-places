import { useEffect, useRef, useState } from "react";
import { ChevronDown, LocateFixed, LoaderCircle, MapPin } from "lucide-react";
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
  onDiscardPlace,
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
  onDiscardPlace: (id: string) => Promise<void>;
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
    [locationUpdated, setLocationUpdated] = useState(false),
    [gpsReview, setGpsReview] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [discarding, setDiscarding] = useState(false);
  const [discardingPlace, setDiscardingPlace] = useState(false);
  const id = useRef(entity?.id ?? draftId ?? crypto.randomUUID());
  const nameSelected = useRef(false);
  const selectNameOnPointerUp = useRef(false);
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
  const discard = () => {
    if (busy || photoBusy || !ready) return;
    stopCapture.current();
    stopRefinement.current();
    void setDraft(workspace, null)
      .then(onClose)
      .catch(() => setError(t("storageFailure")));
  };
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const discardPlace = async () => {
    if (busy || photoBusy || !ready) return;
    setBusy(true);
    stopCapture.current();
    stopRefinement.current();
    setLocating(false);
    try {
      await onDiscardPlace(id.current);
      await setDraft(workspace, null);
      onClose();
    } catch (error) {
      setDiscardingPlace(false);
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
    if (busy || photoBusy || !ready) return;
    const changed =
      name !== (initial?.name ?? "") ||
      categoryId !== (initial?.categoryId ?? "other") ||
      latitude !== (initial ? String(initial.latitude) : "") ||
      longitude !== (initial ? String(initial.longitude) : "") ||
      photoId !== (initial?.photoId ?? null) ||
      accuracy !== (initial?.accuracy ?? null) ||
      (initial != null && capturedAt !== initial.capturedAt);
    if (changed) setDiscarding(true);
    else discard();
  };
  return (
    <>
      <Sheet
        title={fresh ? t("placeSaved") : initial ? t("edit") : t("manual")}
        className="editor-sheet"
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
          className="stack editor-form"
          inert={busy}
        >
          <label>
            {t("name")}
            <input
              autoComplete="off"
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onPointerDown={() => {
                selectNameOnPointerUp.current =
                  fresh && ready && !nameSelected.current && name === initial?.name;
              }}
              onFocus={(e) => {
                if (fresh && ready && !nameSelected.current && name === initial?.name) {
                  nameSelected.current = true;
                  e.currentTarget.select();
                }
              }}
              onPointerUp={(e) => {
                if (selectNameOnPointerUp.current) {
                  e.currentTarget.select();
                  selectNameOnPointerUp.current = false;
                }
              }}
              onBlur={() => {
                selectNameOnPointerUp.current = false;
              }}
              autoFocus={!fresh}
            />
          </label>
          <div className="preferences-options editor-category">
            <label className="preference-row">
              <span>{t("category")}</span>
              <span className="preference-value" aria-hidden="true">
                {selectedCategory ? categoryLabel(selectedCategory) : t("other")}
              </span>
              <ChevronDown size={20} aria-hidden="true" />
              <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={latitude && longitude ? "editor-location" : "stack"}>
            {latitude && longitude && (
              <p className="muted small" role="status">
                <MapPin size={15} aria-hidden="true" />{" "}
                {accuracy != null
                  ? `${t("accuracy")}: ${formatAccuracy(accuracy, units)}`
                  : t("locationSet")}
              </p>
            )}
            <button
              type="button"
              className={
                latitude && longitude ? "icon-button editor-location-update" : "button outline"
              }
              aria-label={latitude && longitude ? t("updateLocation") : undefined}
              aria-busy={locating}
              disabled={locating}
              onClick={() => {
                stopRefinement.current();
                setLocationUpdated(false);
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
                    setLocationUpdated(true);
                  },
                  (error) => {
                    setError(t(error));
                    setLocating(false);
                  },
                );
              }}
            >
              {latitude && longitude ? (
                locating ? (
                  <LoaderCircle className="editor-location-spinner" size={22} aria-hidden="true" />
                ) : (
                  <LocateFixed size={22} aria-hidden="true" />
                )
              ) : (
                <>
                  {locating ? (
                    <LoaderCircle
                      className="editor-location-spinner"
                      size={24}
                      aria-hidden="true"
                    />
                  ) : (
                    <LocateFixed size={24} aria-hidden="true" />
                  )}
                  {t(locating ? "working" : "useCurrentLocation")}
                </>
              )}
            </button>
          </div>
          {locating && (
            <div className="editor-location-progress">
              <div role="status" className="small muted">
                <p>{t("gpsWaiting")}</p>
                <p>{t("editorGpsWaitingHint")}</p>
              </div>
              <button
                type="button"
                className="button quiet"
                onClick={() => {
                  stopCapture.current();
                  setLocating(false);
                }}
              >
                {t("cancelLocationUpdate")}
              </button>
            </div>
          )}
          {locationUpdated && (
            <p role="status" className="small muted editor-location-feedback">
              {t(fresh ? "locationUpdated" : "editorLocationUpdated")}
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
              setLocationUpdated(false);
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
            {t(busy ? "working" : fresh ? "done" : "save")}
          </button>
          {!fresh && (
            <button type="button" className="button quiet" onClick={dismiss}>
              {t("cancel")}
            </button>
          )}
          {fresh && (
            <button
              type="button"
              className="editor-discard-place"
              disabled={busy || photoBusy || !ready}
              onClick={() => setDiscardingPlace(true)}
            >
              {t("discardPlace")}
            </button>
          )}
        </form>
      </Sheet>
      {discardingPlace && (
        <Sheet
          title={t("discardPlaceTitle")}
          closeLabel={t("close")}
          onClose={() => {
            if (!busy) setDiscardingPlace(false);
          }}
        >
          <div className="stack">
            <p>
              <strong>{initial?.name}</strong>
            </p>
            <p>{t("deletePlaceBody")}</p>
            <button
              type="button"
              className="button outline"
              data-initial-focus
              disabled={busy}
              onClick={() => setDiscardingPlace(false)}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void discardPlace()}
            >
              {t(busy ? "working" : "discardPlace")}
            </button>
          </div>
        </Sheet>
      )}
      {discarding && (
        <Sheet
          title={t("discardChanges")}
          onClose={() => setDiscarding(false)}
          closeLabel={t("close")}
        >
          <div className="stack">
            <p>{t("discardChangesHint")}</p>
            <button
              type="button"
              className="button outline"
              data-initial-focus
              onClick={() => setDiscarding(false)}
            >
              {t("keepEditing")}
            </button>
            <button type="button" className="button danger" onClick={discard}>
              {t("discard")}
            </button>
          </div>
        </Sheet>
      )}
      {gpsReview && (
        <LocationReview
          units={units}
          t={t}
          onClose={() => setGpsReview(false)}
          onConfirm={(position) => {
            selectPosition(position);
            setLocationUpdated(true);
            startRefinement(position.coords.accuracy);
            setError("");
            setGpsReview(false);
          }}
        />
      )}
    </>
  );
}
