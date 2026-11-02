import { test, expect, vi } from "vitest";
import { cachedAccount, currentAccount, signOutLocally } from "../src/client/foundation/account";

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
      if (failLogout) {
        throw new Error("offline");
      }

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

test("a guest logout never sends an unscoped sign-out for another browser session", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    await signOutLocally();
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test("another tab signing out while discovery runs cannot repopulate the account cache", async () => {
  const state = { enabled: true, providers: {}, account: { id: "previous-account", methods: [] } };
  const values = new Map([["places-account", JSON.stringify(state)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    values.delete("places-account");

    return Response.json(state);
  });
  try {
    await expect(currentAccount()).rejects.toThrow("accountChanged");
    expect(cachedAccount().account).toBeNull();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test.each(["guest", "family:impostor:10000000-0000-4000-8000-000000000000", ""])(
  "cached identity cannot alias a non-account workspace %s",
  (id) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "places-account"
          ? JSON.stringify({ enabled: true, providers: {}, account: { id, methods: [] } })
          : null,
    });
    try {
      expect(cachedAccount().account).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

test("an invalid stored logout marker cannot be forwarded with the identity of another workspace", async () => {
  const data = new Map([
    ["places-pending-logout", "family:member:10000000-0000-4000-8000-000000000000"],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ enabled: true, providers: {}, account: null }));
  try {
    await currentAccount();
    expect(network.mock.calls.map(([path]) => path)).toEqual(["/api/account"]);
    expect(network.mock.calls[0][1]).toMatchObject({ redirect: "error", mode: "same-origin" });
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("a remote completion removes a saved logout before the initiating tab retries", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValue(
      Response.json({ enabled: true, providers: {}, account: { id: "same-account", methods: [] } }),
    );
  try {
    await signOutLocally("same-account");
    data.delete("places-pending-logout");
    expect((await currentAccount()).account?.id).toBe("same-account");
    expect(network.mock.calls.map(([path]) => path)).toEqual([
      "/api/account/sign-out",
      "/api/account",
    ]);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("local account and completed logout stay hidden if removing keys becomes unavailable", async () => {
  const state = { enabled: true, providers: {}, account: { id: "former-account", methods: [] } };
  const data = new Map([["places-account", JSON.stringify(state)]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: () => {
      throw Error("denied");
    },
  });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ ...state, account: null }));
  try {
    await signOutLocally("former-account");
    expect(data.get("places-pending-logout")).toBe("former-account");
    expect(cachedAccount().account).toBeNull();
    await currentAccount();
    expect(network.mock.calls.map(([path]) => path)).toEqual([
      "/api/account/sign-out",
      "/api/account",
    ]);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("overlapping logout and discovery share the pending sign-out request", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  let resolve!: (value: Response) => void;
  const gate = new Promise<Response>((release) => {
    resolve = release;
  });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(gate)
    .mockResolvedValue(Response.json({ enabled: true, providers: {}, account: null }));
  try {
    const logout = signOutLocally("member");
    const discovery = currentAccount();
    expect(network).toHaveBeenCalledTimes(1);
    resolve(Response.json({ ok: true }));
    await Promise.all([logout, discovery]);
    expect(network).toHaveBeenCalledTimes(2);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("recovered storage cannot expose a cached identity hidden while every storage operation was blocked", async () => {
  const state = {
    enabled: true,
    providers: {},
    account: { id: "blocked-former-account", methods: [] },
  };
  const values = new Map([["places-account", JSON.stringify(state)]]);
  let blocked = true;
  vi.stubGlobal("localStorage", {
    getItem(key: string) {
      if (blocked) {
        throw Error("blocked");
      }

      return values.get(key) ?? null;
    },
    setItem() {
      throw Error("blocked");
    },
    removeItem() {
      throw Error("blocked");
    },
  });
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
  try {
    await signOutLocally(state.account.id);
    blocked = false;
    expect(cachedAccount().account).toBeNull();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});
