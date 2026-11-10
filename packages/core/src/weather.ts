/**
 * Décodage des METAR, TAF et SIGMET internationaux fournis en JSON par aviationweather.gov (NOAA).
 * Le service décode déjà les messages ; on valide chaque champ, on convertit en unités du projet et on écarte (en les
 * comptant) les enregistrements inutilisables. Le texte brut est toujours conservé : il fait foi.
 *
 * Unités : vent en m/s (le JSON est en nœuds), visibilité et altitudes en mètres (le JSON est en miles terrestres et en pieds),
 * pression en pascals, temps en millisecondes UTC (le JSON est en secondes). Direction du vent : degrés VRAIS (METAR).
 */
import { feetToMeters, feet, knotsToMps, knots, meters, hpaToPa, hectopascals, type Meters, type MetersPerSecond, type Pascals } from "./units";

const SM_M = 1609.344;

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";
export type CloudCover = "FEW" | "SCT" | "BKN" | "OVC" | "OVX";

export interface CloudLayer {
  readonly cover: CloudCover;
  /** Hauteur de la base au-dessus du sol (mètres), ou null si non rapportée. */
  readonly base: Meters | null;
}

export interface Conditions {
  /** Degrés vrais ; "VRB" = variable ; null = non rapporté. */
  readonly windDirection: number | "VRB" | null;
  readonly windSpeed: MetersPerSecond | null;
  readonly windGust: MetersPerSecond | null;
  /** Visibilité en mètres ; `orMore` vrai pour « 6 miles et plus » (valeur plancher, pas une mesure). */
  readonly visibility: { readonly meters: number; readonly orMore: boolean } | null;
  /** Phénomènes en clair du message (« -RA BR »). */
  readonly weather: string | null;
  readonly clouds: readonly CloudLayer[];
  /** Plafond : base de la plus basse couche BKN, OVC ou OVX (ou visibilité verticale) ; null = pas de plafond. */
  readonly ceiling: Meters | null;
  /** Catégorie de vol (définitions américaines), null si la visibilité est inconnue. */
  readonly category: FlightCategory | null;
}

export interface Metar {
  readonly station: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly observedAt: number;
  readonly raw: string;
  readonly special: boolean;
  /** °C */
  readonly temperature: number | null;
  readonly dewpoint: number | null;
  readonly qnh: Pascals | null;
  readonly conditions: Conditions;
}

export type TafChange = "BECMG" | "TEMPO" | "PROB";

export interface TafPeriod {
  readonly from: number;
  readonly to: number;
  /** null = période de base ; sinon évolution (BECMG), fluctuation (TEMPO) ou probabilité (PROB). */
  readonly change: TafChange | null;
  readonly probability: number | null;
  readonly conditions: Conditions;
  /** Texte que le service n'a pas su décoder (à lire dans le TAF brut). */
  readonly notDecoded: string | null;
}

export interface Taf {
  readonly station: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly issuedAt: number;
  readonly validFrom: number;
  readonly validTo: number;
  readonly raw: string;
  readonly periods: readonly TafPeriod[];
}

export interface Sigmet {
  readonly id: string;
  readonly firName: string;
  readonly hazard: string;
  readonly qualifier: string | null;
  /** Limites verticales en mètres AMSL, null si non précisées. */
  readonly base: Meters | null;
  readonly top: Meters | null;
  readonly validFrom: number;
  readonly validTo: number;
  /** Polygones [longitude, latitude]. */
  readonly areas: readonly (readonly (readonly [number, number])[])[];
  readonly raw: string;
}

export interface WxParseResult<T> {
  readonly items: T[];
  readonly skipped: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Catégorie de vol (FAA) : LIFR plafond < 500 ft ou visibilité < 1 mile ; IFR plafond < 1000 ft ou visibilité < 3 miles ;
 * MVFR plafond ≤ 3000 ft ou visibilité ≤ 5 miles ; sinon VFR. Ce ne sont PAS les minima VFR français.
 * Visibilité inconnue → null (on ne devine pas).
 */
export function flightCategory(visibilityM: number | null, ceiling: Meters | null): FlightCategory | null {
  if (visibilityM === null) return null;
  const ceilingFt = ceiling === null ? Infinity : ceiling / 0.3048;
  const visSm = visibilityM / SM_M;
  if (ceilingFt < 500 || visSm < 1) return "LIFR";
  if (ceilingFt < 1000 || visSm < 3) return "IFR";
  if (ceilingFt <= 3000 || visSm <= 5) return "MVFR";
  return "VFR";
}

const COVERS: readonly string[] = ["FEW", "SCT", "BKN", "OVC", "OVX"];

function clouds(raw: unknown): CloudLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: CloudLayer[] = [];
  for (const c of raw as { cover?: unknown; base?: unknown }[]) {
    if (typeof c?.cover === "string" && COVERS.includes(c.cover)) {
      out.push({ cover: c.cover as CloudCover, base: isNum(c.base) ? feetToMeters(feet(c.base)) : null });
    }
  }
  return out;
}

function visibility(v: unknown): Conditions["visibility"] {
  if (isNum(v)) return { meters: v * SM_M, orMore: false };
  if (typeof v === "string") {
    const m = /^(\d+(?:\.\d+)?)\+?$/.exec(v.trim());
    if (m) return { meters: Number(m[1]) * SM_M, orMore: v.trim().endsWith("+") };
  }
  return null;
}

function ceilingOf(layers: readonly CloudLayer[], vertVis: unknown): Meters | null {
  const bases = layers.filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "OVX").map((l) => l.base).filter((b): b is Meters => b !== null);
  if (bases.length > 0) return meters(Math.min(...bases));
  // Ciel obscurci : la visibilité verticale (en centaines de pieds) tient lieu de plafond.
  if (isNum(vertVis)) return feetToMeters(feet(vertVis * 100));
  return null;
}

function conditions(o: Record<string, unknown>): Conditions {
  const layers = clouds(o["clouds"]);
  const vis = visibility(o["visib"]);
  const ceiling = ceilingOf(layers, o["vertVis"]);
  const dir = o["wdir"];
  return {
    windDirection: isNum(dir) ? dir : dir === "VRB" ? "VRB" : null,
    windSpeed: isNum(o["wspd"]) ? knotsToMps(knots(o["wspd"])) : null,
    windGust: isNum(o["wgst"]) ? knotsToMps(knots(o["wgst"])) : null,
    visibility: vis,
    weather: str(o["wxString"]) || null,
    clouds: layers,
    ceiling,
    category: flightCategory(vis === null ? null : vis.meters, ceiling),
  };
}

function inBounds(lat: unknown, lon: unknown): lat is number {
  return isNum(lat) && isNum(lon) && lat >= -90 && lat <= 90 && (lon as number) >= -180 && (lon as number) <= 180;
}

export function parseAwcMetars(raw: unknown): WxParseResult<Metar> {
  if (!Array.isArray(raw)) throw new Error("Export METAR invalide : un tableau était attendu");
  const items: Metar[] = [];
  let skipped = 0;
  for (const o of raw as Record<string, unknown>[]) {
    const station = str(o?.["icaoId"]);
    if (station === "" || !isNum(o["obsTime"]) || str(o["rawOb"]) === "" || !inBounds(o["lat"], o["lon"])) { skipped++; continue; }
    items.push({
      station,
      name: str(o["name"]),
      lat: o["lat"] as number,
      lon: o["lon"] as number,
      observedAt: (o["obsTime"] as number) * 1000,
      raw: str(o["rawOb"]),
      special: o["metarType"] === "SPECI",
      temperature: isNum(o["temp"]) ? o["temp"] : null,
      dewpoint: isNum(o["dewp"]) ? o["dewp"] : null,
      qnh: isNum(o["altim"]) && o["altim"] > 800 && o["altim"] < 1100 ? hpaToPa(hectopascals(o["altim"])) : null,
      conditions: conditions(o),
    });
  }
  return { items, skipped };
}

export function parseAwcTafs(raw: unknown): WxParseResult<Taf> {
  if (!Array.isArray(raw)) throw new Error("Export TAF invalide : un tableau était attendu");
  const items: Taf[] = [];
  let skipped = 0;
  for (const o of raw as Record<string, unknown>[]) {
    const station = str(o?.["icaoId"]);
    const fcsts = o?.["fcsts"];
    if (station === "" || !isNum(o["validTimeFrom"]) || !isNum(o["validTimeTo"]) || str(o["rawTAF"]) === "" || !Array.isArray(fcsts) || !inBounds(o["lat"], o["lon"])) { skipped++; continue; }
    const periods: TafPeriod[] = [];
    for (const f of fcsts as Record<string, unknown>[]) {
      if (!isNum(f?.["timeFrom"]) || !isNum(f["timeTo"])) continue;
      const change = f["fcstChange"];
      periods.push({
        from: f["timeFrom"] * 1000,
        to: f["timeTo"] * 1000,
        change: change === "BECMG" || change === "TEMPO" || change === "PROB" ? change : null,
        probability: isNum(f["probability"]) ? f["probability"] : null,
        conditions: conditions(f),
        notDecoded: str(f["notDecoded"]) || null,
      });
    }
    if (periods.length === 0) { skipped++; continue; }
    items.push({
      station,
      name: str(o["name"]),
      lat: o["lat"] as number,
      lon: o["lon"] as number,
      issuedAt: isNum(o["issueTime"]) ? o["issueTime"] * 1000 : Date.parse(str(o["issueTime"])) || (o["validTimeFrom"] as number) * 1000,
      validFrom: (o["validTimeFrom"] as number) * 1000,
      validTo: (o["validTimeTo"] as number) * 1000,
      raw: str(o["rawTAF"]),
      periods,
    });
  }
  return { items, skipped };
}

function ringsOfSigmet(coords: unknown): [number, number][][] {
  const toRing = (pts: unknown): [number, number][] | null => {
    if (!Array.isArray(pts)) return null;
    const ring: [number, number][] = [];
    for (const p of pts as { lon?: unknown; lat?: unknown }[]) {
      if (!isNum(p?.lon) || !isNum(p?.lat) || p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
      ring.push([p.lon, p.lat]);
    }
    return ring.length >= 3 ? ring : null;
  };
  if (!Array.isArray(coords) || coords.length === 0) return [];
  // « AREA » : une liste de points ; « AREAS » : une liste de listes de points.
  const rings = Array.isArray((coords as unknown[])[0]) ? (coords as unknown[]).map(toRing) : [toRing(coords)];
  return rings.filter((r): r is [number, number][] => r !== null);
}

export function parseAwcSigmets(raw: unknown): WxParseResult<Sigmet> {
  if (!Array.isArray(raw)) throw new Error("Export SIGMET invalide : un tableau était attendu");
  const items: Sigmet[] = [];
  let skipped = 0;
  for (const o of raw as Record<string, unknown>[]) {
    const areas = ringsOfSigmet(o?.["coords"]);
    if (!isNum(o?.["validTimeFrom"]) || !isNum(o["validTimeTo"]) || str(o["hazard"]) === "" || areas.length === 0) { skipped++; continue; }
    items.push({
      id: `${str(o["firId"]) || str(o["icaoId"])}-${str(o["seriesId"])}-${o["validTimeFrom"]}`,
      firName: str(o["firName"]),
      hazard: str(o["hazard"]),
      qualifier: str(o["qualifier"]) || null,
      base: isNum(o["base"]) ? feetToMeters(feet(o["base"])) : null,
      top: isNum(o["top"]) ? feetToMeters(feet(o["top"])) : null,
      validFrom: o["validTimeFrom"] * 1000,
      validTo: o["validTimeTo"] * 1000,
      areas,
      raw: str(o["rawSigmet"]),
    });
  }
  return { items, skipped };
}

/** Un METAR plus ancien que ceci (minutes) est signalé comme périmé : un METAR est émis toutes les 30 à 60 min. JUGÉ. */
export const METAR_STALE_MINUTES = 90;

export function ageMinutes(timeMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - timeMs) / 60_000));
}

export type TafStatus = "future" | "valid" | "expired";

export function tafStatus(taf: Pick<Taf, "validFrom" | "validTo">, nowMs: number): TafStatus {
  return nowMs < taf.validFrom ? "future" : nowMs > taf.validTo ? "expired" : "valid";
}

/** Période de base du TAF à l'instant donné, et les évolutions (TEMPO, PROB, BECMG) qui le recouvrent. */
export function tafPeriodsAt(taf: Pick<Taf, "periods">, timeMs: number): { base: TafPeriod | null; overlays: TafPeriod[] } {
  const at = taf.periods.filter((p) => timeMs >= p.from && timeMs < p.to);
  // Une évolution BECMG remplace la base une fois terminée : on retient la plus récente des périodes de base ou BECMG commencées.
  const baseCandidates = at.filter((p) => p.change === null || p.change === "BECMG").sort((a, b) => b.from - a.from);
  return { base: baseCandidates[0] ?? null, overlays: at.filter((p) => p.change === "TEMPO" || p.change === "PROB") };
}

/** Dernier METAR de chaque station (le plus récent l'emporte). */
export function latestMetarByStation(metars: readonly Metar[]): Map<string, Metar> {
  const m = new Map<string, Metar>();
  for (const x of metars) {
    const cur = m.get(x.station);
    if (!cur || x.observedAt > cur.observedAt) m.set(x.station, x);
  }
  return m;
}

/** Dernier TAF de chaque station. */
export function latestTafByStation(tafs: readonly Taf[]): Map<string, Taf> {
  const m = new Map<string, Taf>();
  for (const x of tafs) {
    const cur = m.get(x.station);
    if (!cur || x.issuedAt > cur.issuedAt) m.set(x.station, x);
  }
  return m;
}
