import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useOverlayScrollLock } from "./useOverlayScrollLock";
import { X } from "lucide-react";

function outside(element: HTMLElement, x: number, y: number) {
  const rect = element.getBoundingClientRect();

  return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
}

export function Sheet({
  title,
  subtitle,
  headerActions,
  footer,
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
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  wide?: boolean;
  topAligned?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useOverlayScrollLock(ref);
  const backdropPress = useRef(false);
  const hasFooter = footer != null;
  useLayoutEffect(() => {
    if (!hasFooter) {
      return;
    }
    const dialog = ref.current!;
    const viewport = window.visualViewport;

    const measure = () => {
      // Keep the action above a software keyboard without interfering with pinch zoom.
      const unzoomed = !viewport || viewport.scale === 1;
      const height = unzoomed ? (viewport?.height ?? window.innerHeight) : window.innerHeight;
      const top = unzoomed ? (viewport?.offsetTop ?? 0) : 0;
      dialog.style.setProperty("--sheet-viewport-height", `${height}px`);
      dialog.style.setProperty("--sheet-viewport-top", `${top}px`);
      dialog.style.setProperty(
        "--sheet-viewport-bottom",
        `${Math.max(0, window.innerHeight - top - height)}px`,
      );
    };

    measure();
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);

    return () => {
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [hasFooter]);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    (dialog.querySelector<HTMLElement>("[data-initial-focus]") ?? dialog).focus({
      preventScroll: true,
    });

    // WebKit can retain the scroll layer's old touch regions after rotation.
    // Rebuild that layer once the viewport width settles, keeping the same
    // form nodes, focus and scroll position (including in nested sheets).
    const content = dialog.querySelector<HTMLElement>(".sheet-content")!;
    let width = window.innerWidth;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const top = content.scrollTop;
        const overflow = content.style.overflow;
        content.style.overflow = "clip";
        content.getBoundingClientRect();
        content.style.overflow = overflow;
        content.scrollTop = top;
      }, 150);
    };

    const resize = () => {
      if (window.innerWidth === width) {
        return;
      }
      width = window.innerWidth;
      backdropPress.current = false;
      refresh();
    };

    // Details may be newly mounted after crossing the phone breakpoint.
    refresh();
    window.addEventListener("resize", resize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", resize);
      dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`sheet ${wide ? "sheet-wide" : ""} ${topAligned ? "sheet-top" : ""} ${hasFooter ? "sheet-with-footer" : ""} ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
      {hasFooter && <div className="sheet-footer">{footer}</div>}
    </dialog>
  );
}
