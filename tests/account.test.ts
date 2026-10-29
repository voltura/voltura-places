import { test, expect, vi } from "vitest";
import { currentAccount, signOutLocally } from "../src/client/foundation/account";

test("a stale logout does not trap a different signed-in account in pending logout", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  vi.stubGlobal("localStorage", storage);
  const state = {
    enabled: true,
    providers: { email: true },
    account: { id: "new-account", methods: [] },
  };
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      String(url).endsWith("sign-out")
        ? Response.json({ error: "The signed-in account changed." }, { status: 409 })
        : Response.json(state),
    );
  try {
    await signOutLocally("old-account");
    expect(storage.getItem("places-pending-logout")).toBeNull();
    storage.setItem("places-pending-logout", "old-account");
    expect(await currentAccount()).toEqual(state);
    expect(storage.getItem("places-pending-logout")).toBeNull();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});
