import { useState } from "react";
import type { PlaceRecord } from "../../shared/model";

export function useRouteFollowing(scope: string, records: PlaceRecord[]) {
  const [session, setSession] = useState<{ scope: string; id: string } | null>(null);
  const record =
    session?.scope === scope
      ? records.find((r) => r.id === session.id && r.kind === "route" && !r.deleted)
      : undefined;
  if (session && !record) {
    setSession(null);
  }

  return {
    record,
    start: (route: PlaceRecord) => setSession({ scope, id: route.id }),
    close: () => setSession(null),
  };
}
