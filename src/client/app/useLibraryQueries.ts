import { useCallback, useMemo } from "react";
import { visitOwner } from "../../shared/visits";
import { categoryName } from "../../shared/category-names";
import {
  liveCategories,
  livePlaces,
  libraryVisits,
  selectPlaces,
} from "../foundation/library-selectors";
import type { Workspace } from "../foundation/library";
import type { Preferences } from "../foundation/preferences";
import type { LocalRecord } from "../../shared/model";

export function useLibraryQueries({
  workspace,
  personalWorkspace,
  scope,
  selectedFamily,
  prefs,
  search,
  filter,
  visitFilter,
  sort,
  selected,
  currentPosition,
}: {
  workspace: Workspace | null;
  personalWorkspace: Workspace | null;
  scope: string;
  selectedFamily: string | null;
  prefs: Preferences;
  search: string;
  filter: string;
  visitFilter: string;
  sort: string;
  selected: string | null;
  currentPosition: GeolocationPosition | null;
}) {
  const categories = useMemo(() => liveCategories(workspace), [workspace]);
  const categoryLabel = useCallback(
    (r: LocalRecord) => (r.kind === "category" ? categoryName(r.value, prefs.language) : ""),
    [prefs.language],
  );
  const categoryIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categoryFor = useCallback(
    (id: string) => categoryIndex.get(id) ?? categoryIndex.get("other"),
    [categoryIndex],
  );
  const places = useMemo(() => livePlaces(workspace), [workspace]);
  const visits = useMemo(
    () => libraryVisits(scope, workspace, personalWorkspace),
    [scope, workspace, personalWorkspace],
  );
  const filtered = useMemo(
    () =>
      selectPlaces({
        places,
        categories,
        visits,
        search,
        filter,
        visitFilter,
        sort,
        language: prefs.language,
        currentPosition,
      }),
    [
      places,
      categories,
      visits,
      search,
      filter,
      visitFilter,
      sort,
      prefs.language,
      currentPosition,
    ],
  );
  const current = places.find((p) => p.id === selected);
  const conflicts = [
    ...(workspace?.records.filter((r) => r.conflict) ?? []),
    ...(visitOwner(scope) !== scope && personalWorkspace?.key === visitOwner(scope)
      ? personalWorkspace.records.filter(
          (r) => r.kind === "visit" && r.conflict && r.value.libraryId === selectedFamily,
        )
      : []),
  ];

  return { categories, categoryLabel, categoryFor, places, visits, filtered, current, conflicts };
}
