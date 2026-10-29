import { useEffect, useState, useRef } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { loadPhoto, preparePhoto } from "../foundation/photos";
import type { Message } from "../foundation/i18n";
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
  useEffect(() => {
    let active = true,
      objectUrl = "";
    setUrl("");
    if (id)
      void loadPhoto(workspace, id)
        .then((blob) => {
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspace, id]);
  if (!id) return null;
  return url ? (
    <img className="place-photo" src={url} alt={t("placePhoto")} />
  ) : (
    <p className="muted small">{t("photoUnavailable")}</p>
  );
}
export function PhotoPicker({
  workspace,
  id,
  t,
  onChange,
  onBusy,
}: {
  workspace: string;
  id?: string | null;
  t: (key: Message) => string;
  onChange: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const camera = useRef<HTMLInputElement>(null),
    library = useRef<HTMLInputElement>(null),
    active = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
      const photoId = await preparePhoto(file, workspace);
      if (active.current) onChange(photoId);
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
    <fieldset className="photo-picker">
      <legend>{t("placePhoto")}</legend>
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
          className="button quiet"
          disabled={busy}
          onClick={() => onChange(null)}
        >
          <Trash2 size={17} />
          {t("removePhoto")}
        </button>
      )}
      <p className="muted small">{t(busy ? "processingPhoto" : "photoHint")}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
