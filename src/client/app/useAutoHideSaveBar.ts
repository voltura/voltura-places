import { useEffect, useEffectEvent, useRef, useState } from "react";

// Presentation-only state; saved places and capture never depend on visibility.
export function useAutoHideSaveBar(enabled: boolean, blocked: boolean, resetKey: string) {
  const [hidden, setHidden] = useState(false);
  const scroll = useRef({ y: 0, distance: 0, direction: 0 });
  const resetScroll = () => {
    scroll.current = { y: Math.max(0, window.scrollY), distance: 0, direction: 0 };
  };
  const reveal = () => {
    setHidden(false);
    resetScroll();
  };
  const browse = () => {
    const active = document.activeElement;
    if (
      !enabled ||
      blocked ||
      document.querySelector("dialog:modal") ||
      active?.closest(
        ".app-header, .save-dock, input, textarea, select, [contenteditable]:not([contenteditable=false])",
      )
    )
      return;
    setHidden(true);
  };
  useEffect(() => {
    reveal();
  }, [enabled, blocked, resetKey]);
  const isHidden = enabled && !blocked && hidden;
  const onScroll = useEffectEvent(() => {
    const y = Math.max(0, window.scrollY);
    const delta = y - scroll.current.y;
    const direction = Math.sign(delta);
    const distance =
      direction === scroll.current.direction
        ? scroll.current.distance + Math.abs(delta)
        : Math.abs(delta);
    scroll.current = { y, direction, distance };
    if (!delta) return;
    if (direction < 0 && distance >= 24) reveal();
    else if (direction > 0 && distance >= 48) browse();
  });
  useEffect(() => {
    if (!enabled) return;
    resetScroll();
    const listener = () => onScroll();
    window.addEventListener("scroll", listener, { passive: true });
    return () => window.removeEventListener("scroll", listener);
  }, [enabled]);
  return { hidden: isHidden, reveal, browse, rebase: resetScroll };
}
