import { describe, expect, it } from "vitest";
import { parseVacIndex } from "./vacAuto";

const entry = (over: Record<string, unknown> = {}) => ({
  icao: "LFCQ", sha256: "a".repeat(64), chartDate: "28 NOV 2024", page: 1, georef: { ar: 18.48, ai: 0, ay: 18.43, tx: 215516, ty: 5439322 },
  renderScale: 2, frame: [50.4, 109, 403.1, 397.7], groundMetersPerPoint: 26.6, residualPt: 0.01, ...over,
});
const index = (entries: unknown[]) => ({ format: "lim-nav-vac-index", version: 1, entries });

describe("index des VAC", () => {
  it("lit une entrée valide, indexée par empreinte", () => {
    const m = parseVacIndex(index([entry()]));
    expect(m.get("a".repeat(64))?.icao).toBe("LFCQ");
    expect(m.get("a".repeat(64))?.georef.ay).toBeCloseTo(18.43, 6);
  });
  it("écarte une entrée mal formée sans casser les autres", () => {
    const m = parseVacIndex(index([entry({ sha256: "pas-un-hash" }), entry({ georef: { ar: "x" } }), entry({ frame: [1, 2] }), entry({ sha256: "b".repeat(64) })]));
    expect(m.size).toBe(1);
    expect(m.has("b".repeat(64))).toBe(true);
  });
  it("accepte une carte sans ay (similitude) et sans cadre", () => {
    const m = parseVacIndex(index([entry({ georef: { ar: 2, ai: 0.1, tx: 1, ty: 2 }, frame: null })]));
    expect([...m.values()][0]?.georef.ay).toBeUndefined();
  });
  it.each([null, {}, { format: "autre", version: 1, entries: [] }, { format: "lim-nav-vac-index", version: 2, entries: [] }, { format: "lim-nav-vac-index", version: 1 }])("refuse un index invalide : %j", (bad) => {
    expect(() => parseVacIndex(bad)).toThrow();
  });
});
