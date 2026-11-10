import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PREFS, computeNavLog, litersPerHour, type Aircraft } from "@lim/core";
import { buildDossier, sanitize, type DossierInput } from "./dossierPdf";
import { addPoint, newRoute, setDefaultWind, toWindPlan } from "./routeEdit";
import { DEFAULT_FUEL_PLAN } from "./aircraftStore";

// Avion FICTIF de test (aucune donnée d'un appareil réel).
const aircraft: Aircraft = {
  id: "t", name: "Avion de test", registration: "F-TEST", tasMps: 50, fuelFlowLph: 25,
  fuel: { capacity: 100, unusable: 3, density: 0.72 }, emptyMass: 600, emptyArm: 1.0,
  stations: [
    { id: "p", name: "Pilote", kind: "occupant", arm: 0.9, maxMass: null },
    { id: "b", name: "Bagages", kind: "baggage", arm: 1.6, maxMass: 20 },
    { id: "f", name: "Carburant", kind: "fuel", arm: 1.1, maxMass: null },
  ],
  envelope: [[0.95, 600], [0.95, 800], [1.05, 950], [1.35, 950], [1.35, 600]], maxTakeoffMass: 950, maxLandingMass: null, updatedAt: 1,
};

function input(over: Partial<DossierInput> = {}): DossierInput {
  let r = newRoute("r", "Test → Retour ≥ 2", 1);
  r = addPoint(r, 47.0, 2.0, "a", 1);
  r = addPoint(r, 47.3, 2.6, "b", 2);
  r = addPoint(r, 47.5, 3.4, "c", 3);
  r = setDefaultWind(r, { directionDeg: 270, speedMps: 8 }, 4);
  const navLog = computeNavLog(r, { tas: 50 as never, fuelFlow: litersPerHour(25) }, toWindPlan(r), new Date(Date.UTC(2026, 5, 1)), null);
  return {
    lang: "fr", prefs: DEFAULT_UNIT_PREFS, nowMs: Date.UTC(2026, 5, 1, 8, 0), route: r, navLog, aircraft,
    loads: { p: 80, b: 10, f: 60 }, fuelPlan: DEFAULT_FUEL_PLAN, tripLiters: navLog.totals.fuel as number,
    crossed: [], hasAeroData: false, metars: [], tafs: [], ...over,
  };
}

describe("sanitize : polices PDF standard (WinAnsi)", () => {
  it("remplace les caractères hors WinAnsi, garde les accents et les signes courants", () => {
    expect(sanitize("→ ≥ ≤ − ★")).toBe("-> >= <= - *");
    expect(sanitize("Départ à 5° · «ok» €")).toBe("Départ à 5° · «ok» €");
    expect(sanitize("a b")).toBe("a b");
  });
});

describe("dossier PDF", () => {
  it("produit un vrai PDF (en-tête %PDF, plusieurs octets) même avec des caractères hors WinAnsi dans le nom", async () => {
    const bytes = await buildDossier(input());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3000);
    if (process.env["LIM_PDF_OUT"]) {
      mkdirSync(process.env["LIM_PDF_OUT"], { recursive: true });
      writeFileSync(`${process.env["LIM_PDF_OUT"]}/dossier-fr.pdf`, bytes);
      writeFileSync(`${process.env["LIM_PDF_OUT"]}/dossier-en.pdf`, await buildDossier(input({ lang: "en" })));
    }
  });
  it("ne plante pas sans avion, sans log, sans données", async () => {
    const i = input({ aircraft: null, navLog: null, tripLiters: null });
    const bytes = await buildDossier(i);
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it("fiche d'avion incomplète : le dossier se génère quand même", async () => {
    const bytes = await buildDossier(input({ aircraft: { ...aircraft, emptyMass: 0, envelope: [] } }));
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
