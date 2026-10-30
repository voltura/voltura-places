import { expect, test } from "vitest";
import { dateAppearsInPlaceName, placeDetailsName } from "../src/client/foundation/place-labels";

test.each(["en", "sv"])(
  "recognises %s generated names without hiding custom-name dates",
  (language) => {
    const capturedAt = "2026-10-30T10:00:00Z";
    const date = new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(capturedAt));
    const prefix = language === "sv" ? "Plats" : "Place";
    const generated = { name: `${prefix} · ${date}`, capturedAt, updatedAt: capturedAt };
    expect(placeDetailsName(generated)).toBe(prefix);
    expect(generated.name).toBe(`${prefix} · ${date}`);
    for (const name of ["Weekend picnic", "Place · My favourite café", "Plats · 30 okt. utflykt"])
      expect(placeDetailsName({ ...generated, name })).toBe(name);
    expect(
      dateAppearsInPlaceName({ name: `${prefix} · ${date}`, capturedAt, updatedAt: capturedAt }),
    ).toBe(true);
    expect(
      dateAppearsInPlaceName({ name: "Weekend picnic", capturedAt, updatedAt: capturedAt }),
    ).toBe(false);
    expect(
      dateAppearsInPlaceName({
        name: "Place · My favourite café",
        capturedAt,
        updatedAt: capturedAt,
      }),
    ).toBe(false);
  },
);
