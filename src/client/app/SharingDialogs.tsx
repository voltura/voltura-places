import { Suspense } from "react";
import { DeferredPlacesMap } from "../features/DeferredPlacesMap";
import { familyKey } from "../../shared/families";
import { Copy, MapPin, Pencil, Share2, Trash2, Users, Map } from "lucide-react";
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
      {sharing.routeSnapshot && (
        <Sheet
          title={t("sharedRouteTitle")}
          onClose={() => sharing.setRouteSnapshot(null)}
          closeLabel={t("close")}
        >
          <div className="stack">
            <h3>{sharing.routeSnapshot.snapshot.route.name}</h3>
            <p>{sharing.routeSnapshot.snapshot.category.name}</p>
            <p className="place-description">{sharing.routeSnapshot.snapshot.route.description}</p>
            {sharing.routeSnapshot.snapshot.photo && (
              <img
                src={sharing.routeSnapshot.snapshot.photo}
                alt=""
                className="route-shared-photo"
              />
            )}
            <Suspense fallback={<p>{t("working")}</p>}>
              <DeferredPlacesMap
                preview
                places={[
                  {
                    id: sharing.routeSnapshot.id,
                    kind: "route",
                    value: sharing.routeSnapshot.snapshot.route,
                    revision: 0,
                    generation: 0,
                    deleted: false,
                    dirty: false,
                  },
                ]}
                selected={sharing.routeSnapshot.id}
                fitKey={sharing.routeSnapshot.id}
                onSelect={() => {}}
                categoryColor={() => sharing.routeSnapshot!.snapshot.category.color}
                t={t}
                geometry={{
                  [sharing.routeSnapshot.snapshot.route.geometryId]:
                    sharing.routeSnapshot.snapshot.geometry,
                }}
              />
            </Suspense>
            <label>
              {t("routeDestination")}
              <select
                aria-label={t("routeDestination")}
                name="route-destination"
                value=""
                disabled={sharing.routeShareBusy}
                onChange={(event) => {
                  if (event.target.value) {
                    void sharing.saveIncomingRoute(event.target.value);
                  }
                }}
              >
                <option value="" disabled>
                  {t("saveCopy")}
                </option>
                <option value={account.account?.id ?? "guest"}>
                  {t(account.account ? "privateLibrary" : "localOnly")}
                </option>
                {account.account &&
                  workspaceController.familyCache.families.map((group) => (
                    <option key={group.id} value={familyKey(account.account!.id, group.id)}>
                      {group.name}
                    </option>
                  ))}
              </select>
            </label>
            {sharing.routeShareError && (
              <p role="alert" className="error">
                {sharing.routeShareError}
              </p>
            )}
          </div>
        </Sheet>
      )}
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
              <button
                className="button outline"
                disabled={
                  sharing.routeShareBusy ||
                  (sharePlace.kind === "route" && (!account.account || !navigator.onLine))
                }
                onClick={() => void share(sharePlace)}
              >
                <Share2 size={19} aria-hidden="true" />
                {t("shareLink")}
              </button>
              {sharePlace.kind === "route" ? (
                <details className="muted small">
                  <summary>{t("routeShareSummary")}</summary>
                  <p>{t("routeShareNotice")}</p>
                </details>
              ) : (
                <p className="muted">{t("shareNotice")}</p>
              )}
              {sharePlace.kind === "route" ? (
                <>
                  <button
                    className="button outline"
                    disabled={sharing.routeShareBusy || !account.account || !navigator.onLine}
                    onClick={() => void sharing.revokeRoute(sharePlace.id)}
                  >
                    {t("routeRevoke")}
                  </button>
                  {sharing.routeShareError && (
                    <p role="alert" className="error">
                      {sharing.routeShareError}
                    </p>
                  )}
                </>
              ) : (
                <p className="muted small">{t("photoHint")}</p>
              )}
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
              <Copy size={20} aria-hidden="true" />
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
              <Map size={20} aria-hidden="true" />
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
