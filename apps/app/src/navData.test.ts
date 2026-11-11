import { describe, expect, it } from "vitest";
import { importNavFiles, parseNavaids, parseObstacles, parseReporting } from "./navData";

const pt = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const file = (name: string, data: unknown) => new File([JSON.stringify(data)], name);

describe("données de navigation", () => {
  it("balises : champs lus, éléments sans position écartés", () => {
    const r = parseNavaids([{ name: "AUXERRE", identifier: "AX", type: 2, frequency: { value: "417.000", unit: 1 }, geometry: pt(3.5, 47.8), elevation: { value: 147, unit: 0 }, range: { value: 25, unit: 2 } }, { name: "X" }, null, { geometry: pt(500, 0) }]);
    expect(r).toEqual([{ lat: 47.8, lon: 3.5, name: "AUXERRE", ident: "AX", kind: 2, freq: "417.000", freqUnit: 1, channel: null, elevM: 147, rangeNm: 25 }]);
  });
  it("points de report et obstacles (hauteur parfois absente)", () => {
    expect(parseReporting([{ name: "NA", compulsory: true, geometry: pt(2.6, 50) }])[0]?.compulsory).toBe(true);
    const o = parseObstacles([{ name: "Obstacle", type: 0, geometry: pt(1, 46), height: { value: 80, unit: 0 }, what: "wind" }, { name: "Obstacle", type: 4, geometry: pt(1, 46) }]);
    expect(o.map((x) => x.heightM)).toEqual([80, null]);
    expect(o[0]?.what).toBe("wind");
  });
  it("un fichier qui n'est pas un tableau est signalé, sans casser les autres", async () => {
    const r = await importNavFiles([file("fr_nav.json", { pas: "un tableau" }), file("fr_rpp.json", [{ name: "A", geometry: pt(1, 45) }]), file("manifest.json", { files: [{ name: "fr_nav.json", lastModified: "Wed, 11 Nov 2026 01:55:39 GMT" }] })], 5);
    expect(r.problems).toHaveLength(1);
    expect(r.dataset.reporting).toHaveLength(1);
    expect(r.dataset.meta.exportedAtMs).toBe(Date.parse("Wed, 11 Nov 2026 01:55:39 GMT"));
  });
});

import { navToGeoJSON } from "./aeroGeo";
import { navaidSymbol, type NavDataset } from "./navData";

describe("symboles de la carte aéro", () => {
  it("balise : symbole d'après la fréquence", () => {
    expect(navaidSymbol({ freq: "417.000", freqUnit: 1, channel: null })).toBe("ndb");
    expect(navaidSymbol({ freq: "108.450", freqUnit: 2, channel: "21Y" })).toBe("vordme");
    expect(navaidSymbol({ freq: "113.000", freqUnit: 2, channel: null })).toBe("vor");
    expect(navaidSymbol({ freq: null, freqUnit: null, channel: "40X" })).toBe("dme");
  });
  it("jeu de points unique : famille, symbole, hauteur", () => {
    const d: NavDataset = {
      id: "navdata", meta: { source: "openAIP", licence: "x", exportedAtMs: 0, importedAtMs: 0 },
      navaids: [{ lat: 47, lon: 3, name: "AUXERRE", ident: "AX", kind: 2, freq: "417.000", freqUnit: 1, channel: null, elevM: 1, rangeNm: 25 }],
      reporting: [{ lat: 50, lon: 2, name: "NA", compulsory: true }],
      obstacles: [{ lat: 46, lon: 1, name: "Obstacle", kind: 0, elevM: 5, heightM: 80, what: "wind" }, { lat: 46, lon: 1.1, name: "Obstacle", kind: 4, elevM: 5, heightM: null, what: null }],
      hang: [], hotspots: [],
    };
    const f = navToGeoJSON(d).features.map((x) => x.properties);
    expect(f.map((p) => p?.["sym"])).toEqual(["ndb", "rp-c", "wind", "mast"]);
    expect(f.map((p) => p?.["grp"])).toEqual(["navaid", "report", "obstacle", "obstacle"]);
    expect(f[3]?.["h"]).toBe(0);
  });
});

import { obstacleLabel } from "./aeroGeo";
describe("étiquettes", () => {
  it("obstacle : sommet (hauteur) en pieds, vide si hauteur inconnue", () => {
    expect(obstacleLabel({ heightM: 80, elevM: 56 })).toBe("446\n(262)");
    expect(obstacleLabel({ heightM: null, elevM: 56 })).toBe("");
    expect(obstacleLabel({ heightM: 100, elevM: null })).toBe("(328)");
  });
});

import { airfieldLabel, airfieldSymbol, navaidBox } from "./aeroGeo";
describe("symboles OACI des terrains et balises", () => {
  const rw = (lengthM: number, paved: boolean | null) => ({ designator: "13", trueHeading: 133, lengthM, paved });
  it("terrain : classe, revêtement, privé, fermé", () => {
    expect(airfieldSymbol({ type: 2, private: false, runways: [rw(1200, true)] })).toBe("ad-civil-paved-h9");
    expect(airfieldSymbol({ type: 2, private: false, runways: [rw(600, false)] })).toBe("ad-civil-unpaved");
    expect(airfieldSymbol({ type: 5, private: false, runways: [rw(2000, true)] })).toBe("ad-mil-paved-h9");
    expect(airfieldSymbol({ type: 0, private: false, runways: [rw(2000, true)] })).toBe("ad-mixte-paved-h9");
    expect(airfieldSymbol({ type: 7, private: false, runways: [] })).toBe("ad-civil-heli");
    expect(airfieldSymbol({ type: 10, private: false, runways: [] })).toBe("ad-civil-water");
    expect(airfieldSymbol({ type: 2, private: true, runways: [] })).toBe("ad-p");
    expect(airfieldSymbol({ type: 8, private: false, runways: [] })).toBe("ad-x");
  });
  it("étiquette de terrain et cadre de balise comme sur la carte", () => {
    const a = { id: "1", name: "Poitiers", icao: "LFBI", type: 9, position: { lat: 0, lon: 0 }, elevation: 129 as never, frequencies: [{ name: "Tour", mhz: "118.500", primary: true }], runways: [rw(2300, true)], private: false };
    expect(airfieldLabel(a)).toBe("LFBI\nPOITIERS\n423 118.500 23");
    expect(navaidBox({ ident: "STP", freq: "116.500", channel: "40X" }, "vordme")).toBe("(D) STP 116.5");
    expect(navaidBox({ ident: "LU", freq: "378.000", channel: null }, "ndb")).toBe("LU 378");
  });
});

import { airspaceStyle, limitText, orientRings } from "./aeroGeo";
describe("espaces aériens à la manière de la carte OACI", () => {
  it("style d'après le type et la classe", () => {
    expect(airspaceStyle({ type: 7, icaoClass: "A" })).toBe("ca");
    expect(airspaceStyle({ type: 7, icaoClass: "D" })).toBe("cbd");
    expect(airspaceStyle({ type: 4, icaoClass: "D" })).toBe("cbd");
    expect(airspaceStyle({ type: 26, icaoClass: "E" })).toBe("ce");
    expect(airspaceStyle({ type: 3, icaoClass: null })).toBe("pro");
    expect(airspaceStyle({ type: 2, icaoClass: null })).toBe("res");
    expect(airspaceStyle({ type: 6, icaoClass: null })).toBe("rmz");
  });
  it("limites écrites comme sur la carte", () => {
    expect(limitText("FL085")).toBe("FL 085");
    expect(limitText("2000 ft AMSL")).toBe("2000 AMSL");
    expect(limitText("1500 ft AGL")).toBe("1500 ASFC");
    expect(limitText("SOL")).toBe("SFC");
  });
  it("anneaux : extérieur horaire, trous antihoraires, quel que soit le sens d'origine", () => {
    const sq: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]]; // horaire en (lon, lat)
    const area = (r: number[][]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length] as number[]; return s + (p[0] as number) * (q[1] as number) - (q[0] as number) * (p[1] as number); }, 0) / 2;
    const [outer, hole] = orientRings([[...sq].reverse(), sq]);
    expect(area(outer as number[][])).toBeLessThan(0);
    expect(area(hole as number[][])).toBeGreaterThan(0);
  });
});

import { airspacesToGeoJSON, isParachuting } from "./aeroGeo";
describe("croix, parachutage et vol libre", () => {
  const asp = (type: number, name: string, d: number) => ({
    id: name, name, type, typeLabel: "", group: "restricted" as const, icaoClass: null, lower: { reference: "AGL" as const, value: 0, label: "SOL" }, upper: { reference: "AMSL" as const, value: 900, label: "3000 ft AMSL" },
    rings: [[[0, 0], [d, 0], [d, d], [0, d]]] as unknown as readonly (readonly (readonly [number, number])[])[], bbox: { south: 0, west: 0, north: d, east: d },
    frequencies: [], remarks: null, activeFrom: null, activeUntil: null, onRequest: false, byNotam: false,
  });
  it("petite zone R : croix au centre, contour marqué « small » ; grande zone : pas de croix", () => {
    const f = airspacesToGeoJSON([asp(1, "LF-R1 PETITE", 0.02), asp(1, "LF-R2 GRANDE", 0.5)]).features;
    expect(f.filter((x) => x.properties?.["sty"] === "cross")).toHaveLength(1);
    expect(f.find((x) => x.properties?.["name"] === "LF-R1 PETITE" && x.geometry.type === "Polygon")?.properties?.["small"]).toBe(true);
    expect(f.find((x) => x.properties?.["name"] === "LF-R2 GRANDE" && x.geometry.type === "Polygon")?.properties?.["small"]).toBe(false);
  });
  it("parachutage reconnu par le nom", () => {
    expect(isParachuting({ type: 28, name: "LF-R15A PARA BRIENNE" })).toBe(true);
    expect(isParachuting({ type: 28, name: "LF-R212 MONT DE VANNES" })).toBe(false);
    expect(airspacesToGeoJSON([asp(28, "PARA PERONNE", 0.3)]).features.some((x) => x.properties?.["sty"] === "para")).toBe(true);
  });
});

import { runwayBucket } from "./aeroGeo";
describe("barre de piste du symbole de terrain", () => {
  it("cap → position de la barre (15°, modulo 180°)", () => {
    expect(runwayBucket(45)).toBe(3);
    expect(runwayBucket(225)).toBe(3);
    expect(runwayBucket(0)).toBe(0);
    expect(runwayBucket(179)).toBe(0);
    expect(runwayBucket(133)).toBe(9);
  });
  it("sans cap connu : symbole d'origine", () => {
    expect(airfieldSymbol({ type: 2, private: false, runways: [{ designator: "13", trueHeading: null, lengthM: 1200, paved: true }] })).toBe("ad-civil-paved");
  });
});

import { isRtba } from "./aeroGeo";
describe("RTBA et zones de parachutage", () => {
  it("RTBA : zone réglementée hebdomadaire au plancher très bas", () => {
    expect(isRtba({ type: 1, name: "LF-R69 CHAMPAGNE (MON-FRI)", lower: { reference: "AGL", value: 244 } })).toBe(true);
    expect(isRtba({ type: 1, name: "LF-R2 RUCHARD", lower: { reference: "AGL", value: 0 } })).toBe(false);
    expect(isRtba({ type: 1, name: "LF-R9 X (MON-FRI)", lower: { reference: "AMSL", value: 100 } })).toBe(false);
  });
  it("zone de parachutage : style dédié", () => {
    expect(airspaceStyle({ type: 28, icaoClass: null, name: "PARA GAP" })).toBe("parz");
    expect(airspaceStyle({ type: 1, icaoClass: null, name: "LF-R2 RUCHARD", lower: { reference: "AGL", value: 0 } })).toBe("res");
  });
});
