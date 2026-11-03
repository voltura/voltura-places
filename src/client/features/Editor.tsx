import { CategoryIcon } from "./CategoryAppearance";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Trash2,
  RotateCw,
  CircleArrowUp,
} from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { clearDraft, getDraft, setDraft } from "../foundation/library";
import { hasUnfinishedEdits } from "../foundation/editor-draft";
import {
  entitySchema,
  placeSchema,
  type Entity,
  type LocalRecord,
  type Place,
} from "../../shared/model";
import { libraryErrorMessage, type Message } from "../foundation/i18n";
import { z } from "zod";
import { formatAccuracy, type DistanceUnits } from "../foundation/distance";
import { LocationReview } from "./LocationReview";
import { captureLocation, refineLocation } from "../foundation/location-review";
import { PhotoPicker } from "./PlacePhoto";

const draftSchema = z.object({
  base: entitySchema.nullable().optional(),
  id: z.string(),
  name: z.string(),
  description: z.string().max(1000).optional(),
  visitedHere: z.boolean().optional(),
  categoryId: z.string(),
  latitude: z.string(),
  longitude: z.string(),
  manualLocation: z.boolean().optional(),
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
  onDelete,
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
  onSave: (entity: Entity, base: Entity | null, visitedHere: boolean) => Promise<void>;
  onDiscardPlace: (id: string) => Promise<void>;
  onDelete?: () => void;
  workspace: string;
  reviewGps: boolean;
  units: DistanceUnits;
  fresh?: boolean;
  draftId?: string;
  updateReady?: boolean;
  onUpdate?: () => void;
}) {
  const comparisonBase = useRef<Entity | null>(entity ?? null);
  const route = entity?.kind === "route" ? entity : null;
  const initial = entity?.kind === "place" || entity?.kind === "route" ? entity.value : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [categoryId, setCategory] = useState(initial?.categoryId ?? "other");
  const [latitude, setLat] = useState(initial ? String(initial.latitude) : "");
  const [longitude, setLng] = useState(initial ? String(initial.longitude) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [descriptionOpen, setDescriptionOpen] = useState(!!initial?.description);
  const [visitedHere, setVisitedHere] = useState(false);
  const [manualLocation, setManualLocation] = useState(!initial);
  const [coordinatesExpanded, setCoordinatesExpanded] = useState(false);
  const hasValidCoordinates =
    [latitude, longitude].every((value) =>
      /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim()),
    ) &&
    Math.abs(Number(latitude.replace(",", "."))) <= 90 &&
    Math.abs(Number(longitude.replace(",", "."))) <= 180;
  const [accuracy, setAccuracy] = useState<number | null>(initial?.accuracy ?? null);
  const [capturedAt, setCapturedAt] = useState(
    () => initial?.capturedAt ?? new Date().toISOString(),
  );
  const [error, setError] = useState("");
  const [photoId, setPhoto] = useState<string | null>(initial?.photoId ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationUpdated, setLocationUpdated] = useState(false);
  const [gpsReview, setGpsReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [draftAttempt, setDraftAttempt] = useState(0);
  const [draftReadError, setDraftReadError] = useState(false);
  const [draftWriteError, setDraftWriteError] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardingPlace, setDiscardingPlace] = useState(false);
  const [id] = useState(() => entity?.id ?? draftId ?? crypto.randomUUID());
  const nameField = useRef<HTMLInputElement>(null);
  const focusDescription = useRef(false);
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
    setVisitedHere(true);
    setManualLocation(false);
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
    description,
    visitedHere,
    name,
    categoryId,
    latitude,
    longitude,
    manualLocation,
    photoId,
    accuracy,
    capturedAt,
    id,
    base: comparisonBase.current,
  };
  useEffect(() => {
    let active = true;
    void getDraft(workspace)
      .then((d) => {
        const parsed = draftSchema.safeParse(d);
        if (active && parsed.success && parsed.data.id === id) {
          const v = parsed.data;
          // Legacy drafts have no trustworthy comparison base: preserve both versions.
          comparisonBase.current = v.base ?? null;
          setName(v.name);
          setDescription(v.description ?? initial?.description ?? "");
          setDescriptionOpen(!!(v.description ?? initial?.description));
          setVisitedHere(v.visitedHere ?? false);
          setCategory(v.categoryId);
          setLat(v.latitude);
          setLng(v.longitude);
          setManualLocation(v.manualLocation ?? (!initial && !v.latitude && !v.longitude));
          setPhoto(v.photoId !== undefined ? v.photoId : (initial?.photoId ?? null));
          setAccuracy(v.accuracy !== undefined ? v.accuracy : (initial?.accuracy ?? null));
          setCapturedAt(v.capturedAt ?? initial?.capturedAt ?? new Date().toISOString());
        }
        if (active) {
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setDraftReadError(true);
        }
      });

    return () => {
      active = false;
    };
  }, [workspace, draftAttempt]);
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
    if (!ready) {
      return;
    }
    let current = true;
    void setDraft(workspace, latest.current).then(
      () => {
        if (current) {
          setDraftWriteError(false);
        }
      },
      () => {
        if (current) {
          setDraftWriteError(true);
        }
      },
    );

    return () => {
      current = false;
    };
  }, [
    description,
    visitedHere,
    name,
    categoryId,
    latitude,
    longitude,
    manualLocation,
    photoId,
    accuracy,
    capturedAt,
    workspace,
    ready,
  ]);

  useEffect(() => {
    const input = nameField.current;
    if (ready && !fresh && input && document.activeElement === input.closest("dialog")) {
      input.focus({ preventScroll: true });
    }
  }, [ready, fresh]);

  const save = async () => {
    if (busy || photoBusy || locating || !ready) {
      return;
    }
    if (!latitude.trim() || !longitude.trim()) {
      if (manualLocation) {
        setCoordinatesExpanded(true);
      }
      setError(t("chooseLocation"));

      return;
    }
    if (manualLocation && !hasValidCoordinates) {
      setCoordinatesExpanded(true);
      setError(t("invalidCoordinates"));

      return;
    }
    const now = new Date().toISOString();
    const parsed = placeSchema.safeParse({
      name,
      description,
      categoryId,
      latitude: Number(latitude.replace(",", ".")),
      longitude: Number(longitude.replace(",", ".")),
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
      await onSave(
        route
          ? {
              ...route,
              value: {
                ...route.value,
                name: parsed.data.name,
                description: parsed.data.description,
                categoryId: parsed.data.categoryId,
                photoId: parsed.data.photoId,
                updatedAt: now,
              },
            }
          : { id, kind: "place", value: parsed.data as Place },
        comparisonBase.current,
        visitedHere,
      );
      onClose();
    } catch (error) {
      setError(t(libraryErrorMessage(error)));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (busy || photoBusy || !ready) {
      return;
    }
    stopCapture.current();
    stopRefinement.current();
    setLocating(false);
    setBusy(true);
    void clearDraft(workspace, id)
      .then(onClose)
      .catch(() => {
        setDiscarding(false);
        setError(t("storageFailure"));
      })
      .finally(() => setBusy(false));
  };

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const discardPlace = async () => {
    if (busy || photoBusy || !ready) {
      return;
    }
    setBusy(true);
    stopCapture.current();
    stopRefinement.current();
    setLocating(false);
    try {
      await onDiscardPlace(id);
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
    if (draftReadError) {
      onClose();

      return;
    }
    if (busy || photoBusy || !ready) {
      return;
    }
    const changed =
      visitedHere ||
      name !== (initial?.name ?? "") ||
      description !== (initial?.description ?? "") ||
      categoryId !== (initial?.categoryId ?? "other") ||
      latitude !== (initial ? String(initial.latitude) : "") ||
      longitude !== (initial ? String(initial.longitude) : "") ||
      photoId !== (initial?.photoId ?? null) ||
      accuracy !== (initial?.accuracy ?? null) ||
      (initial != null && capturedAt !== initial.capturedAt);
    if (changed) {
      setDiscarding(true);
    } else {
      discard();
    }
  };

  return (
    <>
      <Sheet
        title={
          route ? t("routeDetails") : fresh ? t("placeSaved") : initial ? t("edit") : t("manual")
        }
        className="editor-sheet"
        onClose={dismiss}
        closeLabel={t("close")}
      >
        {draftReadError && (
          <div className="notice stack">
            <p role="alert">{t("draftReadFailure")}</p>
            <button
              className="button outline"
              onClick={() => {
                setDraftReadError(false);
                setDraftAttempt((n) => n + 1);
              }}
            >
              <RotateCw size={20} aria-hidden="true" />
              {t("retry")}
            </button>
          </div>
        )}
        {draftWriteError && (
          <p className="error" role="alert">
            {t("draftWriteFailure")}
          </p>
        )}
        {updateReady && (
          <div className="notice stack">
            <strong>{t("updateReady")}</strong>
            <p>{t(hasUnfinishedEdits(latest.current) ? "updateDraftHint" : "updateHint")}</p>
            <button
              type="button"
              className="button outline"
              disabled={busy || locating || photoBusy || !ready}
              onClick={onUpdate}
            >
              <CircleArrowUp size={20} aria-hidden="true" />
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
          inert={busy || !ready}
        >
          <label>
            {t("name")}
            <input
              autoComplete="off"
              disabled={busy || !ready}
              required
              pattern={".*\\S.*"}
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
              ref={nameField}
            />
          </label>
          {descriptionOpen ? (
            <label>
              {t("description")}
              <textarea
                ref={(field) => {
                  if (field && focusDescription.current) {
                    focusDescription.current = false;
                    field.focus();
                  }
                }}
                rows={3}
                maxLength={1000}
                value={description}
                placeholder={t("descriptionHint")}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          ) : (
            <button
              type="button"
              className="description-toggle"
              onClick={() => {
                focusDescription.current = true;
                setDescriptionOpen(true);
              }}
            >
              {t("addDescription")}
            </button>
          )}
          <div className="preferences-options editor-category">
            <label className="preference-row">
              <span>{t("category")}</span>
              <span className="preference-value" aria-hidden="true">
                <CategoryIcon record={selectedCategory} />
                <span>{selectedCategory ? categoryLabel(selectedCategory) : t("other")}</span>
              </span>
              <ChevronDown size={20} aria-hidden="true" />
              <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    <CategoryIcon record={c} />
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className={`editor-location-controls ${!manualLocation && latitude && longitude ? "editor-location" : "stack"}`}
            hidden={!!route || (!initial && manualLocation && coordinatesExpanded)}
          >
            {!manualLocation && latitude && longitude && (
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
                !manualLocation && latitude && longitude
                  ? "icon-button editor-location-update"
                  : "button outline"
              }
              aria-label={
                !manualLocation && latitude && longitude ? t("updateLocation") : undefined
              }
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
              {!manualLocation && latitude && longitude ? (
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
                className="button outline subdued"
                onClick={() => {
                  stopCapture.current();
                  setLocating(false);
                }}
              >
                {t("cancelLocationUpdate")}
              </button>
            </div>
          )}
          {locationUpdated && initial && !fresh && (
            <p role="status" className="small muted editor-location-feedback">
              {t("editorLocationUpdated")}
            </p>
          )}
          {!initial && manualLocation && !locating && !gpsReview && (
            <div className="stack">
              {hasValidCoordinates && (
                <p className="muted small editor-location-feedback" role="status">
                  <MapPin size={15} aria-hidden="true" /> {t("manualLocation")}
                </p>
              )}
              <button
                type="button"
                className="button outline editor-coordinate-toggle"
                aria-expanded={coordinatesExpanded}
                aria-controls={`coordinates-${id}`}
                onClick={() => setCoordinatesExpanded((expanded) => !expanded)}
              >
                <span>{t("enterCoordinates")}</span>
                {coordinatesExpanded ? (
                  <ChevronUp size={20} aria-hidden="true" />
                ) : (
                  <ChevronDown size={20} aria-hidden="true" />
                )}
              </button>
              <div
                id={`coordinates-${id}`}
                className="stack editor-coordinates"
                hidden={!coordinatesExpanded}
              >
                <label>
                  {t("latitude")}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={latitude}
                    onChange={(e) => {
                      setLat(e.target.value);
                      setAccuracy(null);
                      setError("");
                    }}
                  />
                </label>
                <label>
                  {t("longitude")}
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={longitude}
                    onChange={(e) => {
                      setLng(e.target.value);
                      setAccuracy(null);
                      setError("");
                    }}
                  />
                </label>
              </div>
            </div>
          )}
          <PhotoPicker
            workspace={workspace}
            id={photoId}
            t={t}
            onChange={setPhoto}
            onBusy={setPhotoBusy}
            onPosition={
              route
                ? undefined
                : (position) => {
                    stopCapture.current();
                    stopRefinement.current();
                    setLocating(false);
                    setLocationUpdated(false);
                    setVisitedHere(false);
                    setManualLocation(false);
                    setLat(String(position.latitude));
                    setLng(String(position.longitude));
                    setAccuracy(null);
                    setCapturedAt(new Date().toISOString());
                    setError("");
                  }
            }
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
            {!fresh && !busy && <Check size={20} aria-hidden="true" />}
            {t(busy ? "working" : fresh ? "done" : "save")}
          </button>
          {!fresh && (
            <button type="button" className="button outline subdued" onClick={dismiss}>
              {t("cancel")}
            </button>
          )}
          {!fresh && initial && onDelete && (
            <button
              type="button"
              className="button danger editor-delete"
              disabled={busy || photoBusy || !ready}
              onClick={onDelete}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t("delete")}
            </button>
          )}
          {fresh && (
            <button
              type="button"
              className="button danger"
              disabled={busy || photoBusy || !ready}
              onClick={() => setDiscardingPlace(true)}
            >
              <Trash2 size={20} aria-hidden="true" />
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
            if (!busy) {
              setDiscardingPlace(false);
            }
          }}
        >
          <div className="stack">
            <p>
              <strong>{initial?.name}</strong>
            </p>
            <p>{t("deletePlaceBody")}</p>
            <button
              type="button"
              className="button outline subdued"
              data-initial-focus
              disabled={busy}
              onClick={() => setDiscardingPlace(false)}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              className="button danger confirm"
              disabled={busy}
              onClick={() => void discardPlace()}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t(busy ? "working" : "discardPlace")}
            </button>
          </div>
        </Sheet>
      )}
      {discarding && (
        <Sheet
          title={t("discardChanges")}
          onClose={() => {
            if (!busy) {
              setDiscarding(false);
            }
          }}
          closeLabel={t("close")}
        >
          <div className="stack">
            <p>{t("discardChangesHint")}</p>
            <button
              type="button"
              className="button outline subdued"
              data-initial-focus
              disabled={busy}
              onClick={() => setDiscarding(false)}
            >
              {t("keepEditing")}
            </button>
            <button
              type="button"
              className="button danger confirm"
              disabled={busy}
              onClick={discard}
            >
              <Trash2 size={20} aria-hidden="true" />
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
