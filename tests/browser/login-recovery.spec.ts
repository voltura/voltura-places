import { test, expect, chromium, webkit } from "./fixtures";

test.use({ serviceWorkers: "block" });

for (const engine of [chromium, webkit]) {
  test(`${engine.name()} same-origin browser logout revokes the session and permits signing in again`, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:5174",
        serviceWorkers: "block",
      });
      await context.addInitScript(() => localStorage.setItem("places-account-choice", "done"));
      const page = await context.newPage();
      const origin = "http://127.0.0.1:5174";
      const subject = `logout-test-${crypto.randomUUID()}`;

      const connect = () =>
        context.request.post("/api/account/connect", {
          headers: { Origin: origin, "oai-authenticated-user-id": subject },
          data: { provider: "chatgpt" },
        });

      expect((await connect()).ok()).toBe(true);
      if (engine === webkit) {
        // Reproduce the shipped policy: WebKit sends a null Origin and is rejected.
        await page.route(origin + "/", async (route) => {
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: { ...response.headers(), "referrer-policy": "no-referrer" },
          });
        });
        await page.goto("/");
        const rejected = page.waitForRequest("**/api/account/sign-out");
        expect(
          await page.evaluate(
            async () =>
              (
                await fetch("/api/account/sign-out", {
                  method: "POST",
                  mode: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                })
              ).status,
          ),
        ).toBe(403);
        expect((await (await rejected).allHeaders()).origin).toBe("null");
        await page.unroute(origin + "/");
      }
      await page.goto("/");
      await page.getByRole("button", { name: "Account & sync", exact: true }).click();
      const request = page.waitForRequest("**/api/account/sign-out");
      const response = page.waitForResponse("**/api/account/sign-out");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      expect((await response).status()).toBe(200);
      expect((await (await request).allHeaders()).origin).toBe(origin);
      await expect(page.getByText("Not signed in", { exact: true })).toBeVisible();
      expect((await (await context.request.get("/api/account")).json()).account).toBeNull();
      expect((await connect()).ok()).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Account & sync", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page.getByText("Not signed in", { exact: true })).toBeVisible();
    } finally {
      await browser.close();
    }
  });
}

test("a saved failed logout keeps login available and finishes before a new email request", async ({
  page,
}) => {
  const config = { enabled: true, providers: { google: true, email: true } };
  let unavailable = true;
  let sent = 0;
  await page.addInitScript(() => localStorage.setItem("places-pending-logout", "previous-member"));
  await page.route("**/api/account", (route) =>
    route.fulfill({ json: { ...config, account: null } }),
  );
  await page.route("**/api/account/config", (route) => route.fulfill({ json: config }));
  await page.route("**/api/account/sign-out", (route) => {
    expect(route.request().headers()["x-places-account"]).toBe("previous-member");

    return route.fulfill(
      unavailable ? { status: 503, json: { error: "temporary failure" } } : { json: { ok: true } },
    );
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", (route) => {
    sent++;

    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "G Sign in with Google", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Account service is unavailable", { exact: false })).toBeHidden();
  await page
    .getByRole("textbox", { name: "Email address", exact: true })
    .fill("fixture@example.invalid");
  await page.getByRole("button", { name: "Email a sign-in code", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(sent).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("places-pending-logout"))).toBe(
    "previous-member",
  );
  unavailable = false;
  await page.getByRole("button", { name: "Email a sign-in code", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Six-digit code", exact: true })).toBeVisible();
  expect(sent).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("places-pending-logout"))).toBeNull();
});

test("unavailable account discovery can be retried directly in Settings", async ({ page }) => {
  let unavailable = true;
  await page.route("**/api/account", (route) =>
    route.fulfill(
      unavailable
        ? { status: 503, json: { error: "temporary failure" } }
        : { json: { enabled: true, providers: { google: true, email: true }, account: null } },
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Account service is unavailable", { exact: false })).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "G Sign in with Google", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Account service is unavailable", { exact: false })).toBeHidden();
});
