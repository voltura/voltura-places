import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { categorySchema, starters, validateBackup } from "../src/shared/model";
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
    "pin",
  ]);
  expect(new Set(records.map((r) => categoryAppearance(r).color)).size).toBe(6);
  expect(records.every((r) => r.kind === "category" && r.value.icon === undefined)).toBe(true);
});
test("appearance survives atomic saving, mutation preparation and backup import with isolated workspaces", async () => {
  vi.stubGlobal("window", new EventTarget());
  const source = crypto.randomUUID(),
    target = crypto.randomUUID(),
    id = crypto.randomUUID();
  await readWorkspace(source);
  await readWorkspace(target);
  await saveEntity(source, {
    id,
    kind: "category",
    value: { name: "Camps", icon: "tent", color: "rose" },
  });
  const backup = validateBackup(await exportBackup(await readWorkspace(source)));
  expect(backup.categories.find((c) => c.id === id)?.value).toEqual({
    name: "Camps",
    icon: "tent",
    color: "rose",
  });
  expect((await readWorkspace(target)).records.some((r) => r.id === id)).toBe(false);
  await importBackup(target, backup);
  expect(
    (await readWorkspace(target)).records.find((r) => r.value.name === "Camps")?.value,
  ).toEqual({ name: "Camps", icon: "tent", color: "rose" });
  await changeWorkspace(source, (w) => {
    w.reconciled = true;
  });
  const mutation = await prepareMutation(source);
  expect(mutation?.mutation.entity.value).toEqual({ name: "Camps", icon: "tent", color: "rose" });
});
test("untrusted appearance values are bounded and rejected", () => {
  expect(categorySchema.safeParse({ name: "Camp", color: "blue" }).success).toBe(true);
  for (const bad of [
    { icon: "<svg onload=alert(1)>" },
    { color: "url(https://example.com)" },
    { icon: "tent", extra: true },
  ])
    expect(categorySchema.safeParse({ name: "Camp", color: "blue", ...bad }).success).toBe(false);
});
