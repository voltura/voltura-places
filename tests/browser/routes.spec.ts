import { chooseSaveOption } from "./fixtures";
import { test, expect, type Page } from "./fixtures";
import { canonicalGeometry } from "../../src/shared/routes";

test.use({ serviceWorkers: "block" });

test("anonymous route preview consumes its token and saves offline", async ({ page, context }) => {
  const geometry = await canonicalGeometry({
    version: 1,
    segments: [
      [
        [59.33, 18.06, 1000, 5],
        [59.331, 18.061, 2000, 5],
      ],
    ],
  });
  const date = "2026-11-03T00:00:00.000Z";
  const snapshot = {
    version: 1,
    category: { name: "Trail", color: "green" },
    geometry: geometry.geometry,
    route: {
      name: "Shared trail",
      categoryId: "other",
      capturedAt: date,
      updatedAt: date,
      startedAt: date,
      stoppedAt: date,
      duration: 0,
      geometryId: geometry.id,
      ...geometry.summary,
    },
  };
  await page.addInitScript(() => {
    localStorage.setItem("places-account-choice", "done");
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", mapBackground: "naturkartan" }),
    );
  });
  let bearer = false;
  await page.route("**/api/v1/route-share", async (route) => {
    bearer = route.request().headers()["x-places-route-token"] === "a".repeat(64);
    await route.fulfill({ json: snapshot });
  });
  await page.goto(`/#route=${"a".repeat(64)}`);
  const incoming = page.getByRole("dialog", { name: "Shared route", exact: true });
  await expect(incoming).toBeVisible();
  expect(bearer).toBe(true);
  expect(new URL(page.url()).hash).toBe("");
  await expect(incoming.locator(".route-line")).toBeVisible();
  await expect(
    incoming.locator('img.leaflet-tile[src*="naturkartan-cdn.se"]').first(),
  ).toBeVisible();
  await expect(incoming.locator(".leaflet-control-attribution")).toBeEmpty();
  await context.setOffline(true);
  await page.getByLabel("Save route to", { exact: true }).selectOption("guest");
  await expect(incoming).toHaveCount(0);
  await expect(page.getByText("Shared trail", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".route-marker")).toHaveCount(1);
  await expect(page.locator(".route-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Route start: Shared trail", exact: true }).click();
  await expect(page.locator(".route-line").first()).toBeVisible();
  const details = page.getByRole("dialog", { name: "Route details", exact: true });
  await expect(details.locator(".details-map-preview .route-line")).toBeVisible();
  await details.getByRole("button", { name: "Expand map", exact: true }).click();
  await expect(details).toHaveCount(0);
  await expect(page.locator(".map-surface .route-line")).toBeVisible();
  await page.locator(".map-surface .map-fullscreen-toggle").click();
  await expect(page.locator(".map-surface.is-fullscreen .route-line")).toBeVisible();
});

async function fix(page: Page, latitude: number, accuracy = 5) {
  await page.evaluate(
    ({ latitude, accuracy }) => {
      (window as unknown as { routeFix: PositionCallback }).routeFix({
        timestamp: Date.now(),
        coords: { latitude, longitude: 18.06 + latitude - 59.33, accuracy },
      } as GeolocationPosition);
    },
    { latitude, accuracy },
  );
}

test("terrain preference persists and failed terrain tiles fall back", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("places-account-choice", "done");
    if (!localStorage.getItem("places-preferences")) {
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language: "en", provider: "google" }),
      );
    }
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: PositionCallback) => {
          Object.assign(window, { routeFix: success });

          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Map background", { exact: true })).toHaveValue("osm");
  await page.getByLabel("Map background", { exact: true }).selectOption("naturkartan");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Map background", { exact: true })).toHaveValue("naturkartan");
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("places-preferences")!).provider),
  ).toBe("google");
  await page
    .getByRole("dialog", { name: "Settings", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  let terrainRequests = 0;
  await page.route("https://new-maptiles.naturkartan-cdn.se/**", (route) => {
    terrainRequests++;

    return route.abort();
  });
  await chooseSaveOption(page, "route");
  await expect(page.locator(".recording-view")).toBeVisible();
  await fix(page, 59.33);
  await expect(
    page.locator(".recording-view").getByRole("link", { name: "OpenStreetMap", exact: true }),
  ).toBeVisible();
  expect(terrainRequests).toBeGreaterThan(0);
  await expect(page.locator(".recording-view .route-marker")).toHaveCount(1);
});

for (const language of ["en", "sv"]) {
  test(`recording retries are contextual and discard confirms without losing recovery: ${language}`, async ({
    page,
  }) => {
    const sv = language === "sv";
    await page.addInitScript((language) => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language, recordingInterval: 5 }),
      );
      Object.defineProperty(navigator, "geolocation", {
        value: {
          watchPosition: (success: PositionCallback, error: PositionErrorCallback) => {
            Object.assign(window, { routeFix: success, routeError: error });

            return 1;
          },
          clearWatch: () => {},
        },
      });
    }, language);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.clock.install();
    const emptyShortcut = page.getByRole("button", {
      name: sv ? "Spela in rutt" : "Track route",
      exact: true,
    });
    await expect(emptyShortcut).toBeVisible();
    await emptyShortcut.click();
    const recording = page.locator(".recording-view");
    const retry = recording.getByRole("button", {
      name: sv ? "Försök igen" : "Retry",
      exact: true,
    });
    const stop = recording.getByRole("button", { name: sv ? "Stoppa" : "Stop", exact: true });
    await expect(stop).toBeVisible();
    await expect(retry).toHaveCount(0);
    const stopTop = (await stop.boundingBox())!.y;
    await page.evaluate(() =>
      (window as unknown as { routeError: PositionErrorCallback }).routeError({
        code: 1,
      } as GeolocationPositionError),
    );
    await expect(retry).toBeVisible();
    expect((await stop.boundingBox())!.y).toBe(stopTop);
    await retry.click();
    await fix(page, 59.33);
    await expect(retry).toHaveCount(0);
    await page.clock.fastForward(5100);
    await fix(page, 59.331);
    await stop.click();
    const editor = page.getByRole("dialog", {
      name: sv ? "Ruttinformation" : "Route details",
      exact: true,
    });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: sv ? "Stäng" : "Close", exact: true }).click();
    await expect(recording).toContainText(
      sv ? "Inspelningen finns kvar på enheten." : "Recording kept on this device.",
    );
    const discard = recording.getByRole("button", {
      name: sv ? "Kasta inspelning" : "Discard recording",
      exact: true,
    });
    await discard.click();
    const confirmation = page.getByRole("dialog", {
      name: sv ? "Kasta den här inspelningen?" : "Discard this recording?",
      exact: true,
    });
    await expect(
      confirmation.getByRole("button", { name: sv ? "Avbryt" : "Cancel", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await page.reload();
    await expect(recording.locator(".route-point-count")).toContainText("2");
    await discard.click();
    await confirmation.getByRole("button", { name: sv ? "Avbryt" : "Cancel", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await page.evaluate(() => {
      const held = new Promise<void>((resolve) =>
        Object.assign(window, { releaseRecordingLock: resolve }),
      );
      void navigator.locks.request("places-route-recording", () => held);
    });
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.locks.query()).held?.some(
            (lock) => lock.name === "places-route-recording",
          ),
        ),
      )
      .toBe(true);
    await discard.click();
    const confirm = confirmation.getByRole("button", {
      name: sv ? "Kasta inspelning" : "Discard recording",
      exact: true,
    });
    await confirm.click();
    await expect(confirmation.getByRole("alert")).toContainText(sv ? "annan flik" : "another tab");
    await expect(recording.locator(".route-point-count")).toContainText("2");
    await page.evaluate(() =>
      (window as unknown as { releaseRecordingLock: () => void }).releaseRecordingLock(),
    );
    await confirm.click();
    await expect(recording).toHaveCount(0);
    await page.reload();
    await expect(recording).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: sv ? "Spara position" : "Save position", exact: true }),
    ).toBeEnabled();
  });

  test(`live recording stays focused, stable and updates fullscreen: ${language}`, async ({
    page,
    browserName,
  }) => {
    await page.addInitScript((language) => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language, recordingInterval: 5 }),
      );
      Object.defineProperty(navigator, "geolocation", {
        value: {
          watchPosition: (success: PositionCallback) => {
            Object.assign(window, { routeFix: success });

            return 1;
          },
          clearWatch: () => {},
        },
      });
    }, language);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.clock.install();
    const sv = language === "sv";
    await chooseSaveOption(page, "route");
    const recording = page.locator(".recording-view");
    await expect(recording).toBeVisible();
    await expect(
      recording.getByText(sv ? "Inga positioner inspelade än." : "No positions recorded yet.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await recording.evaluate((element) => element.matches(":modal"))).toBe(true);
    await page
      .getByRole("button", { name: sv ? "Inställningar" : "Settings", exact: true })
      .evaluate((button) => button.focus());
    expect(await recording.evaluate((element) => element.contains(document.activeElement))).toBe(
      true,
    );
    const stop = recording.getByRole("button", { name: sv ? "Stoppa" : "Stop", exact: true });
    const before = await stop.boundingBox();
    await fix(page, 59.33, 187);
    await expect(recording.getByRole("status")).toContainText("187");
    expect((await stop.boundingBox())?.y).toBe(before?.y);
    await fix(page, 59.33);
    await expect(
      recording.getByText(sv ? "Start sparad · 1 punkt" : "Start recorded · 1 point", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(recording.locator(".route-endpoint")).toHaveCount(1);
    expect((await stop.boundingBox())?.y).toBe(before?.y);
    await recording.locator(".map-fullscreen-toggle").click();
    await expect(page.locator(".map-surface.is-fullscreen")).toBeVisible();
    await page.clock.fastForward(5100);
    await fix(page, 59.331);
    await expect(page.locator(".recording-preview .route-line")).toBeVisible();
    await expect(page.locator(".recording-preview .route-current")).toHaveCount(1);
    await page.locator(".map-surface.is-fullscreen .map-fullscreen-toggle").click();
    await expect(stop).toBeVisible();
    await expect(recording.locator(".route-point-count")).toContainText("2");
    await page.reload();
    await expect(stop).toBeVisible();
    await expect(recording.locator(".route-point-count")).toContainText("2");
    await stop.click();
    await expect(
      page.getByRole("dialog", { name: sv ? "Ruttinformation" : "Route details", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: sv ? "Stäng" : "Close", exact: true }).click();
    await page.reload();
    await expect(
      recording.getByRole("button", {
        name: sv ? "Fortsätt spela in" : "Resume recording",
        exact: true,
      }),
    ).toBeVisible();
    await recording
      .getByRole("button", { name: sv ? "Spara rutt" : "Save route", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: sv ? "Namn" : "Name", exact: true })
      .fill(sv ? "Testpromenad" : "Test walk");
    await expect(
      page.getByRole("combobox", { name: sv ? "Kategori" : "Category", exact: true }),
    ).toHaveValue("route");
    if (browserName === "chromium") {
      const photo = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 100;

        return canvas.toDataURL("image/png").split(",")[1];
      });
      await page
        .locator('input[type="file"][accept="image/*"]')
        .last()
        .setInputFiles({
          name: "route-photo.png",
          mimeType: "image/png",
          buffer: Buffer.from(photo, "base64"),
        });
      await expect(
        page.getByRole("button", { name: sv ? "Ta bort foto" : "Remove photo", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByText(
          sv ? /^Bilden saknar läsbar platsinformation/ : /^This photo has no readable location/,
        ),
      ).toHaveCount(0);
    }
    await page.getByRole("button", { name: sv ? "Spara" : "Save", exact: true }).click();
    await expect(recording).toHaveCount(0);
    await expect(page.getByText(sv ? "Testpromenad" : "Test walk", { exact: true })).toBeVisible();
  });
}
