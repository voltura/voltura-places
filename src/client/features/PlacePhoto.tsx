import { useEffect, useState, useRef } from "react";
import { Camera, ImagePlus, Trash2, Maximize, Minimize } from "lucide-react";
import { createPortal } from "react-dom";
import { loadPhoto, preparePhoto } from "../foundation/photos";
import { watchPhoto } from "../foundation/photo-store";
import type { Message } from "../foundation/i18n";
import { photoPosition, type PhotoPosition } from "../foundation/photo-location";
export function PlacePhoto({
  workspace,
  id,
  t,
}: {
  workspace: string;
  id?: string | null;
  t: (key: Message) => string;
}) {
  const [url, setUrl] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true,
      objectUrl = "";
    setUrl("");
    const changed = () => {
      if (active) setAttempt((value) => value + 1);
    };
    const stopWatching = id ? watchPhoto(workspace, id, changed) : () => {};
    window.addEventListener("online", changed);
    if (id)
      void loadPhoto(workspace, id, () => active)
        .then((blob) => {
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
      stopWatching();
      window.removeEventListener("online", changed);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspace, id, attempt]);
  if (!id) return null;
  return url ? (
    <PhotoView key={`${workspace}:${id}`} url={url} t={t} />
  ) : (
    <p className="muted small">{t("photoUnavailable")}</p>
  );
}
function PhotoView({ url, t }: { url: string; t: (key: Message) => string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <div className="place-photo-frame">
      <img className="place-photo" src={url} alt={t("placePhoto")} />
      <button
        ref={toggle}
        type="button"
        className="icon-button photo-fullscreen-toggle"
        aria-label={t("fullscreenPhoto")}
        aria-haspopup="dialog"
        onClick={() => setFullscreen(true)}
      >
        <Maximize aria-hidden="true" />
      </button>
      {fullscreen && (
        <FullscreenPhoto
          url={url}
          t={t}
          onClose={() => setFullscreen(false)}
          returnFocus={() => toggle.current?.focus({ preventScroll: true })}
        />
      )}
    </div>
  );
}

function FullscreenPhoto({
  url,
  t,
  onClose,
  returnFocus,
}: {
  url: string;
  t: (key: Message) => string;
  onClose: () => void;
  returnFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const surface = dialog.current!;
    const { scrollX, scrollY } = window;
    surface.showModal();
    surface.querySelector("button")?.focus({ preventScroll: true });
    return () => {
      surface.close();
      window.scrollTo(scrollX, scrollY);
      returnFocus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="photo-fullscreen"
      aria-label={t("placePhoto")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <img src={url} alt={t("placePhoto")} />
      <button
        type="button"
        className="icon-button photo-fullscreen-toggle"
        aria-label={t("exitFullscreenPhoto")}
        onClick={onClose}
      >
        <Minimize aria-hidden="true" />
      </button>
    </dialog>,
    document.body,
  );
}
export function PhotoPicker({
  workspace,
  id,
  t,
  onChange,
  onBusy,
  onPosition,
}: {
  workspace: string;
  id?: string | null;
  t: (key: Message) => string;
  onChange: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
  onPosition: (position: PhotoPosition) => void;
}) {
  const camera = useRef<HTMLInputElement>(null),
    library = useRef<HTMLInputElement>(null),
    active = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [position, setPosition] = useState<PhotoPosition | null>(null),
    [missingPosition, setMissingPosition] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const photoId = await preparePhoto(file, workspace, () => active.current);
      const location = await photoPosition(file);
      if (active.current) {
        onChange(photoId);
        setPosition(location);
        setMissingPosition(!location);
      }
    } catch (e) {
      if (active.current)
        setError(
          t(e instanceof Error && e.message === "photoQuota" ? "photoQuota" : "invalidPhoto"),
        );
    } finally {
      if (active.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <fieldset className="photo-picker" aria-label={id ? t("photo") : undefined}>
      {!id && <legend>{t("photo")}</legend>}
      <PlacePhoto {...{ workspace, id, t }} />
      <div className="action-pair">
        <button
          type="button"
          className="button outline"
          disabled={busy}
          onClick={() => camera.current?.click()}
        >
          <Camera size={19} />
          {t("takePhoto")}
        </button>
        <button
          type="button"
          className="button outline"
          disabled={busy}
          onClick={() => library.current?.click()}
        >
          <ImagePlus size={19} />
          {t("choosePhoto")}
        </button>
      </div>
      <input
        hidden
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={library}
        type="file"
        accept="image/*"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {id && (
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={() => {
            onChange(null);
            setPosition(null);
            setMissingPosition(false);
          }}
        >
          <Trash2 size={20} aria-hidden="true" />
          {t("removePhoto")}
        </button>
      )}
      {position && (
        <button
          type="button"
          className="button outline"
          onClick={() => {
            onPosition(position);
            setPosition(null);
          }}
        >
          {t("usePhotoLocation")}
        </button>
      )}
      {missingPosition && <p className="muted small">{t("photoNoLocation")}</p>}
      {busy && (
        <p className="muted small" role="status">
          {t("processingPhoto")}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
