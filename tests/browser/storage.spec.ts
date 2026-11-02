import { test, expect } from "./fixtures";

for (const mode of ["granted", "already", "manual", "denied", "unsupported", "error"] as const) {
  test(`offline retention requests permission automatically and tolerates ${mode}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      let requests = 0;
      let protectedStorage = mode === "already";
      const storage = {
        persisted: async () => protectedStorage,
        persist: async () => {
          requests++;
          if (mode === "error") {
            throw new Error("unavailable");
          }

          protectedStorage = mode === "granted" || (mode === "manual" && requests > 1);

          return protectedStorage;
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
    const protect = page.getByRole("button", { name: "Protect local data", exact: true });
    if (mode === "granted" || mode === "already") {
      await expect(page.locator(".offline-storage [role='status']")).toHaveText(
        "Protection enabled",
      );
      await expect(protect).toHaveCount(0);
    } else if (mode === "manual") {
      await protect.click();
      await expect(page.locator(".offline-storage [role='status']")).toHaveText(
        "Protection enabled",
      );
      await expect(protect).toHaveCount(0);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("combobox", { name: "Settings", exact: true }).selectOption("backup");
      await expect(page.locator(".offline-storage [role='status']")).toHaveText(
        "Protection enabled",
      );
      await expect(protect).toHaveCount(0);
    } else {
      await protect.click();
      await expect(page.locator(".offline-storage [role='status']")).toContainText(
        "did not enable",
      );
      await expect(protect).toBeEnabled();
    }
    expect(await requests()).toBe(
      mode === "already" || mode === "unsupported" ? 0 : mode === "granted" ? 1 : 2,
    );
    if (mode === "granted") {
      await page.screenshot({ path: test.info().outputPath("offline-retention.png") });
    }
  });
}
