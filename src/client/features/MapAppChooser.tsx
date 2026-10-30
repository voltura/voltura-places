import { mapProviders, type MapProvider } from "../foundation/map-providers";
import { ArrowUpRight, Copy, Map } from "lucide-react";
import { mapURL, directionsURL, type MapAction, type Place } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

type Provider = MapProvider;

function MapAppIcon({ provider }: { provider: Provider }) {
  if (provider === "geo") return <Map size={28} aria-hidden="true" />;
  if (provider === "google")
    return (
      <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#34a853"
          d="M24 2C14.6 2 7 9.6 7 19c0 12 13 19 15 26a2.1 2.1 0 0 0 4 0c2-7 15-14 15-26C41 9.6 33.4 2 24 2Z"
        />
        <path fill="#4285f4" d="M24 2a17 17 0 0 0-14 7l11 11 15-13A17 17 0 0 0 24 2Z" />
        <path fill="#ea4335" d="m10 9 11 11-10 12C5 23 6 15 10 9Z" />
        <path fill="#fbbc04" d="M36 7 11 32l7 8 22-25a17 17 0 0 0-4-8Z" />
        <circle cx="24" cy="19" r="6" fill="white" />
      </svg>
    );
  return (
    <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id="apple-map-tile">
          <rect width="48" height="48" rx="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#apple-map-tile)">
        <path fill="#e7eee0" d="M0 0h48v48H0z" />
        <path fill="#9fd17a" d="M0 0h20v19H0zM34 29h14v19H34z" />
        <path fill="#8ed5f6" d="M35 0h13v48H35z" />
        <path stroke="white" strokeWidth="9" d="m-4 38 42-42M0 23h48" />
        <path stroke="#f8cf54" strokeWidth="4" d="m-4 38 42-42" />
        <path
          fill="#2684f5"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
          d="m29 15 9 23-10-5-10 5Z"
        />
      </g>
    </svg>
  );
}

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
              target="_blank"
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
