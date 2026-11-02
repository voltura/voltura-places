import { test, expect, vi } from "vitest";
import { authorizedWorkspace } from "../src/server/workspace";
import type { Environment } from "../src/server/types";

test("disabled accounts deny every shared workspace capability before querying a session", async () => {
  const prepare = vi.fn();
  const env = {
    DB: { prepare },
    ACCOUNTS_ENABLED: "false",
    AUTH_ORIGIN: "https://places.test",
    AUTH_SECRET: "fixture-secret-with-at-least-32-characters",
  } as unknown as Environment;
  await expect(
    authorizedWorkspace(new Request("https://places.test/api/family"), env),
  ).rejects.toMatchObject({ status: 503, message: "serviceUnavailable" });
  expect(prepare).not.toHaveBeenCalled();
});

test("an explicit empty family header cannot read or mutate the private library", async () => {
  const prepare = vi.fn((sql: string) => ({
    bind: () => ({
      first: async () => (sql.includes("places_sessions") ? { account_id: "a" } : null),
    }),
  }));
  const env = {
    DB: { prepare },
    ACCOUNTS_ENABLED: "true",
    AUTH_ORIGIN: "https://places.test",
    AUTH_SECRET: "non-production-fixture-with-32-characters",
  } as unknown as Environment;
  const request = new Request("https://places.test/api/v1/sync", {
    headers: {
      Cookie: "__Host-places-session=fixture",
      "X-Places-Account": "a",
      "X-Places-Family": "",
    },
  });
  await expect(authorizedWorkspace(request, env)).rejects.toMatchObject({
    status: 403,
    message: "familyAccessEnded",
  });
});
