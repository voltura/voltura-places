// Keep the following click from reaching the page after the popup unmounts.
export function dismissPopup(event: PointerEvent, close: () => void) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();

  const cleanup = () => {
    document.removeEventListener("click", block, true);
    document.removeEventListener("pointerdown", cleanup, true);
    document.removeEventListener("pointercancel", cleanup, true);
    window.removeEventListener("blur", cleanup);
  };

  const block = (click: MouseEvent) => {
    click.preventDefault();
    click.stopImmediatePropagation();
    cleanup();
  };

  document.addEventListener("click", block, true);
  document.addEventListener("pointerdown", cleanup, true);
  document.addEventListener("pointercancel", cleanup, true);
  window.addEventListener("blur", cleanup);
  close();
}
