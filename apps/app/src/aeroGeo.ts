import { navaidSymbol, type NavDataset } from "./navData";
/** Conversion des espaces et terrains en GeoJSON pour la carte, et textes de détail. Fonctions pures (testées). */
import type { FeatureCollection } from "geojson";
import {
  flightLevelToMeters, type Airfield, type Airspace, type DatasetFreshness, formatQuantity, type UnitPrefs,
} from "@lim/core";

/** Plancher en mètres AMSL pour le filtre de plafond. -1 = limite relative au sol (toujours affichée, relief inconnu). */
export function floorMeters(a: Pick<Airspace, "lower">): number {
  if (a.lower.reference === "FL") return flightLevelToMeters(a.lower.value);
  if (a.lower.reference === "AMSL") return a.lower.value;
  return -1;
}

/**
 * Style d'un espace d'après la légende de la carte OACI : bandes colorées le long de la limite pour les espaces contrôlés (A rouge, B/C/D bleu, E bleu clair),
 * hachures rouges pour les zones interdites (quadrillées), réglementées et dangereuses, trait mixte pour RMZ/TMZ, pointillés pour ATZ et secteurs SIV.
 * Types openAIP : 1 réglementée, 2 dangereuse, 3 interdite, 4 CTR, 5 TMZ, 6 RMZ, 7 TMA, 10 FIR, 13 ATZ, 21 transit planeur, 26 CTA, 28 activité, 29 parc, 33 SIV, 34 LTA.
 */
export type AirspaceStyle = "ca" | "cbd" | "ce" | "pro" | "res" | "rmz" | "siv" | "atz" | "fir" | "park" | "act" | "glider" | "other";
export function airspaceStyle(a: Pick<Airspace, "type" | "icaoClass">): AirspaceStyle {
  switch (a.type) {
    case 3: return "pro";
    case 1: case 2: return "res";
    case 5: case 6: return "rmz";
    case 33: return "siv";
    case 13: return "atz";
    case 10: return "fir";
    case 29: return "park";
    case 28: return "act";
    case 21: return "glider";
    case 4: case 7: case 26: case 34: case 35: case 36:
      return a.icaoClass === "A" ? "ca" : a.icaoClass === "E" ? "ce" : "cbd";
    default: return "other";
  }
}

/** Limite à la manière de la carte : « FL 085 », « 2000 AMSL », « 1500 ASFC », « SFC ». */
export function limitText(label: string): string {
  return label.replace(/^FL(\d+)/, "FL $1").replace(" ft AMSL", " AMSL").replace(" ft AGL", " ASFC").replace(" m AGL", " m ASFC").replace(/^SOL$/, "SFC");
}

/** Sens des anneaux : extérieur horaire (en longitude/latitude), trous antihoraires. L'intérieur est alors à droite du tracé : un décalage positif place la bande colorée DANS l'espace. */
function ringArea(r: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i] as readonly [number, number], q = r[(i + 1) % r.length] as readonly [number, number]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}
export function orientRings(rings: readonly (readonly (readonly [number, number])[])[]): number[][][] {
  return rings.map((r, i) => {
    const area = ringArea(r);
    const wantClockwise = i === 0;
    const out = r.map((c) => [c[0], c[1]]);
    return (area < 0) === wantClockwise ? out : out.reverse();
  });
}

const LABELLED: ReadonlySet<AirspaceStyle> = new Set(["ca", "cbd", "ce", "pro", "res"]);

export function airspacesToGeoJSON(airspaces: readonly Airspace[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: airspaces.map((a) => {
      const sty = airspaceStyle(a);
      const lbl = LABELLED.has(sty) ? [a.name, limitText(a.upper.label), limitText(a.lower.label)].join("\n") : "";
      return {
        type: "Feature" as const,
        properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a), sty, lbl },
        geometry: { type: "Polygon" as const, coordinates: orientRings(a.rings) },
      };
    }),
  };
}

/**
 * Symbole d'un terrain d'après la légende de la carte OACI : civil (bleu, avec repères), mixte (double cercle), militaire (rouge, sans repères) ;
 * piste en dur (disque barré), bande (cercle), hélistation (H), hydro-aérodrome (ancre) ; privé (P), désaffecté (croix).
 * Le type est celui d'openAIP (0 mixte, 4 et 5 militaires, 7 hélistation, 8 fermé, 10 hydrobase : constaté sur l'export).
 */
export function airfieldSymbol(a: Pick<Airfield, "type" | "private" | "runways">): string {
  if (a.type === 8) return "ad-x";
  const mil = a.type === 4 || a.type === 5;
  if (a.private && !mil) return "ad-p";
  const cls = mil ? "mil" : a.type === 0 ? "mixte" : "civil";
  if (a.type === 4 || a.type === 7) return `ad-${cls}-heli`;
  if (a.type === 10) return `ad-${cls}-water`;
  const longest = Math.max(0, ...a.runways.map((r) => r.lengthM ?? 0));
  const paved = a.runways.some((r) => r.paved === true) || (a.runways.every((r) => r.paved === undefined) && longest >= 900);
  return `ad-${cls}-${paved ? "paved" : "unpaved"}`;
}

/** Étiquette de terrain : code OACI, nom, puis altitude (ft), fréquence principale et longueur de la plus longue piste (hm), comme sur la carte. */
export function airfieldLabel(a: Airfield): string {
  const f = a.frequencies.find((x) => x.primary) ?? a.frequencies[0];
  const longest = Math.max(0, ...a.runways.map((r) => r.lengthM ?? 0));
  const tail = [a.elevation !== null ? String(Math.round(Number(a.elevation) * 3.28084)) : "", f?.mhz ?? "", longest > 0 ? String(Math.round(longest / 100)) : ""].filter(Boolean).join(" ");
  return [a.icao ?? "", a.name.toUpperCase(), tail].filter(Boolean).join("\n");
}

export function airfieldsToGeoJSON(airfields: readonly Airfield[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: airfields.map((a) => ({
      type: "Feature" as const,
      properties: { id: a.id, name: a.name, icao: a.icao ?? "", sym: airfieldSymbol(a), lbl: airfieldLabel(a), mil: a.type === 4 || a.type === 5 },
      geometry: { type: "Point" as const, coordinates: [a.position.lon, a.position.lat] },
    })),
  };
}

const freqText = (f: readonly { name: string; mhz: string; primary: boolean }[]) =>
  f.map((x) => `${x.mhz}${x.name ? ` ${x.name}` : ""}${x.primary ? " ★" : ""}`).join(" · ");

export type PeriodStatus = "upcoming" | "current" | "ended";

/** Où en est-on par rapport à la période d'activation d'un espace temporaire ? null si l'espace n'a pas de période. */
export function periodStatus(a: Pick<Airspace, "activeFrom" | "activeUntil">, nowMs: number): PeriodStatus | null {
  const from = a.activeFrom ? Date.parse(a.activeFrom) : NaN;
  const until = a.activeUntil ? Date.parse(a.activeUntil) : NaN;
  if (Number.isNaN(from) && Number.isNaN(until)) return null;
  if (!Number.isNaN(from) && nowMs < from) return "upcoming";
  if (!Number.isNaN(until) && nowMs > until) return "ended";
  return "current";
}

const STATUS_TEXT: Record<PeriodStatus, string> = { upcoming: "à venir", current: "en cours", ended: "terminée" };

/** Date et heure UTC lisibles : « 02/12/2026 08:00 UTC ». Texte inchangé si la date est illisible. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Détail d'un espace pour la fiche (clés et valeurs lisibles). */
export function airspaceDetails(a: Airspace, exportedAtMs: number | null, nowMs: number = Date.now()): Record<string, string> {
  const d: Record<string, string> = {
    Nom: a.name,
    Type: a.typeLabel + (a.icaoClass ? ` · classe ${a.icaoClass}` : ""),
    Plancher: a.lower.label,
    Plafond: a.upper.label,
  };
  if (a.frequencies.length > 0) d["Fréquences"] = freqText(a.frequencies);
  if (a.onRequest || a.byNotam) d["Activation"] = `${a.byNotam ? "par NOTAM" : "sur demande"} : à vérifier (SIA / NOTAM), état du jour inconnu`;
  const status = periodStatus(a, nowMs);
  if (status !== null) {
    d["Période"] = `${a.activeFrom ? formatUtc(a.activeFrom) : "?"} → ${a.activeUntil ? formatUtc(a.activeUntil) : "?"} (${STATUS_TEXT[status]})`;
  }
  if (a.remarks) d["Remarques"] = a.remarks;
  d["Source"] = `openAIP${exportedAtMs !== null ? `, export du ${new Date(exportedAtMs).toLocaleDateString("fr-FR")}` : ""} (non officiel)`;
  return d;
}

export function airfieldDetails(a: Airfield, prefs: UnitPrefs, exportedAtMs: number | null): Record<string, string> {
  const d: Record<string, string> = { Nom: a.name };
  if (a.icao) d["Code OACI"] = a.icao;
  if (a.elevation !== null) d["Altitude"] = `${formatQuantity("altitude", prefs, a.elevation)} ${prefs.altitude === "ft" ? "ft" : "m"}`;
  if (a.private) d["Accès"] = "privé";
  if (a.runways.length > 0) {
    d["Pistes"] = a.runways
      .map((r) => `${r.designator}${r.trueHeading !== null ? ` (${Math.round(r.trueHeading)}°V)` : ""}${r.lengthM !== null ? ` ${Math.round(r.lengthM)} m` : ""}`)
      .join(" · ");
  }
  if (a.frequencies.length > 0) d["Fréquences"] = freqText(a.frequencies);
  d["Source"] = `openAIP${exportedAtMs !== null ? `, export du ${new Date(exportedAtMs).toLocaleDateString("fr-FR")}` : ""} (non officiel)`;
  return d;
}

/** Phrases d'avertissement sur la fraîcheur des données (vides si tout va bien). */
export function freshnessWarnings(f: DatasetFreshness): string[] {
  const w: string[] = ["openAIP n'est pas un jeu AIRAC officiel : vérifier sur les documents du SIA."];
  if (f.stale) w.push(`Données de ${f.ageDays} jours (plus de 28) : à mettre à jour.`);
  else if (f.beforeCurrentCycle) w.push("Données antérieures au cycle AIRAC en cours.");
  return w;
}

/**
 * Balises, points de report et obstacles pour la carte aéro, en un seul jeu de points. `sym` = image à dessiner, `cat` = nom affiché à l'appui,
 * `grp` = famille (filtre d'affichage), `h` = hauteur au-dessus du sol (m) pour trier les obstacles par importance.
 */
export function navToGeoJSON(d: NavDataset): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  const add = (lon: number, lat: number, properties: Record<string, unknown>) => features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
  for (const v of d.navaids) {
    const sym = navaidSymbol(v);
    const freq = v.freq ? `${Number.parseFloat(v.freq)} ${v.freqUnit === 1 ? "kHz" : "MHz"}` : "";
    add(v.lon, v.lat, { sym, grp: "navaid", cat: sym === "ndb" ? "NDB" : sym === "dme" ? "DME" : sym === "vor" ? "VOR" : "VOR/DME", name: v.name, ident: v.ident, freq, h: 0, lbl: "", nm: v.name.toUpperCase(), box: navaidBox(v, sym) });
  }
  for (const r of d.reporting) add(r.lon, r.lat, { sym: r.compulsory ? "rp-c" : "rp", grp: "report", cat: r.compulsory ? "Point de report obligatoire" : "Point de report", name: r.name, h: 0, lbl: r.name });
  for (const o of d.obstacles) {
    const h = o.heightM ?? 0;
    add(o.lon, o.lat, { sym: o.what === "wind" ? "wind" : h >= HIGH_OBSTACLE_M ? "mast-hi" : "mast", grp: "obstacle", cat: o.what === "wind" ? "Éolienne (indicatif)" : "Obstacle (indicatif)", name: o.name, heightM: o.heightM ?? "", h, lbl: obstacleLabel(o) });
  }
  return { type: "FeatureCollection", features };
}

const FT_PER_M = 3.28084;
/** Étiquette d'obstacle à la manière des cartes aéro : altitude du sommet (ft AMSL) puis hauteur au-dessus du sol entre parenthèses ; rien si la hauteur est inconnue. */
export function obstacleLabel(o: { heightM: number | null; elevM: number | null }): string {
  if (o.heightM === null) return "";
  const h = Math.round(o.heightM * FT_PER_M);
  return o.elevM === null ? `(${h})` : `${Math.round((o.elevM + o.heightM) * FT_PER_M)}\n(${h})`;
}

/** La carte OACI n'indique que les obstacles de 300 ft AGL et plus ; au-delà de 500 ft AGL ils sont dessinés « élevés ». */
export const MIN_OBSTACLE_M = 91.44;
export const HIGH_OBSTACLE_M = 152.4;

/** Cadre de balise : « (D) IDENT fréquence » (D = DME associé ; fréquence sans zéros inutiles : 108.25, 116.5, 378). */
export function navaidBox(v: { ident: string; freq: string | null; channel: string | null }, sym: string): string {
  const f = v.freq === null ? "" : String(Number.parseFloat(v.freq));
  return `${sym === "vordme" || sym === "dme" ? "(D) " : ""}${v.ident}${f ? ` ${f}` : ""}`;
}
