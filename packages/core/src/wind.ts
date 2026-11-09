/**
 * Triangle des vitesses.
 *
 * Conventions : la direction du vent est celle D'OÙ il vient, en degrés VRAIS ; la route (TC) est vraie ;
 * une dérive (WCA) positive se corrige vers la droite : cap vrai = route + dérive.
 *
 *   sin(WCA) = (WS / TAS) · sin(WD − TC)
 *   GS       = TAS · cos(WCA) − WS · cos(WD − TC)
 */
import { relDeg, toDegrees, toRadians, trueDeg, type RelDeg, type TrueDeg } from "./angles";
import type { MetersPerSecond } from "./units";
import { metersPerSecond } from "./units";

/** Vent : direction d'où il vient (vrai) et vitesse. */
export interface Wind {
  readonly direction: TrueDeg;
  readonly speed: MetersPerSecond;
}

export interface WindTriangle {
  /** Correction de dérive : positive = vers la droite. */
  readonly wca: RelDeg;
  /** Cap vrai à tenir pour suivre la route. */
  readonly trueHeading: TrueDeg;
  /** Vitesse sol le long de la route. */
  readonly groundSpeed: MetersPerSecond;
}

/** Sous cette vitesse sol (m/s) on considère que la route ne peut pas être suivie. JUGÉ : ~ 2 kt. */
export const MIN_GROUND_SPEED_MPS = 1;

/**
 * Résout le triangle. Retourne `null` si le vent est trop fort pour tenir la route :
 * la composante traversière dépasse la vitesse propre, ou la vitesse sol est quasi nulle ou négative.
 * `wind` nul = pas de vent connu : cap = route, vitesse sol = vitesse propre.
 */
export function windTriangle(trueCourse: TrueDeg, tas: MetersPerSecond, wind: Wind | null): WindTriangle | null {
  if (!(tas > 0)) return null;
  if (wind === null || wind.speed === 0) {
    return { wca: relDeg(0), trueHeading: trueCourse, groundSpeed: tas };
  }
  const delta = toRadians(wind.direction - trueCourse);
  const ratio = (wind.speed / tas) * Math.sin(delta);
  if (Math.abs(ratio) >= 1) return null;
  const wcaRad = Math.asin(ratio);
  const gs = tas * Math.cos(wcaRad) - wind.speed * Math.cos(delta);
  if (!(gs >= MIN_GROUND_SPEED_MPS)) return null;
  const wcaDeg = toDegrees(wcaRad);
  return { wca: relDeg(wcaDeg), trueHeading: trueDeg(trueCourse + wcaDeg), groundSpeed: metersPerSecond(gs) };
}

/** Composantes du vent par rapport à la route : vent de face (positif) ou arrière (négatif), et traversier (positif = de la droite). */
export function windComponents(trueCourse: TrueDeg, wind: Wind): { headwind: MetersPerSecond; crosswind: MetersPerSecond } {
  const delta = toRadians(wind.direction - trueCourse);
  return {
    headwind: metersPerSecond(wind.speed * Math.cos(delta)),
    crosswind: metersPerSecond(wind.speed * Math.sin(delta)),
  };
}
