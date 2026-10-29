import { DialogLayer } from "./DialogLayer";
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
  return (
    <DialogLayer>
      <div className={`toast ${error ? "error-toast" : ""}`} role={error ? "alert" : "status"}>
        {error ? <MapPin size={18} /> : <Check size={18} />}
        <span>{text}</span>
        <button className="icon-button" aria-label={closeLabel} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
    </DialogLayer>
  );
}
