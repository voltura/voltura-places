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
