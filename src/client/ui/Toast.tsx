import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MapPin, X } from "lucide-react";

export function Toast({
  text,
  error,
  closeLabel,
  onClose,
}: {
  text: string;
  error?: boolean;
  closeLabel: string;
  onClose: () => void;
}) {
  const [host, setHost] = useState<HTMLElement>(document.body);
  useLayoutEffect(() => {
    // A modal dialog's top layer cannot be reached with a larger document z-index.
    const relocate = () =>
      setHost(
        Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1) ??
          document.body,
      );
    const observer = new MutationObserver(relocate);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    relocate();
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <div className={`toast ${error ? "error-toast" : ""}`} role={error ? "alert" : "status"}>
      {error ? <MapPin size={18} /> : <Check size={18} />}
      <span>{text}</span>
      <button className="icon-button" aria-label={closeLabel} onClick={onClose}>
        <X size={17} />
      </button>
    </div>,
    host,
  );
}
