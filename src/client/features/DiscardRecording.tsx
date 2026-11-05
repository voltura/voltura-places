import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

export function DiscardRecording({
  busy,
  error,
  onDiscard,
  t,
}: {
  busy: boolean;
  error: string;
  onDiscard: () => Promise<void>;
  t: (key: Message) => string;
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const close = () => {
    if (!busy) {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        className="button danger"
        disabled={busy}
        onClick={() => {
          setAttempted(false);
          setOpen(true);
        }}
      >
        <Trash2 size={20} aria-hidden="true" />
        {t("routeDiscard")}
      </button>
      {open && (
        <Sheet title={t("routeDiscardTitle")} closeLabel={t("close")} onClose={close}>
          <div className="stack">
            <p>{t("routeDiscardHint")}</p>
            {attempted && error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button outline subdued"
              data-initial-focus
              disabled={busy}
              onClick={close}
            >
              {t("cancel")}
            </button>
            <button
              className="button danger confirm"
              disabled={busy}
              onClick={() => {
                setAttempted(true);
                void onDiscard();
              }}
            >
              <Trash2 size={20} aria-hidden="true" />
              {t(busy ? "working" : "routeDiscard")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
