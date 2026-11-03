import { useEffect, useEffectEvent, useRef, useState } from "react";

const scrollPosition = () => {
  const end = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  return { y: Math.min(end, Math.max(0, window.scrollY)), end };
};

// Presentation-only state; saved places and capture never depend on visibility.
export function useAutoHideSaveBar(enabled: boolean, blocked: boolean, resetKey: string) {
  const [hidden, setHidden] = useState(false);
  const scroll = useRef({ y: 0, end: 0, distance: 0, direction: 0 });

  const resetScroll = () => {
    scroll.current = { ...scrollPosition(), distance: 0, direction: 0 };
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
    ) {
      return;
    }
    setHidden(true);
  };

  useEffect(() => {
    reveal();
  }, [enabled, blocked, resetKey]);
  const isHidden = enabled && !blocked && hidden;
  const onScroll = useEffectEvent(() => {
    const { y, end } = scrollPosition();
    // Safari's elastic overscroll can exceed either edge. Returning from that
    // bounce, or clamping after the dock/viewport resizes, is not browsing up.
    const previousY = Math.min(end, scroll.current.y);
    const delta = y - previousY;
    if (end !== scroll.current.end) {
      scroll.current = { y: previousY, end, distance: 0, direction: 0 };
    }
    if (!delta) {
      return;
    }
    const direction = Math.sign(delta);
    const distance =
      direction === scroll.current.direction
        ? scroll.current.distance + Math.abs(delta)
        : Math.abs(delta);
    scroll.current = { y, end, direction, distance };
    if (direction < 0 && distance >= 24) {
      reveal();
    } else if (direction > 0 && distance >= 48) {
      browse();
    }
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    resetScroll();

    const listener = () => onScroll();

    window.addEventListener("scroll", listener, { passive: true });

    return () => window.removeEventListener("scroll", listener);
  }, [enabled]);

  return { hidden: isHidden, reveal, browse, rebase: resetScroll };
}
