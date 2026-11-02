import type { Entity, LocalRecord, Mutation } from "../../shared/model";

export type WorkspaceChangeOptions = {
  clearDraftId?: string;
  isCurrent?: () => boolean;
  importToken?: string;
  personalVisit?: Entity | Entity[];
  preservePersonalVisits?: boolean;
};

export type Workspace = {
  key: string;
  records: LocalRecord[];
  flight?: { mutation: Mutation; generation: number };
  deferredFlights?: NonNullable<Workspace["flight"]>[];
  importLease?: { token: string; expiresAt: number };
  reconciled: boolean;
  presetRevision?: number;
  deviceAccounts?: string[];
  guestPlaces?: Record<string, string | null>;
  deviceTransfers?: Record<string, { account: string; destination: string; generation: number }>;
};
