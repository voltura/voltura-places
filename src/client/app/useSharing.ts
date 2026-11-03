import { sameValue } from "../foundation/library-records";
import {
  createRouteShare,
  revokeRouteShare,
  fetchRouteShare,
  saveRouteSnapshot,
  type RouteSnapshot,
} from "../foundation/route-sharing";
import { synchronizeAndWait } from "../foundation/sync";
import { useEffect, useRef, useState } from "react";
import { categoryName } from "../../shared/category-names";
import { familyKey } from "../../shared/families";
import {
  parseShare,
  shareURL,
  type Entity,
  type LocalRecord,
  type PlaceRecord,
} from "../../shared/model";
import { shareOrCopy } from "../foundation/sharing";
import { readWorkspace, copyPlaceToWorkspace } from "../foundation/library";
import { synchronize } from "../foundation/sync";
import { libraryErrorMessage, type Message } from "../foundation/i18n";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";

export function useSharing({
  session,
  workspace,
  categories,
  categoryFor,
  categoryLabel,
  save,
  t,
  notify,
  showText,
}: {
  session: Session;
  workspace: WorkspaceController;
  categories: LocalRecord[];
  categoryFor: (id: string) => LocalRecord | undefined;
  categoryLabel: (r: LocalRecord) => string;
  save: (entity: Entity) => Promise<void>;
  t: (key: Message) => string;
  notify: (key: Message, error?: boolean) => void;
  showText: (text: string) => void;
}) {
  const { operations } = session;
  const rendered = operations.capture();
  const [routeSnapshot, setRouteSnapshot] = useState<{
    id: string;
    snapshot: RouteSnapshot;
  } | null>(null);
  const [routeShareBusy, setRouteShareBusy] = useState(false);
  const [routeShareError, setRouteShareError] = useState("");
  const [shared, setShared] = useState(() => parseShare(location.hash));
  const [sharePlace, setSharePlace] = useState<PlaceRecord | null>(null);
  const [menu, setMenu] = useState<PlaceRecord | null>(null);
  const [copyGroupPicker, setCopyGroupPicker] = useState(false);
  const [copyingToGroup, setCopyingToGroup] = useState(false);
  const [savingShared, setSavingShared] = useState(false);
  const copyInProgress = useRef<symbol | null>(null);
  const sharedSavePending = useRef<symbol | null>(null);
  const sharedRevision = useRef(0);
  const callbacks = useRef({ notify });
  callbacks.current = { notify };
  useEffect(() => setCopyGroupPicker(false), [menu, sharePlace]);
  useEffect(() => {
    const consume = () => {
      const hash = location.hash;
      if (hash.startsWith("#route=")) {
        history.replaceState(history.state, "", location.pathname + location.search);
        const token = hash.slice(7);
        if (/^[a-f0-9]{64}$/.test(token)) {
          const revision = ++sharedRevision.current;
          void fetchRouteShare(token)
            .then((snapshot) => {
              if (revision === sharedRevision.current) {
                setRouteSnapshot({ id: crypto.randomUUID(), snapshot });
              }
            })
            .catch(() => callbacks.current.notify("invalidShare", true));
        } else {
          callbacks.current.notify("invalidShare", true);
        }

        return;
      }
      if (!hash.startsWith("#place=")) {
        return;
      }
      const incoming = parseShare(hash);
      history.replaceState(history.state, "", location.pathname + location.search);
      sharedRevision.current++;
      setShared(incoming);
      if (!incoming) {
        callbacks.current.notify("invalidShare", true);
      }
    };

    consume();
    window.addEventListener("hashchange", consume);

    return () => window.removeEventListener("hashchange", consume);
  }, []);

  async function copy(text: string) {
    const operation = rendered;
    if (!operation.isCurrent()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (operation.isCurrent()) {
        notify("copied");

        return;
      }
    } catch {
      if (operation.isCurrent()) {
        showText(text);
      }
    }
  }

  async function share(p: PlaceRecord) {
    if (!rendered.isCurrent()) {
      return;
    }
    if (p.kind === "route") {
      setRouteShareBusy(true);
      setRouteShareError("");
      try {
        if (!operations.account || !navigator.onLine) {
          throw new Error("shareUnavailable");
        }
        await synchronizeAndWait(workspace.scope, () => {}, rendered.isCurrent);
        if (!rendered.isCurrent()) {
          return;
        }
        const latest = (await readWorkspace(workspace.scope)).records.find((r) => r.id === p.id);
        if (
          !latest ||
          latest.deleted ||
          latest.dirty ||
          latest.conflict ||
          latest.revision < 1 ||
          !sameValue(latest.value, p.value)
        ) {
          throw new Error("shareUnavailable");
        }
        const url = await createRouteShare(workspace.scope, p.id);
        if (rendered.isCurrent()) {
          await copy(url);
          notify("shareReady");
        }
      } catch {
        if (rendered.isCurrent()) {
          setRouteShareError(t("routeShareFailed"));
        }
      } finally {
        if (rendered.isCurrent()) {
          setRouteShareBusy(false);
        }
      }

      return;
    }
    const category = categoryFor(p.value.categoryId);
    const url = shareURL(p.value, category ? categoryLabel(category) : t("other"), location.origin);
    try {
      const data = { title: p.value.name, text: p.value.name, url };
      const result = await shareOrCopy(data, url, rendered.isCurrent);
      if (!rendered.isCurrent()) {
        return;
      }
      if (result === "copied") {
        notify("shareReady");
      }
      if (result !== "dismissed") {
        setSharePlace((current) => (current === p ? null : current));
      }
    } catch (error) {
      if (rendered.isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
        showText(url);
      }
    }
  }

  async function copyToFamily(id: string, groupId: string) {
    if (
      copyInProgress.current ||
      !operations.account ||
      !workspace.canWriteNow() ||
      groupId === workspace.selectedFamily ||
      !workspace.hasGroup(groupId) ||
      !rendered.isCurrent()
    ) {
      return;
    }
    const operation = workspace.beginWrite();
    const destinationCurrent = workspace.captureGroup(groupId);

    const isCurrent = () => operation.isCurrent() && destinationCurrent();

    const pending = Symbol();
    copyInProgress.current = pending;
    setCopyingToGroup(true);
    try {
      const key = familyKey(operation.account!, groupId);
      const { copied } = await copyPlaceToWorkspace(operation.workspace, key, id, isCurrent);
      // Once the destination commit succeeds, its upload belongs to that
      // membership, even if the user starts browsing another source workspace.
      if (destinationCurrent()) {
        void synchronize(key, () => {}, destinationCurrent).catch(() => {});
      }
      if (!isCurrent()) {
        return;
      }
      setMenu((current) => (current === menu ? null : current));
      setSharePlace((current) => (current === sharePlace ? null : current));
      notify(copied ? "copiedToGroup" : "alreadyInGroup");
    } catch (error) {
      if (isCurrent()) {
        notify(libraryErrorMessage(error), true);
      }
    } finally {
      if (copyInProgress.current === pending) {
        copyInProgress.current = null;
        setCopyingToGroup(false);
      }
    }
  }

  async function saveShared() {
    if (!shared || sharedSavePending.current || !rendered.isCurrent()) {
      return;
    }
    const operation = workspace.beginWrite();
    if (!operation.isCurrent()) {
      return;
    }
    const pending = Symbol();
    sharedSavePending.current = pending;
    setSavingShared(true);
    const revision = sharedRevision.current;
    const now = new Date().toISOString();
    const cat =
      categories.find((c) => categoryLabel(c) === shared.category) ??
      categories.find(
        (c) =>
          c.kind === "category" &&
          (categoryName(c.value, "en") === shared.category ||
            categoryName(c.value, "sv") === shared.category),
      );
    try {
      await save({
        id: crypto.randomUUID(),
        kind: "place",
        value: {
          name: shared.name,
          ...(shared.description ? { description: shared.description } : {}),
          latitude: shared.latitude,
          longitude: shared.longitude,
          accuracy: null,
          capturedAt: now,
          updatedAt: now,
          categoryId: cat?.id ?? "other",
        },
      });
      if (operation.isCurrent() && revision === sharedRevision.current) {
        setShared(null);
      }
    } catch (error) {
      if (operation.isCurrent() && revision === sharedRevision.current) {
        notify(libraryErrorMessage(error), true);
      }
    } finally {
      if (sharedSavePending.current === pending) {
        sharedSavePending.current = null;
        setSavingShared(false);
      }
    }
  }

  const revokeRoute = async (id: string) => {
    setRouteShareBusy(true);
    try {
      await revokeRouteShare(workspace.scope, id);
      if (rendered.isCurrent()) {
        notify("routeRevoked");
      }
    } catch {
      if (rendered.isCurrent()) {
        setRouteShareError(t("routeShareFailed"));
      }
    } finally {
      if (rendered.isCurrent()) {
        setRouteShareBusy(false);
      }
    }
  };

  const saveIncomingRoute = async (destination: string) => {
    if (!routeSnapshot || routeShareBusy) {
      return;
    }
    const op = operations.capture("account");
    const family = destination.startsWith("family:") ? destination.split(":")[2] : null;
    const destinationCurrent = family
      ? workspace.captureGroup(family)
      : () => op.account === operations.account;

    const current = () =>
      op.isCurrent() &&
      destinationCurrent() &&
      (family
        ? destination === familyKey(op.account!, family)
        : destination === (op.account ?? "guest"));

    setRouteShareBusy(true);
    setRouteShareError("");
    try {
      await saveRouteSnapshot(destination, routeSnapshot.id, routeSnapshot.snapshot, current);
      if (current()) {
        setRouteSnapshot(null);
        await workspace.refresh();
        notify("saved");
        if (destination !== "guest") {
          void synchronize(destination, () => {}, current);
        }
      }
    } catch {
      if (op.isCurrent()) {
        setRouteShareError(t("routeDestinationFailed"));
      }
    } finally {
      if (op.isCurrent()) {
        setRouteShareBusy(false);
      }
    }
  };

  const reset = () => {
    setRouteShareBusy(false);
    copyInProgress.current = null;
    sharedSavePending.current = null;
    setSharePlace(null);
    setMenu(null);
    setCopyGroupPicker(false);
    setCopyingToGroup(false);
    setSavingShared(false);
  };

  return {
    routeSnapshot,
    setRouteSnapshot,
    routeShareBusy,
    routeShareError,
    revokeRoute,
    saveIncomingRoute,
    shared,
    setShared,
    sharePlace,
    setSharePlace,
    menu,
    setMenu,
    copyGroupPicker,
    setCopyGroupPicker,
    copyingToGroup,
    savingShared,
    copy,
    share,
    copyToFamily,
    saveShared,
    reset,
  };
}

export type Sharing = ReturnType<typeof useSharing>;
