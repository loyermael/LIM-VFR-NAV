import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { destination, distance, finalBearing, initialBearing, normalizeLon, type LatLon } from "./geodesy";
import { meters } from "./units";
import { trueDeg } from "./angles";

/** Oracle indépendant : orthodromie sur sphère (formule de haversine), précision ~0,5 %. */
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const PARIS: LatLon = { lat: 48.8566, lon: 2.3522 };
const MARSEILLE: LatLon = { lat: 43.2965, lon: 5.3698 };

describe("distance et caps", () => {
  it("un degré de latitude sur un méridien ≈ 111,2 km (ellipsoïde : 110,6 à 111,7 km)", () => {
    const d = distance({ lat: 45, lon: 3 }, { lat: 46, lon: 3 });
    expect(d).toBeGreaterThan(110_600);
    expect(d).toBeLessThan(111_700);
  });
  it("un degré de latitude à l'équateur et aux pôles diffère (preuve que l'ellipsoïde est utilisé)", () => {
    const eq = distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    const pole = distance({ lat: 89, lon: 0 }, { lat: 90, lon: 0 });
    expect(pole - eq).toBeGreaterThan(900);
  });
  it("cap plein nord / plein est / plein sud / plein ouest", () => {
    const o: LatLon = { lat: 45, lon: 3 };
    expect(initialBearing(o, { lat: 46, lon: 3 })).toBeCloseTo(0, 6);
    expect(initialBearing(o, { lat: 44, lon: 3 })).toBeCloseTo(180, 6);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });
  it("Paris → Marseille : ~660 km, cap initial vers le sud-sud-est", () => {
    const d = distance(PARIS, MARSEILLE);
    expect(d).toBeGreaterThan(655_000);
    expect(d).toBeLessThan(665_000);
    const brg = initialBearing(PARIS, MARSEILLE);
    expect(brg).toBeGreaterThan(155);
    expect(brg).toBeLessThan(180);
  });
  it("distance nulle entre deux points identiques", () => {
    expect(distance(PARIS, PARIS)).toBe(0);
  });
  it("traverse la ligne de changement de date sans erreur", () => {
    const d = distance({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 });
    expect(d).toBeCloseTo(111_319, -2);
  });
});

describe("destination", () => {
  it("1 NM plein nord = 1/60 de degré de latitude (± ellipsoïde)", () => {
    const p = destination({ lat: 45, lon: 3 }, trueDeg(0), meters(1852));
    expect(p.lat - 45).toBeCloseTo(1 / 60, 3);
    expect(p.lon).toBeCloseTo(3, 9);
  });
  it("normalise la longitude", () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(180);
    expect(normalizeLon(-180)).toBe(180);
  });
});

describe("propriétés (fast-check)", () => {
  const point = fc.record({
    lat: fc.double({ min: -80, max: 80, noNaN: true }),
    lon: fc.double({ min: -179, max: 179, noNaN: true }),
  });

  it("la distance est symétrique", () => {
    fc.assert(
      fc.property(point, point, (a, b) => Math.abs(distance(a, b) - distance(b, a)) < 1e-6),
      { numRuns: 300 },
    );
  });
  it("aller : destination(a, cap, d) puis distance et cap retrouvent d et cap", () => {
    fc.assert(
      fc.property(point, fc.double({ min: 0, max: 359.9, noNaN: true }), fc.double({ min: 1000, max: 2_000_000, noNaN: true }), (a, brg, d) => {
        const b = destination(a, trueDeg(brg), meters(d));
        const back = distance(a, b);
        const dBrg = Math.abs(((initialBearing(a, b) - brg + 540) % 360) - 180);
        return Math.abs(back - d) < 1e-3 && dBrg < 1e-6;
      }),
      { numRuns: 300 },
    );
  });
  it("le cap inverse (à l'arrivée + 180) ramène vers le départ", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        if (distance(a, b) < 1000) return true;
        const back = initialBearing(b, a);
        const expected = (finalBearing(a, b) + 180) % 360;
        return Math.abs(((back - expected + 540) % 360) - 180) < 1e-6;
      }),
      { numRuns: 300 },
    );
  });
  it("accord avec la sphère (haversine) à 0,6 % près", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        const d = distance(a, b);
        if (d < 10_000) return true;
        return Math.abs(d - haversine(a, b)) / d < 0.006;
      }),
      { numRuns: 300 },
    );
  });
});
