import { useCallback, useEffect, useRef, useState } from "react";
import { cachedFamily, fetchFamily, storeFamilies } from "../foundation/family";
import { channel, readWorkspace, type Workspace } from "../foundation/library";
import type { AccountState } from "../foundation/account-contract";
import { visitOwner } from "../../shared/visits";
import { workspaceIdentity, type Family } from "../../shared/families";
import type { Session } from "./useSession";

// Older tabs send an unscoped notification. They must still refresh every subscriber.
export function observeWorkspaceChanges(keys: string[], refresh: (affected?: string[]) => void) {
  const listener = (event: Event) => {
    const payload = event instanceof MessageEvent ? event.data : (event as CustomEvent).detail;
    if (
      !Array.isArray(payload?.workspaces) ||
      keys.some((key) => payload.workspaces.includes(key))
    ) {
      refresh(Array.isArray(payload?.workspaces) ? payload.workspaces : undefined);
    }
  };

  window.addEventListener("places-library", listener);
  channel?.addEventListener("message", listener);

  return () => {
    window.removeEventListener("places-library", listener);
    channel?.removeEventListener("message", listener);
  };
}

export function useWorkspace(
  session: Session,
  onTransition: (reason: "account" | "workspace") => void,
  onStorageError: () => void,
) {
  const { operations } = session;
  const renderedAccount = operations.capture("account");
  const [scope, setScope] = useState(operations.workspace);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [personalWorkspace, setPersonalWorkspace] = useState<Workspace | null>(null);
  const [familyCache, setFamilyCache] = useState(() => cachedFamily(operations.account));
  const cache = useRef(familyCache);
  const [verifiedFamilyAccount, setVerifiedFamilyAccount] = useState<string | null>(null);
  const familyRequest = useRef(0);
  const membershipGenerations = useRef(new Map<string, number>());
  const selectedRead = useRef(0);
  const personalRead = useRef(0);
  const familyActionPending = useRef(false);
  const callbacks = useRef({ onTransition, onStorageError });
  callbacks.current = { onTransition, onStorageError };
  const updateFamilies = useCallback(
    (families: Family[]) => {
      const id = operations.account;
      if (!id) {
        return;
      }
      familyRequest.current++;
      const next = storeFamilies(id, families, cache.current);
      if (next === cache.current) {
        return;
      }
      for (const previous of cache.current.families) {
        if (!families.some((f) => f.id === previous.id)) {
          membershipGenerations.current.set(
            previous.id,
            (membershipGenerations.current.get(previous.id) ?? 0) + 1,
          );
        }
      }
      const selected = workspaceIdentity(operations.workspace).family;
      if (
        selected &&
        cache.current.families.some((f) => f.id === selected) &&
        !families.some((f) => f.id === selected)
      ) {
        operations.invalidateWorkspace();
      }
      cache.current = next;
      setFamilyCache(next);
    },
    [operations],
  );
  const selectedFamily = workspaceIdentity(scope).family;
  const canWriteNow = useCallback(() => {
    const family = workspaceIdentity(operations.workspace).family;

    return !family || cache.current.families.some((f) => f.id === family);
  }, [operations]);
  const beginWrite = useCallback(
    () => operations.capture("workspace", canWriteNow),
    [operations, canWriteNow],
  );
  const refresh = useCallback(
    async (affected?: string[]) => {
      const operation = operations.capture();
      if (!operation.isCurrent()) {
        return;
      }
      const key = operation.workspace;
      const owner = visitOwner(key);
      const readSelected = !affected || affected.includes(key);
      const readPersonal = !affected || affected.includes(owner);
      const selectedVersion = readSelected ? ++selectedRead.current : selectedRead.current;
      const personalVersion = readPersonal ? ++personalRead.current : personalRead.current;
      const selected = readSelected ? readWorkspace(key) : null;
      const [w, personal] = await Promise.allSettled([
        selected,
        key === owner ? selected : readPersonal ? readWorkspace(owner) : null,
      ]);
      if (!operation.isCurrent()) {
        return;
      }
      const currentSelected = readSelected && selectedVersion === selectedRead.current;
      const currentPersonal = readPersonal && personalVersion === personalRead.current;
      if (currentSelected && w.status === "fulfilled" && w.value) {
        setWorkspace(w.value);
      }
      if (currentPersonal && personal.status === "fulfilled" && personal.value) {
        setPersonalWorkspace(personal.value);
      }
      if (
        (currentSelected && w.status === "rejected") ||
        (currentPersonal && personal.status === "rejected")
      ) {
        callbacks.current.onStorageError();
      }
    },
    [operations],
  );
  const transition = useCallback(
    (key: string, reason: "account" | "workspace") => {
      operations.changeWorkspace(key);
      setScope(key);
      setWorkspace(null);
      setPersonalWorkspace(null);
      callbacks.current.onTransition(reason);
    },
    [operations],
  );
  const changeAccount = useCallback(
    (next: AccountState) => {
      familyRequest.current++;
      membershipGenerations.current.clear();
      familyActionPending.current = false;
      setVerifiedFamilyAccount(null);
      cache.current = cachedFamily(next.account?.id);
      setFamilyCache(cache.current);
      transition(next.account?.id ?? "guest", "account");
    },
    [transition],
  );
  const switchLibrary = useCallback(
    (key: string) => {
      if (!operations.account || workspaceIdentity(key).account !== operations.account) {
        return;
      }
      if (key === operations.workspace) {
        return;
      }
      transition(key, "workspace");
      try {
        localStorage.setItem(`places-workspace:${operations.account}`, key);
      } catch {}
    },
    [operations, transition],
  );
  const membershipAction = useCallback((pending: boolean) => {
    familyActionPending.current = pending;
    familyRequest.current++;
  }, []);
  useEffect(() => {
    void refresh();

    let frame: number | undefined;
    let affected: Set<string> | undefined;
    const unsubscribe = observeWorkspaceChanges([scope, visitOwner(scope)], (keys) => {
      if (frame === undefined) {
        affected = keys ? new Set(keys) : undefined;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          void refresh(affected ? [...affected] : undefined);
        });
      } else if (!keys) {
        affected = undefined;
      } else if (affected) {
        for (const key of keys) {
          affected.add(key);
        }
      }
    });

    return () => {
      unsubscribe();
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [scope, refresh]);
  const refreshFamilyData = useCallback(async () => {
    const operation = operations.capture("account");
    const id = operation.account;
    if (!id || !navigator.onLine || familyActionPending.current) {
      return;
    }
    const version = ++familyRequest.current;
    const groups = await fetchFamily(id);
    if (operation.isCurrent() && version === familyRequest.current) {
      updateFamilies(groups);
      setVerifiedFamilyAccount(id);
    }
  }, [operations, updateFamilies]);
  useEffect(() => {
    const id = session.account.account?.id;
    if (!id) {
      return;
    }
    let active = true;
    let inFlight = false;

    const refreshGroups = async () => {
      if (
        !active ||
        inFlight ||
        familyActionPending.current ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      inFlight = true;
      try {
        await refreshFamilyData();
      } catch {
      } finally {
        inFlight = false;
      }
    };

    void refreshGroups();
    const timer = setInterval(() => void refreshGroups(), 5000);
    window.addEventListener("online", refreshGroups);
    window.addEventListener("focus", refreshGroups);
    document.addEventListener("visibilitychange", refreshGroups);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", refreshGroups);
      window.removeEventListener("focus", refreshGroups);
      document.removeEventListener("visibilitychange", refreshGroups);
    };
  }, [session.account.account?.id, refreshFamilyData]);

  return {
    scope,
    workspace,
    personalWorkspace,
    familyCache,
    refreshFamilyData,
    verifiedFamilyAccount,
    selectedFamily,
    canWrite: canWriteNow(),
    canWriteNow,
    beginWrite,
    refresh,
    changeAccount,
    switchLibrary,
    familyChanged: (families: Family[]) => {
      if (renderedAccount.isCurrent()) {
        updateFamilies(families);
      }
    },
    membershipAction: (pending: boolean) => {
      if (renderedAccount.isCurrent()) {
        membershipAction(pending);
      }
    },
    hasGroup: (id: string) => cache.current.families.some((f) => f.id === id),
    captureGroup: (id: string) => {
      const operation = operations.capture("account");
      const generation = membershipGenerations.current.get(id) ?? 0;

      return () =>
        operation.isCurrent() &&
        generation === (membershipGenerations.current.get(id) ?? 0) &&
        cache.current.families.some((f) => f.id === id);
    },
    selectedGroup: selectedFamily
      ? (familyCache.families.find((f) => f.id === selectedFamily) ??
        familyCache.inactive.find((f) => f.id === selectedFamily))
      : undefined,
    copyDestinations: familyCache.families.filter((f) => f.id !== selectedFamily),
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
