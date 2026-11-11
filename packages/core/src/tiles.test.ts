import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bboxAround, countTiles, latToTileY, lonToTileX, tileRange, tilesOf } from "./tiles";

describe("tuiles Web Mercator", () => {
  it("valeurs connues : zoom 0 = une tuile ; Greenwich/équateur au zoom 1 = (1,1) ; position connue au zoom 10", () => {
    expect(lonToTileX(2, 0)).toBe(0);
    expect(latToTileY(46, 0)).toBe(0);
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBe(1);
    expect(lonToTileX(0.3067, 10)).toBe(512);
    expect(latToTileY(46.5875, 10)).toBe(361);
    expect(lonToTileX(1.6, 10)).toBe(516); // colonne de la tuile utilisée pour l'essai du service IGN
    expect(latToTileY(47.2, 10)).toBe(359); // ligne de cette même tuile
  });
  it("bornes : longitudes et latitudes extrêmes restent dans la grille", () => {
    expect(lonToTileX(-180, 5)).toBe(0);
    expect(lonToTileX(180, 5)).toBe(31);
    expect(latToTileY(89, 5)).toBe(0);
    expect(latToTileY(-89, 5)).toBe(31);
  });
  it("propriété : un point est toujours dans la plage de tuiles de toute zone qui le contient", () => {
    fc.assert(fc.property(fc.double({ min: -60, max: 60, noNaN: true }), fc.double({ min: -170, max: 170, noNaN: true }), fc.integer({ min: 0, max: 16 }), (lat, lon, z) => {
      const r = tileRange({ west: lon - 0.2, east: lon + 0.2, south: lat - 0.2, north: lat + 0.2 }, z);
      const x = lonToTileX(lon, z), y = latToTileY(lat, z);
      expect(x).toBeGreaterThanOrEqual(r.x0);
      expect(x).toBeLessThanOrEqual(r.x1);
      expect(y).toBeGreaterThanOrEqual(r.y0);
      expect(y).toBeLessThanOrEqual(r.y1);
    }));
  });
  it("comptage = nombre de tuiles énumérées ; le détail pèse de plus en plus lourd (×4 par niveau)", () => {
    const b = { west: 0, east: 1, south: 46, north: 47 };
    expect([...tilesOf(b, 6, 9)]).toHaveLength(countTiles(b, 6, 9));
    const n9 = countTiles(b, 12, 12), n10 = countTiles(b, 13, 13);
    expect(n10 / n9).toBeGreaterThan(3.3);
    expect(n10 / n9).toBeLessThan(4.7);
  });
  it("ordre : les petits niveaux de zoom d'abord", () => {
    const zs = [...tilesOf({ west: 0, east: 0.5, south: 46, north: 46.5 }, 5, 8)].map((t) => t.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
  });
  it("zone autour de points : marge respectée, vide → null, bornée", () => {
    expect(bboxAround([], 1000)).toBeNull();
    const b = bboxAround([{ lat: 46, lon: 1 }, { lat: 47, lon: 2 }], 20000)!;
    expect(b.south).toBeCloseTo(46 - 20000 / 111320, 6);
    expect(b.north).toBeCloseTo(47 + 20000 / 111320, 6);
    expect(b.west).toBeLessThan(1 - 0.2);
    expect(bboxAround([{ lat: 89.9, lon: 179.9 }], 1e6)!.north).toBeLessThanOrEqual(85.06);
  });
});
