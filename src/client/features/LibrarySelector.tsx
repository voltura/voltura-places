import { useId, useLayoutEffect, useRef } from "react";
import { Check, ChevronDown, LockKeyhole, Users } from "lucide-react";

export function LibrarySelector({
  value,
  privateValue,
  privateLabel,
  label,
  groups,
  onChange,
  open,
  placement,
  onOpenChange,
}: {
  value: string;
  privateValue: string;
  privateLabel: string;
  label: string;
  groups: { value: string; label: string }[];
  onChange: (value: string) => void;
  open: boolean;
  placement: "selector" | "dock";
  onOpenChange: (open: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const button =
      placement === "dock"
        ? document.querySelector<HTMLButtonElement>("button.save-destination")!
        : trigger.current!;
    if (placement === "selector") {
      button.scrollIntoView({ block: "nearest" });
      const dockHeight = document.querySelector(".save-dock")?.getBoundingClientRect().height ?? 0;
      if (button.getBoundingClientRect().bottom > innerHeight - dockHeight - 160)
        button.scrollIntoView({ block: "start" });
    }
    const sizeMenu = () => {
      const rect = button.getBoundingClientRect();
      if (placement === "dock") {
        root.current?.style.setProperty("--library-dock-bottom", `${innerHeight - rect.top + 6}px`);
        root.current?.style.setProperty("--library-dock-left", `${rect.left}px`);
        root.current?.style.setProperty("--library-dock-width", `${rect.width}px`);
        root.current?.style.setProperty("--library-dock-space", `${Math.max(0, rect.top - 22)}px`);
      }
      root.current?.style.setProperty(
        "--library-menu-top",
        `${button.getBoundingClientRect().bottom}px`,
      );
    };
    sizeMenu();
    options.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !root.current?.contains(event.target) &&
        !event.target.closest("button.save-destination")
      )
        onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        button.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", sizeMenu);
    window.addEventListener("scroll", sizeMenu, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", sizeMenu);
      window.removeEventListener("scroll", sizeMenu);
    };
  }, [open, placement, onOpenChange]);
  const selected = groups.find((group) => group.value === value)?.label ?? privateLabel;
  const Icon = value !== privateValue ? Users : LockKeyhole;
  return (
    <div
      ref={root}
      className="library-selector"
      onBlur={(event) => {
        // Safari clears focus before a tapped button receives its click. A null
        // destination must not unmount that option; outside presses close above.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !(
            event.relatedTarget instanceof Element &&
            event.relatedTarget.closest("button.save-destination")
          )
        )
          onOpenChange(false);
      }}
    >
      <button
        ref={trigger}
        className="library-selector-label"
        aria-label={label}
        aria-description={selected}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open && placement === "selector"}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <Icon size={22} aria-hidden="true" />
        <span>{selected}</span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={options}
          id={menuId}
          className={`library-options${placement === "dock" ? " library-options-up" : ""}`}
          role="group"
          aria-label={label}
          onKeyDown={(event) => {
            const buttons = [...event.currentTarget.querySelectorAll("button")];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            let next: number;
            if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
            else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = buttons.length - 1;
            else return;
            event.preventDefault();
            buttons[next]?.focus();
          }}
        >
          {[{ value: privateValue, label: privateLabel }, ...groups].map((group) => {
            const OptionIcon = group.value === privateValue ? LockKeyhole : Users;
            return (
              <button
                key={group.value}
                className="library-option"
                aria-pressed={group.value === value}
                onClick={() => {
                  onChange(group.value);
                  onOpenChange(false);
                  (placement === "dock"
                    ? document.querySelector<HTMLButtonElement>("button.save-destination")
                    : trigger.current
                  )?.focus({ preventScroll: true });
                }}
              >
                <OptionIcon size={22} aria-hidden="true" />
                <span>{group.label}</span>
                {group.value === value && <Check size={20} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
