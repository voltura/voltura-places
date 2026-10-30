import { test, expect } from "@playwright/test";

test("editor location update reports progress, cancellation, success and bounded failures", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let next = 0;
    let success!: PositionCallback;
    let failure: PositionErrorCallback | null = null;
    const active = new Set<number>();
    const fix = (accuracy: number) =>
      ({
        timestamp: Date.now(),
        coords: { latitude: 0, longitude: 0, accuracy },
      }) as GeolocationPosition;
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => Object.assign(new EventTarget(), { state: "granted" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (onPosition: PositionCallback, onError: PositionErrorCallback) => {
          const id = ++next;
          active.add(id);
          success = onPosition;
          failure = onError;
          if (id === 1) queueMicrotask(() => onPosition(fix(90)));
          return id;
        },
        clearWatch: (id: number) => active.delete(id),
      },
    });
    Object.assign(window, {
      sendEditorFix: (accuracy: number) => success(fix(accuracy)),
      denyEditorGps: () => failure?.({ code: 1 } as GeolocationPositionError),
      activeEditorWatches: () => active.size,
    });
  });
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const editor = page.getByRole("dialog", { name: /^(Edit place|Place saved)$/, exact: true });
  const update = editor.getByRole("button", { name: "Update location", exact: true });
  const cancel = editor.getByRole("button", { name: "Cancel location update", exact: true });
  const save = editor.getByRole("button", { name: /^(Save changes|Done)$/, exact: true });
  await update.click();
  await expect(update).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(editor.getByText("Finding your location…", { exact: true })).toBeVisible();
  await expect(
    editor.getByText("This can take up to a minute. Allow location access if asked."),
  ).toBeVisible();
  await expect(editor.locator(".editor-location-spinner")).toHaveCSS("animation-name", "gps-spin");
  await page.screenshot({ path: testInfo.outputPath("editor-location-waiting.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(editor.locator(".editor-location-spinner")).toHaveCSS("animation-name", "none");
  await cancel.click();
  await expect(update).toBeEnabled();
  await expect(save).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { activeEditorWatches: () => number }).activeEditorWatches(),
    ),
  ).toBe(0);
  await page.evaluate(() =>
    (window as unknown as { sendEditorFix: (accuracy: number) => void }).sendEditorFix(1),
  );
  await expect(editor.locator(".editor-location [role=status]")).toContainText("±90 m");
  await update.click();
  await page.evaluate(() =>
    (window as unknown as { sendEditorFix: (accuracy: number) => void }).sendEditorFix(25),
  );
  await expect(editor.locator(".editor-location-feedback")).toHaveCount(0);
  await expect(editor.locator(".editor-location [role=status]")).toContainText("±25 m");
  await expect(cancel).toHaveCount(0);
  await update.click();
  await page.clock.fastForward(60001);
  await expect(editor.getByRole("alert")).toContainText("Couldn’t find your location.");
  await expect(update).toBeEnabled();
  await expect(save).toBeEnabled();
  await expect(editor.locator(".editor-location [role=status]")).toContainText("±25 m");
  expect(
    await page.evaluate(() =>
      (window as unknown as { activeEditorWatches: () => number }).activeEditorWatches(),
    ),
  ).toBe(0);
  await update.click();
  await page.evaluate(() => (window as unknown as { denyEditorGps: () => void }).denyEditorGps());
  await expect(editor.getByRole("alert")).toContainText("Location access was denied.");
  await expect(update).toBeEnabled();
  await expect(editor.locator(".editor-location [role=status]")).toContainText("±25 m");
  await save.click();
  await expect(editor).toHaveCount(0);
});
