import { describe, expect, it } from "vitest";
import { normalizeGeoJSON } from "./overlays";

const pt = { type: "Point", coordinates: [2, 46] } as const;

describe("normalizeGeoJSON", () => {
  it("garde une FeatureCollection", () => {
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "A" }, geometry: pt }] };
    expect(normalizeGeoJSON(fc).features).toHaveLength(1);
  });
  it("enveloppe une Feature seule et une géométrie nue", () => {
    expect(normalizeGeoJSON({ type: "Feature", properties: {}, geometry: pt }).features).toHaveLength(1);
    expect(normalizeGeoJSON(pt).features[0]?.geometry).toEqual(pt);
  });
  it("écarte les entités invalides mais refuse un fichier sans aucune entité valide", () => {
    const mixed = { type: "FeatureCollection", features: [{ type: "Feature", geometry: pt }, { type: "Feature", geometry: null }] };
    expect(normalizeGeoJSON(mixed).features).toHaveLength(1);
    expect(() => normalizeGeoJSON({ type: "FeatureCollection", features: [{ nope: true }] })).toThrow();
  });
  it("accepte une collection vide, rejette tout ce qui n'est pas du GeoJSON", () => {
    expect(normalizeGeoJSON({ type: "FeatureCollection", features: [] }).features).toEqual([]);
    expect(() => normalizeGeoJSON(null)).toThrow();
    expect(() => normalizeGeoJSON({ type: "Banane" })).toThrow();
    expect(() => normalizeGeoJSON("texte")).toThrow();
  });
});
