import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PREFS, parseOpenAipAirfields, parseOpenAipAirspaces } from "@lim/core";
import { airfieldDetails, airfieldsToGeoJSON, airspaceDetails, airspacesToGeoJSON, floorMeters, formatUtc, freshnessWarnings, periodStatus } from "./aeroGeo";

const sq = [[[1, 45], [3, 45], [3, 47], [1, 47], [1, 45]]];
const asp = (over: Record<string, unknown> = {}) => parseOpenAipAirspaces([{
  _id: "x", name: "TMA TEST", type: 7, icaoClass: 3, geometry: { type: "Polygon", coordinates: sq },
  lowerLimit: { value: 1500, unit: 1, referenceDatum: 1 }, upperLimit: { value: 65, unit: 6, referenceDatum: 2 },
  frequencies: [{ value: "118.500", name: "APP", primary: true }], remarks: "AIP SUP 084/26", byNotam: true, ...over,
}]).items[0]!;

describe("plancher pour le filtre de plafond", () => {
  it("AMSL en mètres, niveau de vol converti, sol = -1 (toujours affiché)", () => {
    expect(floorMeters(asp())).toBeCloseTo(457.2, 6);
    expect(floorMeters(asp({ lowerLimit: { value: 65, unit: 6, referenceDatum: 2 } }))).toBeCloseTo(1981.2, 6);
    expect(floorMeters(asp({ lowerLimit: { value: 0, unit: 1, referenceDatum: 0 } }))).toBe(-1);
  });
});

describe("GeoJSON", () => {
  it("un espace → un polygone avec identifiant, groupe et plancher", () => {
    const fc = airspacesToGeoJSON([asp()]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.properties).toMatchObject({ id: "x", group: "controlled" });
    expect(fc.features[0]!.geometry.type).toBe("Polygon");
  });
  it("un terrain → un point [longitude, latitude]", () => {
    const apt = parseOpenAipAirfields([{ _id: "t", name: "T", icaoCode: "LFXX", type: 2, geometry: { type: "Point", coordinates: [2, 46] } }]).items;
    const fc = airfieldsToGeoJSON(apt);
    expect(fc.features[0]!.geometry).toEqual({ type: "Point", coordinates: [2, 46] });
    expect(fc.features[0]!.properties).toMatchObject({ icao: "LFXX" });
  });
});

describe("textes de détail", () => {
  it("espace : limites, fréquences, activation par NOTAM à vérifier, remarques, source non officielle", () => {
    const d = airspaceDetails(asp(), Date.parse("2026-11-09T01:51:07Z"));
    expect(d["Type"]).toBe("TMA · classe D");
    expect(d["Plancher"]).toBe("1500 ft AMSL");
    expect(d["Plafond"]).toBe("FL065");
    expect(d["Fréquences"]).toBe("118.500 APP ★");
    expect(d["Activation"]).toMatch(/NOTAM.*à vérifier/);
    expect(d["Remarques"]).toBe("AIP SUP 084/26");
    expect(d["Source"]).toMatch(/openAIP.*non officiel/);
  });
  it("espace sans fréquence ni activation : pas de ligne vide", () => {
    const d = airspaceDetails(asp({ frequencies: [], byNotam: false, remarks: "" }), null);
    expect(Object.keys(d)).toEqual(["Nom", "Type", "Plancher", "Plafond", "Source"]);
  });
  it("terrain : altitude dans l'unité choisie, pistes, fréquences", () => {
    const a = parseOpenAipAirfields([{
      _id: "t", name: "ABBEVILLE", icaoCode: "LFOI", type: 2, geometry: { type: "Point", coordinates: [1.83, 50.14] },
      elevation: { value: 67, unit: 0, referenceDatum: 1 }, frequencies: [{ value: "120.060", name: "A/A", primary: true }],
      runways: [{ designator: "13", trueHeading: 133, dimension: { length: { value: 570, unit: 0 } } }],
    }]).items[0]!;
    const d = airfieldDetails(a, DEFAULT_UNIT_PREFS, null);
    expect(d["Code OACI"]).toBe("LFOI");
    expect(d["Altitude"]).toBe("220 ft");
    expect(d["Pistes"]).toBe("13 (133°V) 570 m");
    expect(d["Fréquences"]).toBe("120.060 A/A ★");
  });
});

describe("avertissements de fraîcheur", () => {
  it("toujours : openAIP non officiel", () => {
    expect(freshnessWarnings({ ageDays: 1, stale: false, beforeCurrentCycle: false })).toHaveLength(1);
  });
  it("périmé ou antérieur au cycle : message en plus", () => {
    expect(freshnessWarnings({ ageDays: 40, stale: true, beforeCurrentCycle: true })[1]).toMatch(/40 jours/);
    expect(freshnessWarnings({ ageDays: 18, stale: false, beforeCurrentCycle: true })[1]).toMatch(/cycle AIRAC/);
  });
});

describe("période d'activation d'un espace temporaire", () => {
  const z = (from: string | null, until: string | null) => ({ activeFrom: from, activeUntil: until });
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("à venir, en cours, terminée, sans période", () => {
    expect(periodStatus(z("2026-12-02T08:00:00.000Z", "2026-12-10T13:00:00.000Z"), now)).toBe("upcoming");
    expect(periodStatus(z("2026-11-01T08:00:00.000Z", "2026-11-20T13:00:00.000Z"), now)).toBe("current");
    expect(periodStatus(z("2026-10-01T08:00:00.000Z", "2026-10-02T13:00:00.000Z"), now)).toBe("ended");
    expect(periodStatus(z(null, null), now)).toBeNull();
  });
  it("une seule borne connue", () => {
    expect(periodStatus(z("2026-12-02T08:00:00.000Z", null), now)).toBe("upcoming");
    expect(periodStatus(z(null, "2026-10-02T13:00:00.000Z"), now)).toBe("ended");
    expect(periodStatus(z(null, "2026-12-02T13:00:00.000Z"), now)).toBe("current");
  });
  it("date illisible : traitée comme absente, pas de plantage", () => {
    expect(periodStatus(z("n'importe quoi", null), now)).toBeNull();
  });
  it("formatUtc lisible, et rend le texte tel quel si illisible", () => {
    expect(formatUtc("2026-12-02T08:00:00.000Z")).toBe("02/12/2026 08:00 UTC");
    expect(formatUtc("pas une date")).toBe("pas une date");
  });
  it("la fiche affiche la période et son état", () => {
    const sq2 = [[[1, 45], [3, 45], [3, 47], [1, 47], [1, 45]]];
    const a = parseOpenAipAirspaces([{ _id: "z", name: "ZRT TEST", type: 1, geometry: { type: "Polygon", coordinates: sq2 }, lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 3000, unit: 1, referenceDatum: 1 }, activeFrom: "2026-12-02T08:00:00.000Z", activeUntil: "2026-12-10T13:00:00.000Z" }]).items[0]!;
    expect(airspaceDetails(a, null, now)["Période"]).toBe("02/12/2026 08:00 UTC → 10/12/2026 13:00 UTC (à venir)");
  });
});
