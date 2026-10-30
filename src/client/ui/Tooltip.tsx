import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const cancelTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const close = () => {
    cancelTimer();
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const element = tip.current!;
    if (!open) {
      element.hidePopover?.();
      return;
    }
    element.showPopover?.();
    const anchor = trigger.current!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(anchor.left + (anchor.width - box.width) / 2, innerWidth - box.width - 8),
    );
    const above = anchor.top - box.height - 8;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(8, Math.min(above >= 8 ? above : anchor.bottom + 8, innerHeight - box.height - 8))}px`;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      element.hidePopover?.();
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);
  return (
    <span
      ref={trigger}
      className="tooltip-trigger"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          cancelTimer();
          timer.current = setTimeout(() => setOpen(true), 350);
        }
      }}
      onPointerLeave={() => {
        cancelTimer();
        if (!trigger.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocusCapture={() => {
        cancelTimer();
        setOpen(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
      onClick={close}
    >
      {cloneElement(children, {
        "aria-describedby":
          [children.props["aria-describedby"], open ? id : ""].filter(Boolean).join(" ") ||
          undefined,
      })}
      <span
        id={id}
        ref={tip}
        className="app-tooltip"
        role="tooltip"
        popover="manual"
        data-open={open}
      >
        {text}
      </span>
    </span>
  );
}
