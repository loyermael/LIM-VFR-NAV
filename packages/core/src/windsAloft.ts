/**
 * Vents en altitude : prévision de modèle (Open-Meteo) à 18 niveaux de pression et par heure.
 *
 * Les niveaux sont repérés par leur altitude géopotentielle (mètres AMSL) fournie à chaque heure par le modèle :
 * l'interpolation se fait en altitude, pas en pression. Un niveau situé SOUS LE SOL (ex. 1000 hPa en altitude) est écarté :
 * le modèle l'extrapole, ce n'est pas un vent réel. Le vent proche du sol vient de la mesure à 10 m.
 *
 * ESTIMATION : prévision d'un modèle, pas une mesure ; l'altitude de vol est confondue avec l'altitude géopotentielle.
 */
import { trueDeg, type TrueDeg } from "./angles";
import { destination, distance, initialBearing, type LatLon } from "./geodesy";
import type { RoutePoint } from "./navlog";
import { meters, metersPerSecond, type Meters, type MetersPerSecond } from "./units";
import type { Wind } from "./wind";

/** Niveaux de pression demandés au service (hPa), du plus bas au plus haut. */
export const PRESSURE_LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50] as const;

export interface LevelSeries {
  readonly hpa: number;
  /** Altitude géopotentielle par heure (m AMSL) ; null si le modèle ne la fournit pas. */
  readonly height: readonly (number | null)[];
  readonly speed: readonly (number | null)[];
  readonly direction: readonly (number | null)[];
}

export interface WindForecast {
  readonly lat: number;
  readonly lon: number;
  /** Altitude du sol à ce point selon le modèle (m). */
  readonly elevation: number;
  /** Heures de prévision (ms UTC). */
  readonly times: readonly number[];
  readonly levels: readonly LevelSeries[];
  /** Vent à 10 m au-dessus du sol, par heure. */
  readonly surface: { readonly speed: readonly (number | null)[]; readonly direction: readonly (number | null)[] };
  readonly fetchedAt: number;
}

/** Hauteur du vent « de surface » au-dessus du sol (m). */
export const SURFACE_WIND_HEIGHT_M = 10;

/** URL de requête Open-Meteo : vitesses en m/s, heures en UTC. */
export function openMeteoWindUrl(lat: number, lon: number, forecastHours = 48): string {
  const vars = ["wind_speed_10m", "wind_direction_10m"];
  for (const l of PRESSURE_LEVELS_HPA) vars.push(`wind_speed_${l}hPa`, `wind_direction_${l}hPa`, `geopotential_height_${l}hPa`);
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: vars.join(","),
    wind_speed_unit: "ms",
    forecast_hours: String(forecastHours),
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function series(h: Record<string, unknown>, key: string, n: number): (number | null)[] | null {
  const a = h[key];
  if (!Array.isArray(a) || a.length !== n) return null;
  return a.map((v) => (isNum(v) ? v : null));
}

/** Lit une réponse Open-Meteo. Refuse une réponse incohérente (tableaux de longueurs différentes, heures illisibles). */
export function parseOpenMeteoWinds(raw: unknown, fetchedAt: number): WindForecast {
  const o = raw as { latitude?: unknown; longitude?: unknown; elevation?: unknown; hourly?: Record<string, unknown>; error?: unknown; reason?: unknown } | null;
  if (!o || typeof o !== "object") throw new Error("Réponse de prévision de vent invalide");
  if (o.error === true) throw new Error(`Prévision de vent refusée : ${String(o.reason ?? "raison inconnue")}`);
  const h = o.hourly;
  if (!h || !Array.isArray(h["time"]) || !isNum(o.latitude) || !isNum(o.longitude)) throw new Error("Réponse de prévision de vent incomplète");
  const times = (h["time"] as unknown[]).map((t) => (typeof t === "string" ? Date.parse(t.endsWith("Z") ? t : `${t}Z`) : NaN));
  if (times.length === 0 || times.some(Number.isNaN)) throw new Error("Heures de prévision illisibles");
  const n = times.length;
  const levels: LevelSeries[] = [];
  for (const hpa of PRESSURE_LEVELS_HPA) {
    const height = series(h, `geopotential_height_${hpa}hPa`, n);
    const speed = series(h, `wind_speed_${hpa}hPa`, n);
    const direction = series(h, `wind_direction_${hpa}hPa`, n);
    if (height && speed && direction) levels.push({ hpa, height, speed, direction });
  }
  const sSpeed = series(h, "wind_speed_10m", n);
  const sDir = series(h, "wind_direction_10m", n);
  if (levels.length === 0 && !(sSpeed && sDir)) throw new Error("Aucun niveau de vent dans la réponse");
  return {
    lat: o.latitude,
    lon: o.longitude,
    elevation: isNum(o.elevation) ? o.elevation : 0,
    times,
    levels,
    surface: { speed: sSpeed ?? new Array(n).fill(null), direction: sDir ?? new Array(n).fill(null) },
    fetchedAt,
  };
}

interface UV { readonly u: number; readonly v: number }

/** Direction « d'où il vient » et vitesse → composantes est (u) et nord (v) du mouvement de l'air. */
function toUV(speed: number, fromDeg: number): UV {
  const r = (fromDeg * Math.PI) / 180;
  return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
}

function fromUV(c: UV): Wind {
  const speed = Math.hypot(c.u, c.v);
  const dir = speed < 1e-9 ? 0 : (Math.atan2(-c.u, -c.v) * 180) / Math.PI;
  return { direction: trueDeg(dir), speed: metersPerSecond(speed) };
}

/** Profil vertical (altitude croissante) à l'heure d'indice `i`, sans les niveaux sous le sol ni les valeurs manquantes. */
function profile(f: WindForecast, i: number): { z: number; c: UV }[] {
  const pts: { z: number; c: UV }[] = [];
  const s = f.surface.speed[i];
  const d = f.surface.direction[i];
  if (isNum(s) && isNum(d)) pts.push({ z: f.elevation + SURFACE_WIND_HEIGHT_M, c: toUV(s, d) });
  for (const lv of f.levels) {
    const z = lv.height[i];
    const sp = lv.speed[i];
    const di = lv.direction[i];
    if (isNum(z) && isNum(sp) && isNum(di) && z > f.elevation + SURFACE_WIND_HEIGHT_M) pts.push({ z, c: toUV(sp, di) });
  }
  return pts.sort((a, b) => a.z - b.z);
}

function atAltitude(p: { z: number; c: UV }[], z: number): UV | null {
  const first = p[0];
  const last = p[p.length - 1];
  if (!first || !last) return null;
  if (z <= first.z) return first.c; // sous le premier niveau (proche du sol) : vent de surface
  if (z > last.z) return null; // au-dessus du plus haut niveau : pas de donnée
  for (let k = 0; k + 1 < p.length; k++) {
    const a = p[k] as { z: number; c: UV };
    const b = p[k + 1] as { z: number; c: UV };
    if (z >= a.z && z <= b.z) {
      const t = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
      return { u: a.c.u + (b.c.u - a.c.u) * t, v: a.c.v + (b.c.v - a.c.v) * t };
    }
  }
  return null;
}

/**
 * Vent prévu à une altitude (m AMSL) et à un instant (ms UTC), par interpolation linéaire des composantes entre niveaux puis entre heures.
 * `null` si l'instant sort de la prévision, si l'altitude dépasse le plus haut niveau ou si les données manquent.
 */
export function windAt(f: WindForecast, altitude: Meters, timeMs: number): Wind | null {
  const t = f.times;
  if (t.length === 0 || timeMs < (t[0] as number) || timeMs > (t[t.length - 1] as number)) return null;
  let i = 0;
  while (i + 1 < t.length && (t[i + 1] as number) <= timeMs) i++;
  const j = Math.min(i + 1, t.length - 1);
  const a = atAltitude(profile(f, i), altitude);
  if (!a) return null;
  if (j === i) return fromUV(a);
  const b = atAltitude(profile(f, j), altitude);
  if (!b) return null;
  const k = ((timeMs - (t[i] as number)) / ((t[j] as number) - (t[i] as number)));
  return fromUV({ u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k });
}

/** Moyenne vectorielle de plusieurs vents (jamais une moyenne de directions). */
export function averageWinds(winds: readonly Wind[]): Wind | null {
  if (winds.length === 0) return null;
  let u = 0, v = 0;
  for (const w of winds) {
    const c = toUV(w.speed, w.direction);
    u += c.u;
    v += c.v;
  }
  return fromUV({ u: u / winds.length, v: v / winds.length });
}

export interface LegWindEstimate {
  readonly leg: number;
  /** Vent estimé, ou null (raison dans `reason`). */
  readonly wind: Wind | null;
  readonly reason: "ok" | "no-altitude" | "no-forecast" | "out-of-range";
  readonly altitude: Meters | null;
  /** Instant de passage au milieu de la branche (ms UTC). */
  readonly timeMs: number;
}

/**
 * Vent de chaque branche d'une route d'après les prévisions faites aux points de la route (une par point, ou null).
 * - altitude : moyenne des altitudes prévues aux deux extrémités (une seule connue : celle-ci) ; aucune → pas de vent estimé ;
 * - instant : départ + temps sans vent cumulé jusqu'au milieu de la branche (la vitesse sol n'est pas encore connue) ;
 * - vent : moyenne vectorielle des vents prévus aux deux extrémités.
 */
export function legWindsFromForecasts(
  points: readonly RoutePoint[],
  forecasts: readonly (WindForecast | null)[],
  departureMs: number,
  tas: MetersPerSecond,
): LegWindEstimate[] {
  const out: LegWindEstimate[] = [];
  let elapsed = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as RoutePoint;
    const b = points[i + 1] as RoutePoint;
    const len = distance(a.position, b.position);
    const timeMs = departureMs + (elapsed + len / tas / 2) * 1000;
    elapsed += len / tas;
    const alts = [a.altitude, b.altitude].filter((x): x is Meters => x !== null);
    if (alts.length === 0) { out.push({ leg: i, wind: null, reason: "no-altitude", altitude: null, timeMs }); continue; }
    const altitude = meters(alts.reduce((s, x) => s + x, 0) / alts.length);
    const fa = forecasts[i] ?? null;
    const fb = forecasts[i + 1] ?? null;
    if (!fa && !fb) { out.push({ leg: i, wind: null, reason: "no-forecast", altitude, timeMs }); continue; }
    const ws = [fa, fb].map((f) => (f ? windAt(f, altitude, timeMs) : null)).filter((w): w is Wind => w !== null);
    if (ws.length === 0) { out.push({ leg: i, wind: null, reason: "out-of-range", altitude, timeMs }); continue; }
    out.push({ leg: i, wind: averageWinds(ws), reason: "ok", altitude, timeMs });
  }
  return out;
}

/** Point intermédiaire d'une branche à la fraction `f` (pour échantillonner un profil le long de la route). */
export function pointAlong(a: LatLon, b: LatLon, f: number): LatLon {
  const d = distance(a, b);
  return d === 0 ? a : destination(a, initialBearing(a, b) as TrueDeg, meters(d * f));
}
