/**
 * Altitude affichée : QNH du jour, niveau de vol, GPS brute, calage sur l'altitude d'un terrain.
 *
 * IMPORTANT — tout est ESTIMÉ à partir de l'altitude géométrique du GPS : l'application n'a pas de baromètre.
 * L'altitude « QNH » est l'altitude GPS AMSL (un altimètre calé sur le QNH donnerait la même chose en atmosphère standard) ;
 * le niveau de vol ajoute la correction de pression standard. Les écarts de température par rapport à l'atmosphère
 * standard font différer ces valeurs de l'altimètre de bord, qui reste la référence.
 */
import { meters, pascals, type Meters, type Pascals } from "./units";

/** 1013,25 hPa. */
export const STANDARD_QNH: Pascals = pascals(101325);

/** Fourchette de QNH acceptée (hPa) : au-delà, la saisie est presque sûrement une faute. JUGÉ. */
export const QNH_RANGE_HPA = { min: 940, max: 1060 } as const;

/** Un QNH saisi plus vieux que ça est abandonné au lancement (retour à 1013). JUGÉ : la pression change en quelques heures. */
export const QNH_VALID_HOURS = 6;

export type AltitudeMode = "qnh" | "gps" | "fl";

export interface AltitudeSettings {
  readonly mode: AltitudeMode;
  /** QNH du jour. */
  readonly qnh: Pascals;
  /** Calage : décalage ajouté à l'altitude GPS (mètres), pour caler sur l'altitude connue d'un terrain. */
  readonly offset: Meters;
}

export const DEFAULT_ALTITUDE_SETTINGS: AltitudeSettings = { mode: "qnh", qnh: STANDARD_QNH, offset: meters(0) };

// Atmosphère standard OACI : h = 44330,77 · (1 − (p / 101325)^0,190263), valable sous 11 km.
const ISA_SCALE_M = 44330.77;
const ISA_EXPONENT = 0.190263;

/** Altitude pression d'un niveau où la pression est `p` (atmosphère standard). */
export function pressureAltitudeOf(p: Pascals): Meters {
  return meters(ISA_SCALE_M * (1 - Math.pow(p / STANDARD_QNH, ISA_EXPONENT)));
}

/** Pression plausible pour un QNH en hPa ? */
export function isPlausibleQnh(hpa: number): boolean {
  return Number.isFinite(hpa) && hpa >= QNH_RANGE_HPA.min && hpa <= QNH_RANGE_HPA.max;
}

/**
 * Valeur à afficher (mètres) selon le mode, ou `null` si l'altitude GPS est inconnue.
 * - `qnh` : altitude AMSL GPS + calage ;
 * - `gps` : altitude AMSL GPS brute (sans calage) ;
 * - `fl`  : altitude pression = altitude AMSL GPS + calage + altitude pression du QNH réglé (convertir ensuite en niveau de vol).
 */
export function altitudeForDisplay(gpsAmsl: Meters | null, s: AltitudeSettings): Meters | null {
  if (gpsAmsl === null) return null;
  switch (s.mode) {
    case "gps":
      return gpsAmsl;
    case "qnh":
      return meters(gpsAmsl + s.offset);
    case "fl":
      return meters(gpsAmsl + s.offset + pressureAltitudeOf(s.qnh));
  }
}

/** Niveau de vol (centaines de pieds) d'une altitude pression, arrondi au plus proche. */
export function flightLevelOf(pressureAltitude: Meters): number {
  return Math.round(pressureAltitude / 0.3048 / 100);
}

/** Calage : décalage à ajouter à l'altitude GPS pour afficher `known` (altitude connue du terrain, AMSL). */
export function calibrationOffset(gpsAmsl: Meters, known: Meters): Meters {
  return meters(known - gpsAmsl);
}

export interface StoredAltitude {
  readonly settings: AltitudeSettings;
  /** Vrai si un QNH enregistré était trop ancien et a été remplacé par 1013,25. */
  readonly qnhExpired: boolean;
}

/**
 * Relit les réglages d'altitude mémorisés (stockage non fiable). Un QNH ou un calage de plus de `QNH_VALID_HOURS` heures
 * est abandonné : on ne vole jamais avec le QNH d'hier sans le savoir.
 */
export function parseStoredAltitude(raw: unknown, nowMs: number): StoredAltitude {
  const d = DEFAULT_ALTITUDE_SETTINGS;
  if (typeof raw !== "object" || raw === null) return { settings: d, qnhExpired: false };
  const o = raw as Record<string, unknown>;
  const mode: AltitudeMode = o["mode"] === "gps" || o["mode"] === "fl" || o["mode"] === "qnh" ? o["mode"] : d.mode;
  // Le calage vieillit comme le QNH : l'erreur verticale du GPS change d'un jour à l'autre.
  const offsetAt = o["offsetSetAtMs"];
  const offsetOk =
    typeof o["offsetM"] === "number" && Number.isFinite(o["offsetM"]) && Math.abs(o["offsetM"]) < 2000 &&
    typeof offsetAt === "number" && nowMs >= offsetAt && nowMs - offsetAt <= QNH_VALID_HOURS * 3_600_000;
  const hpa = o["qnhHpa"];
  const setAt = o["qnhSetAtMs"];
  let qnh = d.qnh;
  let qnhExpired = false;
  if (typeof hpa === "number" && isPlausibleQnh(hpa) && typeof setAt === "number") {
    if (nowMs - setAt <= QNH_VALID_HOURS * 3_600_000 && nowMs >= setAt) qnh = pascals(hpa * 100);
    else qnhExpired = hpa * 100 !== STANDARD_QNH;
  }
  return { settings: { mode, qnh, offset: meters(offsetOk ? (o["offsetM"] as number) : 0) }, qnhExpired };
}
