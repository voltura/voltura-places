import { test, expect } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

const note = "Add Places to your home screen to use it as an app.";
const accountExplanation =
  "Sign in to sync and share places. Without an account, places stay on this device.";
const identities = [
  [
    "Safari iPhone",
    "iPhone Version/26.0 Mobile Safari/605.1.15",
    "iPhone",
    "Tap Share (you may need to open the More menu first).",
  ],
  [
    "Chrome iPhone",
    "iPhone CriOS/140.0 Mobile Safari/605.1.15",
    "iPhone",
    "Tap Share to the right of the address bar.",
  ],
  [
    "Safari iPad",
    "iPad Version/26.0 Mobile Safari/605.1.15",
    "iPad",
    "Tap Share (you may need to open the More menu first).",
  ],
  [
    "Chrome iPad",
    "iPad CriOS/140.0 Mobile Safari/605.1.15",
    "iPad",
    "Tap Share to the right of the address bar.",
  ],
  [
    "desktop-mode iPad",
    "Macintosh Version/26.0 Safari/605.1.15",
    "MacIntel",
    "Tap Share (you may need to open the More menu first).",
  ],
  [
    "Android",
    "Android Chrome/140.0 Mobile Safari/537.36",
    "Linux armv8l",
    "Open your browser’s menu, then choose Install app or Add to home screen and confirm.",
  ],
];

for (const [name, userAgent, platform, step] of identities) {
  test(`first use shares installation help on ${name}`, async ({ page }, testInfo) => {
    await page.addInitScript(
      ({ userAgent, platform }) => {
        Object.defineProperty(navigator, "userAgent", { value: userAgent });
        Object.defineProperty(navigator, "platform", { value: platform });
        Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
      },
      { userAgent, platform },
    );
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Get started", exact: true });
    await expect(dialog.getByText(note)).toBeVisible();
    const steps = dialog.locator(".onboarding-step");
    await expect(steps).toHaveCount(2);
    await expect(dialog.locator(".onboarding-step-number")).toHaveCount(2);
    await expect(dialog.locator(".onboarding-step-number").first()).toBeVisible();
    await expect(dialog.locator(".onboarding-step-number").last()).toBeVisible();
    await expect(
      steps.nth(0).getByRole("heading", { name: "Install Places", exact: true }),
    ).toBeVisible();
    const account = dialog.getByRole("region", { name: "Choose how to continue", exact: true });
    await expect(
      account.getByRole("button", { name: "Sign in or create account", exact: true }),
    ).toBeVisible();
    await expect(account.getByText(accountExplanation, { exact: true })).toBeVisible();
    await expect(account.getByText("or", { exact: true })).toHaveCount(0);
    await expect(account.getByText(/Places works offline/)).toHaveCount(0);
    const installAction = dialog.locator("summary");
    const accountAction = account.getByRole("button", {
      name: "Sign in or create account",
      exact: true,
    });
    expect(await installAction.evaluate((el) => getComputedStyle(el).background)).not.toBe(
      await accountAction.evaluate((el) => getComputedStyle(el).background),
    );
    await expect(
      account.getByRole("button", { name: "Continue without an account", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("details")).not.toHaveAttribute("open");
    if (name === "Safari iPhone")
      await page.screenshot({ path: testInfo.outputPath("first-use-collapsed.png") });
    await dialog.locator("summary").focus();
    await dialog.locator("summary").press("Enter");
    await expect(dialog.getByText(step, { exact: true })).toBeVisible();
    if (name.startsWith("Safari") || name === "desktop-mode iPad") {
      await expect(dialog.getByText("In Safari:", { exact: true })).toBeVisible();
      await expect(dialog.getByText(/open Places in Safari/)).toHaveCount(0);
    }
    if (name === "Safari iPhone")
      await page.screenshot({ path: testInfo.outputPath("first-use-expanded.png") });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continue without an account", exact: true }).click();
    await page.reload();
    await expect(dialog).toHaveCount(0);
  });
}

for (const mode of ["desktop", "standalone", "fullscreen", "apple-standalone"]) {
  test(`first use omits installation help in ${mode}`, async ({ page }, testInfo) => {
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, "userAgent", {
        value: mode === "desktop" ? "Windows Chrome/140.0" : "iPhone Mobile Safari/605.1.15",
      });
      if (mode === "apple-standalone")
        Object.defineProperty(navigator, "standalone", { value: true });
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = original(query);
        if (query === `(display-mode: ${mode})`)
          Object.defineProperty(result, "matches", { value: true });
        return result;
      };
    }, mode);
    await page.goto("/");
    const dialog = page.getByRole("dialog", { name: "Get started", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(note)).toHaveCount(0);
    await expect(dialog.locator("summary")).toHaveCount(0);
    await expect(dialog.locator(".onboarding-step")).toHaveCount(1);
    await expect(dialog.locator(".onboarding-step-number")).toBeHidden();
    await expect(dialog.locator(".onboarding-step-heading")).toBeHidden();
    await expect(dialog.getByText(accountExplanation, { exact: true })).toBeVisible();
    await expect(dialog.getByText("or", { exact: true })).toHaveCount(0);
    await expect(dialog.getByText(/Places works offline/)).toHaveCount(0);
    await expect(dialog.locator(".onboarding-step")).toHaveCSS("border-top-width", "0px");
    await expect(
      dialog.getByRole("button", { name: "Sign in or create account", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Continue without an account", exact: true }),
    ).toBeVisible();
    if (mode === "apple-standalone")
      await page.screenshot({ path: testInfo.outputPath("first-use-installed.png") });
  });
}

for (const outcome of ["accepted", "dismissed", "failed"]) {
  test(`first-use native install handles ${outcome} without dismissing onboarding`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate((outcome) => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => {
          if (outcome === "failed") throw new Error("Refused");
          if (outcome === "accepted") window.dispatchEvent(new Event("appinstalled"));
        },
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
    }, outcome);
    const dialog = page.getByRole("dialog", { name: "Get started", exact: true });
    await dialog.locator("summary").click();
    await dialog.getByRole("button", { name: "Install Places", exact: true }).click();
    await expect(dialog).toBeVisible();
    if (outcome === "accepted") {
      await expect(dialog.getByText(note)).toHaveCount(0);
      await expect(dialog.locator("summary")).toHaveCount(0);
      await expect(dialog.locator(".onboarding-step-number")).toBeHidden();
      await expect(dialog.getByText(accountExplanation, { exact: true })).toBeVisible();
    } else {
      await expect(dialog.getByText(note)).toBeVisible();
      await expect(dialog.getByText(identities[5][3], { exact: true })).toBeVisible();
      if (outcome === "failed")
        await expect(dialog.getByRole("status")).toContainText("could not open");
    }
  });
}

for (const locale of ["en-US", "sv-SE"]) {
  for (const width of [320, 768]) {
    test(`expanded first use remains usable at ${width}px in ${locale} with doubled text`, async ({
      browser,
    }, testInfo) => {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:5174",
        storageState: { cookies: [], origins: [] },
        locale,
        viewport: { width, height: 1024 },
        userAgent: "iPad Version/26.0 Mobile Safari/605.1.15",
      });
      const page = await context.newPage();
      try {
        await page.goto("/");
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "32px";
        });
        const dialog = page.getByRole("dialog");
        await dialog.locator("summary").click();
        await expect(dialog.locator(".install-steps li")).toHaveCount(3);
        expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await dialog.locator(".install-steps li").last().scrollIntoViewIfNeeded();
        await expect(dialog.locator(".install-steps li").last()).toBeInViewport();
        await dialog
          .getByRole("button", {
            name: locale === "sv-SE" ? "Logga in eller skapa konto" : "Sign in or create account",
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        const guest = dialog.getByRole("button", {
          name: locale === "sv-SE" ? "Fortsätt utan konto" : "Continue without an account",
          exact: true,
        });
        await guest.scrollIntoViewIfNeeded();
        await expect(guest).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath("expanded-first-use.png") });
        await guest.click();
        await expect(dialog).toHaveCount(0);
      } finally {
        await context.close();
      }
    });
  }
}
