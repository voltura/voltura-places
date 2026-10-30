import { test, expect } from "@playwright/test";

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
    await page.getByRole("button", { name: "Backup & restore", exact: true }).click();
    const dialog = page.waitForEvent("dialog");
    const click = page
      .getByRole("button", { name: "Keep offline data on this device", exact: true })
      .click();
    const result = await dialog;
    expect(result.message()).toContain(
      mode === "granted" || mode === "already" ? "enabled" : "did not grant",
    );
    await result.dismiss();
    await click;
    expect(await requests()).toBe(mode === "already" || mode === "unsupported" ? 0 : 2);
    if (mode === "granted")
      await page.screenshot({ path: test.info().outputPath("offline-retention.png") });
  });
}
