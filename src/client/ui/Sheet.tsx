import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

function outside(element: HTMLElement, x: number, y: number) {
  const rect = element.getBoundingClientRect();

  return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
}

export function Sheet({
  title,
  subtitle,
  headerActions,
  onClose,
  children,
  closeLabel = "Close",
  wide = false,
  topAligned = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  wide?: boolean;
  topAligned?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  useLayoutEffect(() => {
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
      onPointerDownCapture={(e) => {
        backdropPress.current =
          e.target === e.currentTarget && outside(e.currentTarget, e.clientX, e.clientY);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(e) => {
        if (!backdropPress.current || e.target !== ref.current) {
          return;
        }
        backdropPress.current = false;
        if (outside(e.currentTarget, e.clientX, e.clientY)) {
          onClose();
        }
      }}
    >
      <div className="sheet-head">
        <div className={headerActions ? "sheet-heading-actions" : undefined}>
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="sheet-subtitle muted small">{subtitle}</p>}
          </div>
          {headerActions}
        </div>
        <button className="icon-button" onClick={onClose} aria-label={closeLabel}>
          <X />
        </button>
      </div>
      <div className="sheet-content">{children}</div>
    </dialog>
  );
}
