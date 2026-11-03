import type { Entity, LocalRecord, Mutation } from "../../shared/model";

export type WorkspaceChangeOptions = {
  clearDraftId?: string;
  requirePlace?: { workspace: string; id: string; original?: LocalRecord };
  isCurrent?: () => boolean;
  importToken?: string;
  existingOnly?: boolean;
  personalVisit?: Entity | Entity[];
  preservePersonalVisits?: boolean;
};

export type Workspace = {
  key: string;
  completedRouteDrafts?: string[];
  records: LocalRecord[];
  flight?: { mutation: Mutation; generation: number };
  deferredFlights?: (NonNullable<Workspace["flight"]> & { snapshotBlocked?: boolean })[];
  importLease?: { token: string; expiresAt: number };
  reconciled: boolean;
  presetRevision?: number;
  deviceAccounts?: string[];
  guestPlaces?: Record<string, string | null>;
  deviceTransfers?: Record<
    string,
    { account: string; destination: string; generation: number; skippedGeneration?: number }
  >;
};
