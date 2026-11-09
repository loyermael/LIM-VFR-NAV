import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLimit, parseOpenAipAirfields, parseOpenAipAirspaces, groupOfType } from "./openaip";
import {
  airspacesAlongRoute, airspacesAt, limitMeters, nearestAirfields, pointInRings, searchAirfields, verticalStatus,
} from "./airspaceQuery";
import { feet, feetToMeters, meters, type Meters } from "./units";
import type { RoutePoint } from "./navlog";

// Structure de l'export reproduite à la main (voir un fichier réel : docs/j3-sources.md).
const lim = (value: number, unit: number, referenceDatum: number) => ({ value, unit, referenceDatum });
const square = (lat: number, lon: number, h: number): [number, number][][] => [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]];
const rawAsp = (over: Record<string, unknown> = {}) => ({
  _id: "a1", name: "TMA TEST 1", type: 7, icaoClass: 3, geometry: { type: "Polygon", coordinates: square(46, 2, 0.2) },
  lowerLimit: lim(1500, 1, 1), upperLimit: lim(65, 6, 2),
  frequencies: [{ value: "118.500", name: "TEST APP", primary: true, unit: 2 }, { value: "", name: "vide" }],
  remarks: "AIP SUP 084/26", onRequest: false, byNotam: true, ...over,
});

describe("limites verticales openAIP", () => {
  it("pied niveau de la mer, niveau de vol, sol, mètre", () => {
    expect(parseLimit(lim(1500, 1, 1))).toMatchObject({ reference: "AMSL", label: "1500 ft AMSL" });
    expect(parseLimit(lim(1500, 1, 1))!.value).toBeCloseTo(457.2, 6);
    expect(parseLimit(lim(65, 6, 2))).toMatchObject({ reference: "FL", value: 65, label: "FL065" });
    expect(parseLimit(lim(0, 1, 0))).toMatchObject({ reference: "AGL", value: 0, label: "SOL" });
    expect(parseLimit(lim(3000, 1, 0))).toMatchObject({ reference: "AGL", label: "3000 ft AGL" });
    expect(parseLimit(lim(300, 0, 1))).toMatchObject({ reference: "AMSL", value: 300, label: "300 m AMSL" });
  });
  it("combinaisons illisibles refusées : niveau de vol hors pression standard, unité ou référence inconnues, valeur absente", () => {
    expect(parseLimit(lim(65, 6, 1))).toBeNull();
    expect(parseLimit(lim(65, 9, 1))).toBeNull();
    expect(parseLimit(lim(65, 1, 7))).toBeNull();
    expect(parseLimit({ unit: 1, referenceDatum: 1 })).toBeNull();
    expect(parseLimit(undefined)).toBeNull();
  });
});

describe("espaces aériens openAIP", () => {
  it("décode nom, type, classe, limites, fréquences (vides écartées), SUP AIP, activation", () => {
    const { items, skipped } = parseOpenAipAirspaces([rawAsp()]);
    expect(skipped).toEqual([]);
    const a = items[0]!;
    expect(a.typeLabel).toBe("TMA");
    expect(a.group).toBe("controlled");
    expect(a.icaoClass).toBe("D");
    expect(a.upper.label).toBe("FL065");
    expect(a.frequencies).toEqual([{ name: "TEST APP", mhz: "118.500", primary: true }]);
    expect(a.remarks).toBe("AIP SUP 084/26");
    expect(a.byNotam).toBe(true);
    expect(a.bbox).toEqual({ south: 45.8, north: 46.2, west: 1.8, east: 2.2 });
  });
  it("classe 8 ou absente = sans classe ; type inconnu = groupe « autre »", () => {
    const r = parseOpenAipAirspaces([rawAsp({ icaoClass: 8, type: 99 })]).items[0]!;
    expect(r.icaoClass).toBeNull();
    expect(r.group).toBe("other");
    expect(r.typeLabel).toBe("type 99");
  });
  it("groupes : CTR/TMA/CTA contrôlés, zones R/D/P réglementées, RMZ radio, transit planeur", () => {
    expect([4, 7, 26].map(groupOfType)).toEqual(["controlled", "controlled", "controlled"]);
    expect([1, 2, 3].map(groupOfType)).toEqual(["restricted", "restricted", "restricted"]);
    expect(groupOfType(6)).toBe("radio");
    expect(groupOfType(21)).toBe("glider");
    expect(groupOfType(10)).toBe("other");
  });
  it("enregistrements illisibles écartés et comptés, jamais devinés", () => {
    const { items, skipped } = parseOpenAipAirspaces([
      rawAsp(),
      rawAsp({ name: "SANS GEOMETRIE", geometry: null }),
      rawAsp({ name: "ANNEAU TROP COURT", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] } }),
      rawAsp({ name: "LATITUDE FOLLE", geometry: { type: "Polygon", coordinates: [[[0, 95], [1, 95], [1, 96], [0, 95]]] } }),
      rawAsp({ name: "SANS PLAFOND", upperLimit: null }),
      rawAsp({ name: "SANS TYPE", type: undefined }),
    ]);
    expect(items).toHaveLength(1);
    expect(skipped.map((s) => s.name)).toEqual(["SANS GEOMETRIE", "ANNEAU TROP COURT", "LATITUDE FOLLE", "SANS PLAFOND", "SANS TYPE"]);
  });
  it("un export qui n'est pas un tableau est refusé avec un message clair", () => {
    expect(() => parseOpenAipAirspaces({ items: [] })).toThrow(/tableau/);
    expect(() => parseOpenAipAirfields("x")).toThrow(/tableau/);
  });
});

describe("terrains openAIP", () => {
  const apt = {
    _id: "t1", name: "ABBEVILLE", icaoCode: "LFOI", type: 2, geometry: { type: "Point", coordinates: [1.8325, 50.14306] },
    elevation: { value: 67, unit: 0, referenceDatum: 1 }, private: false,
    frequencies: [{ value: "120.060", name: "A/A", primary: true }],
    runways: [{ designator: "13", trueHeading: 133, dimension: { length: { value: 570, unit: 0 } } }],
  };
  it("décode position, altitude, fréquence et piste", () => {
    const a = parseOpenAipAirfields([apt]).items[0]!;
    expect(a.icao).toBe("LFOI");
    expect(a.position).toEqual({ lat: 50.14306, lon: 1.8325 });
    expect(a.elevation).toBe(67);
    expect(a.runways[0]).toEqual({ designator: "13", trueHeading: 133, lengthM: 570 });
  });
  it("altitude en pieds convertie ; position illisible écartée", () => {
    const r = parseOpenAipAirfields([{ ...apt, elevation: { value: 1000, unit: 1, referenceDatum: 1 } }, { ...apt, name: "SANS POSITION", geometry: null }]);
    expect(r.items[0]!.elevation).toBeCloseTo(304.8, 6);
    expect(r.skipped.map((s) => s.name)).toEqual(["SANS POSITION"]);
  });
});

describe("point dans un polygone", () => {
  const sq = square(46, 2, 0.2);
  it("dedans, dehors, près du bord", () => {
    expect(pointInRings({ lat: 46, lon: 2 }, sq)).toBe(true);
    expect(pointInRings({ lat: 46.3, lon: 2 }, sq)).toBe(false);
    expect(pointInRings({ lat: 46, lon: 2.25 }, sq)).toBe(false);
    expect(pointInRings({ lat: 46.19, lon: 2.19 }, sq)).toBe(true);
  });
  it("les trous sont exclus", () => {
    const withHole = [...sq, ...square(46, 2, 0.05)];
    expect(pointInRings({ lat: 46, lon: 2 }, withHole)).toBe(false);
    expect(pointInRings({ lat: 46.1, lon: 2.1 }, withHole)).toBe(true);
  });
  it("polygone concave", () => {
    const L: [number, number][][] = [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]];
    expect(pointInRings({ lat: 0.5, lon: 3 }, L)).toBe(true);
    expect(pointInRings({ lat: 3, lon: 0.5 }, L)).toBe(true);
    expect(pointInRings({ lat: 3, lon: 3 }, L)).toBe(false);
  });
});

describe("statut vertical", () => {
  const A = parseOpenAipAirspaces([rawAsp()]).items[0]!; // 1500 ft AMSL (457 m) à FL065 (1981 m)
  it("dans, sous le plancher, au-dessus du plafond", () => {
    expect(verticalStatus(A, meters(1000))).toBe("inside");
    expect(verticalStatus(A, meters(300))).toBe("outside");
    expect(verticalStatus(A, meters(3000))).toBe("outside");
  });
  it("altitude inconnue : inconnu", () => {
    expect(verticalStatus(A, null)).toBe("unknown");
  });
  it("plancher SOL : toujours satisfait ; plafond 3000 ft AGL sans relief : inconnu sauf si l'altitude est déjà hors limites", () => {
    const B = parseOpenAipAirspaces([rawAsp({ lowerLimit: lim(0, 1, 0), upperLimit: lim(3000, 1, 0) })]).items[0]!;
    expect(verticalStatus(B, meters(500))).toBe("unknown");
    expect(verticalStatus(B, meters(500), meters(100))).toBe("inside"); // plafond = 100 + 914 m
    expect(verticalStatus(B, meters(1500), meters(100))).toBe("outside");
  });
  it("plancher 3000 ft AGL sans relief : l'altitude ne peut pas l'exclure, inconnu ; très haut au-dessus du plafond AMSL : dehors", () => {
    const C = parseOpenAipAirspaces([rawAsp({ lowerLimit: lim(3000, 1, 0), upperLimit: lim(65, 6, 2) })]).items[0]!;
    expect(verticalStatus(C, meters(1000))).toBe("unknown");
    expect(verticalStatus(C, meters(5000))).toBe("outside");
  });
  it("niveau de vol converti en mètres (pression standard)", () => {
    expect(limitMeters({ reference: "FL", value: 100 }, null)).toBeCloseTo(3048, 6);
    expect(limitMeters({ reference: "AGL", value: 300 }, null)).toBeNull();
    expect(limitMeters({ reference: "AGL", value: 300 }, meters(100))).toBe(400);
  });
});

describe("espaces en un point et le long d'une route", () => {
  const A = parseOpenAipAirspaces([rawAsp({ _id: "A", name: "TMA A" })]).items[0]!; // carré de ±0,2° autour de (46, 2)
  const pt = (id: string, lat: number, lon: number, altFt: number | null): RoutePoint => ({
    id, name: id, position: { lat, lon }, altitude: altFt === null ? null : feetToMeters(feet(altFt)),
  });
  it("airspacesAt : horizontalement dedans, verticalement selon l'altitude", () => {
    const r = airspacesAt({ lat: 46, lon: 2 }, meters(1000), [A]);
    expect(r).toHaveLength(1);
    expect(r[0]!.vertical).toBe("inside");
    expect(airspacesAt({ lat: 47, lon: 2 }, meters(1000), [A])).toEqual([]);
  });
  it("une route d'est en ouest à travers l'espace : un seul espace, entrée avant sortie, distances cohérentes", () => {
    const r = airspacesAlongRoute({ points: [pt("a", 46, 1.5, 3000), pt("b", 46, 2.5, 3000)] }, [A]);
    expect(r).toHaveLength(1);
    expect(r[0]!.vertical).toBe("inside"); // 3000 ft = 914 m, entre 457 m et 1981 m
    // 0,3° de longitude à 46°N ≈ 23 km avant l'entrée, traversée de 0,4° ≈ 31 km
    expect(r[0]!.entry).toBeGreaterThan(21_000);
    expect(r[0]!.entry).toBeLessThan(25_000);
    expect(r[0]!.exit - r[0]!.entry).toBeGreaterThan(29_000);
    expect(r[0]!.exit - r[0]!.entry).toBeLessThan(33_000);
  });
  it("route sous le plancher : traversée en plan mais statut « dehors »", () => {
    const r = airspacesAlongRoute({ points: [pt("a", 46, 1.5, 500), pt("b", 46, 2.5, 500)] }, [A]);
    expect(r[0]!.vertical).toBe("outside");
  });
  it("altitudes non définies : « inconnu », pas « libre »", () => {
    const r = airspacesAlongRoute({ points: [pt("a", 46, 1.5, null), pt("b", 46, 2.5, null)] }, [A]);
    expect(r[0]!.vertical).toBe("unknown");
  });
  it("route qui ne touche rien, ou à un seul point : liste vide", () => {
    expect(airspacesAlongRoute({ points: [pt("a", 48, 1.5, 3000), pt("b", 48, 2.5, 3000)] }, [A])).toEqual([]);
    expect(airspacesAlongRoute({ points: [pt("a", 46, 2, 3000)] }, [A])).toEqual([]);
  });
  it("montée à travers l'espace : l'altitude interpolée entre dans les limites", () => {
    const r = airspacesAlongRoute({ points: [pt("a", 46, 1.5, 0), pt("b", 46, 2.5, 6000)] }, [A]);
    expect(r[0]!.vertical).toBe("inside");
  });
  it("plusieurs espaces : ordre de rencontre", () => {
    const B = parseOpenAipAirspaces([rawAsp({ _id: "B", name: "TMA B", geometry: { type: "Polygon", coordinates: square(46, 3, 0.2) } })]).items[0]!;
    const r = airspacesAlongRoute({ points: [pt("a", 46, 1.5, 3000), pt("b", 46, 3.5, 3000)] }, [B, A]);
    expect(r.map((h) => h.airspace.name)).toEqual(["TMA A", "TMA B"]);
  });
});

describe("terrains proches et recherche", () => {
  const f = (name: string, icao: string | null, lat: number, lon: number, priv = false) => parseOpenAipAirfields([{
    _id: name, name, icaoCode: icao ?? "", type: 2, geometry: { type: "Point", coordinates: [lon, lat] }, private: priv,
  }]).items[0]!;
  const list = [f("LOIN", "LFAA", 48, 2), f("PROCHE", "LFBB", 46.05, 2), f("MOYEN", "LFCC", 46.5, 2), f("PRIVÉ ÉCOLE", "LFDD", 46.01, 2, true)];
  it("trie par distance, limite le nombre, applique le filtre", () => {
    const here = { lat: 46, lon: 2 };
    expect(nearestAirfields(here, list, 2).map((n) => n.airfield.name)).toEqual(["PRIVÉ ÉCOLE", "PROCHE"]);
    expect(nearestAirfields(here, list, 2, (a) => !a.private).map((n) => n.airfield.name)).toEqual(["PROCHE", "MOYEN"]);
    expect(nearestAirfields(here, list, 0)).toEqual([]);
    const n = nearestAirfields(here, list, 1, (a) => a.name === "PROCHE")[0]!;
    expect(n.distance).toBeGreaterThan(5000);
    expect(n.distance).toBeLessThan(6000);
    expect(n.trueBearing).toBeCloseTo(0, 1);
  });
  it("recherche : code OACI exact d'abord, puis préfixe, accents ignorés", () => {
    expect(searchAirfields("lfbb", list).map((a) => a.name)).toEqual(["PROCHE"]);
    expect(searchAirfields("prive", list).map((a) => a.name)).toEqual(["PRIVÉ ÉCOLE"]);
    expect(searchAirfields("lf", list).length).toBe(4);
    expect(searchAirfields("  ", list)).toEqual([]);
    expect(searchAirfields("zzz", list)).toEqual([]);
  });
});

// Vérification sur le VRAI export, si présent (jamais dans le dépôt : licence CC BY-NC) : `npm run data:openaip`.
const realAsp = fileURLToPath(new URL("../../../data/openaip/fr_asp.json", import.meta.url));
const realApt = fileURLToPath(new URL("../../../data/openaip/fr_apt.json", import.meta.url));
describe.skipIf(!existsSync(realAsp) || !existsSync(realApt))("export réel de la France", () => {
  it("presque tous les espaces et terrains se décodent ; peu d'écartés, tous expliqués", () => {
    const asp = parseOpenAipAirspaces(JSON.parse(readFileSync(realAsp, "utf8")));
    const apt = parseOpenAipAirfields(JSON.parse(readFileSync(realApt, "utf8")));
    expect(asp.items.length).toBeGreaterThan(1500);
    expect(asp.skipped.length).toBeLessThan(asp.items.length * 0.02);
    expect(apt.items.length).toBeGreaterThan(1300);
    expect(apt.skipped.length).toBeLessThan(apt.items.length * 0.02);
    const ctr = asp.items.filter((a) => a.typeLabel === "CTR");
    expect(ctr.length).toBeGreaterThan(50);
    expect(asp.items.every((a) => a.lower.label !== "" && a.upper.label !== "")).toBe(true);
    // un point au milieu de la France est dans au moins une FIR
    expect(airspacesAt({ lat: 46.6, lon: 2.35 }, meters(1000) as Meters, asp.items).length).toBeGreaterThan(0);
  });
});
