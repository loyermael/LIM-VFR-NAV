import { describe, expect, it } from "vitest";
import { validateAircraft } from "@lim/core";
import {
  addStation, addVertex, duplicateAircraft, envelopeArea, newAircraft, orderEnvelope, patchAircraft, patchFuel, patchStation,
  patchVertex, removeStation, removeVertex,
} from "./aircraftEdit";

describe("fiche neuve : vide, sans donnée d'avion inventée", () => {
  const a = newAircraft("x", "Mon avion", 1);
  it("masses, bras, enveloppe, vitesse et consommation à zéro ou inconnus", () => {
    expect(a.emptyMass).toBe(0);
    expect(a.maxTakeoffMass).toBe(0);
    expect(a.envelope).toEqual([]);
    expect(a.tasMps).toBeNull();
    expect(a.fuelFlowLph).toBeNull();
    expect(a.stations.every((s) => s.arm === 0 && s.maxMass === null)).toBe(true);
  });
  it("quatre postes types (pilote, passager, bagages, carburant), identifiants propres à la fiche", () => {
    expect(a.stations.map((s) => s.kind)).toEqual(["occupant", "occupant", "baggage", "fuel"]);
    expect(a.stations.every((s) => s.id.startsWith("x-"))).toBe(true);
  });
  it("la validation la déclare inutilisable tant qu'elle n'est pas remplie", () => {
    const missing = validateAircraft(a).join(" | ");
    expect(missing).toMatch(/masse à vide/);
    expect(missing).toMatch(/enveloppe/);
  });
});

describe("modifications immuables", () => {
  const a = newAircraft("x", "A", 1);
  it("champs, carburant, postes", () => {
    const b = patchFuel(patchAircraft(a, { emptyMass: 600 }, 2), { capacity: 80 }, 3);
    expect(b.emptyMass).toBe(600);
    expect(b.fuel.capacity).toBe(80);
    expect(b.fuel.density).toBe(0.72);
    expect(b.updatedAt).toBe(3);
    expect(a.emptyMass).toBe(0);
    const c = patchStation(addStation(b, "x-new", 4), 4, { name: "Soute", arm: 1.8, maxMass: 15 }, 5);
    expect(c.stations).toHaveLength(5);
    expect(c.stations[4]).toMatchObject({ id: "x-new", name: "Soute", arm: 1.8, maxMass: 15 });
    expect(removeStation(c, 4, 6).stations).toHaveLength(4);
    expect(removeStation(c, 9, 6)).toBe(c);
    expect(patchStation(c, 9, { arm: 1 }, 6)).toBe(c);
  });
  it("sommets de l'enveloppe", () => {
    let b = addVertex(addVertex(addVertex(a, 0.9, 600, 2), 1.3, 600, 3), 1.3, 900, 4);
    expect(b.envelope).toHaveLength(3);
    b = patchVertex(b, 1, 1.35, 610, 5);
    expect(b.envelope[1]).toEqual([1.35, 610]);
    expect(removeVertex(b, 0, 6).envelope).toHaveLength(2);
    expect(removeVertex(b, 5, 6)).toBe(b);
    expect(patchVertex(b, 5, 0, 0, 6)).toBe(b);
  });
});

describe("mise en ordre de l'enveloppe", () => {
  it("sommets saisis en désordre : le polygone obtenu a la bonne surface (rectangle 0,4 m × 300 kg = 120)", () => {
    let a = newAircraft("x", "A", 1);
    for (const [arm, mass] of [[1.3, 900], [0.9, 600], [1.3, 600], [0.9, 900]] as const) a = addVertex(a, arm, mass, 2);
    expect(envelopeArea(a)).toBeCloseTo(0, 9); // en désordre : polygone croisé, surface nulle
    expect(envelopeArea(orderEnvelope(a, 3))).toBeCloseTo(120, 9);
  });
  it("enveloppe à bord avant incliné (5 sommets) : surface conservée par le tri", () => {
    let a = newAircraft("x", "A", 1);
    for (const [arm, mass] of [[1.35, 600], [0.95, 800], [1.05, 950], [0.95, 600], [1.35, 950]] as const) a = addVertex(a, arm, mass, 2);
    // polygone réel : [0.95,600],[0.95,800],[1.05,950],[1.35,950],[1.35,600]
    const ordered = orderEnvelope(a, 3);
    expect(envelopeArea(ordered)).toBeGreaterThan(100);
    expect(ordered.envelope).toHaveLength(5);
  });
  it("moins de 3 sommets : inchangée", () => {
    const a = addVertex(newAircraft("x", "A", 1), 1, 600, 2);
    expect(orderEnvelope(a, 3)).toBe(a);
  });
});

describe("copie", () => {
  it("nouvel identifiant, nouveaux identifiants de postes, nom marqué", () => {
    const a = newAircraft("x", "A", 1);
    const b = duplicateAircraft(a, "y", 9);
    expect(b.id).toBe("y");
    expect(b.name).toBe("A (copie)");
    expect(b.stations.map((s) => s.id)).toEqual(["y-pilot", "y-pax", "y-bag", "y-fuel"]);
    expect(a.stations[0]!.id).toBe("x-pilot");
  });
});
