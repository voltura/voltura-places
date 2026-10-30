import type { Place } from "../../shared/model";
import { messages } from "./i18n";

const generatedNames = (["en", "sv"] as const).map((language) => ({
  prefix: `${messages(language)("currentLocation")} · `,
  format: new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
}));

// Recognise existing generated names without changing saved records or custom names.
export function dateAppearsInPlaceName(place: Pick<Place, "name" | "capturedAt" | "updatedAt">) {
  return generatedNames.some(({ prefix, format }) => {
    if (!place.name.startsWith(prefix)) return false;
    return [place.capturedAt, place.updatedAt].some(
      (value) => place.name === prefix + format.format(new Date(value)),
    );
  });
}

export function placeDetailsName(place: Pick<Place, "name" | "capturedAt" | "updatedAt">) {
  return dateAppearsInPlaceName(place) ? place.name.split(" · ")[0] : place.name;
}
