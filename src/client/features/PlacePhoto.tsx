import { useEffect, useState, useRef } from "react";
import { Camera, ImagePlus, Trash2, Maximize, Minimize, MapPin } from "lucide-react";
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
  return id ? (
    <StoredPhotoView key={JSON.stringify([workspace, id])} workspace={workspace} id={id} t={t} />
  ) : null;
}

function StoredPhotoView({
  workspace,
  id,
  t,
}: {
  workspace: string;
  id: string;
  t: (key: Message) => string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    let loading = false;
    let retryRequested = false;

    const load = async () => {
      if (!active || objectUrl) {
        return;
      }
      if (loading) {
        retryRequested = true;

        return;
      }
      loading = true;
      try {
        const blob = await loadPhoto(workspace, id, () => active);
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch {
        if (active) {
          setUrl("");
        }
      } finally {
        loading = false;
        if (retryRequested) {
          retryRequested = false;
          void load();
        }
      }
    };

    const stopWatching = watchPhoto(workspace, id, load);
    window.addEventListener("online", load);
    void load();

    return () => {
      active = false;
      stopWatching();
      window.removeEventListener("online", load);
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [workspace, id]);

  return url ? (
    <PhotoView url={url} t={t} />
  ) : (
    <p className="muted small">{t(url === null ? "working" : "photoUnavailable")}</p>
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
  const originScroll = useRef({ x: 0, y: 0 });

  const dismiss = () => {
    dialog.current?.close();
    window.scrollTo(originScroll.current.x, originScroll.current.y);
    returnFocus();
    onClose();
  };

  useEffect(() => {
    const surface = dialog.current!;
    originScroll.current = { x: window.scrollX, y: window.scrollY };
    surface.showModal();
    surface.querySelector("button")?.focus({ preventScroll: true });

    return () => surface.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="photo-fullscreen"
      aria-label={t("placePhoto")}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
    >
      <img src={url} alt={t("placePhoto")} />
      <button
        type="button"
        className="icon-button photo-fullscreen-toggle"
        aria-label={t("exitFullscreenPhoto")}
        onClick={dismiss}
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
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const selection = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<PhotoPosition | null>(null);
  const [missingPosition, setMissingPosition] = useState(false);
  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
      selection.current++;
    };
  }, []);

  const choose = async (file?: File) => {
    if (!file) {
      return;
    }
    const attempt = ++selection.current;

    const isCurrent = () => active.current && selection.current === attempt;

    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const photoId = await preparePhoto(file, workspace, isCurrent);
      if (!isCurrent()) {
        return;
      }
      const location = await photoPosition(file, isCurrent);
      if (isCurrent()) {
        onChange(photoId);
        setPosition(location);
        setMissingPosition(!location);
      }
    } catch (e) {
      if (isCurrent()) {
        setError(
          t(e instanceof Error && e.message === "photoQuota" ? "photoQuota" : "invalidPhoto"),
        );
      }
    } finally {
      if (isCurrent()) {
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
          disabled={busy}
          onClick={() => {
            onPosition(position);
            setPosition(null);
          }}
        >
          <MapPin size={20} aria-hidden="true" />
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
