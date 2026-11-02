import { useCallback, useEffect, useRef, useState } from "react";
import { cachedAccount, currentAccount, signOutLocally } from "../foundation/account";
import type { AccountState } from "../foundation/account-contract";
import { initialWorkspace } from "../foundation/family";
import { Operations } from "./operations";
import { api } from "../foundation/http";
import { removeAccountWorkspaces } from "../foundation/library";
import type { Message } from "../foundation/i18n";

export function useSession(
  onIdentityChange: (next: AccountState) => void,
  onError: (key: Message, error?: boolean) => void,
) {
  const [account, setAccount] = useState(cachedAccount);
  const [operations] = useState(
    () => new Operations(account.account?.id, initialWorkspace(account.account?.id)),
  );
  const callbacks = useRef(onIdentityChange);
  callbacks.current = onIdentityChange;
  const errors = useRef(onError);
  errors.current = onError;
  const request = useRef(0);
  const connection = useRef<Promise<unknown> | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    operations.activate();

    return () => {
      active.current = false;
      request.current++;
      operations.dispose();
    };
  }, [operations]);
  const accept = useCallback(
    (next: AccountState) => {
      const changed = operations.account !== next.account?.id;
      operations.changeAccount(next.account?.id);
      if (changed) {
        callbacks.current(next);
      }
      setAccount((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    },
    [operations],
  );
  const refreshAccount = useCallback(async () => {
    if (!active.current) {
      return;
    }
    const version = ++request.current;
    try {
      const next = await currentAccount();
      if (active.current && version === request.current) {
        accept(next);
      }
    } catch (error) {
      if (active.current && version === request.current) {
        throw error;
      }
    }
  }, [accept]);
  const discardStaleIdentity = useCallback(() => {
    if (operations.account && cachedAccount().account?.id !== operations.account) {
      request.current++;
      accept({ ...account, account: null });
    }
  }, [account, accept, operations]);

  const signOut = useCallback(async () => {
    const id = operations.account;
    request.current++;
    // Invalidate before any await, including a repeated guest logout.
    operations.invalidate();
    accept({ ...account, account: null });
    await signOutLocally(id);
    if (active.current) {
      await refreshAccount().catch(() => {});
    }
  }, [account, accept, operations, refreshAccount]);

  const deleteAccount = async () => {
    const operation = operations.capture("account");
    if (!operation.account) {
      return;
    }
    await api("/api/account", { confirm: "delete-places-account" }, operation.account, "DELETE");
    if (operation.isCurrent()) {
      await signOut();
    }
    await removeAccountWorkspaces(operation.account);
  };

  const removeDevice = async () => {
    const id = operations.account;
    if (!id) {
      return;
    }
    await signOut();
    await removeAccountWorkspaces(id);
  };

  useEffect(() => {
    let current = true;
    const url = new URL(location.href);
    const value = url.searchParams.get("account");

    const clearReturnParameter = () => {
      url.searchParams.delete("account");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    };

    const operation = operations.capture("account");
    if (value && /^(google|chatgpt)(-link)?$/.test(value)) {
      connection.current = api("/api/account/connect", {
        provider: value.startsWith("google") ? "google" : "chatgpt",
        linking: value.endsWith("-link"),
      });
      clearReturnParameter();
    }
    // Replay the subscription, not the connect request, under React StrictMode.
    if (connection.current) {
      void connection.current
        .then(() => {
          if (current) {
            return refreshAccount();
          }
        })
        .catch(() => {
          if (current && operation.isCurrent()) {
            errors.current("serviceUnavailable", true);
          }
        });
    }
    if (value === "error") {
      errors.current("serviceUnavailable", true);
      clearReturnParameter();
    }

    return () => {
      current = false;
    };
  }, [operations, refreshAccount]);

  return {
    account,
    operations,
    refreshAccount,
    discardStaleIdentity,
    signOut,
    deleteAccount,
    removeDevice,
  };
}

export type Session = ReturnType<typeof useSession>;
