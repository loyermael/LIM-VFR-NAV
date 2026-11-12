import { distance, type LatLon } from "@lim/core";

/** Un point auquel le tracé peut s'accrocher : terrain, balise, point de report ou point déjà dans la route. */
export interface SnapCandidate {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly kind: "airfield" | "navaid" | "report" | "point";
}

/** Rayon d'aimantation en pixels d'écran (un appui au doigt est imprécis). */
export const SNAP_PIXELS = 26;
/** Deux points de la route à moins de cette distance sont considérés comme le même lieu. */
export const SAME_PLACE_M = 150;

/** Mètres par pixel d'écran à une latitude et un zoom donnés (projection Web Mercator, tuiles de 512 px comme MapLibre). */
export const metersPerPixel = (lat: number, zoom: number) => (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

/**
 * Candidat le plus proche d'un appui, dans le rayon donné. À distance voisine (moins de 20 %), un point de la route l'emporte sur un
 * terrain ou une balise : on retombe ainsi sur le point existant plutôt que d'en poser un second à côté.
 */
export function snapTap(tap: LatLon, radiusM: number, candidates: readonly SnapCandidate[]): SnapCandidate | null {
  let best: SnapCandidate | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = distance(tap, { lat: c.lat, lon: c.lon });
    if (d > radiusM) continue;
    const better = d < bestD || (best !== null && c.kind === "point" && best.kind !== "point" && d < bestD * 1.2);
    if (better) { best = c; bestD = d; }
  }
  return best;
}

/** Le point (lat, lon) existe-t-il déjà dans la route (à SAME_PLACE_M près) ? */
export const isInRoute = (lat: number, lon: number, points: readonly { position: LatLon }[]) =>
  points.some((p) => distance({ lat, lon }, p.position) <= SAME_PLACE_M);
