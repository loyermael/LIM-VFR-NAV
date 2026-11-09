/**
 * Requêtes sur les espaces aériens et les terrains : point dans un espace, espaces traversés par une route, terrains proches.
 *
 * Verticalement, tout est ESTIMÉ : un niveau de vol est converti avec la pression standard, et une limite « au-dessus du sol »
 * ne peut pas être résolue sans relief (inconnu ici) : le résultat est alors « inconnu », jamais « libre » par défaut.
 */
import type { AirspaceLimit } from "./ceiling";
import { flightLevelToMeters } from "./ceiling";
import { destination, distance, initialBearing, type LatLon } from "./geodesy";
import type { RoutePoint } from "./navlog";
import type { Airfield, Airspace } from "./openaip";
import { meters, type Meters } from "./units";
import type { TrueDeg } from "./angles";

/** Point dans un polygone à trous (règle pair-impair) : le premier anneau est l'extérieur. */
export function pointInRings(p: LatLon, rings: readonly (readonly (readonly [number, number])[])[]): boolean {
  const inRing = (ring: readonly (readonly [number, number])[]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as readonly [number, number];
      const [xj, yj] = ring[j] as readonly [number, number];
      if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const outer = rings[0];
  if (!outer || !inRing(outer)) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(rings[k] as readonly (readonly [number, number])[])) return false;
  return true;
}

const inBbox = (p: LatLon, b: Airspace["bbox"]) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;

/** Limite en mètres AMSL, ou null si elle dépend du sol et que le sol est inconnu. */
export function limitMeters(l: AirspaceLimit, ground: Meters | null): Meters | null {
  if (l.reference === "FL") return flightLevelToMeters(l.value);
  if (l.reference === "AMSL") return meters(l.value);
  return ground === null ? null : meters(ground + l.value);
}

export type VerticalStatus = "inside" | "outside" | "unknown";

/**
 * L'altitude est-elle entre le plancher et le plafond de l'espace ?
 * Plancher « SOL » (0 AGL) : toujours satisfait. Toute autre limite relative au sol sans relief connu : « unknown ».
 */
export function verticalStatus(a: Pick<Airspace, "lower" | "upper">, altitude: Meters | null, ground: Meters | null = null): VerticalStatus {
  if (altitude === null) return "unknown";
  const lowerOk = a.lower.reference === "AGL" && a.lower.value === 0 ? true : null;
  const lo = lowerOk === true ? -Infinity : limitMeters(a.lower, ground);
  const up = limitMeters(a.upper, ground);
  if (lo === null || up === null) {
    // Une des limites n'est pas résoluble : si l'autre exclut déjà l'altitude, la réponse est sûre.
    if (lo !== null && altitude < lo) return "outside";
    if (up !== null && altitude > up) return "outside";
    return "unknown";
  }
  return altitude >= lo && altitude <= up ? "inside" : "outside";
}

export interface AirspaceAtPoint {
  readonly airspace: Airspace;
  readonly vertical: VerticalStatus;
}

/** Espaces dont le polygone contient le point (le statut vertical dit s'il y est aussi en altitude). */
export function airspacesAt(p: LatLon, altitude: Meters | null, airspaces: readonly Airspace[], ground: Meters | null = null): AirspaceAtPoint[] {
  const out: AirspaceAtPoint[] = [];
  for (const a of airspaces) {
    if (inBbox(p, a.bbox) && pointInRings(p, a.rings)) out.push({ airspace: a, vertical: verticalStatus(a, altitude, ground) });
  }
  return out;
}

export interface RouteHit {
  readonly airspace: Airspace;
  /** Distance le long de la route à l'entrée et à la sortie (m, depuis le départ). */
  readonly entry: Meters;
  readonly exit: Meters;
  /** Branche (indice à partir de 0) où l'on entre. */
  readonly entryLeg: number;
  /** « inside » si, à un moment de la traversée, l'altitude prévue est dans les limites ; « unknown » si on ne peut pas le dire. */
  readonly vertical: VerticalStatus;
}

interface RouteLike {
  readonly points: readonly RoutePoint[];
}

/**
 * Espaces traversés (en plan) par la route, dans l'ordre de rencontre, avec le statut vertical selon les altitudes prévues
 * aux points de la route (interpolées sur chaque branche). Échantillonnage régulier : un empiètement plus court que `stepM`
 * peut être manqué (500 m par défaut).
 */
export function airspacesAlongRoute(route: RouteLike, airspaces: readonly Airspace[], stepM = 500): RouteHit[] {
  const hits = new Map<string, { a: Airspace; entry: number; exit: number; leg: number; inside: boolean; unknown: boolean }>();
  let travelled = 0;
  for (let i = 0; i + 1 < route.points.length; i++) {
    const from = route.points[i] as RoutePoint;
    const to = route.points[i + 1] as RoutePoint;
    const len = distance(from.position, to.position);
    const brg: TrueDeg = initialBearing(from.position, to.position);
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let k = 0; k <= n; k++) {
      const s = Math.min(len, (k * len) / n);
      const pos = k === 0 ? from.position : k === n ? to.position : destination(from.position, brg, meters(s));
      const f = len === 0 ? 0 : s / len;
      const alt: Meters | null =
        from.altitude !== null && to.altitude !== null ? meters(from.altitude + (to.altitude - from.altitude) * f)
        : from.altitude ?? to.altitude;
      const along = travelled + s;
      for (const a of airspaces) {
        if (!inBbox(pos, a.bbox) || !pointInRings(pos, a.rings)) continue;
        const v = verticalStatus(a, alt);
        const h = hits.get(a.id);
        if (!h) hits.set(a.id, { a, entry: along, exit: along, leg: i, inside: v === "inside", unknown: v === "unknown" });
        else {
          h.exit = along;
          h.inside = h.inside || v === "inside";
          h.unknown = h.unknown || v === "unknown";
        }
      }
    }
    travelled += len;
  }
  return [...hits.values()]
    .sort((x, y) => x.entry - y.entry)
    .map((h) => ({
      airspace: h.a,
      entry: meters(h.entry),
      exit: meters(h.exit),
      entryLeg: h.leg,
      vertical: h.inside ? "inside" : h.unknown ? "unknown" : "outside",
    }));
}

export interface NearAirfield {
  readonly airfield: Airfield;
  readonly distance: Meters;
  readonly trueBearing: TrueDeg;
}

/** Les `n` terrains les plus proches (distance géodésique) ; `filter` permet d'écarter les terrains privés, etc. */
export function nearestAirfields(from: LatLon, airfields: readonly Airfield[], n: number, filter?: (a: Airfield) => boolean): NearAirfield[] {
  const out: NearAirfield[] = [];
  for (const a of airfields) {
    if (filter && !filter(a)) continue;
    out.push({ airfield: a, distance: distance(from, a.position), trueBearing: initialBearing(from, a.position) });
  }
  return out.sort((x, y) => x.distance - y.distance).slice(0, Math.max(0, n));
}

/** Recherche par nom ou code OACI (insensible à la casse et aux accents), pour « aller vers un terrain ». */
export function searchAirfields(query: string, airfields: readonly Airfield[], limit = 20): Airfield[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  if (q === "") return [];
  const scored: { a: Airfield; score: number }[] = [];
  for (const a of airfields) {
    const name = norm(a.name);
    const icao = a.icao ? norm(a.icao) : "";
    let score = -1;
    if (icao === q) score = 0;
    else if (icao.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ a, score });
  }
  return scored.sort((x, y) => x.score - y.score || x.a.name.localeCompare(y.a.name)).slice(0, limit).map((s) => s.a);
}
