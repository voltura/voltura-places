import { test, expect, chooseSaveOption } from "./fixtures";

test.use({ serviceWorkers: "block" });

test("a failed draft read cannot overwrite the draft and write failures are visible", async ({
  page,
}) => {
  await page.goto("/");
  const options = page.getByRole("button", { name: "Save options", exact: true });
  await expect(options).toBeEnabled();
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    const put = IDBObjectStore.prototype.put;
    let fault = "read";
    Object.assign(window, {
      changeDraftFault: (next: string) => {
        fault = next;
      },
    });
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === "drafts" && fault === "read") {
        throw new DOMException("fixture", "UnknownError");
      }

      return get.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "drafts" && fault === "write") {
        throw new DOMException("fixture", "QuotaExceededError");
      }

      return put.apply(this, args);
    };
  });
  await chooseSaveOption(page, "details");
  const editor = page.getByRole("dialog", { name: "Add place", exact: true });
  await expect(editor.getByRole("alert")).toContainText("Could not read the saved draft");
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).changeDraftFault("write"));
  await editor.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Could not save this draft");
  await page.evaluate(() => (window as any).changeDraftFault(""));
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Recovered write");
  await expect(editor.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
    "Recovered write",
  );
});

test("an invalid email code can be corrected and a connection retry does not consume it twice", async ({
  page,
}) => {
  let verifications = 0;
  let connections = 0;
  let refreshFailed = false;
  await page.route("**/api/account", (route) => {
    if (connections === 3 && !refreshFailed) {
      refreshFailed = true;

      return route.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
    }

    return route.fulfill({ json: { enabled: true, providers: { email: true }, account: null } });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/auth/sign-in/email-otp", (route) => {
    verifications++;

    return route.fulfill(
      verifications === 1
        ? { status: 400, json: { error: "invalid_otp" } }
        : { json: { ok: true } },
    );
  });
  await page.route("**/api/account/connect", (route) => {
    connections++;

    return route.fulfill(
      connections === 1
        ? { status: 401, json: { error: "signInAgain" } }
        : connections === 2
          ? { status: 503, json: { error: "serviceUnavailable" } }
          : { json: { ok: true } },
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Settings", exact: true });
  await sheet.getByRole("combobox", { name: "Settings", exact: true }).selectOption("account");
  await sheet.locator('input[type="email"]').fill("fixture@example.invalid");
  await sheet.getByRole("button", { name: "Email a sign-in code", exact: true }).click();
  const otp = sheet.getByRole("textbox", { name: "Six-digit code" });
  const signIn = sheet.getByRole("button", { name: "Sign in", exact: true });
  await otp.fill("000000");
  await signIn.click();
  await expect(sheet.getByRole("alert")).toContainText("code is invalid or expired");
  await otp.fill("123456");
  await signIn.click();
  await expect(otp).toHaveCount(0);
  await sheet.getByRole("button", { name: "Email a sign-in code", exact: true }).click();
  await otp.fill("123456");
  await signIn.click();
  await expect(sheet.getByRole("alert")).toContainText("Could not connect");
  await signIn.click();
  await expect.poll(() => refreshFailed).toBe(true);
  await expect(sheet.getByRole("alert")).toContainText("Could not connect");
  await signIn.click();
  await expect(otp).toHaveCount(0);
  expect(verifications).toBe(3);
  expect(connections).toBe(3);
});
