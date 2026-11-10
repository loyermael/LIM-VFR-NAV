import { describe, expect, it } from "vitest";
import { sampleRoute, sigmetsAlongRoute, stationsNearRoute } from "./briefing";
import { distance } from "./geodesy";
import { meters, nmToMeters, nauticalMiles } from "./units";
import type { RoutePoint } from "./navlog";
import type { Sigmet } from "./weather";

const pt = (id: string, lat: number, lon: number, alt: number | null): RoutePoint => ({ id, name: id, position: { lat, lon }, altitude: alt === null ? null : meters(alt) });
const route = { points: [pt("a", 46, 1, 1000), pt("b", 46, 3, 1000)] }; // ~154 km plein est
const NM = (n: number) => nmToMeters(nauticalMiles(n));

describe("échantillonnage de la route", () => {
  it("extrémités comprises, distances croissantes, pas de doublon aux sommets", () => {
    const s = sampleRoute({ points: [pt("a", 46, 1, 0), pt("b", 46, 2, 1000), pt("c", 47, 2, 1000)] });
    expect(s[0]!.along).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i]!.along).toBeGreaterThan(s[i - 1]!.along);
    expect(s.length).toBeGreaterThan(30);
    const total = distance({ lat: 46, lon: 1 }, { lat: 46, lon: 2 }) + distance({ lat: 46, lon: 2 }, { lat: 47, lon: 2 });
    expect(s[s.length - 1]!.along).toBeCloseTo(total, 0);
  });
  it("altitude interpolée sur la branche", () => {
    const s = sampleRoute({ points: [pt("a", 46, 1, 0), pt("b", 46, 2, 1000)] });
    const mid = s[Math.floor(s.length / 2)]!;
    expect(mid.altitude).toBeGreaterThan(300);
    expect(mid.altitude).toBeLessThan(700);
  });
  it("un seul point : un échantillon ; aucun point : aucun", () => {
    expect(sampleRoute({ points: [pt("a", 46, 1, 5)] })).toHaveLength(1);
    expect(sampleRoute({ points: [] })).toEqual([]);
  });
});

describe("stations près de la route", () => {
  const st = (name: string, lat: number, lon: number) => ({ name, lat, lon });
  it("garde celles à moins de 25 NM, dans l'ordre de rencontre, avec la distance au couloir", () => {
    const r = stationsNearRoute(route, [st("FIN", 46.1, 2.9), st("DEBUT", 46.1, 1.1), st("LOIN", 48, 2), st("MILIEU", 46.2, 2)], NM(25));
    expect(r.map((x) => x.station.name)).toEqual(["DEBUT", "MILIEU", "FIN"]);
    expect(r[1]!.distance).toBeGreaterThan(NM(10));
    expect(r[1]!.distance).toBeLessThan(NM(14));
    expect(r[0]!.along).toBeLessThan(r[2]!.along);
  });
  it("limite le nombre en gardant les plus proches de la route", () => {
    const many = Array.from({ length: 6 }, (_, i) => st(`S${i}`, 46 + 0.05 * (i + 1), 2));
    const r = stationsNearRoute(route, many, NM(60), 3);
    expect(r.map((x) => x.station.name).sort()).toEqual(["S0", "S1", "S2"]);
  });
  it("route vide ou aucune station : liste vide", () => {
    expect(stationsNearRoute({ points: [] }, [st("A", 46, 2)], NM(25))).toEqual([]);
    expect(stationsNearRoute(route, [], NM(25))).toEqual([]);
  });
});

describe("SIGMET sur la route", () => {
  const T0 = Date.parse("2026-11-10T08:00:00Z");
  const H = 3_600_000;
  const sg = (over: Partial<Sigmet> = {}): Sigmet => ({
    id: "s", firName: "TEST", hazard: "TS", qualifier: null, base: null, top: meters(9000), validFrom: T0 - H, validTo: T0 + 4 * H,
    areas: [[[1.8, 45.5], [2.2, 45.5], [2.2, 46.5], [1.8, 46.5], [1.8, 45.5]]], raw: "SIGMET TEST", ...over,
  });
  it("polygone traversé, validité recouvrant le vol, altitude dans les limites : « inside »", () => {
    const r = sigmetsAlongRoute(route, [sg()], T0, T0 + 2 * H);
    expect(r).toHaveLength(1);
    expect(r[0]!.vertical).toBe("inside");
    expect(r[0]!.exit).toBeGreaterThan(r[0]!.entry);
    expect(r[0]!.entry).toBeGreaterThan(60_000);
  });
  it("route au-dessus du sommet ou sous la base : « outside » (traversé en plan seulement)", () => {
    expect(sigmetsAlongRoute(route, [sg({ top: meters(500) })], T0, T0 + H)[0]!.vertical).toBe("outside");
    expect(sigmetsAlongRoute(route, [sg({ base: meters(3000) })], T0, T0 + H)[0]!.vertical).toBe("outside");
  });
  it("altitudes de la route inconnues : « unknown »", () => {
    const noAlt = { points: [pt("a", 46, 1, null), pt("b", 46, 3, null)] };
    expect(sigmetsAlongRoute(noAlt, [sg()], T0, T0 + H)[0]!.vertical).toBe("unknown");
  });
  it("validité ne recouvrant pas le vol : ignoré ; polygone ailleurs : ignoré", () => {
    expect(sigmetsAlongRoute(route, [sg({ validTo: T0 - 1 })], T0, T0 + H)).toEqual([]);
    expect(sigmetsAlongRoute(route, [sg({ validFrom: T0 + 10 * H, validTo: T0 + 12 * H })], T0, T0 + H)).toEqual([]);
    expect(sigmetsAlongRoute(route, [sg({ areas: [[[10, 10], [11, 10], [11, 11], [10, 10]]] })], T0, T0 + H)).toEqual([]);
  });
  it("plusieurs SIGMET : dans l'ordre de rencontre", () => {
    const a = sg({ id: "a", areas: [[[2.5, 45.5], [2.9, 45.5], [2.9, 46.5], [2.5, 46.5], [2.5, 45.5]]] });
    const b = sg({ id: "b" });
    expect(sigmetsAlongRoute(route, [a, b], T0, T0 + H).map((x) => x.sigmet.id)).toEqual(["b", "a"]);
  });
});
