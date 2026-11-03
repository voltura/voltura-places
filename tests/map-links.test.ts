import { afterEach, expect, test, vi } from "vitest";
import { mapLinkTarget, openMapLink } from "../src/client/foundation/map-links";

afterEach(() => vi.unstubAllGlobals());

test.each([
  ["iPhone", "iPhone", 5, true, false, "_self"],
  ["iPhone", "iPhone", 5, false, true, "_self"],
  ["Macintosh", "MacIntel", 5, true, false, "_self"],
  ["iPad", "iPad", 5, false, false, "_blank"],
  ["Android", "Linux", 5, true, false, "_blank"],
  ["Macintosh", "MacIntel", 0, true, false, "_blank"],
] as const)(
  "%s (%s, touch=%s), display=%s legacy=%s uses %s",
  (userAgent, platform, maxTouchPoints, standalone, legacy, target) => {
    vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints, standalone: legacy });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: standalone && query === "(display-mode: standalone)",
    }));
    expect(mapLinkTarget()).toBe(target);
  },
);

test("programmatic map links retain destination and referrer/opener protection", () => {
  vi.stubGlobal("navigator", { userAgent: "iPhone", standalone: true });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const link = { href: "", target: "", rel: "", click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal("document", { createElement: () => link, body: { appendChild: append } });
  const url = "https://www.google.com/maps/search/?api=1&query=59,18";
  openMapLink(url);
  expect(link.href).toBe(url);
  expect(link.target).toBe("_self");
  expect(link.rel).toBe("noopener noreferrer");
  expect(append).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledOnce();
  expect(link.remove).toHaveBeenCalledOnce();
});
