import { expect, test } from "vitest";
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
