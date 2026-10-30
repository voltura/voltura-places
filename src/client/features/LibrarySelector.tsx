import { ChevronDown, LockKeyhole, Users } from "lucide-react";

export function LibrarySelector({
  value,
  privateValue,
  privateLabel,
  label,
  groups,
  onChange,
}: {
  value: string;
  privateValue: string;
  privateLabel: string;
  label: string;
  groups: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const shared = value !== privateValue;
  const selected = groups.find((group) => group.value === value)?.label ?? privateLabel;
  const Icon = shared ? Users : LockKeyhole;
  return (
    <div className="library-selector">
      <div className="library-selector-label" aria-hidden="true">
        <Icon size={22} />
        <span>{selected}</span>
        <ChevronDown size={20} />
      </div>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={privateValue}>
          <LockKeyhole size={22} aria-hidden="true" />
          <span>{privateLabel}</span>
        </option>
        {groups.map((group) => (
          <option key={group.value} value={group.value}>
            <Users size={22} aria-hidden="true" />
            <span>{group.label}</span>
          </option>
        ))}
      </select>
    </div>
  );
}
