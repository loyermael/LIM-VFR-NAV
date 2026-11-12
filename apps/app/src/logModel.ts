import {
  airspacesAt, formatAngle, formatQuantity, nearestAirfields, unitLabel, windAt,
  type Airfield, type Airspace, type NavLog, type UnitPrefs, type WindForecast,
} from "@lim/core";
import type { RouteRecord } from "./routeEdit";

/**
 * Modèle du log de navigation (feuille de type « ACP » : REPORTS, Rm/Cm, D, Tsv/Tav, He, Hr, RNav / Info NAV / Com / Z, vents FL20/50/100,
 * carburant, aérodrome d'arrivée, performances du jour). Une seule source pour l'écran et pour le PDF : tout est déjà mis en texte.
 */

export interface LogPoint { readonly name: string; readonly freq: string; readonly alt: string }
export interface LogLeg {
  readonly rm: string; readonly cm: string; readonly d: string; readonly tsv: string; readonly tav: string; readonly he: string;
}
export interface LogModel {
  readonly route: string;
  readonly aircraft: string;
  readonly vp: string; readonly vpUnit: string;
  readonly fb: string; readonly fbUnit: string;
  readonly conso: string; readonly consoUnit: string;
  readonly winds: { readonly fl20: string; readonly fl50: string; readonly fl100: string };
  readonly departure: string;
  readonly points: readonly LogPoint[];
  readonly legs: readonly LogLeg[];
  readonly totals: { readonly d: string; readonly dUnit: string; readonly tsv: string; readonly tav: string; readonly fuel: string };
}

/** Durée en minutes arrondies avec apostrophe (« 11' »), ou « 1h05 » à partir d'une heure. */
export function minutesText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "---";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}'` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * Facteur de base Fb = minutes par unité de distance affichée (60 / vitesse en unités de distance par heure) :
 * à 130 km/h, Fb = 0,46 min/km ; à 85 kt, Fb = 0,71 min/NM. Multiplié par une distance, il donne le temps de vol sans vent.
 */
export function baseFactor(tasMps: number, prefs: UnitPrefs): number | null {
  if (!(tasMps > 0)) return null;
  const perHour = Number(formatQuantity("distance", prefs, tasMps * 3600).replace(",", "."));
  return perHour > 0 ? 60 / perHour : null;
}

/** Fréquence à afficher pour un point : terrain voisin (moins de 2 km), sinon SIV / information de vol qui couvre le point. */
export function pointFrequency(
  pt: { position: { lat: number; lon: number }; altitude: number | null },
  airfields: readonly Airfield[],
  airspaces: readonly Airspace[],
): string {
  const near = nearestAirfields(pt.position as never, airfields, 1)[0];
  if (near && (near.distance as number) <= 2000) {
    const f = near.airfield.frequencies.find((x) => x.primary) ?? near.airfield.frequencies[0];
    if (f) return `${f.mhz} ${near.airfield.icao ?? ""}`.trim();
  }
  const here = airspacesAt(pt.position as never, pt.altitude === null ? null : (pt.altitude as never), airspaces);
  for (const h of here) {
    if (!/SIV|INFO/i.test(h.airspace.name)) continue;
    const f = h.airspace.frequencies.find((x) => x.primary) ?? h.airspace.frequencies[0];
    if (f) return `${f.mhz} ${h.airspace.name}`.trim();
  }
  return "";
}

const FT = 0.3048;
/** Vent prévu à un niveau (pieds AMSL) au point de départ, en « 270°/15 », ou « --- ». */
export function windAtLevel(f: WindForecast | null, feet: number, timeMs: number, prefs: UnitPrefs): string {
  if (!f) return "---";
  const w = windAt(f, (feet * FT) as never, timeMs);
  if (!w) return "---";
  return `${formatAngle(w.direction as number)}°/${formatQuantity("groundSpeed", prefs, w.speed as number)}`;
}

export interface LogModelInput {
  readonly prefs: UnitPrefs;
  readonly route: RouteRecord;
  readonly log: NavLog;
  readonly aircraftName: string;
  readonly tasMps: number;
  readonly fuelFlowLph: number | null;
  readonly airfields: readonly Airfield[];
  readonly airspaces: readonly Airspace[];
  /** Prévision de vent au point de départ (si elle a été chargée) et instant de décollage (ms). */
  readonly departureForecast: WindForecast | null;
  readonly nowMs: number;
}

export function buildLogModel(i: LogModelInput): LogModel {
  const { prefs, log, route } = i;
  const showTrue = prefs.track === "true";
  const dist = (m: number) => formatQuantity("distance", prefs, m);
  const alt = (m: number | null) => (m === null ? "" : formatQuantity("altitude", prefs, m));
  const fb = baseFactor(i.tasMps, prefs);
  const first = log.legs[0];
  const points: LogPoint[] = [];
  if (first) points.push({ name: first.from.name, freq: pointFrequency(first.from, i.airfields, i.airspaces), alt: alt(first.from.altitude as number | null) });
  for (const l of log.legs) points.push({ name: l.to.name, freq: pointFrequency(l.to, i.airfields, i.airspaces), alt: alt(l.to.altitude as number | null) });
  const t0 = route.departureMs ?? i.nowMs;
  return {
    route: route.name,
    aircraft: i.aircraftName,
    vp: formatQuantity("groundSpeed", prefs, i.tasMps), vpUnit: unitLabel("groundSpeed", prefs),
    fb: fb === null ? "---" : fb.toFixed(2), fbUnit: `min/${unitLabel("distance", prefs)}`,
    conso: i.fuelFlowLph === null ? "---" : formatQuantity("fuel", prefs, i.fuelFlowLph), consoUnit: `${unitLabel("fuel", prefs)}/h`,
    winds: {
      fl20: windAtLevel(i.departureForecast, 2000, t0, prefs),
      fl50: windAtLevel(i.departureForecast, 5000, t0, prefs),
      fl100: windAtLevel(i.departureForecast, 10000, t0, prefs),
    },
    departure: route.departureMs === null ? "" : hhmm(route.departureMs),
    points,
    legs: log.legs.map((l) => ({
      rm: formatAngle((showTrue ? l.trueCourse : l.magneticCourse) as number),
      cm: formatAngle(l.trueHeading === null ? null : ((showTrue ? l.trueHeading : l.magneticHeading) as number)),
      d: dist(l.distance as number),
      tsv: minutesText(l.timeNoWind as number),
      tav: minutesText(l.timeWithWind as number | null),
      he: route.departureMs !== null && l.eta !== null ? hhmm(l.eta) : "",
    })),
    totals: {
      d: dist(log.totals.distance as number), dUnit: unitLabel("distance", prefs),
      tsv: minutesText(log.totals.timeNoWind as number), tav: minutesText(log.totals.timeWithWind as number | null),
      fuel: i.fuelFlowLph === null ? "" : formatQuantity("fuel", prefs, log.totals.fuel as number),
    },
  };
}

/** Champs de saisie libre de la feuille, gardés par route (clé de stockage). */
export const logFormKey = (routeId: string) => `lim.logForm.${routeId}`;
export const loadLogForm = (routeId: string): Record<string, string> => {
  try {
    const o = JSON.parse(localStorage.getItem(logFormKey(routeId)) ?? "{}") as unknown;
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch { return {}; }
};
export const saveLogForm = (routeId: string, form: Record<string, string>) => {
  try { localStorage.setItem(logFormKey(routeId), JSON.stringify(form)); } catch { /* stockage bloqué */ }
};
/** Vp modifié sur le log (unité d'affichage), par route. */
export const vpKey = (routeId: string) => `lim.logVp.${routeId}`;
