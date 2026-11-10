import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PREFS, feet, feetToMeters, knots, knotsToMps, type Conditions } from "@lim/core";
import { ageText, cloudsText, hazardLabel, levelsText, temperatureText, utcDateTime, utcRange, utcTime, visibilityText, windText } from "./wxFormat";

const kt = (v: number) => knotsToMps(knots(v));
const P = DEFAULT_UNIT_PREFS;
const w = (dir: number | "VRB" | null, s: number | null, g: number | null = null) => ({ windDirection: dir, windSpeed: s === null ? null : kt(s), windGust: g === null ? null : kt(g) });

describe("vent", () => {
  it("direction sur 3 chiffres, vitesse dans l'unité choisie, rafales", () => {
    expect(windText(w(240, 12, 22), P)).toBe("240° 12 G22 kt");
    expect(windText(w(5, 4), P)).toBe("005° 4 kt");
    expect(windText(w("VRB", 3), P)).toBe("VRB 3 kt");
  });
  it("vitesse nulle : calme ; inconnue : tiret ; 360° affiché 360", () => {
    expect(windText(w(0, 0), P)).toBe("calme");
    expect(windText(w(null, null), P)).toBe("—");
    expect(windText(w(360, 8), P)).toBe("360° 8 kt");
  });
  it("km/h si l'utilisateur l'a choisi", () => {
    expect(windText(w(180, 10), { ...P, groundSpeed: "kmh" })).toBe("180° 19 km/h");
  });
});

describe("visibilité", () => {
  it("« 6 miles ou plus » : ≥ 10 km ; mesures en km ou en m", () => {
    expect(visibilityText({ meters: 6 * 1609.344, orMore: true })).toBe("≥ 10 km");
    expect(visibilityText({ meters: 3.11 * 1609.344, orMore: false })).toBe("5.0 km");
    expect(visibilityText({ meters: 0.5 * 1609.344, orMore: false })).toBe("800 m");
    expect(visibilityText({ meters: 4000, orMore: false })).toBe("4000 m");
    expect(visibilityText(null)).toBe("—");
  });
});

describe("nuages, température, âge, heures", () => {
  it("couches arrondies à 100 ft ; aucune couche : « aucun nuage significatif »", () => {
    expect(cloudsText([{ cover: "FEW", base: feetToMeters(feet(1600)) }, { cover: "BKN", base: feetToMeters(feet(2700)) }])).toBe("FEW 1600 ft · BKN 2700 ft");
    expect(cloudsText([{ cover: "OVX", base: null }])).toBe("OVX");
    expect(cloudsText([])).toBe("aucun nuage significatif");
  });
  it("température et point de rosée, absents = tiret", () => {
    expect(temperatureText(13, 12)).toBe("13° / 12°C");
    expect(temperatureText(-2, null)).toBe("-2°C");
    expect(temperatureText(null, 5)).toBe("—");
  });
  it("âge", () => {
    expect(ageText(12)).toBe("12 min");
    expect(ageText(125)).toBe("2 h 05");
    expect(ageText(60)).toBe("1 h 00");
  });
  it("heures UTC", () => {
    expect(utcTime(Date.parse("2026-11-10T14:30:00Z"))).toBe("14:30Z");
    expect(utcDateTime(Date.parse("2026-11-10T04:05:00Z"))).toBe("10/11 04:05Z");
  });
});

describe("SIGMET", () => {
  it("dangers en français, inconnus tels quels ; niveaux en FL", () => {
    expect(hazardLabel("TS")).toBe("Orages");
    expect(hazardLabel("XYZ")).toBe("XYZ");
    expect(levelsText(null, 9144)).toBe("SOL → FL300");
    expect(levelsText(3048, 7620)).toBe("FL100 → FL250");
    expect(levelsText(null, null)).toBe("SOL → ?");
  });
  it("type Conditions exporté et utilisable", () => {
    const c: Pick<Conditions, "windDirection"> = { windDirection: 10 };
    expect(c.windDirection).toBe(10);
  });
});

describe("plage horaire", () => {
  it("même jour : sans suffixe ; jour suivant : « +1 »", () => {
    expect(utcRange(Date.parse("2026-11-10T06:00:00Z"), Date.parse("2026-11-10T10:00:00Z"))).toBe("06:00Z–10:00Z");
    expect(utcRange(Date.parse("2026-11-10T06:00:00Z"), Date.parse("2026-11-11T04:00:00Z"))).toBe("06:00Z–04:00Z+1");
    expect(utcRange(Date.parse("2026-11-10T23:00:00Z"), Date.parse("2026-11-11T00:00:00Z"))).toBe("23:00Z–00:00Z+1");
  });
});
