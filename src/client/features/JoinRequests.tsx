import { useEffect, useRef, useState } from "react";
import { Check, UserPlus, UserRoundX } from "lucide-react";
import { type Family } from "../../shared/families";
import { fetchFamily } from "../foundation/family";
import { type Message } from "../foundation/i18n";
import { api } from "../foundation/sync";
import { Sheet } from "../ui/Sheet";

export function JoinRequests({
  account,
  families,
  t,
  onChanged,
  onPending,
}: {
  account: string;
  families: Family[];
  t: (key: Message) => string;
  onChanged: (families: Family[]) => void;
  onPending: (pending: boolean) => void;
}) {
  const [deferred, setDeferred] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const requests = families
    .filter((group) => group.ownerId === account)
    .flatMap((group) =>
      group.requests.map((person) => ({ group, person, key: `${group.id}:${person.id}` })),
    );
  const request = requests.find((r) => review || !deferred.includes(r.key));
  const requestKeys = requests.map((r) => r.key).join(",");
  useEffect(() => {
    const current = new Set(requestKeys.split(","));
    setDeferred((previous) =>
      previous.some((key) => !current.has(key))
        ? previous.filter((key) => current.has(key))
        : previous,
    );
  }, [requestKeys]);
  useEffect(() => setError(null), [request?.key]);
  const close = () => {
    if (pending.current) return;
    setDeferred(requests.map((r) => r.key));
    setReview(false);
    setError(null);
  };
  const decide = async (action: "code-approve" | "code-reject") => {
    if (!request || pending.current) return;
    pending.current = true;
    onPending(true);
    setBusy(true);
    setError(null);
    try {
      await api(
        "/api/family",
        { action, familyId: request.group.id, member: request.person.id },
        account,
      );
      // Refresh authoritative membership; never grant access optimistically.
      const groups = await fetchFamily(account);
      if (active.current) onChanged(groups);
    } catch (e) {
      if (active.current) {
        const message = e instanceof Error ? e.message : "";
        setError(
          (
            ["familyCodeChanged", "familyOwnerOnly", "familyAccessEnded", "familyFull"] as string[]
          ).includes(message)
            ? (message as Message)
            : "serviceUnavailable",
        );
        try {
          const groups = await fetchFamily(account);
          if (active.current) onChanged(groups);
        } catch {}
      }
    } finally {
      pending.current = false;
      // An old account's completion must not release a new account's action lock.
      if (active.current) {
        onPending(false);
        setBusy(false);
      }
    }
  };
  if (!requests.length) return null;
  return (
    <>
      {!request && (
        <button
          className="button outline join-request-reminder"
          onClick={() => {
            setReview(true);
            setError(null);
          }}
        >
          <UserPlus size={20} aria-hidden="true" />
          {t("familyRequests")} · {requests.length}
        </button>
      )}
      {request && (
        <Sheet title={t("familyRequests")} onClose={close} closeLabel={t("close")}>
          <div className="stack">
            <p className="join-request-message">
              {t("familyWantsToJoin")
                .replace("{person}", request.person.label)
                .replace("{group}", request.group.name)}
            </p>
            {error && (
              <p className="notice error" role="alert">
                {t(error)}
              </p>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void decide("code-approve")}
            >
              <Check size={20} aria-hidden="true" />
              {t(busy ? "working" : "familyApprove")}
            </button>
            <button
              className="button outline danger"
              disabled={busy}
              onClick={() => void decide("code-reject")}
            >
              <UserRoundX size={20} aria-hidden="true" />
              {t("familyReject")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
