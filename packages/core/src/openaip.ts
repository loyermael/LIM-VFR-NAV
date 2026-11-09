/**
 * Décodage des exports openAIP (espaces aériens et terrains).
 *
 * Source : https://www.openaip.net — licence CC BY-NC 4.0 (non commercial, attribution « openAIP »).
 * AVERTISSEMENT : base communautaire, mise à jour en continu, NON alignée sur le cycle AIRAC et non validée par le SIA.
 *
 * Codes (vérifiés sur le fichier réel de la France en recoupant les noms : « CTR AGEN » = 4, « TMA LYON 3 » = 7…) :
 * - `unit` : 0 mètre, 1 pied, 6 niveau de vol ; `referenceDatum` : 0 sol, 1 niveau de la mer, 2 pression standard ;
 * - `icaoClass` : 0 à 6 = A à G, 8 ou autre = sans classe.
 * Un enregistrement illisible est écarté et compté : on n'invente ni limite ni polygone.
 */
import type { AirspaceLimit } from "./ceiling";
import type { LatLon } from "./geodesy";
import { feetToMeters, feet, meters, type Meters } from "./units";

export type AirspaceGroup = "controlled" | "restricted" | "radio" | "activity" | "glider" | "other";

/** Types openAIP rencontrés ou documentés. Un type inconnu s'affiche « type N » dans le groupe « autre ». */
const TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "Autre", 1: "Zone réglementée", 2: "Zone dangereuse", 3: "Zone interdite", 4: "CTR", 5: "TMZ", 6: "RMZ", 7: "TMA",
  8: "TRA", 9: "TSA", 10: "FIR", 11: "UIR", 12: "ADIZ", 13: "ATZ", 14: "MATZ", 15: "Voie aérienne", 16: "MTR", 17: "Alerte",
  18: "Avertissement", 19: "Zone protégée", 20: "HTZ", 21: "Transit planeur", 22: "TRP", 23: "TIZ", 24: "TIA", 25: "MTA",
  26: "CTA", 27: "Secteur ACC", 28: "Activité sportive", 29: "Parc / réserve", 30: "MRT", 31: "TFR", 32: "Secteur VFR",
  33: "Secteur SIV", 34: "LTA", 35: "UTA", 36: "MCTR",
};

const GROUP_OF_TYPE: Readonly<Record<number, AirspaceGroup>> = {
  4: "controlled", 7: "controlled", 26: "controlled", 13: "controlled", 36: "controlled", 35: "controlled",
  1: "restricted", 2: "restricted", 3: "restricted", 32: "restricted", 8: "restricted", 9: "restricted", 31: "restricted",
  5: "radio", 6: "radio",
  28: "activity",
  21: "glider",
};

export const AIRSPACE_GROUPS: readonly AirspaceGroup[] = ["controlled", "restricted", "radio", "activity", "glider", "other"];

export interface AirLimit extends AirspaceLimit {
  /** Libellé d'origine pour l'affichage : « 1500 ft AMSL », « FL115 », « SOL ». */
  readonly label: string;
}

export interface AirFrequency {
  readonly name: string;
  readonly mhz: string;
  readonly primary: boolean;
}

export interface Airspace {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly typeLabel: string;
  readonly group: AirspaceGroup;
  /** Classe OACI (A à G), ou null (zone sans classe). */
  readonly icaoClass: string | null;
  readonly lower: AirLimit;
  readonly upper: AirLimit;
  /** Anneaux [longitude, latitude] : le premier est l'extérieur, les suivants des trous. */
  readonly rings: readonly (readonly (readonly [number, number])[])[];
  readonly bbox: { readonly south: number; readonly west: number; readonly north: number; readonly east: number };
  readonly frequencies: readonly AirFrequency[];
  readonly remarks: string | null;
  /** Dates d'activation (ISO) quand la zone est temporaire. */
  readonly activeFrom: string | null;
  readonly activeUntil: string | null;
  /** Activation sur demande ou par NOTAM : l'état réel du jour est inconnu de l'application. */
  readonly onRequest: boolean;
  readonly byNotam: boolean;
}

export interface Airfield {
  readonly id: string;
  readonly name: string;
  readonly icao: string | null;
  readonly type: number;
  readonly position: LatLon;
  /** Altitude du terrain, mètres AMSL. */
  readonly elevation: Meters | null;
  readonly frequencies: readonly AirFrequency[];
  readonly runways: readonly { readonly designator: string; readonly trueHeading: number | null; readonly lengthM: number | null }[];
  readonly private: boolean;
}

export interface ParseResult<T> {
  readonly items: T[];
  /** Enregistrements écartés (illisibles), avec leur raison. */
  readonly skipped: { readonly name: string; readonly reason: string }[];
}

interface RawLimit { value?: unknown; unit?: unknown; referenceDatum?: unknown }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Une limite openAIP → limite normalisée (mètres, ou niveau de vol) avec son libellé d'origine. */
export function parseLimit(l: RawLimit | undefined | null): AirLimit | null {
  if (!l || !isNum(l.value) || !isNum(l.unit) || !isNum(l.referenceDatum)) return null;
  const v = l.value;
  const datum = l.referenceDatum;
  if (l.unit === 6) {
    if (datum !== 2) return null;
    return { reference: "FL", value: v, label: `FL${String(v).padStart(3, "0")}` };
  }
  const metersValue = l.unit === 0 ? v : l.unit === 1 ? feetToMeters(feet(v)) : null;
  if (metersValue === null) return null;
  const unit = l.unit === 0 ? "m" : "ft";
  if (datum === 0) return { reference: "AGL", value: metersValue, label: v === 0 ? "SOL" : `${v} ${unit} AGL` };
  if (datum === 1) return { reference: "AMSL", value: metersValue, label: `${v} ${unit} AMSL` };
  return null;
}

export function groupOfType(type: number): AirspaceGroup {
  return GROUP_OF_TYPE[type] ?? "other";
}

const CLASS_LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;

function frequencies(raw: unknown): AirFrequency[] {
  if (!Array.isArray(raw)) return [];
  const out: AirFrequency[] = [];
  for (const f of raw as { value?: unknown; name?: unknown; primary?: unknown }[]) {
    const mhz = str(f?.value);
    if (mhz !== "") out.push({ name: str(f.name), mhz, primary: f.primary === true });
  }
  return out;
}

function ringsOf(geometry: unknown): [number, number][][] | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!g || g.type !== "Polygon" || !Array.isArray(g.coordinates)) return null;
  const rings: [number, number][][] = [];
  for (const ring of g.coordinates as unknown[]) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    const pts: [number, number][] = [];
    for (const c of ring as unknown[]) {
      if (!Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || c[1] < -90 || c[1] > 90 || c[0] < -180 || c[0] > 180) return null;
      pts.push([c[0], c[1]]);
    }
    rings.push(pts);
  }
  return rings.length > 0 ? rings : null;
}

export function parseOpenAipAirspaces(raw: unknown): ParseResult<Airspace> {
  if (!Array.isArray(raw)) throw new Error("Export openAIP des espaces aériens invalide : un tableau était attendu");
  const items: Airspace[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    const name = str(a?.["name"]) || "?";
    const rings = ringsOf(a?.["geometry"]);
    const lower = parseLimit(a?.["lowerLimit"] as RawLimit | undefined);
    const upper = parseLimit(a?.["upperLimit"] as RawLimit | undefined);
    const type = a?.["type"];
    if (!isNum(type)) { skipped.push({ name, reason: "type absent" }); continue; }
    if (!rings) { skipped.push({ name, reason: "géométrie illisible" }); continue; }
    if (!lower || !upper) { skipped.push({ name, reason: "limite verticale illisible" }); continue; }
    let south = 90, north = -90, west = 180, east = -180;
    for (const [lon, lat] of rings[0] as [number, number][]) {
      south = Math.min(south, lat); north = Math.max(north, lat); west = Math.min(west, lon); east = Math.max(east, lon);
    }
    const cls = a["icaoClass"];
    items.push({
      id: str(a["_id"]) || `${name}#${items.length}`,
      name,
      type,
      typeLabel: TYPE_LABELS[type] ?? `type ${type}`,
      group: groupOfType(type),
      icaoClass: isNum(cls) && cls >= 0 && cls < CLASS_LETTERS.length ? (CLASS_LETTERS[cls] as string) : null,
      lower,
      upper,
      rings,
      bbox: { south, west, north, east },
      frequencies: frequencies(a["frequencies"]),
      remarks: str(a["remarks"]) || null,
      activeFrom: str(a["activeFrom"]) || null,
      activeUntil: str(a["activeUntil"]) || null,
      onRequest: a["onRequest"] === true,
      byNotam: a["byNotam"] === true,
    });
  }
  return { items, skipped };
}

export function parseOpenAipAirfields(raw: unknown): ParseResult<Airfield> {
  if (!Array.isArray(raw)) throw new Error("Export openAIP des terrains invalide : un tableau était attendu");
  const items: Airfield[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    const name = str(a?.["name"]) || "?";
    const g = a?.["geometry"] as { type?: unknown; coordinates?: unknown } | undefined;
    const c = g?.coordinates;
    if (!g || g.type !== "Point" || !Array.isArray(c) || !isNum(c[0]) || !isNum(c[1]) || c[1] < -90 || c[1] > 90 || c[0] < -180 || c[0] > 180) {
      skipped.push({ name, reason: "position illisible" });
      continue;
    }
    const el = a["elevation"] as RawLimit | undefined;
    // Altitude du terrain : mètre (0) ou pied (1), référence niveau de la mer.
    const elevation = el && isNum(el.value) ? (el.unit === 1 ? feetToMeters(feet(el.value)) : el.unit === 0 ? meters(el.value) : null) : null;
    const runways = Array.isArray(a["runways"])
      ? (a["runways"] as Record<string, unknown>[]).map((r) => {
          const dim = (r?.["dimension"] as { length?: { value?: unknown; unit?: unknown } } | undefined)?.length;
          const len = dim && isNum(dim.value) ? (dim.unit === 1 ? dim.value * 0.3048 : dim.value) : null;
          return { designator: str(r?.["designator"]), trueHeading: isNum(r?.["trueHeading"]) ? (r["trueHeading"] as number) : null, lengthM: len };
        })
      : [];
    items.push({
      id: str(a["_id"]) || `${name}#${items.length}`,
      name,
      icao: str(a["icaoCode"]) || null,
      type: isNum(a["type"]) ? (a["type"] as number) : -1,
      position: { lat: c[1], lon: c[0] },
      elevation,
      frequencies: frequencies(a["frequencies"]),
      runways,
      private: a["private"] === true,
    });
  }
  return { items, skipped };
}
