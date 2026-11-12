/**
 * Alerte de proximité d'espace aérien en vol : on projette la position le long de la route sol (vecteur vitesse) et on cherche le premier
 * espace dont on n'est pas déjà dedans et qu'on atteint avant l'horizon. Estimation : trajectoire droite, vitesse sol constante.
 * Verticalement, un statut « unknown » (limite au-dessus du sol sans relief) est signalé tel quel, jamais écarté.
 */
import { destination, type LatLon } from "./geodesy";
import type { TrueDeg } from "./angles";
import type { Airspace } from "./openaip";
import { airspacesAt, type VerticalStatus } from "./airspaceQuery";
import { meters, type Meters } from "./units";

export interface AirspaceAhead {
  readonly airspace: Airspace;
  /** Délai estimé avant l'entrée (s). */
  readonly seconds: number;
  readonly vertical: VerticalStatus;
}

/** Groupes pour lesquels une pénétration involontaire compte : contrôlés et réglementés / dangereux / interdits. */
const WATCHED = new Set<Airspace["group"]>(["controlled", "restricted"]);

export function airspaceAhead(
  position: LatLon,
  track: TrueDeg | null,
  groundSpeedMps: number | null,
  altitude: Meters | null,
  airspaces: readonly Airspace[],
  horizonS = 300,
): AirspaceAhead | null {
  if (track === null || groundSpeedMps === null || !(groundSpeedMps > 1)) return null;
  const watched = airspaces.filter((a) => WATCHED.has(a.group));
  const inside = new Set(airspacesAt(position, altitude, watched).map((h) => h.airspace.id));
  const stepS = Math.max(2, Math.min(10, 500 / groundSpeedMps));
  for (let s = stepS; s <= horizonS + 1e-9; s += stepS) {
    const p = destination(position, track, meters(groundSpeedMps * s));
    for (const h of airspacesAt(p, altitude, watched)) {
      if (h.vertical === "outside" || inside.has(h.airspace.id)) continue;
      return { airspace: h.airspace, seconds: s, vertical: h.vertical };
    }
  }
  return null;
}
