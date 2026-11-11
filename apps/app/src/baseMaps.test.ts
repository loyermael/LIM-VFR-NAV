import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_MAPS, CACHE_NAME, MAX_TILES_PER_AREA, deleteArea, downloadArea, estimateArea, parseAreas, parseBasePrefs, wmtsUrl } from "./baseMaps";

/** Cache Storage minimal en mémoire (Node n'en a pas). */
function installFakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (u: string) => store.get(u)?.clone(),
    put: async (u: string, r: Response) => { store.set(u, r); },
    delete: async (u: string) => store.delete(u),
  };
  (globalThis as unknown as { caches: unknown }).caches = { open: async (n: string) => { expect(n).toBe(CACHE_NAME); return cache; } };
  return store;
}
afterEach(() => { delete (globalThis as { caches?: unknown }).caches; });

const bbox = { west: 0.3, east: 0.35, south: 46.55, north: 46.6 };
const ok = (async () => new Response(new Uint8Array(100))) as unknown as typeof fetch;

describe("adresses des tuiles IGN", () => {
  it("plan, photos, relief : couche, format et matrice PM corrects", () => {
    const u = wmtsUrl(BASE_MAPS.plan, 10, 516, 359);
    expect(u).toContain("https://data.geopf.fr/wmts?");
    expect(u).toContain("LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2");
    expect(u).toContain("FORMAT=image/png");
    expect(u).toContain("TILEMATRIXSET=PM&TILEMATRIX=10&TILEROW=359&TILECOL=516");
    expect(wmtsUrl(BASE_MAPS.ortho, 1, 0, 0)).toContain("FORMAT=image/jpeg");
    expect(wmtsUrl(BASE_MAPS.relief, 1, 0, 0)).toContain("LIDAR-HD_MNT");
  });
});

describe("téléchargement d'une zone", () => {
  it("estimation et refus des zones trop grandes", () => {
    const e = estimateArea("plan", bbox, 8, 12);
    expect(e.tiles).toBeGreaterThan(5);
    expect(e.bytes).toBe(e.tiles * BASE_MAPS.plan.avgTileBytes);
    expect(e.tooBig).toBe(false);
    expect(estimateArea("plan", { west: -5, east: 9, south: 41, north: 51 }, 6, 16).tooBig).toBe(true);
  });
  it("télécharge toutes les tuiles, mesure le poids réel, progression croissante jusqu'à 100 %", async () => {
    const store = installFakeCaches();
    const seen: number[] = [];
    const res = await downloadArea("plan", bbox, 9, 11, (p) => seen.push(p.done), undefined, ok);
    expect(res.done).toBe(res.total);
    expect(res.failed).toBe(0);
    expect(res.bytes).toBe(res.total * 100);
    expect(store.size).toBe(res.total);
    expect(seen[seen.length - 1]).toBe(res.total);
    expect(seen.every((v, i) => i === 0 || v >= (seen[i - 1] as number))).toBe(true);
  });
  it("les tuiles déjà en cache ne sont pas retéléchargées", async () => {
    installFakeCaches();
    const f = vi.fn(ok);
    await downloadArea("plan", bbox, 10, 10, () => undefined, undefined, f as unknown as typeof fetch);
    const first = f.mock.calls.length;
    await downloadArea("plan", bbox, 10, 10, () => undefined, undefined, f as unknown as typeof fetch);
    expect(f.mock.calls.length).toBe(first);
  });
  it("une tuile qui échoue est comptée (2 essais), la zone reste utilisable", async () => {
    installFakeCaches();
    let n = 0;
    const flaky = (async () => { n++; if (n <= 2) throw new TypeError("réseau"); return new Response(new Uint8Array(10)); }) as unknown as typeof fetch;
    const res = await downloadArea("plan", bbox, 10, 10, () => undefined, undefined, flaky);
    expect(res.failed).toBeLessThanOrEqual(1);
    expect(res.done).toBe(res.total);
  });
  it("erreur HTTP : tuile comptée en échec, rien n'est stocké", async () => {
    const store = installFakeCaches();
    const res = await downloadArea("plan", bbox, 10, 10, () => undefined, undefined, (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    expect(res.failed).toBe(res.total);
    expect(store.size).toBe(0);
  });
  it("annulation : s'arrête et le signale", async () => {
    installFakeCaches();
    const ctl = new AbortController();
    const slow = (async () => { ctl.abort(); return new Response(new Uint8Array(5)); }) as unknown as typeof fetch;
    await expect(downloadArea("plan", bbox, 9, 12, () => undefined, ctl.signal, slow)).rejects.toThrow(/annulé/);
  });
  it("zone trop grande : refusée avant tout téléchargement", async () => {
    installFakeCaches();
    const f = vi.fn(ok);
    await expect(downloadArea("plan", { west: -5, east: 9, south: 41, north: 51 }, 6, 16, () => undefined, undefined, f as unknown as typeof fetch)).rejects.toThrow(String(MAX_TILES_PER_AREA));
    expect(f).not.toHaveBeenCalled();
  });
  it("suppression d'une zone : retire ses tuiles du cache", async () => {
    const store = installFakeCaches();
    const res = await downloadArea("plan", bbox, 10, 10, () => undefined, undefined, ok);
    expect(store.size).toBe(res.total);
    expect(await deleteArea({ map: "plan", bbox, zmin: 10, zmax: 10 })).toBe(res.total);
    expect(store.size).toBe(0);
  });
  it("sans Cache Storage : erreur claire", async () => {
    await expect(downloadArea("plan", bbox, 10, 10, () => undefined, undefined, ok)).rejects.toThrow(/stockage hors-ligne/);
  });
});

describe("mémoire locale", () => {
  it("zones : valides gardées, le reste écarté", () => {
    const good = { id: "a", name: "Poitou", map: "plan", bbox: { west: 0, east: 1, south: 46, north: 47 }, zmin: 8, zmax: 12, tiles: 10, bytes: 1000, at: 5 };
    expect(parseAreas([good, { ...good, map: "autre" }, { ...good, bbox: { west: "x" } }, null, 3])).toEqual([good]);
    expect(parseAreas("n'importe quoi")).toEqual([]);
  });
  it("choix d'affichage : valeurs inconnues → plan IGN sans relief", () => {
    expect(parseBasePrefs(null)).toEqual({ base: "plan", relief: false });
    expect(parseBasePrefs({ base: "ortho", relief: true })).toEqual({ base: "ortho", relief: true });
    expect(parseBasePrefs({ base: "oaci", relief: "oui" })).toEqual({ base: "plan", relief: false });
  });
});
