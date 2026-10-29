import { MapPin, Check } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <MapPin size={27} />
        <Check className="brand-check" size={10} />
      </span>
      <span>
        voltura <strong>places</strong>
      </span>
    </div>
  );
}
export function TrailArt() {
  return (
    <svg className="trail-art" viewBox="0 0 400 240" fill="none" aria-hidden="true">
      <path
        d="M-30 196c78-110 118 61 191-24s154-114 270-66M-29 166c66-100 128 53 177-23s174-110 281-65M-22 136c71-83 109 53 153-19s194-102 295-66M-12 107c52-71 100 42 131-13s171-96 297-71"
        stroke="currentColor"
        opacity=".16"
      />
      <path
        d="M60 209c25-44 18-55 73-64s56-38 70-74"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="5 7"
        strokeLinecap="round"
        opacity=".6"
      />
      <circle cx="60" cy="209" r="6" fill="currentColor" />
      <path
        d="M204 21c-21 0-37 16-37 36 0 27 37 58 37 58s37-31 37-58c0-20-16-36-37-36Z"
        fill="currentColor"
      />
      <circle cx="204" cy="57" r="12" fill="var(--surface)" />
      <path
        d="m291 149 15-28 15 28h-9v13h-12v-13Zm-19 38 12-23 12 23h-7v10h-10v-10Z"
        fill="currentColor"
        opacity=".4"
      />
    </svg>
  );
}
