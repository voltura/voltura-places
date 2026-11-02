import { useCallback, useEffect, useRef, useState } from "react";
import { cachedFamily, fetchFamily, storeFamilies } from "../foundation/family";
import { channel, readWorkspace, type Workspace } from "../foundation/library";
import type { AccountState } from "../foundation/account-contract";
import { visitOwner } from "../../shared/visits";
import { workspaceIdentity, type Family } from "../../shared/families";
import type { Session } from "./useSession";

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
  const readRequest = useRef(0);
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
  const refresh = useCallback(async () => {
    const operation = operations.capture();
    if (!operation.isCurrent()) {
      return;
    }
    const request = ++readRequest.current;
    try {
      const w = await readWorkspace(operation.workspace);
      const owner = visitOwner(operation.workspace);
      const personal = owner === operation.workspace ? w : await readWorkspace(owner);
      if (!operation.isCurrent() || request !== readRequest.current) {
        return;
      }
      setWorkspace(w);
      setPersonalWorkspace(personal);
    } catch {
      if (operation.isCurrent() && request === readRequest.current) {
        callbacks.current.onStorageError();
      }
    }
  }, [operations]);
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
      void refresh();
    },
    [operations, transition, refresh],
  );
  const membershipAction = useCallback((pending: boolean) => {
    familyActionPending.current = pending;
    familyRequest.current++;
  }, []);
  useEffect(() => {
    void refresh();

    const listener = () => void refresh();

    window.addEventListener("places-library", listener);
    channel?.addEventListener("message", listener);

    return () => {
      window.removeEventListener("places-library", listener);
      channel?.removeEventListener("message", listener);
    };
  }, [scope, refresh]);
  useEffect(() => {
    const id = session.account.account?.id;
    if (!id) {
      return;
    }
    const operation = operations.capture("account");
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
      const version = ++familyRequest.current;
      try {
        const groups = await fetchFamily(id);
        if (active && operation.isCurrent() && version === familyRequest.current) {
          updateFamilies(groups);
          setVerifiedFamilyAccount(id);
        }
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
  }, [session.account.account?.id, operations, updateFamilies]);

  return {
    scope,
    workspace,
    personalWorkspace,
    familyCache,
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
    selectedGroup: [...familyCache.families, ...familyCache.inactive].find(
      (f) => f.id === selectedFamily,
    ),
    copyDestinations: familyCache.families.filter((f) => f.id !== selectedFamily),
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
