/**
 * Filtre de plafond : masque les espaces dont le plancher est au-dessus du niveau de vol choisi
 * (inutiles quand on vole en dessous). Une limite est exprimée dans sa référence d'origine.
 */
import { feetToMeters, feet, type Meters } from "./units";

export type LimitReference = "AMSL" | "AGL" | "FL";

export interface AirspaceLimit {
  readonly reference: LimitReference;
  /** Mètres (AMSL, AGL) ou niveau de vol (FL). */
  readonly value: number;
}

/** Niveau de vol → mètres (calage standard 1013,25 hPa : FL100 = 10 000 ft). */
export function flightLevelToMeters(fl: number): Meters {
  return feetToMeters(feet(fl * 100));
}

/**
 * L'espace est-il à afficher pour un filtre `ceilingFL` ?
 * Plancher AMSL ou FL : affiché s'il est strictement sous le filtre.
 * Plancher AGL : toujours affiché, car on ne connaît pas le relief ici (choix prudent : JUGÉ).
 * Plancher inconnu : toujours affiché.
 */
export function isAirspaceVisible(floor: AirspaceLimit | null, ceilingFL: number): boolean {
  if (floor === null) return true;
  if (floor.reference === "AGL") return true;
  const floorM = floor.reference === "FL" ? flightLevelToMeters(floor.value) : floor.value;
  return floorM < flightLevelToMeters(ceilingFL);
}
