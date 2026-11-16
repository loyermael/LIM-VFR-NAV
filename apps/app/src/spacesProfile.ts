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

interface Ll { readonly lat: number; readonly lon: number }

/**
 * Projette une position sur la route : distance parcourue depuis le départ (m) du point le plus proche et écart à la route (m).
 * Calcul plan local (précis à quelques mètres sur des branches de moins de quelques centaines de km).
 */
export function projectOnRoute(points: readonly RoutePoint[], p: Ll, hintAlong: number | null = null): { along: number; offset: number } | null {
  if (points.length < 2) return null;
  const k = Math.cos((p.lat * Math.PI) / 180) * 111_320;
  const xy = (q: Ll) => ({ x: (q.lon - p.lon) * k, y: (q.lat - p.lat) * 110_574 });
  const cands: { along: number; offset: number }[] = [];
  let cum = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as RoutePoint, b = points[i + 1] as RoutePoint;
    const len = distance(a.position, b.position) as number;
    const A = xy(a.position), B = xy(b.position);
    const dx = B.x - A.x, dy = B.y - A.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, (-A.x * dx - A.y * dy) / l2));
    const offset = Math.hypot(A.x + t * dx, A.y + t * dy);
    cands.push({ along: cum + t * len, offset });
    cum += len;
  }
  const min = Math.min(...cands.map((c) => c.offset));
  // Route aller-retour : les deux branches se superposent ; à écart égal (30 m près) on garde celle la plus proche de `hintAlong` (dernier curseur ou avion).
  const near = cands.filter((c) => c.offset <= min + 30);
  if (hintAlong === null) return near[0] ?? null;
  return near.reduce((b, c) => (Math.abs(c.along - hintAlong) < Math.abs(b.along - hintAlong) ? c : b));
}

/** Position et altitude prévue (m) à une distance donnée le long de la route (interpolation sur chaque branche). */
export function positionAlong(points: readonly RoutePoint[], d: number): { lat: number; lon: number; alt: number | null } | null {
  if (points.length < 2) return null;
  let cum = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as RoutePoint, b = points[i + 1] as RoutePoint;
    const len = distance(a.position, b.position) as number;
    if (d <= cum + len || i === points.length - 2) {
      const t = len === 0 ? 0 : Math.min(1, Math.max(0, (d - cum) / len));
      const alt = a.altitude !== null && b.altitude !== null ? (a.altitude as number) + ((b.altitude as number) - (a.altitude as number)) * t : ((a.altitude ?? b.altitude) as number | null);
      return { lat: a.position.lat + (b.position.lat - a.position.lat) * t, lon: a.position.lon + (b.position.lon - a.position.lon) * t, alt };
    }
    cum += len;
  }
  return null;
}
