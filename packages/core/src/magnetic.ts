/**
 * Variation magnétique (déclinaison) par le World Magnetic Model de NOAA/BGS.
 * Le modèle WMM2025 est valable du 01/01/2025 au 31/12/2029 : au-delà, l'erreur croît et
 * `outOfRange` passe à vrai — l'interface doit alors prévenir le pilote.
 * Convention : variation Est positive, MAG = TRUE − VAR.
 */
import { model } from "geomagnetism";
import { variationDeg, type VariationDeg } from "./angles";
import type { LatLon } from "./geodesy";
import type { Meters } from "./units";

export interface MagneticVariation {
  readonly variation: VariationDeg;
  /** Nom du modèle utilisé (ex. « WMM-2025 »). */
  readonly model: string;
  /** Fin de validité du modèle. */
  readonly validUntil: Date;
  /** Vrai si la date demandée sort de la période de validité du modèle. */
  readonly outOfRange: boolean;
}

/**
 * Variation magnétique en un point et à une date.
 * @param altitude altitude au-dessus de l'ellipsoïde ; l'effet sur la déclinaison est négligeable en VFR.
 */
export function magneticVariation(
  at: LatLon,
  date: Date,
  altitude: Meters | 0 = 0,
): MagneticVariation {
  const m = model(date, { allowOutOfBoundsModel: true });
  const p = m.point([at.lat, at.lon, altitude / 1000]);
  return {
    variation: variationDeg(p.decl),
    model: m.name,
    validUntil: m.end_date,
    outOfRange: date < m.start_date || date > m.end_date,
  };
}
