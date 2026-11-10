/**
 * Briefing le long de la route : stations météo proches du couloir et SIGMET qui le traversent.
 *
 * Le « couloir » est la route échantillonnée tous les 5 km ; une station est retenue si elle est à moins de
 * `maxDistance` d'un de ces points. Estimation : ce n'est pas un briefing officiel.
 */
import { destination, distance, initialBearing, type LatLon } from "./geodesy";
import { pointInRings } from "./airspaceQuery";
import type { RoutePoint } from "./navlog";
import type { Sigmet } from "./weather";
import { meters, type Meters } from "./units";

const SAMPLE_STEP_M = 5000;

interface RouteLike { readonly points: readonly RoutePoint[] }

/** Points de la route (extrémités comprises) avec leur distance depuis le départ et leur altitude interpolée. */
export function sampleRoute(route: RouteLike, stepM = SAMPLE_STEP_M): { position: LatLon; along: number; altitude: Meters | null }[] {
  const out: { position: LatLon; along: number; altitude: Meters | null }[] = [];
  let travelled = 0;
  for (let i = 0; i + 1 < route.points.length; i++) {
    const a = route.points[i] as RoutePoint;
    const b = route.points[i + 1] as RoutePoint;
    const len = distance(a.position, b.position);
    const brg = initialBearing(a.position, b.position);
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const s = (k * len) / n;
      const f = len === 0 ? 0 : s / len;
      const alt: Meters | null =
        a.altitude !== null && b.altitude !== null ? meters(a.altitude + (b.altitude - a.altitude) * f) : a.altitude ?? b.altitude;
      out.push({ position: k === n ? b.position : k === 0 ? a.position : destination(a.position, brg, meters(s)), along: travelled + s, altitude: alt });
    }
    travelled += len;
  }
  if (out.length === 0 && route.points.length === 1) {
    const p = route.points[0] as RoutePoint;
    out.push({ position: p.position, along: 0, altitude: p.altitude });
  }
  return out;
}

export interface StationNearRoute<S> {
  readonly station: S;
  /** Distance au point le plus proche de la route (m). */
  readonly distance: Meters;
  /** Distance de ce point depuis le départ (m) : ordre de rencontre le long de la route. */
  readonly along: Meters;
}

/** Stations (METAR ou TAF) à moins de `maxDistance` de la route, triées dans l'ordre de rencontre ; `limit` en garde au plus N (les plus proches de la route). */
export function stationsNearRoute<S extends { lat: number; lon: number }>(
  route: RouteLike,
  stations: readonly S[],
  maxDistance: Meters,
  limit = 12,
): StationNearRoute<S>[] {
  const samples = sampleRoute(route);
  if (samples.length === 0) return [];
  const found: StationNearRoute<S>[] = [];
  for (const s of stations) {
    const here = { lat: s.lat, lon: s.lon };
    let best = Infinity;
    let at = 0;
    for (const p of samples) {
      const d = distance(p.position, here);
      if (d < best) { best = d; at = p.along; }
    }
    if (best <= maxDistance) found.push({ station: s, distance: meters(best), along: meters(at) });
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, Math.max(0, limit)).sort((a, b) => a.along - b.along);
}

export type SigmetVertical = "inside" | "outside" | "unknown";

export interface SigmetOnRoute {
  readonly sigmet: Sigmet;
  readonly entry: Meters;
  readonly exit: Meters;
  /** Les altitudes prévues sont-elles dans les limites verticales du SIGMET ? */
  readonly vertical: SigmetVertical;
}

/**
 * SIGMET dont un polygone est traversé (en plan) par la route et dont la validité recouvre la fenêtre de vol.
 * Vertical : « inside » si une altitude prévue est entre base et sommet (base absente = surface), « unknown » sans altitude.
 */
export function sigmetsAlongRoute(route: RouteLike, sigmets: readonly Sigmet[], flightStartMs: number, flightEndMs: number): SigmetOnRoute[] {
  const samples = sampleRoute(route);
  const out: SigmetOnRoute[] = [];
  for (const sg of sigmets) {
    if (sg.validTo < flightStartMs || sg.validFrom > flightEndMs) continue;
    let entry = -1, exit = -1;
    let inside = false, unknown = false;
    for (const p of samples) {
      if (!sg.areas.some((ring) => pointInRings(p.position, [ring]))) continue;
      if (entry < 0) entry = p.along;
      exit = p.along;
      if (p.altitude === null) unknown = true;
      else if ((sg.base === null || p.altitude >= sg.base) && (sg.top === null || p.altitude <= sg.top)) inside = true;
    }
    if (entry >= 0) out.push({ sigmet: sg, entry: meters(entry), exit: meters(exit), vertical: inside ? "inside" : unknown ? "unknown" : "outside" });
  }
  return out.sort((a, b) => a.entry - b.entry);
}
