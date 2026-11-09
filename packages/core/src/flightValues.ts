/**
 * Valeurs de vol prêtes à afficher, dérivées d'une position GPS.
 * Règle : une valeur qu'on ne sait pas calculer correctement vaut `null` (affichée « --- »), jamais une valeur approchée.
 */
import { trueToMag, type MagDeg, type TrueDeg, type VariationDeg } from "./angles";
import type { Geoid } from "./geoid";
import { magneticVariation } from "./magnetic";
import { usableTrack, type GpsFix } from "./gps";
import type { Meters, MetersPerSecond } from "./units";

export interface FlightValues {
  readonly groundSpeed: MetersPerSecond | null;
  readonly trackTrue: TrueDeg | null;
  readonly trackMagnetic: MagDeg | null;
  /** Altitude AMSL (niveau de la mer EGM96). Nulle si la hauteur est ellipsoïdale et que le géoïde n'est pas chargé. */
  readonly altitudeMsl: Meters | null;
  readonly variation: VariationDeg;
  /** Vrai si le modèle magnétique est hors de sa période de validité. */
  readonly variationOutOfRange: boolean;
}

export function flightValues(fix: GpsFix, geoid: Geoid | null, date: Date): FlightValues {
  const mv = magneticVariation(fix.position, date);
  const trk = usableTrack(fix);

  let altitudeMsl: Meters | null = null;
  if (fix.altitude !== null) {
    if (fix.altitudeReference === "msl") altitudeMsl = fix.altitude;
    else if (geoid) altitudeMsl = geoid.ellipsoidalToMsl(fix.position, fix.altitude);
  }

  return {
    groundSpeed: fix.groundSpeed,
    trackTrue: trk,
    trackMagnetic: trk === null ? null : trueToMag(trk, mv.variation),
    altitudeMsl,
    variation: mv.variation,
    variationOutOfRange: mv.outOfRange,
  };
}
