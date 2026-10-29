import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Sheet({
  title,
  onClose,
  children,
  closeLabel = "Close",
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${wide ? "sheet-wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={closeLabel}>
          <X />
        </button>
      </div>
      <div className="sheet-content">{children}</div>
    </dialog>
  );
}
