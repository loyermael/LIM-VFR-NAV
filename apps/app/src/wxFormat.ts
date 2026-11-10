/** Textes lisibles pour la météo : fonctions pures (testées). Toutes les valeurs absentes donnent « — », jamais un zéro inventé. */
import { formatQuantity, unitLabel, type CloudLayer, type Conditions, type UnitPrefs } from "@lim/core";

const DASH = "—";
const pad3 = (n: number) => String(n).padStart(3, "0");

/** « 240° 12 kt G22 », « VRB 3 kt », « calme ». */
export function windText(c: Pick<Conditions, "windDirection" | "windSpeed" | "windGust">, prefs: UnitPrefs): string {
  if (c.windSpeed === null) return DASH;
  const unit = unitLabel("groundSpeed", prefs);
  const speed = formatQuantity("groundSpeed", prefs, c.windSpeed);
  if (c.windSpeed === 0) return "calme";
  const dir = c.windDirection === "VRB" ? "VRB" : c.windDirection === null ? DASH : `${pad3(Math.round(c.windDirection) % 360 || 360)}°`;
  const gust = c.windGust !== null ? ` G${formatQuantity("groundSpeed", prefs, c.windGust)}` : "";
  return `${dir} ${speed}${gust} ${unit}`;
}

/** Visibilité : « ≥ 10 km », « 5.0 km », « 800 m ». « ou plus » est une valeur plancher. */
export function visibilityText(v: Conditions["visibility"]): string {
  if (v === null) return DASH;
  if (v.orMore) return v.meters >= 9600 ? "≥ 10 km" : `≥ ${(v.meters / 1000).toFixed(1)} km`;
  if (v.meters >= 5000) return `${(v.meters / 1000).toFixed(1)} km`;
  return `${Math.round(v.meters / 100) * 100} m`;
}

/** « FEW 1600 ft · BKN 2700 ft » (hauteurs au-dessus du sol, arrondies à 100 ft). */
export function cloudsText(layers: readonly CloudLayer[]): string {
  if (layers.length === 0) return "aucun nuage significatif";
  return layers.map((l) => (l.base === null ? l.cover : `${l.cover} ${Math.round(l.base / 0.3048 / 100) * 100} ft`)).join(" · ");
}

export function ceilingText(c: Conditions): string {
  return c.ceiling === null ? "pas de plafond" : `${Math.round(c.ceiling / 0.3048 / 100) * 100} ft`;
}

export function temperatureText(t: number | null, d: number | null): string {
  if (t === null) return DASH;
  return d === null ? `${t}°C` : `${t}° / ${d}°C`;
}

/** Âge lisible : « 12 min », « 2 h 05 ». */
export function ageText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Heure UTC « 14:30Z » et date-heure « 10/11 14:30Z ». */
export function utcTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
}
export function utcDateTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} ${utcTime(ms)}`;
}

const HAZARDS: Record<string, string> = {
  TS: "Orages", TURB: "Turbulence", ICE: "Givrage", MTW: "Ondes de montagne", TC: "Cyclone tropical", VA: "Cendres volcaniques",
};
export const hazardLabel = (h: string): string => HAZARDS[h] ?? h;

/** Niveaux d'un SIGMET : « SOL → FL300 », « FL100 → FL250 ». Pieds arrondis aux 100 pieds. */
export function levelsText(base: number | null, top: number | null): string {
  const ft = (m: number) => `FL${String(Math.round(m / 0.3048 / 100)).padStart(3, "0")}`;
  return `${base === null ? "SOL" : ft(base)} → ${top === null ? "?" : ft(top)}`;
}

/** Plage horaire UTC « 06:00Z–04:00Z+1 » : « +1 » = jour suivant (une période de TAF dépasse souvent minuit). */
export function utcRange(fromMs: number, toMs: number): string {
  const day = (ms: number) => Math.floor(ms / 86_400_000);
  const diff = day(toMs) - day(fromMs);
  return `${utcTime(fromMs)}–${utcTime(toMs)}${diff > 0 ? `+${diff}` : ""}`;
}
