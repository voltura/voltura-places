import { test, expect } from "./fixtures";

test.use({ serviceWorkers: "block", baseURL: "http://127.0.0.1:5173" });

for (const language of ["en", "sv"] as const) {
  test(`join requests arrive outside Settings, defer, retry and approve (${language})`, async ({
    page,
  }, testInfo) => {
    let account = "request-owner";
    let incoming = false;
    let fail = true;
    const decisions: unknown[] = [];
    const group = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Weekend adventures",
      invitationVersion: "a".repeat(64),
      ownerId: account,
      members: [{ id: account, label: "Owner" }],
      requests: [] as { id: string; label: string }[],
    };
    await page.addInitScript((language) => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-preferences",
        JSON.stringify({ language, theme: "dark", provider: "" }),
      );
    }, language);
    await page.route("**/api/account", (r) =>
      r.fulfill({ json: { enabled: true, providers: {}, account: { id: account, methods: [] } } }),
    );
    await page.route("**/api/v1/sync", (r) =>
      r.fulfill({ json: { version: 1, accountId: account, records: [] } }),
    );
    await page.route("**/api/family", async (r) => {
      if (r.request().method() === "POST") {
        decisions.push(r.request().postDataJSON());
        expect(r.request().headers()["x-places-account"]).toBe("request-owner");
        if (fail) {
          return r.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
        }
        incoming = false;

        return r.fulfill({ json: { ok: true } });
      }

      return r.fulfill({
        json: {
          families: [
            {
              ...group,
              requests: incoming ? [{ id: "requester", label: "Dominika {group} $&" }] : [],
            },
          ],
        },
      });
    });
    await page.goto("/");
    const title = language === "en" ? "Join requests" : "Förfrågningar om att gå med";
    const prompt = page.getByRole("dialog", { name: title, exact: true });
    await expect(prompt).toBeHidden();
    await expect(page.locator("#account-sync-status")).toHaveText(
      language === "en" ? "Synced" : "Synkroniserat",
    );
    await page.clock.install();
    incoming = true;
    await page.clock.fastForward(5000);
    await expect(prompt).toContainText(
      language === "en"
        ? "Dominika {group} $& wants to join Weekend adventures."
        : "Dominika {group} $& vill gå med i Weekend adventures.",
    );
    await prompt.screenshot({ path: testInfo.outputPath(`join-request-${language}.png`) });
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("html").evaluate((e) => e.clientWidth),
    );
    await prompt
      .getByRole("button", { name: language === "en" ? "Close" : "Stäng", exact: true })
      .click();
    await page.clock.fastForward(10000);
    await expect(prompt).toBeHidden();
    // A replacement invitation is a new decision even for the same person.
    group.invitationVersion = "b".repeat(64);
    await page.clock.fastForward(5000);
    await expect(prompt).toBeVisible();
    const approve = prompt.getByRole("button", {
      name: language === "en" ? "Approve" : "Godkänn",
      exact: true,
    });
    await approve.click();
    await expect(prompt.getByRole("alert")).toBeVisible();
    await expect(approve).toBeEnabled();
    fail = false;
    await approve.click();
    await expect(prompt).toBeHidden();
    expect(decisions).toEqual(
      Array(2).fill({
        action: "code-approve",
        familyId: group.id,
        member: "requester",
        invitationVersion: group.invitationVersion,
      }),
    );
    // A new signed-in account must not see an old owner's requests, even if returned by a stale source.
    incoming = true;
    account = "different-account";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.clock.fastForward(5000);
    await expect(prompt).toBeHidden();
    await expect(page.locator(".join-request-reminder")).toBeHidden();
  });
}

test("decline and stale approvals use the correct owned group and live server state", async ({
  page,
}) => {
  const account = "owner-fixture";
  const owned = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Another group",
    ownerId: account,
    members: [{ id: account, label: "Owner" }],
    requests: [{ id: "visitor", label: "Visitor" }],
  };
  let requests = owned.requests;
  let fail = false;
  let unavailable = true;
  const decisions: unknown[] = [];
  await page.addInitScript(
    ({ account, owned }) => {
      localStorage.setItem("places-account-choice", "done");
      localStorage.setItem(
        "places-family:" + account,
        JSON.stringify({ families: [owned], inactive: [] }),
      );
    },
    { account, owned },
  );
  await page.route("**/api/account", (r) =>
    r.fulfill({ json: { enabled: true, providers: {}, account: { id: account, methods: [] } } }),
  );
  await page.route("**/api/v1/sync", (r) =>
    r.fulfill({ json: { version: 1, accountId: account, records: [] } }),
  );
  await page.route("**/api/family", async (r) => {
    if (unavailable) {
      return r.fulfill({ status: 503, json: { error: "serviceUnavailable" } });
    }
    if (r.request().method() === "POST") {
      decisions.push(r.request().postDataJSON());
      requests = [];

      return r.fulfill({
        status: fail ? 409 : 200,
        json: fail ? { error: "familyCodeChanged" } : { ok: true },
      });
    }

    return r.fulfill({
      json: {
        families: [
          {
            ...owned,
            id: "33333333-3333-4333-8333-333333333333",
            ownerId: "someone-else",
            requests: owned.requests,
          },
          { ...owned, requests },
        ],
      },
    });
  });
  await page.goto("/");
  await page.clock.install();
  const prompt = page.getByRole("dialog", { name: "Join requests", exact: true });
  await page.clock.fastForward(5000);
  await expect(prompt).toBeHidden(); // Cached owner requests cannot create a live approval prompt.
  unavailable = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(prompt).toContainText("Visitor wants to join Another group.");
  await prompt.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(prompt).toBeHidden();
  expect(decisions[0]).toEqual({ action: "code-reject", familyId: owned.id, member: "visitor" });
  requests = owned.requests;
  fail = true;
  await page.clock.fastForward(5000);
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(prompt).toBeHidden(); // A server-expired request disappears after authoritative refresh.
  await expect(page.locator(".join-request-reminder")).toBeHidden();
  expect(decisions[1]).toEqual({ action: "code-approve", familyId: owned.id, member: "visitor" });
});
