import { test, expect } from "@playwright/test";
test("optional accuracy review refines GPS and commits only the confirmed fix", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const watches = new Map<number, ReturnType<typeof setTimeout>[]>();
    let next = 0;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (success: (p: unknown) => void) => {
          const id = ++next;
          watches.set(
            id,
            [80, 25, 6].map((accuracy, i) =>
              setTimeout(
                () =>
                  success({
                    timestamp: Date.now(),
                    coords: { latitude: 0, longitude: 0, accuracy },
                  }),
                100 + i * 400,
              ),
            ),
          );
          return id;
        },
        clearWatch: (id: number) => {
          watches.get(id)?.forEach(clearTimeout);
          watches.delete(id);
          document.documentElement.dataset.gpsStopped = "true";
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("checkbox", {
    name: "Review GPS accuracy before saving",
    exact: false,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page
    .getByRole("combobox", { name: "Distance units", exact: true })
    .selectOption("imperial");
  await page.reload();
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  await expect(review).toBeVisible();
  await expect(review.getByRole("meter")).toHaveAttribute("aria-valuenow", "4");
  await expect(review).toContainText("±20 ft");
  await expect(page.getByRole("heading", { name: "Your places 0" })).toBeAttached();
  await review.getByRole("button", { name: "Use this position", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Saved on this device", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Saved on this device", exact: true }),
  ).toContainText("±20 ft");
  await expect(page.locator("html")).toHaveAttribute("data-gps-stopped", "true");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.getByRole("button", { name: "Add place", exact: true }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Keep my draft");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Keep my draft",
  );
});
test("accuracy review handles denied permission and cancel without saving", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "places-preferences",
      JSON.stringify({ language: "en", theme: "dark", provider: "", reviewGps: true }),
    );
    Object.defineProperty(navigator, "geolocation", {
      value: {
        watchPosition: (_s: unknown, error: (e: unknown) => void) => {
          setTimeout(() => error({ code: 1 }), 20);
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Check your location", exact: true });
  await expect(review.getByRole("alert")).toContainText("Location access was denied");
  await expect(
    review.getByRole("button", { name: "Use this position", exact: true }),
  ).toBeDisabled();
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 0" })).toBeVisible();
});
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 0, longitude: 0, accuracy: 8 });
});
test("camera and library inputs support a durable offline photo and removable draft", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add place", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Photo fixture");
  await expect(page.getByRole("textbox", { name: "Latitude", exact: true })).toHaveCount(0);
  await expect(page.locator('input[capture="environment"]')).toHaveAttribute("accept", "image/*");
  const picker = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  await picker.setInputFiles("tests/fixtures/photo-gps.jpg");
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Use photo location", exact: true }).click();
  await expect(page.getByText("Location selected", { exact: true })).toBeVisible();
  await picker.setInputFiles({
    name: "invalid.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit place: Photo fixture", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Edit place: Photo fixture", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit place", exact: true }).click();
  await expect(page.locator(".photo-picker img")).toBeVisible();
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  await expect(page.locator(".photo-picker img")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Photo removed draft");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const open = indexedDB.open("voltura-places");
            open.onsuccess = () => {
              const db = open.result;
              const read = db.transaction("drafts").objectStore("drafts").get("guest");
              read.onsuccess = () => {
                resolve(
                  read.result?.name === "Photo removed draft" && read.result?.photoId === null,
                );
                db.close();
              };
            };
          }),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Photo removed draft",
  );
  await expect(page.locator(".photo-picker img")).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("GPS denial leaves the library intact and offers recovery", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_success: unknown, error: (e: { code: number }) => void) =>
          error({ code: 1 }),
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Location access was denied");
  await expect(page.getByRole("heading", { name: "Your places 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save here", exact: true })).toBeEnabled();
});
test("an unfinished manual draft reopens after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add place", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Unfinished draft");
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("voltura-places");
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("drafts").objectStore("drafts").get("guest");
          get.onsuccess = () => {
            resolve(get.result?.name === "Unfinished draft");
            db.close();
          };
          get.onerror = () => {
            resolve(false);
            db.close();
          };
        };
        open.onerror = () => resolve(false);
      }),
  );
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Add place" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Unfinished draft",
  );
});
test("GPS quick save commits before naming and survives offline reload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 59.3293, longitude: 18.0686, accuracy: 8 });
  await page.goto("/");
  await page.getByRole("button", { name: "Save here", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Saved on this device" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your places 1" })).toBeVisible();
  await page.getByRole("button", { name: "Add place", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Offline clearing");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your places 2" })).toBeVisible();
});
test("location is required and GPS places search and edit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add place", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Trailhead");
  await expect(page.getByRole("textbox", { name: "Latitude", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a photo location");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("mushrooms");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("textbox", { name: "Search your places" }).fill("missing");
  await expect(page.getByRole("heading", { name: "No matching places" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Edit place: Trailhead" })).toBeVisible();
  await expect(page.getByRole("article")).toContainText("Mushrooms");
});

test("sign-out retains sign-in providers and rejects a late account response", async ({ page }) => {
  const identity = {
    id: "fixture-account",
    methods: [
      { provider: "email", label: "fixture@example.invalid" },
      { provider: "google", label: "fixture@example.invalid" },
    ],
  };
  let signedIn = true;
  let holdNext = false;
  let releaseOld: (() => Promise<void>) | undefined;
  let held: (() => void) | undefined;
  const oldRequested = new Promise<void>((resolve) => {
    held = resolve;
  });
  const state = (account: typeof identity | null) => ({
    enabled: true,
    providers: { google: true, email: true, chatgpt: true },
    account,
  });
  await page.route("**/api/account", async (route) => {
    if (holdNext) {
      holdNext = false;
      releaseOld = () => route.fulfill({ json: state(identity) });
      held!();
      return;
    }
    await route.fulfill({ json: state(signedIn ? identity : null) });
  });
  await page.route("**/api/account/sign-out", async (route) => {
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/sync", (route) =>
    route.fulfill({ json: { version: 1, accountId: identity.id, records: [] } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Use the account library", exact: true }).click();
  await page.getByRole("button", { name: "Account & sync", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
  await expect(
    page.locator(".account-summary").getByText("fixture@example.invalid", { exact: true }),
  ).toHaveCount(1);
  await page.getByText("Sign-in methods", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Link ChatGPT", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with ChatGPT", exact: true }),
  ).toBeHidden();
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await oldRequested;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "G Continue with Google", exact: true }),
  ).toBeEnabled();
  await releaseOld!();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeHidden();
  await expect(page.getByText("Account service is unavailable", { exact: false })).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem("places-account") ?? "null")?.account),
    )
    .toBeNull();
});

test("copy feedback stays above an open map dialog and follows it back to the page", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } }),
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Add place", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Copy example");
  await page.getByRole("button", { name: "Use current location", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open maps", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Open with…", exact: true });
  await dialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  const toast = dialog.getByRole("status");
  await expect(toast).toContainText("Copied");
  expect(
    await toast.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
  await toast.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Copy coordinates", exact: true }).click();
  await dialog.locator(".sheet-head").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("body > .toast")).toContainText("Copied");
  await expect
    .poll(() => page.locator("html").evaluate((element) => getComputedStyle(element).overflow))
    .not.toBe("hidden");
});
