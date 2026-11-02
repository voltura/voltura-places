import { test, expect } from "./fixtures";

test("a delayed first worker installation does not offer a replacement update", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Reproduce Workbox's external-install heuristic after a slow first install.
    const now = performance.now.bind(performance);
    let offset = 0;
    Object.defineProperty(performance, "now", { value: () => now() + offset });
    const original = ServiceWorkerRegistration.prototype.addEventListener;
    ServiceWorkerRegistration.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (!listener) {
        return;
      }
      if (type !== "updatefound") {
        return original.call(this, type, listener, options);
      }

      return original.call(
        this,
        type,
        (event) => {
          offset = 120000;
          Object.assign(window, { delayedInstallObserved: true });
          if (typeof listener === "function") {
            listener.call(this, event);
          } else {
            listener.handleEvent(event);
          }
        },
        options,
      );
    };
  });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => (window as any).delayedInstallObserved)).toBe(true);
  await expect(page.getByRole("dialog", { name: "An update is ready", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
});
