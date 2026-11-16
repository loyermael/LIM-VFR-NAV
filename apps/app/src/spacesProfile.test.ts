import { describe, expect, it } from "vitest";
import { isGroundRelative, limitToMeters, niceStep, profileTop, routeProfilePoints } from "./spacesProfile";

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
