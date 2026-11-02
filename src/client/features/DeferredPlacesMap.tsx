import { lazy } from "react";
import type { Message } from "../foundation/i18n";

function MapUnavailable({ t }: { t: (key: Message) => string }) {
  return (
    <p className="muted" role="status">
      {t("mapModuleUnavailable")}
    </p>
  );
}

// Keep local records and editing usable if the optional map chunk was never cached.
export const DeferredPlacesMap = lazy<typeof import("./PlacesMap").default>(() =>
  import("./PlacesMap").catch(() => ({ default: MapUnavailable })),
);
