import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  categoryNameDraft,
  categoryNameValue,
  type CategoryLanguage,
} from "../../shared/category-names";
import { categorySchema, type Entity, type LocalRecord } from "../../shared/model";
import { categoryAppearance, CategoryAppearancePicker, CategoryIcon } from "./CategoryAppearance";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

/** The form owns its transient edits; composition owns the durable workspace write. */
export function CategoryEditor({
  entity,
  language,
  t,
  onSave,
  onClose,
  onError,
}: {
  entity?: LocalRecord;
  language: CategoryLanguage;
  t: (key: Message) => string;
  onSave: (entity: Entity, base?: Entity) => Promise<void>;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const [categoryEdit, setCategoryEdit] = useState(() => ({
    entity,
    ...categoryNameDraft(entity?.kind === "category" ? entity.value : undefined, language),
    ...categoryAppearance(entity),
  }));
  const [savingCategory, setSavingCategory] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
    };
  }, []);

  async function submit() {
    if (pending.current) {
      return;
    }
    const original = categoryEdit.entity;
    const parsed = categorySchema.safeParse({
      ...categoryNameValue(
        original?.kind === "category" ? original.value : undefined,
        categoryEdit,
      ),
      color: categoryEdit.color,
      icon: categoryEdit.icon,
    });
    if (!parsed.success) {
      return;
    }
    pending.current = true;
    setSavingCategory(true);
    try {
      await onSave(
        { id: original?.id ?? crypto.randomUUID(), kind: "category", value: parsed.data },
        original,
      );
      if (active.current) {
        onClose();
      }
    } catch (error) {
      if (active.current) {
        onError(error);
      }
    } finally {
      pending.current = false;
      if (active.current) {
        setSavingCategory(false);
      }
    }
  }

  return (
    <Sheet
      title={t(categoryEdit.entity ? "editCategory" : "newCategory")}
      onClose={() => {
        if (!savingCategory) {
          onClose();
        }
      }}
      className="category-editor-sheet"
      closeLabel={t("close")}
    >
      <form
        className="category-editor-form"
        inert={savingCategory}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="stack category-editor-body">
          <div className="category-name-editor">
            <div className="category-name-heading">
              <label htmlFor="category-name">{t("name")}</label>
              <div className="category-name-language">
                <img
                  className="language-flag"
                  src={`/flags/${categoryEdit.nameLanguage === "sv" ? "se" : "gb"}.svg`}
                  alt=""
                  width="24"
                  height="18"
                />
                <select
                  aria-label={t("categoryNameLanguage")}
                  value={categoryEdit.nameLanguage}
                  onChange={(event) =>
                    setCategoryEdit({
                      ...categoryEdit,
                      nameLanguage: event.target.value as CategoryLanguage,
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="sv">Svenska</option>
                </select>
              </div>
            </div>
            <span
              className={`category-name-field ${categoryEdit.icon === "none" ? "no-icon" : ""}`}
            >
              {categoryEdit.icon !== "none" && (
                <span className="category-name-preview" aria-hidden="true">
                  <CategoryIcon icon={categoryEdit.icon} color={categoryEdit.color} size={22} />
                </span>
              )}
              <input
                id="category-name"
                value={categoryEdit.names[categoryEdit.nameLanguage] ?? ""}
                placeholder={categoryEdit.names.en || categoryEdit.names.sv || ""}
                maxLength={60}
                required={!Object.values(categoryEdit.names).some((name) => name?.trim())}
                onChange={(e) =>
                  setCategoryEdit({
                    ...categoryEdit,
                    names: {
                      ...categoryEdit.names,
                      [categoryEdit.nameLanguage]: e.target.value,
                    },
                    namesChanged: true,
                  })
                }
              />
            </span>
            <p className="muted small category-name-hint">{t("categoryNameHint")}</p>
          </div>
          <CategoryAppearancePicker
            icon={categoryEdit.icon}
            color={categoryEdit.color}
            t={t}
            onChange={(change) => setCategoryEdit({ ...categoryEdit, ...change })}
          />
        </div>
        <div className="category-editor-footer">
          <button className="button primary" disabled={savingCategory}>
            {!savingCategory && <Check size={20} aria-hidden="true" />}
            {t(savingCategory ? "working" : "save")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
