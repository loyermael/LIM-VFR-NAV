/**
 * Édition d'une route : fonctions pures (testées sans navigateur) qui retournent une nouvelle route.
 * Toute modification de structure (ajout, retrait, déplacement dans la liste, inversion) efface les vents par branche :
 * les indices de branche changent et un vent attaché à la mauvaise branche serait pire qu'un vent absent.
 */
import { meters, trueDeg, knotsToMps, type Meters, type RoutePoint, type RouteFile, type WindPlan } from "@lim/core";

export interface StoredWind {
  /** D'où vient le vent, degrés vrais. */
  readonly directionDeg: number;
  /** Vitesse en m/s. */
  readonly speedMps: number;
}

export interface RouteRecord {
  readonly id: string;
  readonly name: string;
  readonly points: readonly RoutePoint[];
  readonly windDefault: StoredWind | null;
  /** Vents particuliers par branche ; `null` = « pas de vent » imposé sur cette branche. */
  readonly windByLeg: Readonly<Record<number, StoredWind | null>>;
  readonly departureMs: number | null;
  readonly updatedAt: number;
}

export function newRoute(id: string, name: string, now: number): RouteRecord {
  return { id, name, points: [], windDefault: null, windByLeg: {}, departureMs: null, updatedAt: now };
}

const touch = (r: RouteRecord, patch: Partial<RouteRecord>, now: number): RouteRecord => ({ ...r, ...patch, updatedAt: now });
const structural = { windByLeg: {} } as const;

/** Prochain nom libre de la forme WPT01, WPT02… */
export function nextPointName(points: readonly RoutePoint[]): string {
  const used = new Set(points.map((p) => p.name));
  for (let n = 1; ; n++) {
    const name = `WPT${String(n).padStart(2, "0")}`;
    if (!used.has(name)) return name;
  }
}

export function addPoint(r: RouteRecord, lat: number, lon: number, id: string, now: number): RouteRecord {
  const p: RoutePoint = { id, name: nextPointName(r.points), position: { lat, lon }, altitude: null };
  return touch(r, { points: [...r.points, p], ...structural }, now);
}

export function removePoint(r: RouteRecord, index: number, now: number): RouteRecord {
  if (index < 0 || index >= r.points.length) return r;
  return touch(r, { points: r.points.filter((_, i) => i !== index), ...structural }, now);
}

/** Déplace un point (glisser sur la carte) : la structure ne change pas, les vents par branche sont conservés. */
export function movePoint(r: RouteRecord, index: number, lat: number, lon: number, now: number): RouteRecord {
  if (index < 0 || index >= r.points.length) return r;
  return touch(r, { points: r.points.map((p, i) => (i === index ? { ...p, position: { lat, lon } } : p)) }, now);
}

/** Échange la place de deux points dans la liste (monter / descendre). */
export function swapPoints(r: RouteRecord, i: number, j: number, now: number): RouteRecord {
  const n = r.points.length;
  if (i < 0 || j < 0 || i >= n || j >= n || i === j) return r;
  const pts = [...r.points];
  [pts[i], pts[j]] = [pts[j] as RoutePoint, pts[i] as RoutePoint];
  return touch(r, { points: pts, ...structural }, now);
}

export function reverseRoute(r: RouteRecord, now: number): RouteRecord {
  return touch(r, { points: [...r.points].reverse(), ...structural }, now);
}

export function renamePoint(r: RouteRecord, index: number, name: string, now: number): RouteRecord {
  const clean = name.trim();
  if (index < 0 || index >= r.points.length || clean === "") return r;
  return touch(r, { points: r.points.map((p, i) => (i === index ? { ...p, name: clean } : p)) }, now);
}

export function setPointAltitude(r: RouteRecord, index: number, altitude: Meters | null, now: number): RouteRecord {
  if (index < 0 || index >= r.points.length) return r;
  return touch(r, { points: r.points.map((p, i) => (i === index ? { ...p, altitude } : p)) }, now);
}

export function setDepartureMs(r: RouteRecord, ms: number | null, now: number): RouteRecord {
  return touch(r, { departureMs: ms }, now);
}

export function renameRoute(r: RouteRecord, name: string, now: number): RouteRecord {
  const clean = name.trim();
  return clean === "" ? r : touch(r, { name: clean }, now);
}

export function setDefaultWind(r: RouteRecord, wind: StoredWind | null, now: number): RouteRecord {
  return touch(r, { windDefault: wind }, now);
}

export function setLegWind(r: RouteRecord, leg: number, wind: StoredWind | null | undefined, now: number): RouteRecord {
  const by = { ...r.windByLeg };
  if (wind === undefined) delete by[leg]; // retour au vent par défaut
  else by[leg] = wind;
  return touch(r, { windByLeg: by }, now);
}

/** Vents de la route au format du moteur de calcul. */
export function toWindPlan(r: RouteRecord): WindPlan {
  const conv = (w: StoredWind | null) => (w === null ? null : { direction: trueDeg(w.directionDeg), speed: w.speedMps as never });
  const byLeg: Record<number, ReturnType<typeof conv>> = {};
  for (const [k, w] of Object.entries(r.windByLeg)) byLeg[Number(k)] = conv(w);
  return { default: conv(r.windDefault), byLeg };
}

/** Vent saisi en kt → stocké en m/s. */
export const windFromKnots = (directionDeg: number, speedKt: number): StoredWind => ({
  directionDeg: ((directionDeg % 360) + 360) % 360,
  speedMps: knotsToMps(speedKt as never),
});

export function toRouteFile(r: RouteRecord): RouteFile {
  return { name: r.name, points: r.points.map((p) => ({ name: p.name, lat: p.position.lat, lon: p.position.lon, altitude: p.altitude })) };
}

export function fromRouteFile(file: RouteFile, newId: () => string, now: number): RouteRecord {
  return {
    ...newRoute(newId(), file.name, now),
    points: file.points.map((p) => ({ id: newId(), name: p.name, position: { lat: p.lat, lon: p.lon }, altitude: p.altitude === null ? null : meters(p.altitude) })),
  };
}
