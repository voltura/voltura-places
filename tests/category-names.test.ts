import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import {
  categoryName,
  categoryNameDraft,
  categoryNameValue,
  builtInCategoryNames,
} from "../src/shared/category-names";
import { categorySchema, starters, validateBackup, type Category } from "../src/shared/model";
import {
  saveEntity,
  readWorkspace,
  exportBackup,
  importBackup,
  changeWorkspace,
  prepareMutation,
  mergeSnapshot,
} from "../src/client/foundation/library";

test("built-in categories translate and appearance-only edits preserve their stored identity", () => {
  for (const record of starters) {
    if (record.kind !== "category") continue;
    const draft = categoryNameDraft(record.value, "sv");
    expect(categoryName(record.value, "en")).toBe(builtInCategoryNames[record.id].en);
    expect(categoryName(record.value, "sv")).toBe(builtInCategoryNames[record.id].sv);
    expect(categoryNameValue(record.value, draft)).toEqual({
      name: record.value.name,
      builtIn: record.value.builtIn,
    });
  }
});
test.each([{ en: "Hikes", sv: "Vandringar" }, { en: "Hikes" }, { sv: "Vandringar" }])(
  "localized names and one-language fallback: %j",
  (names) => {
    const category: Category = { name: names.en || names.sv!, names, color: "green" };
    expect(categoryName(category, "en")).toBe(names.en || names.sv);
    expect(categoryName(category, "sv")).toBe(names.sv || names.en);
  },
);
test("custom legacy names stay unchanged and empty translations are omitted", () => {
  const category: Category = { name: "My custom category", color: "blue" };
  expect(categoryName(category, "sv")).toBe(category.name);
  const draft = categoryNameDraft(category, "en");
  draft.names.sv = "  Mina platser  ";
  draft.names.en = "";
  draft.namesChanged = true;
  expect(categoryNameValue(category, draft)).toEqual({
    name: "Mina platser",
    names: { sv: "Mina platser" },
  });
});
test("translation input rejects unknown languages, blank maps, long names and non-string values", () => {
  for (const names of [{}, { en: "" }, { sv: "x".repeat(61) }, { de: "Name" }, { en: 2 }])
    expect(categorySchema.safeParse({ name: "Fallback", color: "green", names }).success).toBe(
      false,
    );
});
test("translations survive backup/import and mutation preparation", async () => {
  vi.stubGlobal("window", new EventTarget());
  const source = crypto.randomUUID(),
    target = crypto.randomUUID();
  const value: Category = {
    name: "Hikes",
    color: "green",
    names: { en: "Hikes", sv: "Vandringar" },
  };
  await saveEntity(source, { id: "localized", kind: "category", value });
  const backup = validateBackup(exportBackup(await readWorkspace(source)));
  await importBackup(target, backup);
  expect((await readWorkspace(target)).records.find((r) => r.id === "localized")?.value).toEqual(
    value,
  );
  await changeWorkspace(source, (w) => {
    w.reconciled = true;
  });
  expect((await prepareMutation(source))?.mutation.entity.value).toEqual(value);
});
test("sync compares nested translations and preserves a different cloud translation as a conflict", async () => {
  vi.stubGlobal("window", new EventTarget());
  for (const changed of [false, true]) {
    const key = crypto.randomUUID();
    await changeWorkspace(key, (w) => {
      w.reconciled = true;
    });
    const value: Category = {
      name: "Hikes",
      color: "green",
      names: { en: "Hikes", sv: "Vandringar" },
    };
    await saveEntity(key, { id: "localized", kind: "category", value });
    await mergeSnapshot(key, [
      {
        id: "localized",
        kind: "category",
        value: { ...value, names: { sv: changed ? "Promenader" : "Vandringar", en: "Hikes" } },
        revision: 1,
        deleted: false,
      },
    ]);
    const record = (await readWorkspace(key)).records.find((r) => r.id === "localized")!;
    expect(!!record.conflict).toBe(changed);
    expect(record.dirty).toBe(changed);
  }
});
