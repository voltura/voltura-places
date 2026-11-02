import type { Category } from "./model";
export type CategoryLanguage = "en" | "sv";
export const builtInCategoryNames: Record<string, Record<CategoryLanguage, string>> = {
  parking: { en: "Parking", sv: "Parkering" },
  food: { en: "Food & drink", sv: "Mat och dryck" },
  outdoors: { en: "Outdoors", sv: "Friluftsliv" },
  accommodation: { en: "Accommodation", sv: "Boende" },
  mushrooms: { en: "Mushrooms", sv: "Svampar" },
  other: { en: "Other", sv: "Övrigt" },
};
const presetNames = (category: Category) => {
  const preset =
    category.builtIn && Object.hasOwn(builtInCategoryNames, category.builtIn)
      ? builtInCategoryNames[category.builtIn]
      : undefined;
  return preset && category.name === preset.en ? preset : undefined;
};
export function categoryName(category: Category, language: CategoryLanguage) {
  return (
    category.names?.[language] ||
    category.names?.en ||
    category.names?.sv ||
    presetNames(category)?.[language] ||
    category.name
  );
}
export function categoryNameDraft(category: Category | undefined, language: CategoryLanguage) {
  return {
    names: category
      ? { ...(category.names ?? presetNames(category) ?? { [language]: category.name }) }
      : ({} as Partial<Record<CategoryLanguage, string>>),
    nameLanguage: language,
    namesChanged: false,
  };
}
export function categoryNameValue(
  original: Category | undefined,
  draft: ReturnType<typeof categoryNameDraft>,
) {
  if (original && !draft.namesChanged)
    return {
      name: original.name,
      ...(original.names ? { names: original.names } : {}),
      ...(original.builtIn ? { builtIn: original.builtIn } : {}),
    };
  const names = Object.fromEntries(
    Object.entries(draft.names)
      .map(([language, name]) => [language, name?.trim()])
      .filter(([, name]) => !!name),
  ) as Partial<Record<CategoryLanguage, string>>;
  return { name: names.en || names.sv || "", ...(Object.keys(names).length ? { names } : {}) };
}
