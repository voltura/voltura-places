import { useLayoutEffect, useRef, useState } from "react";
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
  Footprints,
  Route,
  Binoculars,
  Bird,
  Cat,
  Leaf,
  Sun,
  Snowflake,
  Flame,
  Droplets,
  Palmtree,
  Castle,
  Church,
  Landmark,
  Hospital,
  BedDouble,
  Store,
  Fuel,
  TrainFront,
  Bus,
  Ship,
  Dumbbell,
  Volleyball,
  Wine,
  IceCreamCone,
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
  footprints: Footprints,
  route: Route,
  binoculars: Binoculars,
  bird: Bird,
  cat: Cat,
  leaf: Leaf,
  sun: Sun,
  snowflake: Snowflake,
  flame: Flame,
  water: Droplets,
  palm: Palmtree,
  castle: Castle,
  church: Church,
  landmark: Landmark,
  hospital: Hospital,
  bed: BedDouble,
  store: Store,
  fuel: Fuel,
  train: TrainFront,
  bus: Bus,
  ship: Ship,
  dumbbell: Dumbbell,
  volleyball: Volleyball,
  wine: Wine,
  icecream: IceCreamCone,
};
const defaults: Record<string, NonNullable<Category["icon"]>> = {
  parking: "car",
  food: "utensils",
  outdoors: "trees",
  accommodation: "house",
  mushrooms: "mushroom",
  route: "route",
  other: "pin",
};

export function categoryAppearance(record?: LocalRecord) {
  const v = record?.kind === "category" ? record.value : undefined;

  return {
    icon:
      v?.icon ?? (v?.builtIn && Object.hasOwn(defaults, v.builtIn) ? defaults[v.builtIn] : "pin"),
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
  const a = categoryAppearance(record);
  const selected = icon ?? a.icon;
  if (selected === "none") {
    return null;
  }
  const Icon = icons[selected];

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
  color: Category["color"];
  onChange: (c: { icon?: NonNullable<Category["icon"]>; color?: Category["color"] }) => void;
  t: (key: Message) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollIcons, setScrollIcons] = useState(false);
  useLayoutEffect(() => {
    const picker = ref.current!;
    const body = picker.closest<HTMLElement>(".category-editor-body");
    const sheet = picker.closest<HTMLElement>(".category-editor-sheet");
    if (!body || !sheet) {
      return;
    }
    const name = body.querySelector(".category-name-editor")!;
    const colors = picker.querySelector("fieldset")!;
    const heading = picker.querySelector(".category-icons-heading")!;

    const measure = () => {
      const viewport = window.visualViewport;
      sheet.style.setProperty(
        "--category-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      const style = getComputedStyle(body);
      const fixedHeight =
        name.getBoundingClientRect().height +
        colors.getBoundingClientRect().height +
        heading.getBoundingClientRect().height +
        8 +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.gap) +
        parseFloat(getComputedStyle(picker).gap);
      // Reserve at least two complete 48px icon rows before pinning the fields.
      setScrollIcons(body.clientHeight - fixedHeight >= 104);
    };

    const observer = new ResizeObserver(measure);
    for (const element of [body, name, colors, heading]) {
      observer.observe(element);
    }
    window.visualViewport?.addEventListener("resize", measure);
    measure();

    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      sheet.style.removeProperty("--category-viewport-height");
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`stack category-appearance-picker ${scrollIcons ? "scroll-icons" : ""}`}
    >
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
      <div className="category-icons-section" role="group" aria-label={t("categoryIcon")}>
        <div className="category-icons-heading">{t("categoryIcon")}</div>
        <div className="category-icon-scroll">
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
                {i === "none" ? (
                  <span className="category-no-icon" aria-hidden="true" />
                ) : (
                  <CategoryIcon icon={i} color={color} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
