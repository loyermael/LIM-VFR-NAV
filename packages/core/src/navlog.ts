/**
 * Route et log de navigation.
 *
 * Une route est une suite de points ; chaque branche relie deux points consécutifs. Pour chaque branche on calcule :
 * route vraie et magnétique, distance, vent, dérive, cap vrai et magnétique, vitesse sol, temps sans vent (TSV),
 * temps avec vent (TAV), carburant, distance depuis le départ (DSD) et distance restante (DTA).
 *
 * Conventions :
 * - route d'une branche = route VRAIE mesurée au milieu de la branche (comme sur une carte, au méridien médian),
 *   pas le cap initial de l'orthodromie ;
 * - variation magnétique évaluée au milieu de la branche (WMM), MAG = TRUE − VAR ;
 * - TSV = distance / vitesse propre ; TAV = distance / vitesse sol ;
 * - un vent impossible (trop fort pour tenir la route) laisse dérive, cap, TAV et carburant à `null` et ajoute un avertissement :
 *   on n'invente jamais un chiffre.
 */
import { magDeg, trueDeg, trueToMag, type MagDeg, type RelDeg, type TrueDeg, type VariationDeg } from "./angles";
import { destination, distance, initialBearing, type LatLon } from "./geodesy";
import { magneticVariation } from "./magnetic";
import {
  liters, meters, seconds,
  type Liters, type LitersPerHour, type Meters, type MetersPerSecond, type Seconds,
} from "./units";
import { windTriangle, type Wind } from "./wind";

/** Au-delà de cette différence d'altitude entre deux points (m), la branche est une montée ou une descente. JUGÉ : 100 ft. */
export const LEVEL_TOLERANCE_M = 30.48;

export interface RoutePoint {
  readonly id: string;
  readonly name: string;
  readonly position: LatLon;
  /** Altitude de vol prévue AMSL en ce point (mètres), ou null. */
  readonly altitude: Meters | null;
}

export interface Route {
  readonly id: string;
  readonly name: string;
  readonly points: readonly RoutePoint[];
}

/** Vent par défaut et vents particuliers par branche (indice de branche à partir de 0). */
export interface WindPlan {
  readonly default: Wind | null;
  readonly byLeg: Readonly<Record<number, Wind | null>>;
}

export interface Performance {
  /** Vitesse propre de croisière. */
  readonly tas: MetersPerSecond;
  /** Consommation de croisière. */
  readonly fuelFlow: LitersPerHour;
}

export type VerticalTrend = "climb" | "level" | "descent";

export interface NavLogLeg {
  readonly index: number;
  readonly from: RoutePoint;
  readonly to: RoutePoint;
  readonly distance: Meters;
  readonly trueCourse: TrueDeg;
  readonly variation: VariationDeg;
  readonly magneticCourse: MagDeg;
  readonly wind: Wind | null;
  /** Dérive (positive = vers la droite), ou null si le triangle est impossible. */
  readonly wca: RelDeg | null;
  readonly trueHeading: TrueDeg | null;
  readonly magneticHeading: MagDeg | null;
  readonly groundSpeed: MetersPerSecond | null;
  /** Temps sans vent. */
  readonly timeNoWind: Seconds;
  /** Temps avec vent, ou null si le triangle est impossible. */
  readonly timeWithWind: Seconds | null;
  readonly fuel: Liters | null;
  /** Distance depuis le départ jusqu'à la fin de la branche (DSD). */
  readonly distanceFromStart: Meters;
  /** Distance restante depuis le début de la branche jusqu'à l'arrivée (DTA). */
  readonly distanceRemaining: Meters;
  /** Temps avec vent cumulé jusqu'à la fin de la branche, ou null dès qu'une branche est impossible. */
  readonly cumulativeTime: Seconds | null;
  /** Heure estimée de passage à la fin de la branche (ms UTC), si un départ est donné. */
  readonly eta: number | null;
  readonly trend: VerticalTrend | null;
  readonly error: "wind-too-strong" | null;
}

export interface NavLogTotals {
  readonly distance: Meters;
  readonly timeNoWind: Seconds;
  readonly timeWithWind: Seconds | null;
  readonly fuel: Liters | null;
}

export type NavLogWarning =
  | { readonly kind: "wind-too-strong"; readonly leg: number }
  | { readonly kind: "magnetic-model-expired" };

export interface NavLog {
  readonly legs: readonly NavLogLeg[];
  readonly totals: NavLogTotals;
  readonly warnings: readonly NavLogWarning[];
}

/** Route vraie mesurée au milieu de la branche. */
export function midCourse(from: LatLon, to: LatLon): TrueDeg {
  const d = distance(from, to);
  if (d === 0) return trueDeg(0);
  const mid = destination(from, initialBearing(from, to), meters(d / 2));
  return initialBearing(mid, to);
}

function midPoint(from: LatLon, to: LatLon): LatLon {
  const d = distance(from, to);
  return d === 0 ? from : destination(from, initialBearing(from, to), meters(d / 2));
}

export function computeNavLog(
  route: Route,
  perf: Performance,
  winds: WindPlan,
  date: Date,
  departureMs: number | null = null,
): NavLog {
  const pts = route.points;
  const warnings: NavLogWarning[] = [];
  const raw: Omit<NavLogLeg, "distanceFromStart" | "distanceRemaining" | "cumulativeTime" | "eta">[] = [];
  let expired = false;

  for (let i = 0; i + 1 < pts.length; i++) {
    const from = pts[i] as RoutePoint;
    const to = pts[i + 1] as RoutePoint;
    const dist = distance(from.position, to.position);
    const tc = midCourse(from.position, to.position);
    const mv = magneticVariation(midPoint(from.position, to.position), date);
    expired = expired || mv.outOfRange;
    const wind = i in winds.byLeg ? (winds.byLeg[i] ?? null) : winds.default;
    const tri = windTriangle(tc, perf.tas, wind);
    const tsv = seconds(dist / perf.tas);
    const tav = tri === null ? null : seconds(dist / tri.groundSpeed);
    if (tri === null) warnings.push({ kind: "wind-too-strong", leg: i });

    let trend: VerticalTrend | null = null;
    if (from.altitude !== null && to.altitude !== null) {
      const dz = to.altitude - from.altitude;
      trend = dz > LEVEL_TOLERANCE_M ? "climb" : dz < -LEVEL_TOLERANCE_M ? "descent" : "level";
    }

    raw.push({
      index: i,
      from,
      to,
      distance: dist,
      trueCourse: tc,
      variation: mv.variation,
      magneticCourse: trueToMag(tc, mv.variation),
      wind,
      wca: tri?.wca ?? null,
      trueHeading: tri?.trueHeading ?? null,
      magneticHeading: tri ? trueToMag(tri.trueHeading, mv.variation) : null,
      groundSpeed: tri?.groundSpeed ?? null,
      timeNoWind: tsv,
      timeWithWind: tav,
      fuel: tav === null ? null : liters((perf.fuelFlow * tav) / 3600),
      trend,
      error: tri === null ? "wind-too-strong" : null,
    });
  }

  if (expired) warnings.push({ kind: "magnetic-model-expired" });

  const total = raw.reduce((a, l) => a + l.distance, 0);
  let acc = 0;
  let accTime: number | null = 0;
  const legs: NavLogLeg[] = raw.map((l) => {
    const remaining = total - acc;
    acc += l.distance;
    accTime = accTime !== null && l.timeWithWind !== null ? accTime + l.timeWithWind : null;
    return {
      ...l,
      distanceFromStart: meters(acc),
      distanceRemaining: meters(remaining),
      cumulativeTime: accTime === null ? null : seconds(accTime),
      eta: departureMs !== null && accTime !== null ? departureMs + accTime * 1000 : null,
    };
  });

  const timeNoWind = legs.reduce((a, l) => a + l.timeNoWind, 0);
  const complete = legs.every((l) => l.timeWithWind !== null);
  const timeWithWind = complete ? legs.reduce((a, l) => a + (l.timeWithWind as number), 0) : null;
  const fuel = complete ? legs.reduce((a, l) => a + (l.fuel as number), 0) : null;

  return {
    legs,
    totals: {
      distance: meters(total),
      timeNoWind: seconds(timeNoWind),
      timeWithWind: timeWithWind === null ? null : seconds(timeWithWind),
      fuel: fuel === null ? null : liters(fuel),
    },
    warnings,
  };
}

export interface DirectTo {
  readonly distance: Meters;
  readonly trueBearing: TrueDeg;
  readonly magneticBearing: MagDeg;
  /** Temps restant à la vitesse sol actuelle, ou null si elle est inconnue ou trop faible. */
  readonly timeToGo: Seconds | null;
}

/** Fonction « Direct » : cap et distance pour rejoindre `target` depuis la position actuelle. */
export function directTo(from: LatLon, target: LatLon, groundSpeed: MetersPerSecond | null, date: Date): DirectTo {
  const d = distance(from, target);
  const brg = initialBearing(from, target);
  const mv = magneticVariation(from, date);
  return {
    distance: d,
    trueBearing: brg,
    magneticBearing: magDeg(trueToMag(brg, mv.variation)),
    timeToGo: groundSpeed !== null && groundSpeed >= 1 ? seconds(d / groundSpeed) : null,
  };
}
