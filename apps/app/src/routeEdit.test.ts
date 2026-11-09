import { describe, expect, it } from "vitest";
import {
  addPoint, fromRouteFile, movePoint, newRoute, nextPointName, removePoint, renamePoint, renameRoute, reverseRoute,
  setDefaultWind, setLegWind, setPointAltitude, swapPoints, toRouteFile, toWindPlan, windFromKnots,
} from "./routeEdit";
import { meters } from "@lim/core";

let n = 0;
const id = () => `id${++n}`;
const base = () => {
  let r = newRoute("r1", "Test", 0);
  r = addPoint(r, 46, 2, id(), 1);
  r = addPoint(r, 46, 3, id(), 2);
  r = addPoint(r, 47, 3, id(), 3);
  return r;
};

describe("ajout et noms", () => {
  it("noms WPT01, WPT02… ; réutilise un nom libéré", () => {
    let r = base();
    expect(r.points.map((p) => p.name)).toEqual(["WPT01", "WPT02", "WPT03"]);
    r = removePoint(r, 0, 4);
    expect(nextPointName(r.points)).toBe("WPT01");
  });
  it("ne modifie jamais la route d'origine (immuable)", () => {
    const r = base();
    const before = JSON.stringify(r);
    addPoint(r, 1, 1, "x", 9);
    removePoint(r, 0, 9);
    swapPoints(r, 0, 1, 9);
    expect(JSON.stringify(r)).toBe(before);
  });
});

describe("modifications", () => {
  it("déplacer un point garde les vents par branche", () => {
    let r = setLegWind(base(), 1, windFromKnots(180, 15), 5);
    r = movePoint(r, 1, 46.5, 3.5, 6);
    expect(r.points[1]!.position).toEqual({ lat: 46.5, lon: 3.5 });
    expect(r.windByLeg[1]).toBeDefined();
  });
  it("retirer, échanger, inverser : effacent les vents par branche (indices changés)", () => {
    const withWind = () => setLegWind(base(), 0, windFromKnots(90, 10), 5);
    expect(removePoint(withWind(), 1, 6).windByLeg).toEqual({});
    expect(swapPoints(withWind(), 0, 2, 6).windByLeg).toEqual({});
    expect(reverseRoute(withWind(), 6).windByLeg).toEqual({});
    expect(addPoint(withWind(), 1, 1, "z", 6).windByLeg).toEqual({});
  });
  it("échanger et inverser", () => {
    const r = swapPoints(base(), 0, 2, 5);
    expect(r.points.map((p) => p.name)).toEqual(["WPT03", "WPT02", "WPT01"]);
    expect(reverseRoute(base(), 5).points.map((p) => p.name)).toEqual(["WPT03", "WPT02", "WPT01"]);
  });
  it("indices invalides : aucun changement, pas de plantage", () => {
    const r = base();
    expect(removePoint(r, 9, 5)).toBe(r);
    expect(removePoint(r, -1, 5)).toBe(r);
    expect(movePoint(r, 9, 0, 0, 5)).toBe(r);
    expect(swapPoints(r, 0, 0, 5)).toBe(r);
    expect(swapPoints(r, 0, 9, 5)).toBe(r);
    expect(setPointAltitude(r, 9, meters(1), 5)).toBe(r);
  });
  it("renommer : espaces retirés, nom vide refusé", () => {
    const r = base();
    expect(renamePoint(r, 0, "  LFBI ", 5).points[0]!.name).toBe("LFBI");
    expect(renamePoint(r, 0, "   ", 5)).toBe(r);
    expect(renameRoute(r, "Ma route", 5).name).toBe("Ma route");
    expect(renameRoute(r, "", 5)).toBe(r);
  });
  it("altitude d'un point, mise à jour de la date", () => {
    const r = setPointAltitude(base(), 1, meters(900), 42);
    expect(r.points[1]!.altitude).toBe(900);
    expect(r.updatedAt).toBe(42);
  });
});

describe("vents", () => {
  it("vent par défaut et vent particulier (null = pas de vent sur la branche)", () => {
    let r = setDefaultWind(base(), windFromKnots(270, 20), 5);
    r = setLegWind(r, 1, null, 6);
    const plan = toWindPlan(r);
    expect(plan.default?.direction).toBe(270);
    expect(1 in plan.byLeg).toBe(true);
    expect(plan.byLeg[1]).toBeNull();
    expect(0 in plan.byLeg).toBe(false);
  });
  it("retour au vent par défaut", () => {
    let r = setLegWind(base(), 0, windFromKnots(90, 5), 5);
    r = setLegWind(r, 0, undefined, 6);
    expect(0 in toWindPlan(r).byLeg).toBe(false);
  });
  it("direction ramenée dans [0, 360[ ; kt → m/s", () => {
    expect(windFromKnots(370, 10).directionDeg).toBe(10);
    expect(windFromKnots(-10, 10).directionDeg).toBe(350);
    expect(windFromKnots(0, 10).speedMps).toBeCloseTo(5.14444, 4);
  });
});

describe("conversion avec les fichiers", () => {
  it("route → fichier → route garde noms, positions et altitudes", () => {
    const r = setPointAltitude(base(), 1, meters(900), 5);
    const back = fromRouteFile(toRouteFile(r), id, 10);
    expect(back.name).toBe("Test");
    expect(back.points.map((p) => p.name)).toEqual(r.points.map((p) => p.name));
    expect(back.points[1]!.altitude).toBe(900);
    expect(back.points[2]!.position).toEqual({ lat: 47, lon: 3 });
    expect(new Set(back.points.map((p) => p.id)).size).toBe(3);
  });
});
