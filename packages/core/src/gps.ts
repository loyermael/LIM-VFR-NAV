/**
 * Position GPS : type commun à toutes les sources (GPS de l'appareil, simulateur, GDL90…),
 * état du signal et vecteur vitesse.
 */
import { trueDeg, type TrueDeg } from "./angles";
import {
  GPS_LOST_AFTER_S, GPS_MAX_USABLE_ACCURACY_M, GPS_STALE_AFTER_S, MIN_SPEED_FOR_TRACK_MPS,
} from "./config";
import { destination, type LatLon } from "./geodesy";
import { meters, type Meters, type MetersPerSecond } from "./units";

/** Une mesure de position. Les grandeurs inconnues sont `null`, jamais 0. */
export interface GpsFix {
  /** Horodatage UTC en millisecondes. */
  readonly timeMs: number;
  readonly position: LatLon;
  /** Hauteur au-dessus de l'ellipsoïde WGS84, ou au-dessus du niveau de la mer selon la source (voir `altitudeReference`). */
  readonly altitude: Meters | null;
  /** Référence de `altitude` : à vérifier par source (certains Android donnent déjà de l'AMSL). */
  readonly altitudeReference: "ellipsoid" | "msl";
  readonly groundSpeed: MetersPerSecond | null;
  /** Route sol vraie. */
  readonly track: TrueDeg | null;
  /** Incertitude horizontale (rayon à 68 %), mètres. */
  readonly accuracy: Meters | null;
}

export type GpsStatus =
  /** Pas encore de position. */
  | "none"
  /** Position récente et précise. */
  | "ok"
  /** Position récente mais imprécise. */
  | "poor"
  /** Pas de nouvelle position depuis un moment. */
  | "stale"
  /** Signal perdu : alerte. */
  | "lost";

export function gpsStatus(last: GpsFix | null, nowMs: number): GpsStatus {
  if (!last) return "none";
  const age = (nowMs - last.timeMs) / 1000;
  if (age >= GPS_LOST_AFTER_S) return "lost";
  if (age >= GPS_STALE_AFTER_S) return "stale";
  if (last.accuracy !== null && last.accuracy > GPS_MAX_USABLE_ACCURACY_M) return "poor";
  return "ok";
}

/** La route sol n'a de sens qu'au-dessus d'une vitesse minimale. */
export function usableTrack(fix: GpsFix): TrueDeg | null {
  if (fix.track === null || fix.groundSpeed === null) return null;
  return fix.groundSpeed >= MIN_SPEED_FOR_TRACK_MPS ? fix.track : null;
}

export interface SpeedVectorPoint {
  readonly minutes: number;
  readonly position: LatLon;
}

/**
 * Vecteur vitesse : positions prévues à chaque échéance (en minutes) en gardant la route et la vitesse sol actuelles.
 * Vide si la route ou la vitesse ne sont pas exploitables.
 */
export function speedVector(fix: GpsFix, minutes: readonly number[]): SpeedVectorPoint[] {
  const trk = usableTrack(fix);
  if (trk === null || fix.groundSpeed === null) return [];
  return minutes.map((m) => ({
    minutes: m,
    position: destination(fix.position, trueDeg(trk), meters(fix.groundSpeed! * 60 * m)),
  }));
}
