import { countTiles, tilesOf, type BBox } from "@lim/core";

/**
 * Fonds de carte de l'IGN (Géoplateforme, service WMTS ouvert `data.geopf.fr`, Licence Ouverte, en-têtes CORS vérifiés) :
 * plan IGN, photographies aériennes, relief ombré LiDAR HD. Affichés en ligne ; une zone peut être téléchargée pour le hors-ligne
 * (tuiles gardées dans le Cache Storage du navigateur). Pas de carte OACI : elle n'est pas dans ce service ouvert.
 */
export type BaseMapId = "plan" | "ortho" | "relief";

export interface BaseMapDef {
  readonly id: BaseMapId;
  readonly layer: string;
  readonly format: "image/png" | "image/jpeg";
  readonly maxZoom: number;
  /** Poids moyen d'une tuile (octets), pour estimer un téléchargement : mesuré sur quelques tuiles, donc approximatif. */
  readonly avgTileBytes: number;
}

export const BASE_MAPS: Readonly<Record<BaseMapId, BaseMapDef>> = {
  plan: { id: "plan", layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", format: "image/png", maxZoom: 19, avgTileBytes: 22_000 },
  ortho: { id: "ortho", layer: "ORTHOIMAGERY.ORTHOPHOTOS", format: "image/jpeg", maxZoom: 19, avgTileBytes: 30_000 },
  relief: { id: "relief", layer: "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW", format: "image/png", maxZoom: 18, avgTileBytes: 40_000 },
};

export const IGN_ATTRIBUTION = "© IGN";

/** Adresse réelle d'une tuile sur le service IGN (matrice « PM » = grille XYZ Web Mercator). */
export function wmtsUrl(def: BaseMapDef, z: number, x: number, y: number): string {
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${def.layer}&STYLE=normal&FORMAT=${def.format}&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
}

export const CACHE_NAME = "lim-tiles-v1";
const TILE_TIMEOUT_MS = 20_000;

async function openCache(): Promise<Cache | null> {
  try {
    return "caches" in globalThis ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

/** Tuile pour l'affichage : d'abord celle téléchargée pour le hors-ligne, sinon le réseau. null = indisponible (hors-ligne, absente). */
export async function getTile(def: BaseMapDef, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const url = wmtsUrl(def, z, x, y);
  const cache = await openCache();
  const hit = cache ? await cache.match(url) : undefined;
  if (hit) return hit.arrayBuffer();
  // Un nouvel essai : le réseau mobile coupe souvent la première requête ; MapLibre ne redemande pas une tuile en échec.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
      if (res.ok) return await res.arrayBuffer();
      if (res.status === 404) return null; // pas de tuile ici (hors couverture)
    } catch { /* nouvel essai */ }
  }
  return null;
}

/** Zone téléchargée pour le hors-ligne. */
export interface AreaRecord {
  readonly id: string;
  readonly name: string;
  readonly map: BaseMapId;
  readonly bbox: BBox;
  readonly zmin: number;
  readonly zmax: number;
  readonly tiles: number;
  /** Poids réel mesuré à la fin du téléchargement. */
  readonly bytes: number;
  readonly at: number;
}

export const MAX_TILES_PER_AREA = 20_000;

export function estimateArea(map: BaseMapId, bbox: BBox, zmin: number, zmax: number): { tiles: number; bytes: number; tooBig: boolean } {
  const tiles = countTiles(bbox, zmin, zmax);
  return { tiles, bytes: tiles * BASE_MAPS[map].avgTileBytes, tooBig: tiles > MAX_TILES_PER_AREA };
}

export interface DownloadProgress { readonly done: number; readonly total: number; readonly bytes: number; readonly failed: number }

/**
 * Télécharge toutes les tuiles d'une zone dans le Cache Storage (6 à la fois, un nouvel essai par tuile). Annulable ;
 * les tuiles déjà en cache ne sont pas retéléchargées. Une tuile impossible à obtenir est comptée, pas fatale (zone partiellement vide).
 */
export async function downloadArea(
  map: BaseMapId, bbox: BBox, zmin: number, zmax: number, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<DownloadProgress> {
  const def = BASE_MAPS[map];
  const cache = await openCache();
  if (!cache) throw new Error("stockage hors-ligne indisponible dans ce navigateur");
  const total = countTiles(bbox, zmin, zmax);
  if (total > MAX_TILES_PER_AREA) throw new Error(`zone trop grande (${total} tuiles, maximum ${MAX_TILES_PER_AREA})`);
  const it = tilesOf(bbox, zmin, zmax);
  let done = 0, bytes = 0, failed = 0, lastReport = 0;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const n = it.next();
      if (n.done) return;
      const t = n.value;
      const url = wmtsUrl(def, t.z, t.x, t.y);
      try {
        const have = await cache.match(url);
        if (have) bytes += Number(have.headers.get("content-length") ?? 0);
        else {
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok && !signal?.aborted; attempt++) {
            try {
              const res = await fetchFn(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
              if (res.ok) {
                const buf = await res.arrayBuffer();
                await cache.put(url, new Response(buf, { headers: { "content-type": def.format, "content-length": String(buf.byteLength) } }));
                bytes += buf.byteLength;
                ok = true;
              }
            } catch { /* nouvel essai */ }
          }
          if (!ok) failed++;
        }
      } catch {
        failed++;
      }
      done++;
      const now = Date.now();
      if (done === total || now - lastReport > 150) { lastReport = now; onProgress({ done, total, bytes, failed }); } // au plus ~7 mises à jour par seconde
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const last = { done, total, bytes, failed };
  onProgress(last);
  if (signal?.aborted) throw new DOMException("annulé", "AbortError");
  return last;
}

/** Retire du Cache Storage toutes les tuiles d'une zone. */
export async function deleteArea(a: Pick<AreaRecord, "map" | "bbox" | "zmin" | "zmax">): Promise<number> {
  const cache = await openCache();
  if (!cache) return 0;
  let n = 0;
  for (const t of tilesOf(a.bbox, a.zmin, a.zmax)) if (await cache.delete(wmtsUrl(BASE_MAPS[a.map], t.z, t.x, t.y))) n++;
  return n;
}

// ---- mémoire locale : zones téléchargées et choix d'affichage
const AREAS_KEY = "lim.areas.v1";
const PREFS_KEY = "lim.basemap.v1";

export function parseAreas(raw: unknown): AreaRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: AreaRecord[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (typeof a !== "object" || a === null) continue;
    const b = a["bbox"] as Record<string, unknown> | undefined;
    const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (typeof a["id"] !== "string" || typeof a["name"] !== "string" || !(a["map"] === "plan" || a["map"] === "ortho" || a["map"] === "relief") || !b) continue;
    if (!num(b["west"]) || !num(b["east"]) || !num(b["south"]) || !num(b["north"]) || !num(a["zmin"]) || !num(a["zmax"]) || !num(a["tiles"]) || !num(a["bytes"]) || !num(a["at"])) continue;
    out.push({ id: a["id"], name: a["name"], map: a["map"], bbox: { west: b["west"], east: b["east"], south: b["south"], north: b["north"] }, zmin: a["zmin"], zmax: a["zmax"], tiles: a["tiles"], bytes: a["bytes"], at: a["at"] });
  }
  return out;
}

export function loadAreas(): AreaRecord[] {
  try {
    return parseAreas(JSON.parse(localStorage.getItem(AREAS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}
export function saveAreas(a: readonly AreaRecord[]): void {
  try {
    localStorage.setItem(AREAS_KEY, JSON.stringify(a));
  } catch { /* stockage bloqué */ }
}

export interface BaseMapPrefs { readonly base: "none" | "plan" | "ortho"; readonly relief: boolean }
export const DEFAULT_BASE_PREFS: BaseMapPrefs = { base: "plan", relief: false };

export function parseBasePrefs(raw: unknown): BaseMapPrefs {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { base: o["base"] === "none" || o["base"] === "ortho" || o["base"] === "plan" ? o["base"] : DEFAULT_BASE_PREFS.base, relief: o["relief"] === true };
}
export function loadBasePrefs(): BaseMapPrefs {
  try {
    return parseBasePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null"));
  } catch {
    return DEFAULT_BASE_PREFS;
  }
}
export function saveBasePrefs(p: BaseMapPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch { /* stockage bloqué */ }
}
