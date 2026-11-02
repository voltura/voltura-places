import { visitOwner, visitStatuses } from "../../shared/visits";
import { categoryName } from "../../shared/category-names";
import { distanceMetres } from "./distance";
import type { Workspace } from "./library-types";
import type { Language } from "./i18n";
import type { LocalRecord, PlaceRecord } from "../../shared/model";

export const liveCategories = (workspace: Workspace | null) =>
  workspace?.records.filter((r) => r.kind === "category" && !r.deleted) ?? [];

export const livePlaces = (workspace: Workspace | null) =>
  workspace?.records.filter((r): r is PlaceRecord => r.kind === "place" && !r.deleted) ?? [];

export function libraryVisits(
  scope: string,
  workspace: Workspace | null,
  personalWorkspace: Workspace | null,
) {
  const owner = visitOwner(scope);
  const personal = owner === scope ? workspace : personalWorkspace;

  return visitStatuses(personal?.key === owner ? personal.records : [], scope);
}

export function selectPlaces({
  places,
  categories,
  visits,
  search,
  filter,
  visitFilter,
  sort,
  language,
  currentPosition,
}: {
  places: PlaceRecord[];
  categories: LocalRecord[];
  visits: ReturnType<typeof visitStatuses>;
  search: string;
  filter: string;
  visitFilter: string;
  sort: string;
  language: Language;
  currentPosition: GeolocationPosition | null;
}) {
  const categoryIndex = new Map(categories.map((c) => [c.id, c]));

  const categoryFor = (id: string) => categoryIndex.get(id) ?? categoryIndex.get("other");

  const categoryLabel = (r: LocalRecord) =>
    r.kind === "category" ? categoryName(r.value, language) : "";

  const query = search.toLocaleLowerCase(language);
  const matches = places.filter((p) => {
    const category = categoryFor(p.value.categoryId);

    return (
      (filter === "all" || (category?.id ?? "other") === filter) &&
      (visitFilter === "all" || (visits.get(p.id) ?? "none") === visitFilter) &&
      (!query ||
        `${p.value.name} ${p.value.description ?? ""} ${category ? categoryLabel(category) : ""}`
          .toLocaleLowerCase(language)
          .includes(query))
    );
  });
  if (sort === "name") {
    const collator = new Intl.Collator(language);

    return matches.sort((a, b) => collator.compare(a.value.name, b.value.name));
  }

  // Compute dates and great-circle distances once per place, rather than
  // repeating parsing/trigonometry for each comparison in the sort.
  return matches
    .map((place) => ({
      place,
      captured: Date.parse(place.value.capturedAt),
      distance:
        sort === "closest" && currentPosition
          ? distanceMetres(currentPosition.coords, place.value)
          : 0,
    }))
    .sort((a, b) => a.distance - b.distance || b.captured - a.captured)
    .map(({ place }) => place);
}
