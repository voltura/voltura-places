import { DialogLayer } from "./DialogLayer";
import { Check, CircleAlert, X } from "lucide-react";

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
        {error ? <CircleAlert size={20} /> : <Check size={20} />}
        <span>{text}</span>
        <button className="icon-button" aria-label={closeLabel} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
    </DialogLayer>
  );
}
