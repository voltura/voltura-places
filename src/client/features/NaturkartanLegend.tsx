import { useState } from "react";
import { List } from "lucide-react";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

const symbols = [
  {
    label: "mapLegendContours",
    background: "#d2edb6",
    color: "#ae835c",
    path: "M0 8Q9 0 19 8T40 8M0 15Q9 7 19 15T40 15M0 22Q9 14 19 22T40 22",
  },
  { label: "mapLegendForest", background: "#d2edb6" },
  { label: "mapLegendWater", background: "#c8e8fc" },
  {
    label: "mapLegendStream",
    background: "#d2edb6",
    color: "#2497c5",
    path: "M0 19L10 13L22 15L40 5M21 10L28 12L25 19",
  },
  {
    label: "mapLegendWetland",
    background: "#d2edb6",
    color: "#ad835e",
    path: "M14 4H26M9 8H31M5 12H35M6 16H34M10 20H30M15 24H25",
  },
] as const;

export function NaturkartanLegend({ t }: { t: (key: Message) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="icon-button map-legend-toggle"
        aria-label={t("mapLegend")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        <List aria-hidden="true" />
      </button>
      {open && (
        <Sheet
          title={t("mapLegend")}
          subtitle={t("naturkartan")}
          closeLabel={t("close")}
          className="map-legend"
          onClose={() => setOpen(false)}
        >
          <ul className="map-legend-symbols">
            {symbols.map((symbol) => (
              <li key={symbol.label}>
                <svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true">
                  <rect width="40" height="28" fill={symbol.background} />
                  {"path" in symbol && (
                    <path d={symbol.path} stroke={symbol.color} fill="none" strokeWidth="1.25" />
                  )}
                </svg>
                {t(symbol.label)}
              </li>
            ))}
          </ul>
          <a
            href="https://www.lantmateriet.se/globalassets/geodata/geodatatjanster/tf_twk.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("mapLegendReference")}
          </a>
        </Sheet>
      )}
    </>
  );
}
