import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  closeLabel = "Close",
  wide = false,
  topAligned = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  wide?: boolean;
  topAligned?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>("[data-initial-focus]") ?? dialog).focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`sheet ${wide ? "sheet-wide" : ""} ${topAligned ? "sheet-top" : ""} ${className}`}
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
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="sheet-subtitle muted small">{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label={closeLabel}>
          <X />
        </button>
      </div>
      <div className="sheet-content">{children}</div>
    </dialog>
  );
}
