import { openMeteoWindUrl, parseOpenMeteoWinds, type LatLon, type WindForecast } from "@lim/core";
import { tx } from "./db";

/** Prévisions de vent mises en cache sur l'appareil (clé : position arrondie à 0,1°). */
interface WindRecord { readonly id: string; readonly forecast: WindForecast }

export const windKey = (lat: number, lon: number) => `wind:${lat.toFixed(1)},${lon.toFixed(1)}`;
/** Une prévision plus vieille que ceci est considérée périmée (le modèle est mis à jour toutes les 1 à 6 heures). JUGÉ. */
export const WIND_STALE_MS = 6 * 3_600_000;
/** Une prévision plus récente que ceci n'est pas retéléchargée (évite de saturer le service gratuit : HTTP 429). JUGÉ. */
export const WIND_REUSE_MS = 30 * 60_000;

export const loadWindCache = (): Promise<WindForecast[]> =>
  tx("weather", "readonly", (s) => s.getAll() as IDBRequest<(WindRecord | { id: string })[]>).then((all) =>
    (all as WindRecord[]).filter((r) => r.id.startsWith("wind:")).map((r) => r.forecast),
  );

const saveWindAs = (key: string, f: WindForecast): Promise<IDBValidKey> =>
  tx("weather", "readwrite", (s) => s.put({ id: key, forecast: f } satisfies WindRecord));
const loadWindAs = (key: string): Promise<WindForecast | null> =>
  tx("weather", "readonly", (s) => s.get(key) as IDBRequest<WindRecord | undefined>).then((r) => r?.forecast ?? null);

/** Points distincts à la maille du cache (0,1°) : une route dont plusieurs points sont proches ne fait qu'une requête. */
export function uniqueWindPoints(points: readonly LatLon[]): LatLon[] {
  const seen = new Set<string>();
  const out: LatLon[] = [];
  for (const p of points) {
    const k = windKey(p.lat, p.lon);
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

/** Attente avant de réessayer après un refus temporaire (429 ou erreur serveur) ; null = ne pas réessayer. Respecte « Retry-After » (secondes), plafonné à 8 s. */
export function retryDelayMs(status: number, retryAfter: string | null, attempt: number, maxAttempts = 2): number | null {
  if ((status !== 429 && status < 500) || attempt >= maxAttempts) return null;
  const ra = retryAfter === null ? NaN : Number(retryAfter);
  const base = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt;
  return Math.min(base, 8000);
}

/** Message lisible pour un refus du service de prévision. */
export function windHttpMessage(status: number): string {
  return status === 429
    ? "Service de prévision saturé (HTTP 429) : trop de requêtes. Réessayez dans une minute ; la dernière prévision reçue reste utilisée."
    : `Service de prévision indisponible (HTTP ${status}).`;
}

const memory = new Map<string, { at: number; forecast: WindForecast }>();
const inflight = new Map<string, Promise<WindForecast>>();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function download(lat: number, lon: number, hours: number): Promise<WindForecast> {
  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(openMeteoWindUrl(lat, lon, hours), { signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error("Réseau indisponible (la dernière prévision reçue reste affichée, avec son âge).");
    }
    if (res.ok) break;
    const wait = retryDelayMs(res.status, res.headers.get("Retry-After"), attempt);
    if (wait === null) throw new Error(windHttpMessage(res.status));
    await sleep(wait);
  }
  return parseOpenMeteoWinds(await res.json(), Date.now());
}

export const WIND_HORIZON_H = 120; // 5 jours de prévision

/**
 * Prévision de vent d'un point : réutilise une prévision de moins de 30 min (sauf `force`), partage une requête déjà en cours,
 * réessaie après un 429, et en dernier recours rend la dernière prévision gardée sur l'appareil. Lève une erreur au message lisible
 * seulement s'il n'y a rien du tout à montrer.
 */
export async function fetchWinds(lat: number, lon: number, hours = WIND_HORIZON_H, force = false): Promise<WindForecast> {
  const key = windKey(lat, lon);
  const hit = memory.get(key);
  if (!force && hit && Date.now() - hit.at < WIND_REUSE_MS) return hit.forecast;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    try {
      const f = await download(lat, lon, hours);
      memory.set(key, { at: Date.now(), forecast: f });
      await saveWindAs(windKey(f.lat, f.lon), f).catch(() => undefined);
      if (windKey(f.lat, f.lon) !== key) await saveWindAs(key, f).catch(() => undefined);
      return f;
    } catch (e) {
      const old = hit?.forecast ?? (await loadWindAs(key).catch(() => null));
      if (old) return old; // service saturé ou hors ligne : on garde la dernière prévision (son âge reste affiché)
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Prévisions de plusieurs points, rendues dans le même ordre que `points` (un point par entrée, même prévision pour les points proches).
 * Les points regroupés à la maille du cache ne font qu'une requête ; les requêtes partent deux à deux.
 */
export async function fetchWindsMany(points: readonly LatLon[], force = false): Promise<WindForecast[]> {
  const pts = uniqueWindPoints(points);
  const byKey = new Map<string, WindForecast>();
  let next = 0;
  const worker = async () => {
    while (next < pts.length) {
      const p = pts[next++] as LatLon;
      byKey.set(windKey(p.lat, p.lon), await fetchWinds(p.lat, p.lon, WIND_HORIZON_H, force));
    }
  };
  await Promise.all([worker(), worker()]);
  return points.map((p) => byKey.get(windKey(p.lat, p.lon)) as WindForecast);
}
