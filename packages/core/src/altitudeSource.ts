/**
 * Choix de la valeur d'altitude à afficher : baromètre si demandé et disponible, sinon GPS.
 * Le mode « GPS brute » ignore toujours le baromètre.
 */
import { altitudeForDisplay, pressureAltitudeOf, type AltitudeSettings } from "./altitude";
import { indicatedAltitude } from "./baro";
import { meters, type Meters, type Pascals } from "./units";

export interface AltitudeResult {
  readonly value: Meters | null;
  /** Origine réelle de la valeur (peut différer de la source demandée si le baromètre est muet). */
  readonly origin: "baro" | "gps";
}

export function altitudeResult(gpsAmsl: Meters | null, baroPressure: Pascals | null, s: AltitudeSettings): AltitudeResult {
  if (s.source === "baro" && baroPressure !== null && s.mode !== "gps") {
    // Le calage d'un terrain (offset) ne s'applique qu'au GPS : avec le baromètre, on règle le QNH.
    const value = s.mode === "qnh" ? indicatedAltitude(baroPressure, s.qnh) : meters(pressureAltitudeOf(baroPressure));
    return { value, origin: "baro" };
  }
  return { value: altitudeForDisplay(gpsAmsl, s), origin: "gps" };
}
