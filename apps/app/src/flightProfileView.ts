import type { Airspace, RouteHit, UnitPrefs } from "@lim/core";

/** Profil en vol : fonctions pures (testées) ; le dessin est dans FlightProfile.tsx. */

export type Vertical = "inside" | "unknown" | "outside";

/** Une traversée d'espace vue depuis l'avion : distances RELATIVES à l'avion (m, négatif = derrière). */
export interface AheadSeg {
  readonly key: string;
  readonly airspace: Airspace;
  readonly entry: number;
  readonly exit: number;
  readonly vertical: Vertical;
}

/** Fenêtres proposées, dans l'unité de distance choisie (nautiques : 10 / 20 / 40 ; sinon 20 / 40 / 80). */
export const windowOptions = (unit: string): readonly [number, number, number] => (unit === "nm" ? [10, 20, 40] : [20, 40, 80]);
export const windowOptionsFor = (prefs: Pick<UnitPrefs, "distance">) => windowOptions(prefs.distance);

/**
 * Traversées entre un peu derrière l'avion et la fin de la fenêtre, coupées à ces bornes.
 * `behindM` : distance gardée derrière l'avion pour montrer l'espace où l'on se trouve. Hors limites verticales : omises sauf `showOutside`.
 */
export function segmentsAhead(hits: readonly RouteHit[], aircraftM: number, windowM: number, showOutside: boolean, behindM: number): AheadSeg[] {
  const out: AheadSeg[] = [];
  for (const h of hits) {
    h.segments.forEach((s, i) => {
      if (!showOutside && s.vertical === "outside") return;
      const entry = (s.entry as number) - aircraftM;
      const exit = (s.exit as number) - aircraftM;
      if (exit < -behindM || entry > windowM) return;
      out.push({ key: `${h.airspace.id}-${i}`, airspace: h.airspace, entry: Math.max(entry, -behindM), exit: Math.min(exit, windowM), vertical: s.vertical });
    });
  }
  return out;
}

export interface NextSpace {
  readonly airspace: Airspace;
  readonly vertical: Vertical;
  /** Vrai si l'avion est déjà dans l'emprise de l'espace (à l'altitude prévue). */
  readonly here: boolean;
  /** Distance avant l'entrée (m, 0 si déjà dedans) et avant la sortie (m). */
  readonly entryIn: number;
  readonly exitIn: number;
}

/** Prochain espace à l'altitude de la route (dans l'espace ou à vérifier) : celui où l'on est, sinon le plus proche devant. */
export function nextSpace(segs: readonly AheadSeg[]): NextSpace | null {
  const rel = segs.filter((s) => s.vertical !== "outside" && s.exit >= 0);
  if (rel.length === 0) return null;
  const here = rel.filter((s) => s.entry <= 0).sort((a, b) => b.exit - a.exit)[0];
  const pick = here ?? [...rel].sort((a, b) => a.entry - b.entry)[0];
  if (!pick) return null;
  return { airspace: pick.airspace, vertical: pick.vertical, here: pick.entry <= 0, entryIn: Math.max(0, pick.entry), exitIn: pick.exit };
}
