import { expect, test, vi } from "vitest";
import { parsePreferences, storePreferences } from "../src/client/foundation/preferences";

test("linked language wins while valid device preferences survive", () => {
  expect(
    parsePreferences(
      {
        language: "en",
        theme: "system",
        skin: "matrix",
        provider: "apple",
        lastCategory: "hikes",
        reviewGps: true,
        units: "imperial",
      },
      "?lang=sv",
      "en-US",
    ),
  ).toEqual({
    language: "sv",
    theme: "system",
    skin: "matrix",
    provider: "apple",
    lastCategory: "hikes",
    reviewGps: true,
    autoHideControls: false,
    recordingInterval: 10,
    units: "imperial",
  });
});

test.each([null, [], 42, "corrupt"])(
  "invalid storage uses browser-language defaults: %j",
  (value) => {
    expect(parsePreferences(value, "?lang=invalid", "sv-SE")).toMatchObject({
      language: "sv",
      theme: "dark",
      lastCategory: "other",
    });
  },
);

test("malformed fields cannot erase valid settings or inject unknown fields", () => {
  const preferences = parsePreferences(
    {
      language: "en",
      theme: null,
      provider: 42,
      skin: "unknown",
      lastCategory: {},
      reviewGps: "true",
      autoHideControls: 1,
      units: "yards",
      unknown: "discard",
    },
    "",
    "sv",
  );
  expect(preferences).toEqual({
    language: "en",
    theme: "dark",
    provider: "",
    skin: "forest",
    lastCategory: "other",
    reviewGps: false,
    autoHideControls: false,
    recordingInterval: 10,
    units: "metric",
  });
});

test("updating a single preference merges a concurrent change to another field before storage events arrive", () => {
  const previous = parsePreferences({ language: "en", theme: "dark", skin: "forest" }, "", "en");
  let raw = JSON.stringify({ ...previous, skin: "matrix" });
  vi.stubGlobal("navigator", { language: "en" });
  vi.stubGlobal("localStorage", {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  });
  try {
    const result = storePreferences(previous, { provider: "apple" });
    expect(result.saved).toBe(true);
    expect(JSON.parse(raw)).toMatchObject({ skin: "matrix", provider: "apple" });
  } finally {
    vi.unstubAllGlobals();
  }
});
