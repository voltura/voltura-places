import {
  MapPin,
  Car,
  Utensils,
  Trees,
  House,
  Coffee,
  Tent,
  Fish,
  Camera,
  Heart,
  Star,
  Dog,
  Bike,
  Sailboat,
  ShoppingBag,
  Flag,
  Flower2,
  Mountain,
  Waves,
  BookOpen,
  Music,
  Plane,
  Wrench,
  Check,
} from "lucide-react";
import type { Category, LocalRecord } from "../../shared/model";
import { categoryIcons, categoryColors } from "../../shared/model";
import type { Message } from "../foundation/i18n";
function Mushroom({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 13a9 9 0 0 1 18 0Z" />
      <path d="M9 13v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-6" />
      <path d="M8 9h.01M12 6h.01M16 10h.01" />
    </svg>
  );
}
const icons = {
  pin: MapPin,
  car: Car,
  utensils: Utensils,
  trees: Trees,
  house: House,
  mushroom: Mushroom,
  coffee: Coffee,
  tent: Tent,
  fish: Fish,
  camera: Camera,
  heart: Heart,
  star: Star,
  dog: Dog,
  bike: Bike,
  boat: Sailboat,
  shopping: ShoppingBag,
  flag: Flag,
  flower: Flower2,
  mountain: Mountain,
  waves: Waves,
  book: BookOpen,
  music: Music,
  plane: Plane,
  wrench: Wrench,
};
const defaults: Record<string, NonNullable<Category["icon"]>> = {
  parking: "car",
  food: "utensils",
  outdoors: "trees",
  accommodation: "house",
  mushrooms: "mushroom",
  other: "pin",
};
export function categoryAppearance(record?: LocalRecord) {
  const v = record?.kind === "category" ? record.value : undefined;
  return {
    icon: v?.icon ?? defaults[v?.builtIn ?? ""] ?? "pin",
    color:
      v?.builtIn === "mushrooms" && !v.icon && v.color === "amber" ? "rose" : (v?.color ?? "slate"),
  };
}
export function CategoryIcon({
  record,
  icon,
  color,
  size = 22,
}: {
  record?: LocalRecord;
  icon?: Category["icon"];
  color?: string;
  size?: number;
}) {
  const a = categoryAppearance(record),
    Icon = icons[icon ?? a.icon];
  return (
    <span className={`category-icon ${color ?? a.color}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
export function CategoryAppearancePicker({
  icon,
  color,
  onChange,
  t,
}: {
  icon: NonNullable<Category["icon"]>;
  color: string;
  onChange: (c: { icon?: NonNullable<Category["icon"]>; color?: string }) => void;
  t: (key: Message) => string;
}) {
  return (
    <div className="stack category-appearance-picker">
      <fieldset>
        <legend>{t("color")}</legend>
        <div className="color-swatches">
          {categoryColors.map((c) => (
            <button
              type="button"
              key={c}
              className={`color-swatch ${c}`}
              aria-label={t(c)}
              aria-pressed={color === c}
              onClick={() => onChange({ color: c })}
            >
              <span />
              {color === c && <Check size={18} className="swatch-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{t("categoryIcon")}</legend>
        <div className="category-icon-grid">
          {categoryIcons.map((i) => (
            <button
              type="button"
              key={i}
              aria-label={t(`icon_${i}`)}
              title={t(`icon_${i}`)}
              aria-pressed={icon === i}
              onClick={() => onChange({ icon: i })}
            >
              <CategoryIcon icon={i} color={color} />
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
