import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement>(document.body);
  useLayoutEffect(() => {
    // Document z-index cannot cross a modal dialog's native top layer.
    const relocate = () =>
      setHost(
        Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1) ??
          document.body,
      );
    const observer = new MutationObserver(relocate);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    relocate();
    return () => observer.disconnect();
  }, []);
  return createPortal(children, host);
}
