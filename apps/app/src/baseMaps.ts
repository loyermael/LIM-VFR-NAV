import { countTiles, tilesOf, type BBox } from "@lim/core";

/**
 * Fonds de carte de l'IGN (Géoplateforme, service WMTS ouvert `data.geopf.fr`, Licence Ouverte, en-têtes CORS vérifiés) :
 * plan IGN, photographies aériennes, relief ombré LiDAR HD. Affichés en ligne ; une zone peut être téléchargée pour le hors-ligne
 * (tuiles gardées dans le Cache Storage du navigateur). Pas de carte OACI : elle n'est pas dans ce service ouvert.
 */
export type BaseMapId = "plan" | "ortho" | "relief" | "aero";

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
  // Fond « aéro » : tuiles vectorielles OpenStreetMap (OpenFreeMap) + relief Terrarium, dessinés au style de la carte OACI. Poids moyen mesuré (200 à 350 Ko par tuile vectorielle + relief, région de Toulouse).
  aero: { id: "aero", layer: "openfreemap+terrarium", format: "image/png", maxZoom: 14, avgTileBytes: 230_000 },
  relief: { id: "relief", layer: "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW", format: "image/png", maxZoom: 18, avgTileBytes: 40_000 },
};

export const IGN_ATTRIBUTION = "© IGN";
export const AERO_ATTRIBUTION = "© contributeurs OpenStreetMap · OpenFreeMap · relief Mapzen/AWS";
/** Le relief (teintes hypsométriques) s'arrête au zoom 12 : au-delà, la tuile du zoom 12 est étirée. */
export const AERO_DEM_MAX_ZOOM = 12;
const AERO_TILEJSON = "https://tiles.openfreemap.org/planet";
const AERO_TPL_KEY = "lim.aero.tpl.v1";
const demUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
/** Clé de cache stable (l'adresse des tuiles vectorielles contient la date de la version du jeu de données, qui change). */
const aeroKey = (kind: "v" | "dem", z: number, x: number, y: number) => `https://lim.local/aero/${kind}/${z}/${x}/${y}`;

/** Modèle d'adresse des tuiles vectorielles : lu dans le TileJSON d'OpenFreeMap, gardé pour le hors-ligne. */
export async function aeroVectorTemplate(fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<string> {
  try {
    const res = await fetchFn(AERO_TILEJSON, { signal: AbortSignal.timeout(8_000) });
    const tpl = res.ok ? ((await res.json()) as { tiles?: unknown }).tiles : null;
    if (Array.isArray(tpl) && typeof tpl[0] === "string" && /^https:\/\//.test(tpl[0])) {
      try { localStorage.setItem(AERO_TPL_KEY, tpl[0]); } catch { /* stockage bloqué */ }
      return tpl[0];
    }
  } catch { /* hors-ligne : dernier modèle connu */ }
  try {
    const saved = localStorage.getItem(AERO_TPL_KEY);
    if (saved) return saved;
  } catch { /* stockage bloqué */ }
  throw new Error("fond aéro indisponible (hors-ligne, jamais chargé)");
}
const fill = (tpl: string, z: number, x: number, y: number) => tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));

/** Tuile du fond aéro pour l'affichage : le cache d'abord (zone téléchargée ou déjà vue), sinon le réseau puis mise en cache. null si indisponible. */
export async function getAeroTile(kind: "v" | "dem", z: number, x: number, y: number, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<ArrayBuffer | null> {
  const key = aeroKey(kind, z, x, y);
  const cache = await openCache();
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit.arrayBuffer();
  try {
    const url = kind === "dem" ? demUrl(z, x, y) : fill(await aeroVectorTemplate(fetchFn), z, x, y);
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (cache) await cache.put(key, new Response(buf.slice(0), { headers: { "content-type": kind === "dem" ? "image/png" : "application/x-protobuf", "content-length": String(buf.byteLength) } })).catch(() => undefined);
    return buf;
  } catch {
    return null;
  }
}

interface TileJob { readonly key: string; readonly url: string; readonly type: string }
/** Fichiers à garder pour une tuile : une seule pour l'IGN ; pour le fond aéro, la tuile vectorielle et (jusqu'au zoom 12) celle du relief. */
function jobsOf(def: BaseMapDef, z: number, x: number, y: number, tpl: string): TileJob[] {
  if (def.id !== "aero") { const u = wmtsUrl(def, z, x, y); return [{ key: u, url: u, type: def.format }]; }
  const jobs: TileJob[] = [{ key: aeroKey("v", z, x, y), url: fill(tpl, z, x, y), type: "application/x-protobuf" }];
  if (z <= AERO_DEM_MAX_ZOOM) jobs.push({ key: aeroKey("dem", z, x, y), url: demUrl(z, x, y), type: "image/png" });
  return jobs;
}

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
  const tpl = map === "aero" ? await aeroVectorTemplate(fetchFn) : "";
  const it = tilesOf(bbox, zmin, zmax);
  let done = 0, bytes = 0, failed = 0, lastReport = 0;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const n = it.next();
      if (n.done) return;
      const t = n.value;
      try {
        let tileFailed = false;
        for (const job of jobsOf(def, t.z, t.x, t.y, tpl)) {
          const have = await cache.match(job.key);
          if (have) { bytes += Number(have.headers.get("content-length") ?? 0); continue; }
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok && !signal?.aborted; attempt++) {
            try {
              const res = await fetchFn(job.url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
              if (res.ok) {
                const buf = await res.arrayBuffer();
                await cache.put(job.key, new Response(buf, { headers: { "content-type": job.type, "content-length": String(buf.byteLength) } }));
                bytes += buf.byteLength;
                ok = true;
              }
            } catch { /* nouvel essai */ }
          }
          if (!ok) tileFailed = true;
        }
        if (tileFailed) failed++;
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
  const def = BASE_MAPS[a.map];
  for (const t of tilesOf(a.bbox, a.zmin, a.zmax)) {
    let any = false;
    for (const job of jobsOf(def, t.z, t.x, t.y, "")) if (await cache.delete(job.key)) any = true;
    if (any) n++;
  }
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
    if (typeof a["id"] !== "string" || typeof a["name"] !== "string" || !(a["map"] === "plan" || a["map"] === "ortho" || a["map"] === "relief" || a["map"] === "aero") || !b) continue;
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

export interface BaseMapPrefs { readonly base: "none" | "plan" | "ortho" | "aero"; readonly relief: boolean }
export const DEFAULT_BASE_PREFS: BaseMapPrefs = { base: "plan", relief: false };

export function parseBasePrefs(raw: unknown): BaseMapPrefs {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { base: o["base"] === "none" || o["base"] === "ortho" || o["base"] === "plan" || o["base"] === "aero" ? o["base"] : DEFAULT_BASE_PREFS.base, relief: o["relief"] === true };
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
