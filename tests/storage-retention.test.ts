import { expect, test, vi } from "vitest";
import { keepOfflineData } from "../src/client/foundation/storage";

test("concurrent retention requests share a prompt even when checking current persistence fails", async () => {
  const storage = {
    persisted: vi.fn().mockRejectedValue(Error("unavailable")),
    persist: vi.fn().mockResolvedValue(true),
  };
  vi.stubGlobal("navigator", { storage });
  try {
    expect(await Promise.all([keepOfflineData(), keepOfflineData()])).toEqual([true, true]);
    expect(storage.persist).toHaveBeenCalledTimes(1);
    expect(storage.persisted).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("already-persisted storage is detected when the request method is unavailable", async () => {
  vi.stubGlobal("navigator", { storage: { persisted: async () => true } });
  try {
    expect(await keepOfflineData()).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
