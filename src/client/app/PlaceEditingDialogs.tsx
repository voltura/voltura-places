import { Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Editor } from "../features/Editor";
import { CategoryEditor } from "../features/CategoryEditor";
import { LocationReview } from "../features/LocationReview";
import { Sheet } from "../ui/Sheet";
import { libraryErrorMessage, type Message } from "../foundation/i18n";
import type { Preferences } from "../foundation/preferences";
import type { LocalRecord, PlaceRecord } from "../../shared/model";
import type { PlaceEditing } from "./usePlaceEditing";
import type { Operation } from "./operations";

export function PlaceEditingDialogs({
  editing,
  scope,
  canWrite,
  categories,
  places,
  categoryLabel,
  prefs,
  t,
  notify,
  update,
  onUpdate,
  renderedOperation,
  setFilter,
}: {
  editing: PlaceEditing;
  scope: string;
  canWrite: boolean;
  categories: LocalRecord[];
  places: PlaceRecord[];
  categoryLabel: (r: LocalRecord) => string;
  prefs: Preferences;
  t: (key: Message) => string;
  notify: (key: Message, error?: boolean) => void;
  update: boolean;
  onUpdate: () => Promise<void>;
  renderedOperation: Operation;
  setFilter: Dispatch<SetStateAction<string>>;
}) {
  const {
    editor,
    setEditor,
    categoryEdit,
    setCategoryEdit,
    deletePlace,
    setDeletePlace,
    deletingPlace,
    deleteCategory,
    setDeleteCategory,
    deletingCategory,
    gpsReview,
    setGpsReview,
    save,
    remove,
  } = editing;

  return (
    <>
      {editor && (
        <Editor
          key={`${scope}-${editor.entity?.id ?? editor.draftId ?? "new"}`}
          entity={editor.entity}
          fresh={editor.fresh}
          draftId={editor.draftId}
          categories={categories}
          categoryLabel={categoryLabel}
          t={t}
          units={prefs.units}
          reviewGps={prefs.reviewGps}
          onClose={() => {
            if (renderedOperation.isCurrent()) {
              setEditor(null);
            }
          }}
          onSave={(value, base, visitedHere) => save(value, base, true, visitedHere)}
          onDelete={
            canWrite && editor.entity && !editor.fresh
              ? () => {
                  const place = places.find((p) => p.id === editor.entity?.id);
                  if (place) {
                    setDeletePlace({ place, scope });
                  }
                }
              : undefined
          }
          onDiscardPlace={editing.discardPlace}
          workspace={scope}
          updateReady={update}
          onUpdate={() => void onUpdate()}
        />
      )}
      {categoryEdit && (
        <CategoryEditor
          key={`${scope}:${categoryEdit.entity?.id ?? "new"}`}
          entity={categoryEdit.entity}
          language={prefs.language}
          t={t}
          onSave={save}
          onClose={() => setCategoryEdit(null)}
          onError={(error) => notify(libraryErrorMessage(error), true)}
        />
      )}
      {deleteCategory && deleteCategory.scope === scope && (
        <Sheet
          title={t("deleteCategory")}
          closeLabel={t("cancel")}
          onClose={() => {
            if (!deletingCategory) {
              setDeleteCategory(null);
            }
          }}
        >
          <div className="stack">
            <p>
              <strong>{categoryLabel(deleteCategory.entity)}</strong>
            </p>
            <p>{t("deleteCategoryBody")}</p>
            <div className="action-pair">
              <button
                className="button outline subdued"
                data-initial-focus
                disabled={deletingCategory}
                onClick={() => setDeleteCategory(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger confirm"
                disabled={deletingCategory || !canWrite}
                onClick={() => void editing.removeCategory(setFilter)}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t(deletingCategory ? "working" : "delete")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {deletePlace && deletePlace.scope === scope && (
        <Sheet
          title={t("deletePlace")}
          closeLabel={t("cancel")}
          onClose={() => {
            if (!deletingPlace) {
              setDeletePlace(null);
            }
          }}
        >
          <div className="stack">
            <p>
              <strong>{deletePlace.place.value.name}</strong>
            </p>
            <p>{t("deletePlaceBody")}</p>
            <div className="action-pair">
              <button
                className="button outline subdued"
                data-initial-focus
                disabled={deletingPlace}
                onClick={() => setDeletePlace(null)}
              >
                {t("cancel")}
              </button>
              <button
                className="button danger confirm"
                disabled={deletingPlace || !canWrite}
                onClick={() => void remove(deletePlace.place, deletePlace.scope)}
              >
                <Trash2 size={20} aria-hidden="true" />
                {t(deletingPlace ? "working" : "delete")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {gpsReview && (
        <LocationReview
          units={prefs.units}
          t={t}
          onClose={() => setGpsReview(false)}
          onConfirm={editing.confirmPosition}
        />
      )}
    </>
  );
}
