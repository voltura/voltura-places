import { test, expect } from "./fixtures";

for (const reviewGps of [true, false]) {
  for (const permissionsApi of ["grant-event", "stale", "missing"] as const) {
    test(`first Allow continues without Retry: review=${reviewGps}, permissions=${permissionsApi}`, async ({
      page,
    }) => {
      await page.addInitScript(
        ({ reviewGps, permissionsApi }) => {
          localStorage.setItem("places-preferences", JSON.stringify({ language: "en", reviewGps }));
          const permission = Object.assign(new EventTarget(), { state: "denied" });
          let requests = 0;
          let fail!: PositionErrorCallback;
          Object.defineProperty(navigator, "permissions", {
            value: permissionsApi === "missing" ? undefined : { query: async () => permission },
          });
          Object.defineProperty(navigator, "geolocation", {
            value: {
              watchPosition: (success: PositionCallback, failure: PositionErrorCallback) => {
                requests++;
                fail = failure;
                if (requests > 1) {
                  setTimeout(() => {
                    success({
                      timestamp: Date.now(),
                      coords: { latitude: 0, longitude: 0, accuracy: 7 },
                    } as GeolocationPosition);
                  }, 0);
                }

                return requests;
              },
              clearWatch: () => {},
            },
          });
          Object.assign(window, {
            allowLocation: () => {
              if (permissionsApi === "stale") {
                // Keep the status stale and the native prompt open beyond the old grace period.
                setTimeout(() => fail({ code: 1 } as GeolocationPositionError), 1250);

                return;
              }
              fail({ code: 1 } as GeolocationPositionError);
              // The native callback precedes the page's permission update.
              setTimeout(() => {
                permission.state = "granted";
                permission.dispatchEvent(new Event("change"));
              }, 100);
            },
          });
        },
        { reviewGps, permissionsApi },
      );
      await page.goto("/");
      for (const count of [1, 2]) {
        if (count === 2) {
          await page.reload();
        }
        await page.getByRole("button", { name: "Save position", exact: true }).click();
        await page.evaluate(() =>
          (window as unknown as { allowLocation: () => void }).allowLocation(),
        );
        if (reviewGps) {
          const review = page.getByRole("dialog", { name: "Check your location", exact: true });
          const confirm = review.getByRole("button", { name: "Use this position", exact: true });
          await expect(confirm).toBeEnabled();
          await expect(review.getByRole("button", { name: "Try again", exact: true })).toHaveCount(
            0,
          );
          await expect(
            page.getByRole("heading", {
              name: count === 1 ? "No places saved yet" : "Your places 1",
              exact: true,
            }),
          ).toBeVisible();
          await confirm.click();
        }
        await expect(page.getByRole("dialog", { name: "Place saved", exact: true })).toBeVisible();
        await expect(page.getByRole("alert")).toHaveCount(0);
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Place saved", exact: true })).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: `Your places ${count}`, exact: true }),
        ).toBeVisible();
      }
    });
  }
}
