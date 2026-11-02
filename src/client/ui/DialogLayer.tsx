import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement>(document.body);
  useLayoutEffect(() => {
    // Document z-index cannot cross a modal dialog's native top layer.
    let current: HTMLElement = document.body;

    const relocate = () => {
      const focused = document.activeElement?.closest<HTMLDialogElement>("dialog:modal");
      current =
        focused ??
        Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal")).at(-1) ??
        document.body;
      setHost(current);
    };

    // Adding map tiles, cards or text does not change the native top layer.
    // An opened/closed dialog changes its open attribute. Removing the host
    // directly is the one child-list mutation that requires relocation.
    const observer = new MutationObserver((mutations) => {
      if (
        !current.isConnected ||
        mutations.some((m) => m.type === "attributes" && m.target instanceof HTMLDialogElement)
      ) {
        relocate();
      }
    });
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
