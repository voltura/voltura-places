import { expect, test, vi } from "vitest";
import { shareOrCopy } from "../src/client/foundation/sharing";
import { directionsURL, mapURL } from "../src/shared/model";

test.each(["google", "apple"] as const)(
  "%s directions preserve exact coordinates and omit origin",
  (provider) => {
    const place = { latitude: -33.123456789, longitude: 151.987654321, name: "<script>& ? å" };
    const url = new URL(directionsURL(provider, place));
    expect(url.searchParams.get("destination")).toBe("-33.123456789,151.987654321");
    expect(url.searchParams.has("origin")).toBe(false);
    expect(url.searchParams.has("source")).toBe(false);
    expect(url.href).not.toContain("script");
    expect(url.protocol).toBe("https:");
    expect(mapURL(provider, place)).not.toBe(url.href);
    if (provider === "google") {
      expect(url.searchParams.get("api")).toBe("1");
      expect(url.searchParams.get("dir_action")).toBe("navigate");
    }
  },
);

test("lone surrogate from a truncated place label cannot break opening Apple or Android maps", () => {
  const place = { latitude: 2, longitude: 3, name: "Cafe \uD800" };
  expect(new URL(mapURL("apple", place)).searchParams.get("q")).toBe("Cafe \uFFFD");
  expect(new URL(mapURL("geo", place)).searchParams.get("q")).toBe("2,3(Cafe \uFFFD)");
});

test("maps receive decimal degrees for valid coordinates near the equator or prime meridian", () => {
  const place = { latitude: 1.23e-7, longitude: -1e-8, name: "Tiny" };
  for (const provider of ["apple", "google", "geo"] as const) {
    const url = new URL(mapURL(provider, place));
    expect([...url.searchParams.values()].join(" ")).toContain("0.000000123,-0.00000001");
    if (provider !== "geo") {
      expect(new URL(directionsURL(provider, place)).searchParams.get("destination")).toBe(
        "0.000000123,-0.00000001",
      );
    }
  }
});

test("an unusable native share target copies the invitation while a dismissed share stays quiet", async () => {
  const writeText = vi.fn(async () => {});
  const share = vi
    .fn()
    .mockRejectedValueOnce(new Error("no sharing targets"))
    .mockRejectedValueOnce({ name: "AbortError" });
  vi.stubGlobal("navigator", { share, clipboard: { writeText } });
  try {
    expect(await shareOrCopy({ text: "Invite" }, "Invite")).toBe("copied");
    expect(await shareOrCopy({ text: "Invite" }, "Invite")).toBe("dismissed");
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Invite");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a failed native share cannot copy a discarded workspace link", async () => {
  let current = true;
  const writeText = vi.fn();
  vi.stubGlobal("navigator", {
    share: async () => {
      current = false;
      throw Error();
    },
    clipboard: { writeText },
  });
  try {
    expect(await shareOrCopy({ text: "Invite" }, "Invite", () => current)).toBe("dismissed");
    expect(writeText).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
