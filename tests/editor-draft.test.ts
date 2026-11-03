import { expect, test } from "vitest";
import { hasUnfinishedEdits } from "../src/client/foundation/editor-draft";

const base = {
  id: "sample",
  kind: "place",
  value: {
    name: "Trail",
    categoryId: "other",
    latitude: 59,
    longitude: 18,
    accuracy: 5,
    capturedAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
  },
};
const draft = {
  id: base.id,
  base,
  name: "Trail",
  categoryId: "other",
  latitude: "59",
  longitude: "18",
  description: "",
  photoId: null,
  visitedHere: false,
};

test("absent, blank and unchanged editor drafts do not claim unfinished edits", () => {
  expect(hasUnfinishedEdits(undefined)).toBe(false);
  expect(
    hasUnfinishedEdits({ id: "new", name: "", categoryId: "other", latitude: "", longitude: "" }),
  ).toBe(false);
  expect(hasUnfinishedEdits(draft)).toBe(false);
});

test.each([
  { name: "Changed" },
  { description: "A note" },
  { latitude: "59.1" },
  { categoryId: "hikes" },
  { visitedHere: true },
  { accuracy: 10 },
  { photoId: "photo" },
  { capturedAt: "2026-11-03T01:00:00.000Z" },
])("changed editor values are unfinished: %j", (change) => {
  expect(hasUnfinishedEdits({ ...draft, ...change })).toBe(true);
});

test("new draft content counts and reverting edits clears the warning", () => {
  expect(hasUnfinishedEdits({ ...draft, base: null })).toBe(true);
  expect(hasUnfinishedEdits({ ...draft, name: "Changed" })).toBe(true);
  expect(hasUnfinishedEdits(draft)).toBe(false);
});
