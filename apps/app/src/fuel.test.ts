import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PREFS, computeBalance, computeNavLog, litersPerHour, type Aircraft } from "@lim/core";
import { addPoint, newRoute, setDefaultWind, toWindPlan } from "./routeEdit";
import { DEFAULT_FUEL_PLAN } from "./aircraftStore";
import { computeFuelSheet, formatFuel, formatHm } from "./fuel";
import { buildAutoFields } from "./logModel";

// Avion FICTIF de test.
const aircraft: Aircraft = {
  id: "t", name: "Avion de test", registration: "F-TEST", tasMps: 50, fuelFlowLph: 12,
  fuel: { capacity: 45, unusable: 5, density: 0.72 }, emptyMass: 600, emptyArm: 1.0,
  stations: [
    { id: "p", name: "Pilote", kind: "occupant", arm: 0.9, maxMass: null },
    { id: "f", name: "Carburant", kind: "fuel", arm: 1.1, maxMass: null },
  ],
  envelope: [[0.95, 600], [0.95, 800], [1.05, 950], [1.35, 950], [1.35, 600]], maxTakeoffMass: 950, maxLandingMass: null, updatedAt: 1,
};
const prefs = { ...DEFAULT_UNIT_PREFS, fuel: "l" } as typeof DEFAULT_UNIT_PREFS;
const loads = { p: 80, f: 40 };

function logFor(windMps: number) {
  let r = newRoute("r", "Test", 1);
  r = addPoint(r, 47.0, 2.0, "a", 1);
  r = addPoint(r, 47.3, 2.6, "b", 2);
  r = addPoint(r, 47.5, 3.4, "c", 3);
  if (windMps > 0) r = setDefaultWind(r, { directionDeg: windMps > 60 ? 0 : 270, speedMps: windMps }, 4);
  return { r, log: computeNavLog(r, { tas: 50 as never, fuelFlow: litersPerHour(12) }, toWindPlan(r), new Date(Date.UTC(2026, 5, 1)), null) };
}

describe("fuel.ts : fiche carburant unique", () => {
  it("trajet = consommation × temps avec vent, et la base est indiquée", () => {
    const { log } = logFor(8);
    const s = computeFuelSheet({ log, aircraft, loads, plan: DEFAULT_FUEL_PLAN });
    expect(s.tripBasis).toBe("wind");
    expect(s.trip).toBeCloseTo((12 * (log.totals.timeWithWind as number)) / 3600, 9);
    expect(s.trip).toBeCloseTo(log.totals.fuel as number, 9);
  });
  it("sans vent calculable (vent plus fort que la vitesse propre) : repli sur le temps sans vent, base « nowind »", () => {
    const { log } = logFor(80);
    expect(log.totals.timeWithWind).toBeNull();
    const s = computeFuelSheet({ log, aircraft, loads, plan: DEFAULT_FUEL_PLAN });
    expect(s.tripBasis).toBe("nowind");
    expect(s.trip).toBeCloseTo((12 * (log.totals.timeNoWind as number)) / 3600, 9);
  });
  it("bilan : total nécessaire, excédent, arrivée, autonomies", () => {
    const { log } = logFor(0);
    const s = computeFuelSheet({ log, aircraft, loads, plan: { ...DEFAULT_FUEL_PLAN, taxiLiters: 1 } });
    const trip = s.trip as number;
    const reserve = 12 * 0.5; // 30 min
    expect(s.required).toBeCloseTo(1 + trip + trip * 0.1 + 0 + reserve, 9);
    expect(s.surplus).toBeCloseTo(40 - (s.required as number), 9);
    expect(s.arrival).toBeCloseTo(40 - 1 - trip, 9);
    expect(s.enduranceTotalSec).toBeCloseTo((40 / 12) * 3600, 6);
    expect(s.enduranceUsableSec).toBeCloseTo(((40 - 1 - reserve) / 12) * 3600, 6);
    expect(s.burnToLanding).toBeCloseTo(1 + trip, 9);
  });
  it("sans consommation, sans log ou sans embarqué : valeurs nulles, jamais inventées", () => {
    const { log } = logFor(0);
    expect(computeFuelSheet({ log: null, aircraft, loads, plan: DEFAULT_FUEL_PLAN }).trip).toBeNull();
    expect(computeFuelSheet({ log, aircraft: { ...aircraft, fuelFlowLph: null }, loads, plan: DEFAULT_FUEL_PLAN }).trip).toBeNull();
    const none = computeFuelSheet({ log, aircraft, loads: { p: 80 }, plan: DEFAULT_FUEL_PLAN });
    expect(none.arrival).toBeNull();
    expect(none.onboard).toBe(0);
  });
  it("formats : litres à 1 décimale, durées en h:mm", () => {
    expect(formatHm(3 * 3600 + 20 * 60)).toBe("3:20");
    expect(formatHm(59 * 60 + 40)).toBe("1:00");
    expect(formatHm(null)).toBe("—");
    const { log } = logFor(0);
    const v = formatFuel(computeFuelSheet({ log, aircraft, loads, plan: DEFAULT_FUEL_PLAN }), prefs);
    expect(v.onboard).toBe("40.0 L");
    expect(v.enduranceTotal).toBe("3:20");
    expect(v.trip).toMatch(/^\d+\.\d L$/);
  });
});

describe("mêmes chiffres sur toutes les pages", () => {
  it("log (champs préremplis), Carburant (vue) et Centrage (consommation) lisent la même fiche", () => {
    const { r, log } = logFor(8);
    const s = computeFuelSheet({ log, aircraft, loads, plan: { ...DEFAULT_FUEL_PLAN, taxiLiters: 1 } });
    const v = formatFuel(s, prefs);
    const auto = buildAutoFields({ prefs, route: r as never, log, fuel: s, airfields: [] });
    expect(auto["fStart"]).toBe(v.onboard);
    expect(auto["fAuto"]).toBe(v.enduranceTotal);
    expect(auto["fStop"]).toBe(v.arrival);
    // Centrage : le carburant à l'atterrissage = embarqué − roulage − trajet = « à l'arrivée » de la fiche.
    const bal = computeBalance(aircraft, loads, s.burnToLanding ?? 0);
    expect(bal.fuelLiters.landing).toBeCloseTo(s.arrival as number, 9);
    expect(bal.fuelLiters.takeoff).toBeCloseTo(s.onboard, 9);
  });
  it("modifier l'embarqué change l'arrivée, le surplus et l'autonomie partout (même fiche)", () => {
    const { log } = logFor(0);
    const a = computeFuelSheet({ log, aircraft, loads: { p: 80, f: 30 }, plan: DEFAULT_FUEL_PLAN });
    const b = computeFuelSheet({ log, aircraft, loads: { p: 80, f: 40 }, plan: DEFAULT_FUEL_PLAN });
    expect((b.arrival as number) - (a.arrival as number)).toBeCloseTo(10, 9);
    expect((b.surplus as number) - (a.surplus as number)).toBeCloseTo(10, 9);
    expect((b.enduranceTotalSec as number) - (a.enduranceTotalSec as number)).toBeCloseTo((10 / 12) * 3600, 6);
  });
});
