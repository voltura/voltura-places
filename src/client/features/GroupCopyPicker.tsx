import { Users } from "lucide-react";
import type { Message } from "../foundation/i18n";

export function GroupCopyPicker({
  groups,
  busy,
  t,
  onChoose,
  onCancel,
}: {
  groups: { id: string; name: string }[];
  busy: boolean;
  t: (key: Message) => string;
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="stack copy-group-picker" aria-busy={busy}>
      <p>{t("copyToGroupBody")}</p>
      {groups.map((group) => (
        <button
          key={group.id}
          className="button outline"
          disabled={busy}
          onClick={() => onChoose(group.id)}
        >
          <Users size={20} aria-hidden="true" />
          <span>{group.name}</span>
        </button>
      ))}
      <button
        className="button outline subdued"
        disabled={busy}
        data-initial-focus
        onClick={onCancel}
      >
        {t("cancel")}
      </button>
    </div>
  );
}
