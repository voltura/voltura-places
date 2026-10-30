import { test, expect, vi } from "vitest";
import { currentAccount, signOutLocally } from "../src/client/foundation/account";

test("unavailable browser settings storage does not prevent online account discovery or logout retry", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    removeItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const state = {
    enabled: true,
    providers: {},
    account: { id: "storage-blocked-account", methods: [] },
  };
  let failLogout = false;
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("sign-out")) {
      if (failLogout) throw new Error("offline");
      return Response.json({ ok: true });
    }
    return Response.json(state);
  });
  try {
    expect(await currentAccount()).toEqual(state);
    failLogout = true;
    await signOutLocally(state.account.id);
    expect((await currentAccount()).account).toBeNull();
    failLogout = false;
    expect(await currentAccount()).toEqual(state);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

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
