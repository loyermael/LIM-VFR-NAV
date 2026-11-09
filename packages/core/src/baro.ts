/**
 * Altitude barométrique : pression mesurée par le capteur de l'appareil (disponible seulement dans la coque
 * Android native — un navigateur n'a pas accès au baromètre), convertie avec l'atmosphère standard OACI.
 *
 * - altitude indiquée = altitude pression de la mesure − altitude pression du QNH réglé (comme un altimètre) ;
 * - le QNH peut se déduire de l'altitude connue d'un terrain : c'est ce que fait un pilote au sol.
 * Le capteur d'un téléphone est bruité et sensible à la ventilation du cockpit : filtrage et prudence.
 */
import { pressureAltitudeOf, STANDARD_QNH } from "./altitude";
import { meters, pascals, type Meters, type Pascals } from "./units";

// Atmosphère standard (cf. altitude.ts) : p = 101325 · (1 − h / 44330,77)^(1 / 0,190263)
const ISA_SCALE_M = 44330.77;
const ISA_EXPONENT = 0.190263;

/** Pression plausible à la surface ou en vol VFR : 300 à 1100 hPa (11 000 m à bien en dessous du niveau de la mer). JUGÉ. */
export const PRESSURE_RANGE_HPA = { min: 300, max: 1100 } as const;

export const isPlausiblePressure = (p: number): boolean =>
  Number.isFinite(p) && p / 100 >= PRESSURE_RANGE_HPA.min && p / 100 <= PRESSURE_RANGE_HPA.max;

/** Pression de l'atmosphère standard à l'altitude pression `h` (inverse de `pressureAltitudeOf`). */
export function pressureAtAltitude(h: Meters): Pascals {
  return pascals(STANDARD_QNH * Math.pow(1 - h / ISA_SCALE_M, 1 / ISA_EXPONENT));
}

/** Altitude indiquée par un altimètre calé sur `qnh`, pour la pression mesurée `pressure`. */
export function indicatedAltitude(pressure: Pascals, qnh: Pascals): Meters {
  return meters(pressureAltitudeOf(pressure) - pressureAltitudeOf(qnh));
}

/**
 * QNH qui fait indiquer `elevation` (altitude connue du terrain) à la pression mesurée au sol.
 * Calage du pilote : « je suis sur un terrain à 300 m, le baromètre mesure X → le QNH est Y ».
 */
export function qnhFromElevation(pressure: Pascals, elevation: Meters): Pascals {
  return pressureAtAltitude(meters(pressureAltitudeOf(pressure) - elevation));
}

/**
 * Lissage exponentiel d'une pression irrégulièrement échantillonnée (constante de temps en secondes).
 * Une mesure aberrante (hors plage) est ignorée ; après un trou de plus de `resetAfterS`, le filtre repart de zéro.
 */
export class PressureFilter {
  private value: number | null = null;
  private lastMs: number | null = null;

  constructor(
    private readonly timeConstantS = 1.0,
    private readonly resetAfterS = 10,
  ) {}

  /** Intègre une mesure ; retourne la pression filtrée, ou `null` si aucune mesure valide n'a encore été vue. */
  update(pressure: number, timeMs: number): Pascals | null {
    if (!isPlausiblePressure(pressure)) return this.value === null ? null : pascals(this.value);
    if (this.value === null || this.lastMs === null || (timeMs - this.lastMs) / 1000 > this.resetAfterS || timeMs < this.lastMs) {
      this.value = pressure;
    } else {
      const dt = (timeMs - this.lastMs) / 1000;
      const alpha = 1 - Math.exp(-dt / this.timeConstantS);
      this.value += alpha * (pressure - this.value);
    }
    this.lastMs = timeMs;
    return pascals(this.value);
  }

  /** Dernière pression filtrée et son âge (ms), pour détecter un capteur muet. */
  last(nowMs: number): { pressure: Pascals; ageMs: number } | null {
    return this.value === null || this.lastMs === null ? null : { pressure: pascals(this.value), ageMs: nowMs - this.lastMs };
  }
}
