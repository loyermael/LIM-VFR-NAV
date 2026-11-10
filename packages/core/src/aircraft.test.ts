import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeBalance, envelopeLimitsAt, insideEnvelope, planFuel, validateAircraft, type Aircraft } from "./aircraft";

/**
 * Avion FICTIF servant uniquement aux tests (aucun avion réel) : masse à vide 600 kg, bras 1,00 m ;
 * enveloppe : 600→950 kg, bras avant 0,95→1,05 m, bras arrière 1,35 m.
 * Postes : pilote 0,90 m (max 110), passager 0,90 m (max 110), bagages 1,60 m (max 20), carburant 1,10 m (80 L, 0,72 kg/L).
 */
const AC: Aircraft = {
  id: "t", name: "Avion d'essai", registration: "F-TEST", tasMps: 51.44, fuelFlowLph: 30,
  fuel: { capacity: 80, unusable: 2, density: 0.72 },
  emptyMass: 600, emptyArm: 1.0,
  stations: [
    { id: "pilot", name: "Pilote", kind: "occupant", arm: 0.9, maxMass: 110 },
    { id: "pax", name: "Passager", kind: "occupant", arm: 0.9, maxMass: 110 },
    { id: "bag", name: "Bagages", kind: "baggage", arm: 1.6, maxMass: 20 },
    { id: "fuel", name: "Carburant", kind: "fuel", arm: 1.1, maxMass: null },
  ],
  envelope: [[0.95, 600], [0.95, 800], [1.05, 950], [1.35, 950], [1.35, 600]],
  maxTakeoffMass: 950, maxLandingMass: null, updatedAt: 0,
};

describe("enveloppe", () => {
  it("limites avant / arrière à une masse donnée (interpolation du bord incliné)", () => {
    expect(envelopeLimitsAt(AC.envelope, 700)).toEqual({ forward: 0.95, aft: 1.35 });
    const l = envelopeLimitsAt(AC.envelope, 875)!; // bord avant : 0,95 → 1,05 entre 800 et 950 kg
    expect(l.forward).toBeCloseTo(1.0, 9);
    expect(l.aft).toBe(1.35);
  });
  it("masse hors plage : pas de limites", () => {
    expect(envelopeLimitsAt(AC.envelope, 500)).toBeNull();
    expect(envelopeLimitsAt(AC.envelope, 1000)).toBeNull();
  });
  it("dedans, bord compris, dehors", () => {
    expect(insideEnvelope(AC.envelope, 1.1, 800)).toBe(true);
    expect(insideEnvelope(AC.envelope, 0.95, 700)).toBe(true);
    expect(insideEnvelope(AC.envelope, 0.9, 700)).toBe(false);
    expect(insideEnvelope(AC.envelope, 1.4, 700)).toBe(false);
    expect(insideEnvelope(AC.envelope, 1.1, 1000)).toBe(false);
  });
});

describe("masse et centrage : calcul à la main", () => {
  // Pilote 80 + passager 70 à 0,9 m, bagages 10 à 1,6 m, carburant 40 L = 28,8 kg à 1,1 m.
  const loads = { pilot: 80, pax: 70, bag: 10, fuel: 40 };
  const r = computeBalance(AC, loads, 15);
  it("point zéro carburant : 600 + 80 + 70 + 10 = 760 kg ; moment 600 + 72 + 63 + 16 = 751 kg·m ; CG 0,9882 m", () => {
    expect(r.zeroFuel.mass).toBeCloseTo(760, 9);
    expect(r.zeroFuel.moment).toBeCloseTo(751, 9);
    expect(r.zeroFuel.cg).toBeCloseTo(751 / 760, 9);
  });
  it("décollage : + 28,8 kg à 1,1 m = 788,8 kg ; moment 782,68 ; CG 0,99228 m", () => {
    expect(r.takeoff.mass).toBeCloseTo(788.8, 9);
    expect(r.takeoff.moment).toBeCloseTo(782.68, 9);
    expect(r.takeoff.cg).toBeCloseTo(782.68 / 788.8, 9);
  });
  it("atterrissage après 15 L consommés : 25 L restants = 18 kg ; 778 kg", () => {
    expect(r.fuelLiters).toEqual({ takeoff: 40, landing: 25 });
    expect(r.landing.mass).toBeCloseTo(778, 9);
    expect(r.landing.moment).toBeCloseTo(751 + 18 * 1.1, 9);
  });
  it("dans l'enveloppe, sans défaut, avec une marge positive", () => {
    expect(r.takeoff.inEnvelope).toBe(true);
    expect(r.takeoff.issues).toEqual([]);
    expect(r.takeoff.cgMargin).toBeGreaterThan(0);
    expect(r.takeoff.cgMargin).toBeCloseTo(Math.min(r.takeoff.cg - 0.95, 1.35 - r.takeoff.cg), 9);
  });
  it("détail par poste", () => {
    expect(r.lines.find((l) => l.station.id === "bag")).toMatchObject({ mass: 10, moment: 16 });
    expect(r.lines.find((l) => l.station.id === "fuel")!.mass).toBeCloseTo(28.8, 9);
  });
});

describe("défauts signalés, jamais passés sous silence", () => {
  it("masse maximale dépassée", () => {
    const r = computeBalance({ ...AC, maxTakeoffMass: 880 }, { pilot: 110, pax: 110, bag: 20, fuel: 80 });
    expect(r.takeoff.mass).toBeCloseTo(600 + 110 + 110 + 20 + 57.6, 9); // 897,6 kg > 880 kg
    expect(r.takeoff.issues).toContain("overweight");
    expect(computeBalance(AC, { pilot: 110, pax: 110, bag: 20, fuel: 80 }).takeoff.issues).not.toContain("overweight"); // 897,6 < 950
  });
  it("CG trop en avant : un seul occupant lourd devant, peu de carburant", () => {
    const front: Aircraft = { ...AC, stations: AC.stations.map((s) => (s.id === "pilot" ? { ...s, arm: 0.3 } : s)) };
    const r = computeBalance(front, { pilot: 100, pax: 0, bag: 0, fuel: 10 });
    expect(r.takeoff.issues).toContain("cg-forward");
    expect(r.takeoff.inEnvelope).toBe(false);
    expect(r.takeoff.cgMargin!).toBeLessThan(0);
  });
  it("CG trop en arrière : bagages à la limite et personne devant", () => {
    const aft: Aircraft = { ...AC, stations: AC.stations.map((s) => (s.id === "bag" ? { ...s, arm: 3.0, maxMass: 200 } : s)) };
    const r = computeBalance(aft, { pilot: 60, pax: 0, bag: 150, fuel: 5 });
    expect(r.takeoff.issues).toContain("cg-aft");
  });
  it("poste surchargé, réservoir au-delà de sa capacité, charge négative", () => {
    expect(computeBalance(AC, { bag: 25 }).takeoff.issues).toContain("station-overload");
    expect(computeBalance(AC, { fuel: 90 }).takeoff.issues).toContain("fuel-over-capacity");
    expect(computeBalance(AC, { pilot: -5 }).takeoff.issues).toContain("negative-load");
    expect(computeBalance(AC, { pilot: Number.NaN }).takeoff.issues).toContain("negative-load");
  });
  it("masse hors de la plage de l'enveloppe : « hors enveloppe », sans limites ni marge inventées", () => {
    const light = computeBalance({ ...AC, emptyMass: 300 }, {});
    expect(light.takeoff.limits).toBeNull();
    expect(light.takeoff.cgMargin).toBeNull();
    expect(light.takeoff.issues).toContain("outside-envelope");
  });
  it("masse maximale à l'atterrissage, si la fiche en donne une", () => {
    const r = computeBalance({ ...AC, maxLandingMass: 700 }, { pilot: 80, pax: 70, fuel: 40 }, 0);
    expect(r.landing.issues).toContain("overweight-landing");
    expect(r.takeoff.issues).not.toContain("overweight-landing");
  });
});

describe("carburant consommé", () => {
  it("jamais plus que ce qu'il y a dans les réservoirs ; plusieurs réservoirs vidés dans l'ordre", () => {
    const two: Aircraft = { ...AC, stations: [...AC.stations.filter((s) => s.id !== "fuel"), { id: "f1", name: "Réservoir 1", kind: "fuel", arm: 1.0, maxMass: null }, { id: "f2", name: "Réservoir 2", kind: "fuel", arm: 1.2, maxMass: null }] };
    const r = computeBalance(two, { f1: 10, f2: 20 }, 15);
    expect(r.fuelLiters.landing).toBeCloseTo(15, 9); // f1 vidé (10), f2 : 20 − 5
    expect(computeBalance(AC, { fuel: 10 }, 999).fuelLiters.landing).toBe(0);
    expect(computeBalance(AC, { fuel: 10 }, -5).fuelLiters.landing).toBe(10);
  });
});

describe("propriétés (fast-check)", () => {
  it("la masse totale est la somme des masses ; le CG est toujours entre le plus avant et le plus arrière des bras utilisés", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 110, noNaN: true }), fc.double({ min: 0, max: 110, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), fc.double({ min: 0, max: 80, noNaN: true }), (pilot, pax, bag, fuel) => {
        const r = computeBalance(AC, { pilot, pax, bag, fuel });
        const m = 600 + pilot + pax + bag + fuel * 0.72;
        const arms = [1.0, 0.9, 1.6, 1.1];
        return Math.abs(r.takeoff.mass - m) < 1e-6 && r.takeoff.cg >= Math.min(...arms) - 1e-9 && r.takeoff.cg <= Math.max(...arms) + 1e-9;
      }),
      { numRuns: 300 },
    );
  });
  it("brûler du carburant ne change jamais la masse au point zéro carburant et fait baisser la masse à l'atterrissage", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 80, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), (fuel, burn) => {
        const a = computeBalance(AC, { pilot: 80, fuel }, 0);
        const b = computeBalance(AC, { pilot: 80, fuel }, burn);
        return Math.abs(a.zeroFuel.mass - b.zeroFuel.mass) < 1e-9 && b.landing.mass <= a.landing.mass + 1e-9 && b.landing.mass >= b.zeroFuel.mass - 1e-9;
      }),
      { numRuns: 300 },
    );
  });
});

describe("validation de la fiche", () => {
  it("fiche complète : aucun défaut", () => expect(validateAircraft(AC)).toEqual([]));
  it("défauts nommés", () => {
    expect(validateAircraft({ ...AC, emptyMass: 0 })).toContain("masse à vide");
    expect(validateAircraft({ ...AC, maxTakeoffMass: 500 }).join()).toMatch(/masse maximale/);
    expect(validateAircraft({ ...AC, envelope: [[1, 600], [1.2, 900]] }).join()).toMatch(/enveloppe/);
    expect(validateAircraft({ ...AC, stations: [] })).toContain("postes de chargement");
    expect(validateAircraft({ ...AC, fuel: { ...AC.fuel, density: 0 } }).join()).toMatch(/carburant/);
  });
});

describe("plan de carburant", () => {
  const base = { tripLiters: 50, taxiLiters: 2, contingencyPercent: 10, alternateMinutes: 20, reserveMinutes: 30, fuelFlowLph: 30, onboardLiters: 100, usableCapacityLiters: 120 };
  it("2 roulage + 50 trajet + 5 aléas (10 %) + 10 déroutement (20 min à 30 L/h) + 15 réserve = 82 L", () => {
    const p = planFuel(base);
    expect(p.contingency).toBeCloseTo(5, 9);
    expect(p.alternate).toBeCloseTo(10, 9);
    expect(p.reserve).toBeCloseTo(15, 9);
    expect(p.required).toBeCloseTo(82, 9);
    expect(p.surplus).toBeCloseTo(18, 9);
    expect(p.sufficient).toBe(true);
    expect(p.endurance).toBeCloseTo(100 / 30, 9);
  });
  it("carburant insuffisant : déficit négatif, « sufficient » faux ; dépassement de capacité signalé", () => {
    const p = planFuel({ ...base, onboardLiters: 60 });
    expect(p.surplus).toBeCloseTo(-22, 9);
    expect(p.sufficient).toBe(false);
    expect(planFuel({ ...base, onboardLiters: 130 }).overCapacity).toBe(true);
  });
  it("trajet ou consommation inconnus : pas de total inventé", () => {
    const p = planFuel({ ...base, tripLiters: null });
    expect(p.required).toBeNull();
    expect(p.sufficient).toBeNull();
    const q = planFuel({ ...base, fuelFlowLph: null });
    expect(q.required).toBeNull();
    expect(q.endurance).toBeNull();
  });
  it("valeurs négatives ramenées à zéro", () => {
    const p = planFuel({ ...base, taxiLiters: -5, contingencyPercent: -10, reserveMinutes: -30 });
    expect(p.taxi).toBe(0);
    expect(p.contingency).toBe(0);
    expect(p.reserve).toBe(0);
  });
});
