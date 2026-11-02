import { Copy, MapPin, Pencil, Share2, Trash2, Users } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import { GroupCopyPicker } from "../features/GroupCopyPicker";
import type { Sharing } from "./useSharing";
import type { PlaceEditing } from "./usePlaceEditing";
import type { WorkspaceController } from "./useWorkspace";
import type { Session } from "./useSession";
import type { Place } from "../../shared/model";
import type { Message } from "../foundation/i18n";

export function SharingDialogs({
  sharing,
  editing,
  workspaceController,
  session,
  reconciling,
  t,
  openMaps,
}: {
  sharing: Sharing;
  editing: PlaceEditing;
  workspaceController: WorkspaceController;
  session: Session;
  reconciling: boolean;
  t: (key: Message) => string;
  openMaps: (place: Place) => void;
}) {
  const {
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
    copyToFamily,
    share,
  } = sharing;
  const { scope, canWrite, workspace, copyDestinations } = workspaceController;
  const { account } = session;
  const { setEditor, setDeletePlace } = editing;

  return (
    <>
      {sharePlace && (
        <Sheet
          key={copyGroupPicker ? "share-group" : "share-place"}
          title={copyGroupPicker ? t("shareToGroup") : t("share")}
          onClose={() => setSharePlace(null)}
          closeLabel={t("close")}
        >
          <h3>{sharePlace.value.name}</h3>
          {copyGroupPicker ? (
            <GroupCopyPicker
              groups={copyDestinations}
              busy={copyingToGroup}
              t={t}
              onChoose={(id) => void copyToFamily(sharePlace.id, id)}
              onCancel={() => setCopyGroupPicker(false)}
            />
          ) : (
            <div className="stack">
              {account.account && canWrite && copyDestinations.length > 0 && (
                <button
                  className="button primary"
                  disabled={copyingToGroup}
                  onClick={() => setCopyGroupPicker(true)}
                >
                  <Users size={19} aria-hidden="true" />
                  {t("shareToGroup")}
                </button>
              )}
              <button className="button outline" onClick={() => void share(sharePlace)}>
                <Share2 size={19} aria-hidden="true" />
                {t("shareLink")}
              </button>
              <p className="muted">{t("shareNotice")}</p>
              <p className="muted small">{t("photoHint")}</p>
            </div>
          )}
        </Sheet>
      )}
      {shared && (
        <Sheet title={t("sharedTitle")} onClose={() => setShared(null)} closeLabel={t("close")}>
          <div className="stack">
            <div className="section-icon">
              <MapPin />
            </div>
            <h3>{shared.name}</h3>
            {shared.description && <p className="place-description">{shared.description}</p>}
            <p className="muted">
              {shared.category} · {shared.latitude.toFixed(6)}, {shared.longitude.toFixed(6)}
            </p>
            <button
              className="button primary"
              disabled={savingShared || !workspace || reconciling || !canWrite}
              onClick={() => void sharing.saveShared()}
            >
              {t("saveCopy")}
            </button>
            <button
              className="button outline"
              onClick={() => {
                openMaps({
                  name: shared.name,
                  latitude: shared.latitude,
                  longitude: shared.longitude,
                } as Place);
                setShared(null);
              }}
            >
              {t("openMaps")}
            </button>
          </div>
        </Sheet>
      )}
      {menu && (
        <Sheet
          key={copyGroupPicker ? "copy-group" : "place-menu"}
          title={copyGroupPicker ? t("copyToGroup") : menu.value.name}
          onClose={() => setMenu(null)}
          closeLabel={t("close")}
        >
          {copyGroupPicker ? (
            <GroupCopyPicker
              groups={copyDestinations}
              busy={copyingToGroup}
              t={t}
              onChoose={(id) => void copyToFamily(menu.id, id)}
              onCancel={() => setCopyGroupPicker(false)}
            />
          ) : (
            <div className="stack place-actions">
              <button
                className="button outline"
                disabled={!canWrite}
                onClick={() => {
                  setEditor({ entity: menu });
                  setMenu(null);
                }}
              >
                <Pencil size={18} />
                {t("editAction")}
              </button>
              <button
                className="button outline"
                onClick={() => {
                  setSharePlace(menu);
                  setMenu(null);
                }}
              >
                <Share2 size={18} />
                {t("shareAction")}
              </button>
              {account.account && canWrite && copyDestinations.length > 0 && (
                <button
                  className="button outline copy-group-action"
                  disabled={copyingToGroup}
                  onClick={() =>
                    copyDestinations.length === 1
                      ? void copyToFamily(menu.id, copyDestinations[0].id)
                      : setCopyGroupPicker(true)
                  }
                >
                  <Copy size={18} aria-hidden="true" />
                  <span>
                    {copyDestinations.length === 1
                      ? `${t("copyTo")} ${copyDestinations[0].name}`
                      : `${t("copyToGroup")}…`}
                  </span>
                </button>
              )}
              <button
                className="button danger"
                disabled={!canWrite}
                onClick={() => setDeletePlace({ place: menu, scope })}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t("delete")}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
