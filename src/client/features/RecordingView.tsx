import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Brand } from "../ui/Brand";

export function RecordingView({ title, children }: { title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();

    return () => element.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="recording-view"
      aria-label={title}
      onCancel={(event) => event.preventDefault()}
    >
      <header className="app-header recording-header">
        <div className="header-inner">
          <Brand />
        </div>
      </header>
      <div className="recording-view-content">
        <h1 tabIndex={-1} autoFocus>
          {title}
        </h1>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
