import { useId, useLayoutEffect, useRef } from "react";
import { ChevronDown, FilePenLine, Route } from "lucide-react";
import type { Message } from "../foundation/i18n";
import { dismissPopup } from "../ui/dismissPopup";
import { useOverlayScrollLock } from "../ui/useOverlayScrollLock";

export function SaveOptions({
  open,
  disabled,
  onOpenChange,
  onDetails,
  onRoute,
  t,
}: {
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onDetails: () => void;
  onRoute: () => void;
  t: (key: Message) => string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlayScrollLock(options, open);
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    options.current?.querySelector("button")?.focus({ preventScroll: true });

    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        dismissPopup(event, () => {
          onOpenChange(false);
          trigger.current?.focus({ preventScroll: true });
        });
      }
    };

    document.addEventListener("pointerdown", outside, true);

    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    trigger.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={root}
      className="save-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = [...options.current!.querySelectorAll("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        ref={trigger}
        className="save-options-trigger"
        aria-label={t("saveOptions")}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={options}
          id={id}
          className="library-options save-options"
          role="group"
          aria-label={t("saveOptions")}
        >
          <button
            className="library-option"
            onClick={() => {
              close();
              onDetails();
            }}
          >
            <FilePenLine size={22} aria-hidden="true" />
            <span>{t("addWithDetails")}</span>
          </button>
          <button
            className="library-option"
            onClick={() => {
              close();
              onRoute();
            }}
          >
            <Route size={22} aria-hidden="true" />
            <span>{t("trackRoute")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
