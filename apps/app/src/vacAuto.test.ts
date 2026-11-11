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

describe("téléchargement d'une VAC", () => {
  it("vérifie l'empreinte et signale la progression", async () => {
    const { downloadVac, loadVacIndex, vacFor } = await import("./vacAuto");
    const bytes = new TextEncoder().encode("%PDF-test");
    const { sha256Hex } = await import("./dataPack");
    const sha = await sha256Hex(bytes.buffer as ArrayBuffer);
    const idx = { format: "lim-nav-vac-index", version: 1, filesBase: "https://x.test/vac", entries: [{ icao: "LFBI", sha256: sha, file: "LFBI.pdf", bytes: bytes.length, chartDate: "2026-10-29", page: 1, georef: { ar: 1, ai: 0, tx: 0, ty: 0 }, renderScale: 2, frame: null, groundMetersPerPoint: 1, residualPt: 0.1 }] };
    const f = (async (u: string) => (String(u).endsWith("index.json") ? new Response(JSON.stringify(idx)) : new Response(bytes))) as unknown as typeof fetch;
    const index = await loadVacIndex("https://x.test", f);
    const e = vacFor(index, "LFBI");
    expect(e?.file).toBe("LFBI.pdf");
    const seen: number[] = [];
    const d = await downloadVac(e!, (done) => seen.push(done), undefined, f);
    expect(d.sourceDate).toBe("SIA 2026-10-29");
    expect(seen.length).toBeGreaterThan(0);
    await expect(downloadVac({ ...e!, sha256: "0".repeat(64) }, () => undefined, undefined, f)).rejects.toThrow(/corrompu/);
  });
});
