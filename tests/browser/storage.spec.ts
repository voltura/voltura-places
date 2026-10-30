import { test, expect } from "./fixtures";

for (const mode of ["granted", "already", "denied", "unsupported", "error"] as const) {
  test(`offline retention requests permission automatically and tolerates ${mode}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      let requests = 0;
      const storage = {
        persisted: async () => mode === "already",
        persist: async () => {
          requests++;
          if (mode === "error") throw new Error("unavailable");
          return mode === "granted";
        },
      };
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: mode === "unsupported" ? undefined : storage,
      });
      Object.defineProperty(window, "retentionRequests", { get: () => requests });
    }, mode);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Save position", exact: true })).toBeEnabled();
    const requests = () =>
      page.evaluate(() => (window as unknown as { retentionRequests: number }).retentionRequests);
    await expect.poll(requests).toBe(mode === "already" || mode === "unsupported" ? 0 : 1);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("backup");
    await page.getByRole("button", { name: "Keep data on this device", exact: true }).click();
    await expect(page.locator(".offline-storage [role='status']")).toContainText(
      mode === "granted" || mode === "already" ? "enabled" : "did not grant",
    );
    expect(await requests()).toBe(mode === "already" || mode === "unsupported" ? 0 : 2);
    if (mode === "granted")
      await page.screenshot({ path: test.info().outputPath("offline-retention.png") });
  });
}
