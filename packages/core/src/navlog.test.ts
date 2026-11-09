import { describe, expect, it } from "vitest";
import { ARRIVAL_RADIUS_M, computeNavLog, directTo, hasReachedPoint, midCourse, type Performance, type Route, type RoutePoint, type WindPlan } from "./navlog";
import { distance, initialBearing } from "./geodesy";
import { magneticVariation } from "./magnetic";
import { feet, feetToMeters, knots, knotsToMps, litersPerHour, meters, mpsToKnots } from "./units";
import { trueDeg } from "./angles";

const date = new Date("2026-11-10T12:00:00Z");
const kt = (v: number) => knotsToMps(knots(v));
const pt = (id: string, lat: number, lon: number, altFt: number | null = null): RoutePoint => ({
  id, name: id, position: { lat, lon }, altitude: altFt === null ? null : feetToMeters(feet(altFt)),
});
const perf: Performance = { tas: kt(100), fuelFlow: litersPerHour(30) };
const noWind: WindPlan = { default: null, byLeg: {} };

// Géométrie simple : A → B plein est sur le parallèle 46°N (1°), B → C plein nord (1°).
const A = pt("A", 46, 2, 2000);
const B = pt("B", 46, 3, 3000);
const C = pt("C", 47, 3, 3000);
const route: Route = { id: "r", name: "test", points: [A, B, C] };

describe("route d'une branche (au milieu)", () => {
  it("est plein est sur un parallèle, mais le cap initial de l'orthodromie est légèrement au nord de l'est", () => {
    expect(midCourse(A.position, B.position)).toBeCloseTo(90, 1);
  });
  it("sur une longue branche est-ouest, la route au milieu diffère du cap initial d'environ la convergence des méridiens", () => {
    const a = { lat: 46, lon: 0 };
    const b = { lat: 46, lon: 3 };
    const diff = Math.abs(initialBearing(a, b) - midCourse(a, b));
    // convergence ≈ Δlon · sin(lat) / 2 ≈ 1,08° pour 3° de longitude à 46°N
    expect(diff).toBeGreaterThan(0.9);
    expect(diff).toBeLessThan(1.3);
  });
  it("branche de longueur nulle : route 0, pas de plantage", () => {
    expect(midCourse(A.position, A.position)).toBe(0);
  });
});

describe("log de nav sans vent", () => {
  const log = computeNavLog(route, perf, noWind, date);
  it("deux branches, distances géodésiques", () => {
    expect(log.legs).toHaveLength(2);
    expect(log.legs[0]!.distance).toBeCloseTo(distance(A.position, B.position), 6);
    expect(log.legs[1]!.distance).toBeCloseTo(distance(B.position, C.position), 6);
    expect(log.legs[1]!.distance).toBeGreaterThan(110_000);
    expect(log.legs[1]!.distance).toBeLessThan(112_000);
  });
  it("routes vraies : est puis nord", () => {
    expect(log.legs[0]!.trueCourse).toBeCloseTo(90, 1);
    expect(log.legs[1]!.trueCourse).toBeCloseTo(0, 1);
  });
  it("route magnétique = route vraie − variation, variation Est positive en France", () => {
    for (const l of log.legs) {
      expect(l.variation).toBeGreaterThan(0);
      expect(l.variation).toBeLessThan(4);
      expect(l.magneticCourse).toBeCloseTo((l.trueCourse - l.variation + 360) % 360, 9);
    }
    const mv = magneticVariation({ lat: 46.5, lon: 3 }, date).variation;
    expect(log.legs[1]!.variation).toBeCloseTo(mv, 1);
  });
  it("sans vent : vitesse sol = vitesse propre, TAV = TSV, dérive 0, cap = route", () => {
    for (const l of log.legs) {
      expect(l.groundSpeed).toBe(perf.tas);
      expect(l.timeWithWind).toBeCloseTo(l.timeNoWind, 9);
      expect(l.wca).toBe(0);
      expect(l.trueHeading).toBeCloseTo(l.trueCourse, 9);
    }
  });
  it("TSV = distance / vitesse propre", () => {
    const l = log.legs[1]!;
    expect(l.timeNoWind).toBeCloseTo(l.distance / perf.tas, 9);
  });
  it("carburant = consommation × temps (30 L/h)", () => {
    const l = log.legs[1]!;
    expect(l.fuel).toBeCloseTo((30 * l.timeWithWind!) / 3600, 9);
  });
  it("distances cumulées (DSD) et restantes (DTA) cohérentes", () => {
    const [l1, l2] = log.legs as [typeof log.legs[number], typeof log.legs[number]];
    const total = l1.distance + l2.distance;
    expect(log.totals.distance).toBeCloseTo(total, 6);
    expect(l1.distanceFromStart).toBeCloseTo(l1.distance, 6);
    expect(l2.distanceFromStart).toBeCloseTo(total, 6);
    expect(l1.distanceRemaining).toBeCloseTo(total, 6);
    expect(l2.distanceRemaining).toBeCloseTo(l2.distance, 6);
  });
  it("totaux = somme des branches", () => {
    expect(log.totals.timeNoWind).toBeCloseTo(log.legs[0]!.timeNoWind + log.legs[1]!.timeNoWind, 9);
    expect(log.totals.timeWithWind).toBeCloseTo(log.legs[0]!.timeWithWind! + log.legs[1]!.timeWithWind!, 9);
    expect(log.totals.fuel).toBeCloseTo(log.legs[0]!.fuel! + log.legs[1]!.fuel!, 9);
  });
  it("tendance verticale d'après les altitudes des points", () => {
    expect(log.legs[0]!.trend).toBe("climb");
    expect(log.legs[1]!.trend).toBe("level");
    const noAlt = computeNavLog({ ...route, points: [pt("A", 46, 2), pt("B", 46, 3)] }, perf, noWind, date);
    expect(noAlt.legs[0]!.trend).toBeNull();
  });
  it("heure de passage estimée à partir du départ", () => {
    const dep = Date.parse("2026-11-10T09:00:00Z");
    const l = computeNavLog(route, perf, noWind, date, dep);
    expect(l.legs[0]!.eta).toBeCloseTo(dep + l.legs[0]!.timeWithWind! * 1000, 3);
    expect(l.legs[1]!.eta).toBeCloseTo(dep + (l.legs[0]!.timeWithWind! + l.legs[1]!.timeWithWind!) * 1000, 3);
    expect(computeNavLog(route, perf, noWind, date).legs[0]!.eta).toBeNull();
  });
});

describe("log de nav avec vent", () => {
  it("vent de face sur la branche nord (vent du nord 20 kt) : GS 80 kt, TAV > TSV", () => {
    const winds: WindPlan = { default: { direction: trueDeg(0), speed: kt(20) }, byLeg: {} };
    const log = computeNavLog(route, perf, winds, date);
    const l = log.legs[1]!;
    expect(mpsToKnots(l.groundSpeed!)).toBeCloseTo(80, 1);
    expect(l.timeWithWind!).toBeGreaterThan(l.timeNoWind);
    expect(l.timeWithWind!).toBeCloseTo(l.distance / l.groundSpeed!, 6);
  });
  it("vent traversier sur la branche est : dérive non nulle, cap magnétique = cap vrai − variation", () => {
    const winds: WindPlan = { default: { direction: trueDeg(180), speed: kt(20) }, byLeg: {} };
    const l = computeNavLog(route, perf, winds, date).legs[0]!;
    expect(l.wca!).toBeGreaterThan(10);
    expect(l.magneticHeading!).toBeCloseTo((l.trueHeading! - l.variation + 360) % 360, 9);
  });
  it("un vent particulier sur une branche l'emporte sur le vent par défaut", () => {
    const winds: WindPlan = { default: { direction: trueDeg(0), speed: kt(20) }, byLeg: { 1: null } };
    const log = computeNavLog(route, perf, winds, date);
    expect(log.legs[1]!.wind).toBeNull();
    expect(log.legs[1]!.groundSpeed).toBe(perf.tas);
    expect(log.legs[0]!.wind).not.toBeNull();
  });
  it("vent impossible : pas de chiffre inventé (cap, TAV, carburant à null), avertissement, totaux nuls", () => {
    const winds: WindPlan = { default: { direction: trueDeg(180), speed: kt(120) }, byLeg: {} };
    const log = computeNavLog(route, perf, winds, date);
    const l = log.legs[0]!;
    expect(l.error).toBe("wind-too-strong");
    expect(l.trueHeading).toBeNull();
    expect(l.timeWithWind).toBeNull();
    expect(l.fuel).toBeNull();
    expect(log.warnings).toContainEqual({ kind: "wind-too-strong", leg: 0 });
    expect(log.totals.timeWithWind).toBeNull();
    expect(log.totals.fuel).toBeNull();
    expect(log.legs[1]!.cumulativeTime).toBeNull();
    expect(log.totals.timeNoWind).toBeGreaterThan(0);
  });
});

describe("cas limites", () => {
  it("moins de deux points : aucune branche, totaux nuls", () => {
    const log = computeNavLog({ ...route, points: [A] }, perf, noWind, date);
    expect(log.legs).toEqual([]);
    expect(log.totals.distance).toBe(0);
    expect(log.totals.timeWithWind).toBe(0);
    expect(computeNavLog({ ...route, points: [] }, perf, noWind, date).legs).toEqual([]);
  });
  it("modèle magnétique périmé : avertissement", () => {
    const log = computeNavLog(route, perf, noWind, new Date("2033-01-01T00:00:00Z"));
    expect(log.warnings).toContainEqual({ kind: "magnetic-model-expired" });
  });
});

describe("Direct", () => {
  const here = { lat: 46, lon: 2 };
  const target = { lat: 47, lon: 2 };
  it("cap, distance et temps restant", () => {
    const d = directTo(here, target, kt(100), date);
    expect(d.trueBearing).toBeCloseTo(0, 6);
    expect(d.distance).toBeCloseTo(distance(here, target), 6);
    expect(d.timeToGo!).toBeCloseTo(d.distance / kt(100), 9);
    expect(d.magneticBearing).toBeCloseTo((360 - magneticVariation(here, date).variation) % 360, 6);
  });
  it("vitesse inconnue ou quasi nulle : pas de temps restant", () => {
    expect(directTo(here, target, null, date).timeToGo).toBeNull();
    expect(directTo(here, target, meters(0.2) as never, date).timeToGo).toBeNull();
  });
  it("déjà sur le point : distance nulle", () => {
    expect(directTo(here, here, kt(90), date).distance).toBe(0);
  });
});

describe("arrivée au point visé", () => {
  it("sous le rayon d'arrivée : atteint, quelle que soit la vitesse", () => {
    expect(hasReachedPoint(meters(ARRIVAL_RADIUS_M - 1), null)).toBe(true);
    expect(hasReachedPoint(meters(100), kt(0))).toBe(true);
  });
  it("loin et lent : pas atteint", () => {
    expect(hasReachedPoint(meters(5000), kt(80))).toBe(false);
    expect(hasReachedPoint(meters(5000), null)).toBe(false);
  });
  it("à grande vitesse : atteint si on y sera en moins de 10 s (1,5 km à 160 kt = 18 s : non ; 800 m... : oui par le rayon)", () => {
    expect(hasReachedPoint(meters(1500), kt(160))).toBe(false);
    expect(hasReachedPoint(meters(800), kt(160))).toBe(true);
    expect(hasReachedPoint(meters(1000), kt(300))).toBe(true); // 1 000 m à 154 m/s = 6,5 s
  });
});
