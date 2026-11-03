import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import {
  categorySchema,
  categoryColors,
  categoryIcons,
  starters,
  validateBackup,
} from "../src/shared/model";
import { categoryAppearance } from "../src/client/features/CategoryAppearance";
import {
  changeWorkspace,
  saveEntity,
  readWorkspace,
  exportBackup,
  importBackup,
  prepareMutation,
} from "../src/client/foundation/library";

test("legacy defaults do not rewrite saved categories", () => {
  const records = starters.map((r) => ({
    ...r,
    revision: 0,
    deleted: false,
    generation: 0,
    dirty: false,
  }));
  expect(records.map((r) => categoryAppearance(r).icon)).toEqual([
    "car",
    "utensils",
    "trees",
    "house",
    "mushroom",
    "route",
    "pin",
  ]);
  expect(new Set(records.map((r) => categoryAppearance(r).color)).size).toBe(6);
  expect(records.every((r) => r.kind === "category" && r.value.icon === undefined)).toBe(true);
  for (const record of records) {
    if (record.kind === "category") {
      expect(
        categoryAppearance({ ...record, value: { ...record.value, builtIn: "__proto__" } }).icon,
      ).toBe("pin");
      expect(categoryAppearance({ ...record, value: { ...record.value, icon: "none" } }).icon).toBe(
        "none",
      );
    }
  }
});
test.each(["icecream", "none"] as const)(
  "appearance %s survives atomic saving, mutation preparation and backup import with isolated workspaces",
  async (icon) => {
    vi.stubGlobal("window", new EventTarget());
    const source = crypto.randomUUID();
    const target = crypto.randomUUID();
    const id = crypto.randomUUID();
    await readWorkspace(source);
    await readWorkspace(target);
    await saveEntity(source, {
      id,
      kind: "category",
      value: { name: "Camps", icon, color: "cyan" },
    });
    const backup = validateBackup(await exportBackup(await readWorkspace(source)));
    expect(backup.categories.find((c) => c.id === id)?.value).toEqual({
      name: "Camps",
      icon,
      color: "cyan",
    });
    expect((await readWorkspace(target)).records.some((r) => r.id === id)).toBe(false);
    await importBackup(target, backup);
    expect(
      (await readWorkspace(target)).records.find(
        (r) => r.kind === "category" && r.value.name === "Camps",
      )?.value,
    ).toEqual({ name: "Camps", icon, color: "cyan" });
    await changeWorkspace(source, (w) => {
      w.reconciled = true;
    });
    const mutation = await prepareMutation(source);
    expect(mutation?.mutation.entity.value).toEqual({
      name: "Camps",
      icon,
      color: "cyan",
    });
  },
);
test("untrusted appearance values are bounded and rejected", () => {
  expect(categorySchema.safeParse({ name: "Camp", color: "blue" }).success).toBe(true);
  for (const bad of [
    { icon: "<svg onload=alert(1)>" },
    { color: "url(https://example.com)" },
    { icon: "tent", extra: true },
  ]) {
    expect(categorySchema.safeParse({ name: "Camp", color: "blue", ...bad }).success).toBe(false);
  }
});

test("every catalog appearance validates and renders", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { CategoryIcon } = await import("../src/client/features/CategoryAppearance");
  expect(categoryColors).toHaveLength(12);
  expect(categoryIcons).toHaveLength(50);
  for (const color of categoryColors) {
    for (const icon of categoryIcons) {
      expect(categorySchema.safeParse({ name: "Example", color, icon }).success).toBe(true);
      const markup = renderToStaticMarkup(createElement(CategoryIcon, { color, icon }));
      if (icon === "none") {
        expect(markup).toBe("");
      } else {
        expect(markup).toContain("<svg");
      }
    }
  }
});
