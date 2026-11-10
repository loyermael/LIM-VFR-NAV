import { openMeteoWindUrl, parseOpenMeteoWinds, type WindForecast } from "@lim/core";
import { tx } from "./db";

/** Prévisions de vent mises en cache sur l'appareil (clé : position arrondie à 0,1°). */
interface WindRecord { readonly id: string; readonly forecast: WindForecast }

export const windKey = (lat: number, lon: number) => `wind:${lat.toFixed(1)},${lon.toFixed(1)}`;
/** Une prévision plus vieille que ceci est considérée périmée (le modèle est mis à jour toutes les 1 à 6 heures). JUGÉ. */
export const WIND_STALE_MS = 6 * 3_600_000;

export const loadWindCache = (): Promise<WindForecast[]> =>
  tx("weather", "readonly", (s) => s.getAll() as IDBRequest<(WindRecord | { id: string })[]>).then((all) =>
    (all as WindRecord[]).filter((r) => r.id.startsWith("wind:")).map((r) => r.forecast),
  );

const saveWind = (f: WindForecast): Promise<IDBValidKey> =>
  tx("weather", "readwrite", (s) => s.put({ id: windKey(f.lat, f.lon), forecast: f } satisfies WindRecord));

/** Télécharge la prévision de vent (réseau requis), la conserve et la rend. Lève une erreur au message lisible. */
export async function fetchWinds(lat: number, lon: number, hours = 48): Promise<WindForecast> {
  let res: Response;
  try {
    res = await fetch(openMeteoWindUrl(lat, lon, hours), { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Réseau indisponible (la dernière prévision reçue reste affichée, avec son âge).");
  }
  if (!res.ok) throw new Error(`Service de prévision indisponible (HTTP ${res.status}).`);
  const f = parseOpenMeteoWinds(await res.json(), Date.now());
  await saveWind(f).catch(() => undefined);
  return f;
}
