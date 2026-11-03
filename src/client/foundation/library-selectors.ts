import { visitOwner, visitStatuses } from "../../shared/visits";
import { categoryName } from "../../shared/category-names";
import { distanceMetres } from "./distance";
import type { Workspace } from "./library-types";
import type { Language } from "./i18n";
import type { LocalRecord, PlaceRecord } from "../../shared/model";

export const liveCategories = (workspace: Workspace | null) =>
  workspace?.records.filter((r) => r.kind === "category" && !r.deleted) ?? [];

export const livePlaces = (workspace: Workspace | null) =>
  workspace?.records.filter(
    (r): r is PlaceRecord => (r.kind === "place" || r.kind === "route") && !r.deleted,
  ) ?? [];

export function libraryVisits(
  scope: string,
  workspace: Workspace | null,
  personalWorkspace: Workspace | null,
) {
  const owner = visitOwner(scope);
  const personal = owner === scope ? workspace : personalWorkspace;

  return visitStatuses(personal?.key === owner ? personal.records : [], scope);
}

const collators = new Map<Language, Intl.Collator>();

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
  const query = search.trim().normalize().toLocaleLowerCase(language);
  const categoryIndex =
    filter !== "all" || query ? new Map(categories.map((c) => [c.id, c])) : undefined;

  const categoryFor = (id: string) => categoryIndex?.get(id) ?? categoryIndex?.get("other");

  const labels = new Map<string, string>();

  const categoryLabel = (r: LocalRecord | undefined) => {
    if (r?.kind !== "category") {
      return "";
    }
    let label = labels.get(r.id);
    if (label === undefined) {
      label = categoryName(r.value, language);
      labels.set(r.id, label);
    }

    return label;
  };

  const matches = places.filter((p) => {
    const category = categoryIndex ? categoryFor(p.value.categoryId) : undefined;

    return (
      (filter === "all" || (category?.id ?? "other") === filter) &&
      (visitFilter === "all" ||
        (visitFilter === "places"
          ? p.kind === "place"
          : visitFilter === "routes"
            ? p.kind === "route"
            : (visits.get(p.id) ?? "none") === visitFilter)) &&
      (!query ||
        `${p.value.name} ${p.value.description ?? ""} ${categoryLabel(category)}`
          .normalize()
          .toLocaleLowerCase(language)
          .includes(query))
    );
  });
  if (sort === "name") {
    let collator = collators.get(language);
    if (!collator) {
      collator = new Intl.Collator(language);
      collators.set(language, collator);
    }

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
