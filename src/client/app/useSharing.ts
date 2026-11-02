import { useEffect, useRef, useState } from "react";
import { familyKey } from "../../shared/families";
import {
  parseShare,
  shareURL,
  type Entity,
  type LocalRecord,
  type PlaceRecord,
} from "../../shared/model";
import { shareOrCopy } from "../foundation/sharing";
import { copyPlaceToWorkspace } from "../foundation/library";
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
      if (!hash) {
        return;
      }
      const incoming = parseShare(hash);
      if (hash.startsWith("#place=")) {
        history.replaceState(history.state, "", location.pathname + location.search);
      }
      if (incoming) {
        sharedRevision.current++;
        setShared(incoming);
      } else {
        callbacks.current.notify("invalidShare", true);
      }
    };

    consume();
    window.addEventListener("hashchange", consume);

    return () => window.removeEventListener("hashchange", consume);
  }, []);

  async function copy(text: string) {
    const operation = operations.capture("account");
    try {
      await navigator.clipboard.writeText(text);
      if (operation.isCurrent()) {
        notify("copied");
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
    const category = categoryFor(p.value.categoryId);
    const url = shareURL(p.value, category ? categoryLabel(category) : t("other"), location.origin);
    try {
      const result = await shareOrCopy({ title: p.value.name, text: p.value.name, url }, url);
      if (!rendered.isCurrent()) {
        return;
      }
      if (result === "copied") {
        notify("shareReady");
      }
      if (result !== "dismissed") {
        setSharePlace(null);
      }
    } catch (error) {
      if (rendered.isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
        return copy(url);
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
      await copyPlaceToWorkspace(operation.workspace, key, id, isCurrent);
      if (!isCurrent()) {
        return;
      }
      await synchronize(key, () => {}, isCurrent);
      if (!isCurrent()) {
        return;
      }
      setMenu(null);
      setSharePlace(null);
      notify("copiedToGroup");
    } catch (error) {
      if (isCurrent()) {
        notify(libraryErrorMessage(error), true);
      }
    } finally {
      if (copyInProgress.current === pending) {
        copyInProgress.current = null;
        if (operation.isCurrent()) {
          setCopyingToGroup(false);
        }
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
    const cat = categories.find((c) => categoryLabel(c) === shared.category);
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
        notify("saved");
      }
    } catch {
      if (operation.isCurrent() && revision === sharedRevision.current) {
        notify("storageFailure", true);
      }
    } finally {
      if (sharedSavePending.current === pending) {
        sharedSavePending.current = null;
        if (operation.isCurrent()) {
          setSavingShared(false);
        }
      }
    }
  }

  const reset = () => {
    copyInProgress.current = null;
    sharedSavePending.current = null;
    setSharePlace(null);
    setMenu(null);
    setCopyGroupPicker(false);
    setCopyingToGroup(false);
    setSavingShared(false);
  };

  return {
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
