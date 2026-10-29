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
