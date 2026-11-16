import { describe, expect, it } from "vitest";
import { isGroundRelative, limitToMeters, niceStep, positionAlong, profileTop, projectOnRoute, routeProfilePoints } from "./spacesProfile";

describe("profil vertical des espaces", () => {
  it("limites : FL en atmosphère standard, AMSL et AGL en mètres", () => {
    expect(limitToMeters({ reference: "FL", value: 100 })).toBeCloseTo(3048, 0);
    expect(limitToMeters({ reference: "AMSL", value: 1200 })).toBe(1200);
    expect(limitToMeters({ reference: "AGL", value: 300 })).toBe(300);
  });
  it("seule une limite au-dessus du sol non nulle est « relative au sol » (SOL = exact)", () => {
    expect(isGroundRelative({ reference: "AGL", value: 0 })).toBe(false);
    expect(isGroundRelative({ reference: "AGL", value: 150 })).toBe(true);
    expect(isGroundRelative({ reference: "AMSL", value: 150 })).toBe(false);
  });
  it("graduations rondes et sommet du graphique", () => {
    expect(niceStep(12000)).toBe(4000);
    expect(profileTop(3500, 8000)).toBe(8000);
    expect(profileTop(9000, 8000)).toBeGreaterThanOrEqual(13500);
  });
  it("points de route : distance cumulée croissante et altitudes conservées", () => {
    const pts = [
      { position: { lat: 47, lon: 2 }, altitude: 300 },
      { position: { lat: 47.1, lon: 2 }, altitude: null },
      { position: { lat: 47.2, lon: 2 }, altitude: 600 },
    ] as never;
    const r = routeProfilePoints(pts);
    expect(r[0]).toEqual({ d: 0, alt: 300 });
    expect(r[1]?.d).toBeGreaterThan(10000);
    expect(r[2]?.d).toBeGreaterThan(r[1]?.d as number);
    expect(r[1]?.alt).toBeNull();
  });
});

describe("curseur : projection sur la route et position le long de la route", () => {
  const pts = [
    { position: { lat: 47, lon: 2 }, altitude: 300 },
    { position: { lat: 47.2, lon: 2 }, altitude: 900 },
    { position: { lat: 47.2, lon: 2.3 }, altitude: 900 },
  ] as never;
  const total = routeProfilePoints(pts)[2]!.d;
  it("un point sur la route se projette sur lui-même (écart nul)", () => {
    const mid = positionAlong(pts, 10000)!;
    const pr = projectOnRoute(pts, mid)!;
    expect(pr.along).toBeGreaterThan(9990);
    expect(pr.along).toBeLessThan(10010);
    expect(pr.offset).toBeLessThan(15);
  });
  it("un point à côté de la route : distance le long de la route et écart latéral", () => {
    const pr = projectOnRoute(pts, { lat: 47.1, lon: 2.01 })!;
    expect(pr.offset).toBeGreaterThan(700);
    expect(pr.offset).toBeLessThan(800);
    expect(pr.along).toBeGreaterThan(10900);
    expect(pr.along).toBeLessThan(11300);
  });
  it("hors de la route : projection au plus proche des extrémités ; altitude interpolée", () => {
    expect(projectOnRoute(pts, { lat: 46.9, lon: 2 })!.along).toBe(0);
    expect(positionAlong(pts, 0)!.alt).toBe(300);
    expect(positionAlong(pts, total + 5000)!.lon).toBeCloseTo(2.3, 3);
    const half = positionAlong(pts, (routeProfilePoints(pts)[1]!.d) / 2)!;
    expect(half.alt).toBeCloseTo(600, 0);
  });
});

describe("route aller-retour : les deux branches se superposent", () => {
  const ar = [
    { position: { lat: 47, lon: 2 }, altitude: null },
    { position: { lat: 47.2, lon: 2 }, altitude: null },
    { position: { lat: 47, lon: 2 }, altitude: null },
  ] as never;
  it("sans indice : la première branche ; avec un indice : la branche la plus proche de l'indice", () => {
    const p = { lat: 47.1, lon: 2 };
    const out = projectOnRoute(ar, p)!;
    const back = projectOnRoute(ar, p, 30000)!;
    expect(out.along).toBeLessThan(12000);
    expect(back.along).toBeGreaterThan(30000);
  });
});
