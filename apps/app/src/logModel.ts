import {
  airspacesAt, formatAngle, formatDuration, formatQuantity, nearestAirfields, planFuel, unitLabel, windAt,
  type Aircraft, type Airfield, type Airspace, type Loads, type NavLog, type UnitPrefs, type WindForecast,
} from "@lim/core";
import type { FuelPlanParams } from "./aircraftStore";
import type { RouteRecord } from "./routeEdit";

/**
 * Modèle du log de navigation (feuille de type « ACP » : REPORTS, Rm/Cm, D, Tsv/Tav, He, Hr, RNav / Info NAV / Com / Z, vents FL20/50/100,
 * carburant, aérodrome d'arrivée, performances du jour). Une seule source pour l'écran et pour le PDF : tout est déjà mis en texte.
 */

export interface LogPoint { readonly name: string; readonly freq: string; readonly alt: string }
export interface LogLeg {
  readonly rm: string; readonly cm: string; readonly d: string; readonly tsv: string; readonly tav: string; readonly he: string;
  /** Altitude du point d'arrivée de la branche, tendance (montée / palier / descente), distance depuis le départ (au début de la branche) et distance restante. */
  readonly z: string; readonly trend: "climb" | "level" | "descent" | null; readonly dsd: string; readonly dta: string;
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
      z: alt(l.to.altitude as number | null),
      trend: l.trend,
      dsd: dist((l.distanceFromStart as number) - (l.distance as number)),
      dta: dist(l.distanceRemaining as number),
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

const nearAirfield = (pos: { lat: number; lon: number }, airfields: readonly Airfield[]): Airfield | null => {
  const n = nearestAirfields(pos as never, airfields, 1)[0];
  return n && (n.distance as number) <= 2000 ? n.airfield : null;
};
const longestRunway = (a: Airfield | null): string => {
  const len = Math.max(0, ...(a?.runways ?? []).map((r) => r.lengthM ?? 0));
  return len > 0 ? `~${Math.round(len)} m` : "";
};

export interface AutoFieldsInput {
  readonly prefs: UnitPrefs;
  readonly route: RouteRecord;
  readonly log: NavLog;
  readonly aircraft: Aircraft | null;
  readonly loads: Loads;
  readonly plan: FuelPlanParams;
  readonly flow: number | null;
  readonly airfields: readonly Airfield[];
}

/**
 * Valeurs préremplies de la feuille (carburant, aérodrome d'arrivée, perfo du jour), toutes tirées des données de l'app :
 * carburant embarqué et réglages de l'écran Avion, terrains (pistes, fréquences, altitude) et log. L'utilisateur peut tout corriger.
 * TODA / LDA : la base de données ne donne que la longueur de piste, d'où le « ~ » (distances déclarées à vérifier).
 */
export function buildAutoFields(i: AutoFieldsInput): Record<string, string> {
  const out: Record<string, string> = {};
  const { prefs, log, route } = i;
  const fuelU = unitLabel("fuel", prefs);
  const fl = (v: number) => `${formatQuantity("fuel", prefs, v)} ${fuelU}`;
  const fuelStation = i.aircraft?.stations.find((s) => s.kind === "fuel");
  const onboard = i.aircraft && fuelStation ? (i.loads[fuelStation.id] ?? 0) : 0;
  const trip = i.flow === null ? null : (log.totals.fuel as number);
  const plan = i.aircraft
    ? planFuel({
        tripLiters: trip, taxiLiters: i.plan.taxiLiters, contingencyPercent: i.plan.contingencyPercent, alternateMinutes: i.plan.alternateMinutes,
        reserveMinutes: i.plan.reserveMinutes, fuelFlowLph: i.flow, onboardLiters: onboard, usableCapacityLiters: Math.max(0, i.aircraft.fuel.capacity - i.aircraft.fuel.unusable),
      })
    : null;
  if (plan) {
    if (onboard > 0) {
      out["fStart"] = fl(onboard);
      if (plan.endurance !== null) out["fAuto"] = formatDuration(plan.endurance * 3600);
      if (trip !== null) out["fStop"] = fl(Math.max(0, onboard - plan.taxi - trip));
    } else if (plan.required !== null) {
      out["fStart"] = `mini ${fl(plan.required)}`;
    }
  }
  const dep = log.legs[0]?.from;
  const arr = log.legs[log.legs.length - 1]?.to;
  const depAd = dep ? nearAirfield(dep.position, i.airfields) : null;
  const arrAd = arr ? nearAirfield(arr.position, i.airfields) : null;
  if (arrAd) {
    const lines: string[] = [];
    const elev = arrAd.elevation === null ? null : `${formatQuantity("altitude", prefs, arrAd.elevation as number)} ${unitLabel("altitude", prefs)}`;
    lines.push([arrAd.icao, elev ? `alt. ${elev}` : ""].filter(Boolean).join(" - "));
    if (arrAd.runways.length > 0) lines.push(`Pistes : ${arrAd.runways.map((r) => `${r.designator}${r.lengthM ? ` ${Math.round(r.lengthM)} m` : ""}${r.paved === true ? " dur" : r.paved === false ? " non revetu" : ""}`).join(" / ")}`);
    if (arrAd.frequencies.length > 0) lines.push(`VHF : ${arrAd.frequencies.slice(0, 4).map((f) => `${f.mhz}${f.name ? ` (${f.name})` : ""}`).join(", ")}`);
    out["arrival"] = lines.filter(Boolean).join("\n");
  }
  if (route.departureMs !== null) {
    out["deco"] = hhmm(route.departureMs);
    const tav = log.totals.timeWithWind as number | null;
    if (tav !== null) out["att"] = hhmm(route.departureMs + tav * 1000);
  }
  if (dep) out["dep"] = depAd?.icao ?? dep.name;
  if (arr) out["arr"] = arrAd?.icao ?? arr.name;
  const t1 = longestRunway(depAd), t2 = longestRunway(arrAd);
  if (t1) { out["toda1"] = t1; out["lda1"] = t1; }
  if (t2) { out["toda2"] = t2; out["lda2"] = t2; }
  return out;
}
