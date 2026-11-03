import { useLayoutEffect, type RefObject } from "react";

const overlays: RefObject<HTMLElement | null>[] = [];
let restore: (() => void) | undefined;

export function useOverlayScrollLock(ref: RefObject<HTMLElement | null>, open = true) {
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    if (!overlays.length) {
      const overflow = document.documentElement.style.overflow;
      const padding = document.documentElement.style.paddingRight;
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      if (gutter > 0) {
        document.documentElement.style.paddingRight = `${parseFloat(getComputedStyle(document.documentElement).paddingRight) + gutter}px`;
      }
      document.documentElement.style.overflow = "hidden";
      let lastY = 0;
      let lastX = 0;
      const supportsOpenSelect = CSS.supports("selector(select:open)");

      const start = (event: TouchEvent) => {
        lastY = event.touches[0]?.clientY ?? 0;
        lastX = event.touches[0]?.clientX ?? 0;
      };

      const block = (event: TouchEvent | WheelEvent) => {
        if (event.ctrlKey) {
          return;
        }
        const container = overlays.at(-1)?.current;
        const target = event.target;
        const delta =
          "deltaY" in event ? event.deltaY : lastY - (event.touches[0]?.clientY ?? lastY);
        const deltaX =
          "deltaX" in event ? event.deltaX : lastX - (event.touches[0]?.clientX ?? lastX);
        if ("touches" in event) {
          if (event.touches.length !== 1) {
            return;
          }
          lastY = event.touches[0]?.clientY ?? lastY;
          lastX = event.touches[0]?.clientX ?? lastX;
        }
        let element = target instanceof Element ? target : null;
        while (container && element && container.contains(element)) {
          const style = getComputedStyle(element);
          // A customizable select scrolls its picker pseudo-element, which is
          // not part of the DOM ancestry inspected below.
          if (
            element instanceof HTMLSelectElement &&
            supportsOpenSelect &&
            element.matches(":open") &&
            style.appearance === "base-select"
          ) {
            return;
          }
          const horizontal = Math.abs(deltaX) > Math.abs(delta);
          const movement = horizontal ? deltaX : delta;
          const position = horizontal ? element.scrollLeft : element.scrollTop;
          const size = horizontal ? element.scrollWidth : element.scrollHeight;
          const viewport = horizontal ? element.clientWidth : element.clientHeight;
          if (
            /auto|scroll/.test(horizontal ? style.overflowX : style.overflowY) &&
            size > viewport &&
            ((movement < 0 && position > 0) || (movement > 0 && position + viewport < size - 1))
          ) {
            return;
          }
          element = element.parentElement;
        }
        if (event.cancelable) {
          event.preventDefault();
        }
      };

      document.addEventListener("touchstart", start, { passive: true });
      document.addEventListener("touchmove", block, { passive: false });
      document.addEventListener("wheel", block, { passive: false });
      restore = () => {
        document.documentElement.style.overflow = overflow;
        document.documentElement.style.paddingRight = padding;
        document.removeEventListener("touchstart", start);
        document.removeEventListener("touchmove", block);
        document.removeEventListener("wheel", block);
      };
    }
    overlays.push(ref);

    return () => {
      overlays.splice(overlays.indexOf(ref), 1);
      if (!overlays.length) {
        restore?.();
        restore = undefined;
      }
    };
  }, [open, ref]);
}
