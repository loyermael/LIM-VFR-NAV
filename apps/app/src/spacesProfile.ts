import { distance, flightLevelToMeters, type RoutePoint } from "@lim/core";

/** Géométrie du profil vertical « route + espaces traversés » : fonctions pures (testées), le dessin est dans SpacesTab. */

export interface LimitLike { readonly reference: string; readonly value: number }

/** Limite en mètres : FL converti en atmosphère standard ; AMSL tel quel ; AGL pris comme hauteur depuis un sol à 0 m (relief inconnu, donc approximatif). */
export function limitToMeters(l: LimitLike): number {
  return l.reference === "FL" ? flightLevelToMeters(l.value) : l.value;
}

/** Vrai si la limite dépend du sol (hors « SOL » = 0) : elle ne peut pas être placée avec certitude sans le relief. */
export const isGroundRelative = (l: LimitLike) => l.reference === "AGL" && l.value > 0;

export interface RoutePt { readonly d: number; readonly alt: number | null }

/** Points de la route : distance cumulée depuis le départ (m) et altitude prévue (m), null si non renseignée. */
export function routeProfilePoints(points: readonly RoutePoint[]): RoutePt[] {
  let d = 0;
  return points.map((p, i) => {
    if (i > 0) d += distance((points[i - 1] as RoutePoint).position, p.position) as number;
    return { d, alt: p.altitude === null ? null : (p.altitude as number) };
  });
}

const STEPS = [100, 200, 500, 1000, 2000, 4000, 5000, 10000, 20000];
/** Pas « rond » (dans l'unité d'affichage) pour environ `n` graduations. */
export function niceStep(range: number, n = 5): number {
  const raw = range / n;
  return STEPS.find((s) => s >= raw) ?? (STEPS[STEPS.length - 1] as number);
}

/**
 * Sommet du graphique (unité d'affichage) : la plus haute altitude de route + 50 %, au moins `minTop`,
 * arrondi au pas des graduations. `minTop` : 8 000 pour des pieds, 2 500 pour des mètres.
 */
export function profileTop(routeMaxDisplay: number, minTop: number): number {
  const want = Math.max(minTop, routeMaxDisplay * 1.5);
  const step = niceStep(want, 5);
  return Math.ceil(want / step) * step;
}
