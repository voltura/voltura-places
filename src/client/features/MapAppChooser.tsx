import { mapProviders, type MapProvider } from "../foundation/map-providers";
import { mapLinkTarget } from "../foundation/map-links";
import { ArrowUpRight, Copy } from "lucide-react";
import { mapURL, directionsURL, type MapAction, type Place } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { MapAppIcon } from "./MapAppIcon";
import { Sheet } from "../ui/Sheet";

type Provider = MapProvider;

export function MapAppChooser({
  place,
  action = "show",
  t,
  onClose,
  onChoose,
  copy,
}: {
  place: Place;
  action?: MapAction;
  t: (key: Message) => string;
  onClose: () => void;
  onChoose: (provider: Provider) => void;
  copy: (text: string) => Promise<void>;
}) {
  return (
    <Sheet
      title={t("chooseMapApp")}
      subtitle={place.name}
      onClose={onClose}
      closeLabel={t("close")}
      className="map-app-sheet"
    >
      <div className="map-app-list">
        {mapProviders()
          .filter((provider) => action === "show" || provider !== "geo")
          .map((provider) => (
            <a
              key={provider}
              className="map-app-row"
              href={
                action === "navigate" && provider !== "geo"
                  ? directionsURL(provider, place)
                  : mapURL(provider, place)
              }
              target={mapLinkTarget()}
              rel="noopener noreferrer"
              onClick={() => onChoose(provider)}
            >
              <MapAppIcon provider={provider} />
              <span>{t(provider)}</span>
              <ArrowUpRight className="map-app-external" size={16} aria-hidden="true" />
            </a>
          ))}
      </div>
      <button
        className="button quiet map-copy"
        onClick={() => void copy(`${place.latitude}, ${place.longitude}`)}
      >
        <Copy size={20} aria-hidden="true" />
        {t("copyCoordinates")}
      </button>
    </Sheet>
  );
}
