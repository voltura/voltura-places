import { expect, test, vi } from "vitest";
import { createInstallation, appleInstallBrowser } from "../src/client/foundation/installation";
import { shareOrCopy } from "../src/client/foundation/sharing";

test("a fresh browser install offer can supersede an unresolved prompt without inheriting its error", async () => {
  const display = Object.assign(new EventTarget(), { matches: false });
  const win = Object.assign(new EventTarget(), { matchMedia: () => display });
  const service = createInstallation(win as unknown as Window, {} as Navigator);
  let reject!: (error: unknown) => void;
  const oldPrompt = new Promise<void>((_, fail) => {
    reject = fail;
  });

  const offer = (prompt: () => Promise<void>) =>
    Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });

  try {
    win.dispatchEvent(offer(() => oldPrompt));
    const old = service.install();
    const newPrompt = vi.fn(async () => {});
    win.dispatchEvent(offer(newPrompt));
    expect(service.getSnapshot()).toMatchObject({ available: true, pending: false });
    await service.install();
    expect(newPrompt).toHaveBeenCalledOnce();
    reject(Error("outdated offer"));
    await old;
    expect(service.getSnapshot().failed).toBe(false);
  } finally {
    service.dispose();
  }
});

test("embedded iOS user agents containing a Chrome marker still show embedded-browser guidance", () => {
  expect(
    appleInstallBrowser({
      userAgent: "Mozilla/5.0 iPhone CriOS/120.0 Mobile Safari/604.1 [FBAN/FBIOS]",
    }),
  ).toBe("other");
  expect(
    appleInstallBrowser({ userAgent: "Mozilla/5.0 iPhone CriOS/120.0 Mobile Safari/604.1" }),
  ).toBe("chrome");
});

test("dismissing a share sheet from a different realm leaves the clipboard unchanged", async () => {
  const clipboard = { writeText: vi.fn() };
  vi.stubGlobal("navigator", {
    share: vi.fn().mockRejectedValue({ name: "AbortError" }),
    clipboard,
  });
  try {
    await expect(shareOrCopy({ text: "fixture" }, "fixture")).resolves.toBe("dismissed");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
