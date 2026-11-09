/**
 * Unités d'affichage choisies par l'utilisateur, une par information.
 * Le calcul reste en SI ; la conversion ne se fait qu'ici, à la frontière d'affichage.
 */
import { METERS_PER_FOOT, METERS_PER_NM, MPS_PER_KNOT } from "./units";

export type SpeedUnit = "kt" | "kmh" | "mph" | "ms";
export type AltitudeUnit = "ft" | "m";
export type DistanceUnit = "nm" | "km" | "sm" | "m";
export type VerticalSpeedUnit = "fpm" | "ms";
export type PressureUnit = "hpa" | "inhg";
export type AngleReference = "mag" | "true";

interface UnitDef {
  /** Libellé affiché. */
  readonly label: string;
  /** Nombre d'unités SI (m, m/s, Pa) dans une unité d'affichage. */
  readonly si: number;
  /** Décimales d'affichage par défaut. */
  readonly decimals: number;
}

const MPS_PER_KMH = 1000 / 3600;
const MPS_PER_MPH = 1609.344 / 3600;
const M_PER_SM = 1609.344;
const MPS_PER_FPM = METERS_PER_FOOT / 60;
const PA_PER_INHG = 3386.389;

export const SPEED_UNITS: Record<SpeedUnit, UnitDef> = {
  kt: { label: "kt", si: MPS_PER_KNOT, decimals: 0 },
  kmh: { label: "km/h", si: MPS_PER_KMH, decimals: 0 },
  mph: { label: "mph", si: MPS_PER_MPH, decimals: 0 },
  ms: { label: "m/s", si: 1, decimals: 1 },
};
export const ALTITUDE_UNITS: Record<AltitudeUnit, UnitDef> = {
  ft: { label: "ft", si: METERS_PER_FOOT, decimals: 0 },
  m: { label: "m", si: 1, decimals: 0 },
};
export const DISTANCE_UNITS: Record<DistanceUnit, UnitDef> = {
  nm: { label: "NM", si: METERS_PER_NM, decimals: 1 },
  km: { label: "km", si: 1000, decimals: 1 },
  sm: { label: "SM", si: M_PER_SM, decimals: 1 },
  m: { label: "m", si: 1, decimals: 0 },
};
export const VERTICAL_SPEED_UNITS: Record<VerticalSpeedUnit, UnitDef> = {
  fpm: { label: "ft/min", si: MPS_PER_FPM, decimals: 0 },
  ms: { label: "m/s", si: 1, decimals: 1 },
};
export const PRESSURE_UNITS: Record<PressureUnit, UnitDef> = {
  hpa: { label: "hPa", si: 100, decimals: 0 },
  inhg: { label: "inHg", si: PA_PER_INHG, decimals: 2 },
};

/** Choix de l'utilisateur : une unité pour chaque information affichée. */
export interface UnitPrefs {
  groundSpeed: SpeedUnit;
  altitude: AltitudeUnit;
  distance: DistanceUnit;
  verticalSpeed: VerticalSpeedUnit;
  pressure: PressureUnit;
  /** Référence de la route suivie (magnétique ou vraie). */
  track: AngleReference;
  /** Référence du relèvement vers le prochain point. */
  bearing: AngleReference;
}

/** Défaut aviation (kt, ft, NM) ; tout est modifiable dans les réglages. */
export const DEFAULT_UNIT_PREFS: UnitPrefs = {
  groundSpeed: "kt",
  altitude: "ft",
  distance: "nm",
  verticalSpeed: "fpm",
  pressure: "hpa",
  track: "mag",
  bearing: "mag",
};

/** Valeurs permises par information (sert à l'interface des réglages et à la validation). */
export const UNIT_CHOICES = {
  groundSpeed: Object.keys(SPEED_UNITS) as SpeedUnit[],
  altitude: Object.keys(ALTITUDE_UNITS) as AltitudeUnit[],
  distance: Object.keys(DISTANCE_UNITS) as DistanceUnit[],
  verticalSpeed: Object.keys(VERTICAL_SPEED_UNITS) as VerticalSpeedUnit[],
  pressure: Object.keys(PRESSURE_UNITS) as PressureUnit[],
  track: ["mag", "true"] as AngleReference[],
  bearing: ["mag", "true"] as AngleReference[],
} as const satisfies Record<keyof UnitPrefs, readonly string[]>;

/**
 * Reconstruit des préférences à partir de données non fiables (stockage local, import).
 * Toute valeur inconnue retombe sur le défaut, champ par champ.
 */
export function parseUnitPrefs(raw: unknown): UnitPrefs {
  const out: UnitPrefs = { ...DEFAULT_UNIT_PREFS };
  if (typeof raw !== "object" || raw === null) return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(UNIT_CHOICES) as (keyof UnitPrefs)[]) {
    const choices: readonly string[] = UNIT_CHOICES[key];
    const v = src[key];
    if (typeof v === "string" && choices.includes(v)) {
      (out as unknown as Record<string, string>)[key] = v;
    }
  }
  return out;
}

const tables = {
  groundSpeed: SPEED_UNITS,
  altitude: ALTITUDE_UNITS,
  distance: DISTANCE_UNITS,
  verticalSpeed: VERTICAL_SPEED_UNITS,
  pressure: PRESSURE_UNITS,
} as const;

type Quantity = keyof typeof tables;

/** Valeur SI (m, m/s, Pa) → nombre dans l'unité choisie. */
export function fromSI(q: Quantity, prefs: UnitPrefs, siValue: number): number {
  const def = (tables[q] as Record<string, UnitDef>)[prefs[q]];
  if (!def) throw new Error(`unité inconnue : ${q}=${prefs[q]}`);
  return siValue / def.si;
}

/** Nombre dans l'unité choisie → valeur SI. */
export function toSI(q: Quantity, prefs: UnitPrefs, value: number): number {
  const def = (tables[q] as Record<string, UnitDef>)[prefs[q]];
  if (!def) throw new Error(`unité inconnue : ${q}=${prefs[q]}`);
  return value * def.si;
}

/** Libellé de l'unité choisie (« kt », « km/h », « °M »…). */
export function unitLabel(q: Quantity | "track" | "bearing", prefs: UnitPrefs, lang: "fr" | "en" = "fr"): string {
  if (q === "track" || q === "bearing") return prefs[q] === "mag" ? "°M" : lang === "fr" ? "°V" : "°T";
  return (tables[q] as Record<string, UnitDef>)[prefs[q]]?.label ?? "";
}

/** Texte prêt à afficher, sans l'unité. `NaN` ou non fini → « --- ». */
export function formatQuantity(q: Quantity, prefs: UnitPrefs, siValue: number): string {
  if (!Number.isFinite(siValue)) return "---";
  const def = (tables[q] as Record<string, UnitDef>)[prefs[q]];
  if (!def) throw new Error(`unité inconnue : ${q}=${prefs[q]}`);
  return (siValue / def.si).toFixed(def.decimals);
}
