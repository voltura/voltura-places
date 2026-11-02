import { test, expect } from "./fixtures";

async function openInstall(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Install Places" }).click();
}

for (const outcome of ["accepted", "dismissed", "failed"] as const) {
  test(`native install offer survives closed settings and handles ${outcome}`, async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    // The browser can offer installation before Settings has ever mounted.
    await page.evaluate((outcome) => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => {
          document.documentElement.dataset.installCalls = String(
            Number(document.documentElement.dataset.installCalls || 0) + 1,
          );
          if (outcome === "failed") {
            throw new Error("Browser refused");
          }
          if (outcome === "accepted") {
            window.dispatchEvent(new Event("appinstalled"));
          }
        },
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
      document.documentElement.dataset.offerPrevented = String(event.defaultPrevented);
    }, outcome);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Install Places" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-offer-prevented", "true");
    if (outcome === "accepted") {
      await page
        .getByRole("button", { name: "Install Places", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("native-install.png") });
    }
    await page.getByRole("button", { name: "Install Places", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-install-calls", "1");
    await expect(page.getByRole("button", { name: "Install Places", exact: true })).toHaveCount(0);
    if (outcome === "accepted") {
      await expect(page.locator("summary").filter({ hasText: "Install Places" })).toHaveCount(0);
    } else {
      await expect(
        page.getByText(
          "In Chrome on Android: tap More (⋮) to the right of the address bar → Install and create shortcut → Install. Follow the on-screen instructions.",
        ),
      ).toBeVisible();
      if (outcome === "failed") {
        await expect(page.getByRole("status").filter({ hasText: "could not open" })).toBeVisible();
      }
      // A new browser offer can be used after dismissal or a rejected prompt.
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        Object.assign(event, {
          prompt: async () => {},
          userChoice: Promise.resolve({ outcome: "dismissed" }),
        });
        window.dispatchEvent(event);
      });
      await expect(page.getByRole("button", { name: "Install Places", exact: true })).toBeVisible();
    }
  });
}

for (const ipad of [false, true]) {
  test(`Apple ${ipad ? "desktop-mode iPad" : "iPhone"} gets the illustrated guide`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((ipad) => {
      Object.defineProperty(navigator, "userAgent", {
        get: () =>
          ipad
            ? "Mozilla/5.0 Macintosh Version/26.0 Safari/605.1.15"
            : "Mozilla/5.0 iPhone Version/26.0 Mobile/15E148 Safari/604.1",
      });
      Object.defineProperty(navigator, "platform", { get: () => (ipad ? "MacIntel" : "iPhone") });
      Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    }, ipad);
    await page.setViewportSize({ width: 390, height: 844 });
    await openInstall(page);
    await expect(page.getByText("In Safari:")).toBeVisible();
    const steps = page.locator(".install-steps");
    await expect(steps.locator("li")).toHaveCount(4);
    await expect(steps.locator("li").nth(1)).toHaveText(
      "In the share sheet, tap View More (⌄) if the full list of actions is hidden.",
    );
    await expect(steps.getByText("Scroll down and tap Add to Home Screen.")).toBeVisible();
    await expect(
      page.getByText("Use your browser’s Install app or Add to home screen menu."),
    ).toHaveCount(0);
    await steps.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("apple-install.png") });
    await page
      .getByRole("combobox")
      .filter({ has: page.locator('option[value="sv"]') })
      .selectOption("sv");
    await expect(steps.locator("li").nth(1)).toHaveText(
      "Tryck på Visa mer (⌄) i delningspanelen om hela listan med åtgärder är dold.",
    );
    await expect(steps.getByText("Rulla ned och tryck på Lägg till på hemskärmen.")).toBeVisible();
    await expect(steps.locator("li").last()).toHaveText(
      "Behåll Öppna som webbapp aktiverat om det visas och tryck sedan på Lägg till.",
    );
  });
}

for (const mode of ["standalone", "fullscreen", "apple"] as const) {
  test(`installed ${mode} launch hides installation`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === "apple") {
        Object.defineProperty(navigator, "standalone", { get: () => true });
      } else {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = original(query);
          if (query === `(display-mode: ${mode})`) {
            Object.defineProperty(result, "matches", { value: true });
          }

          return result;
        };
      }
    }, mode);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("summary").filter({ hasText: "Install Places" })).toHaveCount(0);
    await expect(page.locator("summary").filter({ hasText: "Privacy" })).toBeVisible();
  });
}

test("desktop without an install offer keeps browser guidance", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 Windows Firefox" }),
  );
  await openInstall(page);
  await expect(
    page.getByText("For a guided installation, open this page in Chrome on your computer.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Install Places", exact: true })).toHaveCount(0);
});

for (const [browser, marker] of [
  ["Chrome", "CriOS/140.0"],
  ["Firefox", "FxiOS/140.0"],
  ["Edge", "EdgiOS/140.0"],
  ["embedded", ""],
]) {
  test(`iPhone ${browser} gets browser-specific guidance`, async ({ page }, testInfo) => {
    await page.addInitScript((marker) => {
      Object.defineProperty(navigator, "userAgent", {
        get: () =>
          `Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 ${marker} Mobile/15E148 ${marker ? "Safari/604.1" : ""}`,
      });
    }, marker);
    await openInstall(page);
    const steps = page.locator(".install-steps");
    if (browser === "Chrome") {
      await expect(page.getByText("In Chrome:")).toBeVisible();
      await expect(steps.getByText("Tap Share to the right of the address bar.")).toBeVisible();
      await expect(steps.getByText("Check the app name, then tap Add.")).toBeVisible();
      await expect(
        steps.getByText("Keep Open as Web App enabled if shown, then tap Add."),
      ).toHaveCount(0);
      await steps.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("chrome-iphone-install.png") });
      await page
        .getByRole("combobox")
        .filter({ has: page.locator('option[value="sv"]') })
        .selectOption("sv");
      await expect(steps.getByText("Tryck på Dela till höger om adressfältet.")).toBeVisible();
      await expect(steps.getByText("Välj Lägg till på startskärmen.")).toBeVisible();
    } else {
      await expect(
        page.getByText(
          "For a guided installation, open this page in Safari, then follow these steps:",
        ),
      ).toBeVisible();
      await expect(
        steps.getByText(
          "Tap Safari’s menu (three lines) beside the address bar, then Share. If Share is already visible in the toolbar, tap it directly.",
        ),
      ).toBeVisible();
    }
  });
}

for (const [name, userAgent, en, sv] of [
  [
    "Android Chrome",
    "Android Chrome/140.0 Mobile Safari/537.36",
    "In Chrome on Android:",
    "I Chrome på Android:",
  ],
  [
    "Android Samsung",
    "Android Chrome/140.0 SamsungBrowser/28.0 Safari/537.36",
    "open this page in Chrome on Android",
    "öppna den här sidan i Chrome på Android",
  ],
  [
    "Android Edge",
    "Android Chrome/140.0 EdgA/140.0 Safari/537.36",
    "open this page in Chrome on Android",
    "öppna den här sidan i Chrome på Android",
  ],
  [
    "Android embedded",
    "Android; wv) Version/4.0 Chrome/140.0 Safari/537.36",
    "open this page in Chrome on Android",
    "öppna den här sidan i Chrome på Android",
  ],
  [
    "Windows Chrome",
    "Windows NT 10.0 Chrome/140.0 Safari/537.36",
    "In Chrome on your computer:",
    "I Chrome på datorn:",
  ],
  [
    "Windows Edge",
    "Windows NT 10.0 Chrome/140.0 Safari/537.36 Edg/140.0",
    "In Microsoft Edge on your computer:",
    "I Microsoft Edge på datorn:",
  ],
  [
    "Mac Safari",
    "Macintosh Version/26.0 Safari/605.1.15",
    "In Safari on macOS Sonoma 14 or later:",
    "I Safari på macOS Sonoma 14 eller senare:",
  ],
]) {
  test(`${name} manual instructions use the correct browser route in both languages`, async ({
    page,
  }) => {
    await page.addInitScript((userAgent) => {
      Object.defineProperty(navigator, "userAgent", { value: userAgent });
      Object.defineProperty(navigator, "maxTouchPoints", { value: 0 });
    }, userAgent);
    await openInstall(page);
    await expect(page.locator(".install-content")).toContainText(en);
    await page
      .getByRole("combobox")
      .filter({ has: page.locator('option[value="sv"]') })
      .selectOption("sv");
    await expect(page.locator(".install-content")).toContainText(sv);
    await expect(page.locator(".install-steps")).toHaveCount(0);
  });
}
