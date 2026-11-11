import { navaidSymbol, type NavDataset } from "./navData";
import type { OnaDataset } from "./obstacles";
import { shiftedPosition } from "./activities";
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
export type AirspaceStyle = "ca" | "cbd" | "ce" | "pro" | "res" | "rtba" | "parz" | "rmz" | "siv" | "atz" | "fir" | "park" | "act" | "glider" | "other";
/**
 * RTBA (réseau très basse altitude, vols militaires) : zones réglementées à activation hebdomadaire (« (MON-FRI) »…) dont le plancher est au sol ou très bas (≤ 1000 ft AGL).
 * Repérage par le nom et le plancher : openAIP ne porte pas d'indicateur RTBA.
 */
export const isRtba = (a: { type: number; name?: string; lower?: { reference: string; value: number } }) =>
  a.type === 1 && /\((MON|TUE|WED|THU|FRI|SAT)-/.test(a.name ?? "") && a.lower?.reference === "AGL" && a.lower.value <= 305;

export function airspaceStyle(a: Pick<Airspace, "type" | "icaoClass"> & { name?: string; lower?: { reference: string; value: number } }): AirspaceStyle {
  if (isRtba(a)) return "rtba";
  if (isParachuting({ type: a.type, name: a.name ?? "" }) && (a.type === 1 || a.type === 28)) return "parz";
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

const LABELLED: ReadonlySet<AirspaceStyle> = new Set(["pro", "res", "rtba", "parz"]);
/** Espaces contrôlés : étiquette encadrée avec le carré de la classe, comme la carte OACI (« TMA ST-YAN-1 / FL 085 / 2000 ASFC / 123.405 »). */
const CONTROLLED: ReadonlySet<AirspaceStyle> = new Set(["ca", "cbd", "ce"]);

/** Zone « de faible superficie » : la carte OACI la figure par une croix rouge plutôt que par son contour (emprise de moins de 0,06°, environ 3 NM). */
export const SMALL_AREA_DEG = 0.06;
const isSmallArea = (a: Pick<Airspace, "type" | "bbox">) =>
  (a.type === 1 || a.type === 2 || a.type === 3) && Math.max(a.bbox.north - a.bbox.south, a.bbox.east - a.bbox.west) < SMALL_AREA_DEG;
/** Activité de parachutage : zones « activité sportive » dont le nom l'indique (PARA, PJE…), ou zone réglementée « PARA ». */
/** Voltige : zones « activité sportive » nommées VOLTIGE ou AEROBATICS. */
export const isAerobatics = (a: Pick<Airspace, "type" | "name">) => a.type === 28 && /VOLTIGE|AEROBATIC/i.test(a.name);
export const isParachuting = (a: Pick<Airspace, "type" | "name">) => (a.type === 28 || a.type === 1) && /\bPARA|\bPJE\b/i.test(a.name);

export function airspacesToGeoJSON(airspaces: readonly Airspace[]): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  for (const a of airspaces) {
    const sty = airspaceStyle(a);
    const small = isSmallArea(a);
    const lbl = LABELLED.has(sty) ? [a.name, limitText(a.upper.label), limitText(a.lower.label)].join("\n") : "";
    features.push({
      type: "Feature" as const,
      // secteur d'information de vol (SIV) : nom, limites et fréquence dans un encadré vert, comme sur la carte OACI
      properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a), sty, lbl: small ? "" : lbl, small, ctllbl: CONTROLLED.has(sty) && !small ? [a.name, limitText(a.upper.label), limitText(a.lower.label), a.frequencies[0]?.mhz ?? ""].filter(Boolean).join("\n") : "", cls: a.icaoClass && /^[A-E]$/.test(a.icaoClass) ? `cls-${a.icaoClass}` : "cls-none", sivlbl: sty === "siv" ? [a.name, `${limitText(a.lower.label)} - ${limitText(a.upper.label)}`, a.frequencies[0]?.mhz ?? ""].filter(Boolean).join("\n") : "" },
      geometry: { type: "Polygon" as const, coordinates: orientRings(a.rings) },
    });
    const centre = { type: "Point" as const, coordinates: [(a.bbox.east + a.bbox.west) / 2, (a.bbox.north + a.bbox.south) / 2] };
    const cLat = (a.bbox.north + a.bbox.south) / 2, cLon = (a.bbox.east + a.bbox.west) / 2;
    const sh = (kind: "para" | "acro") => ({ type: "Point" as const, coordinates: shiftedPosition(cLat, cLon, kind) }); // décalage fixé sur le terrain, pas en pixels
    // Croix (petite zone) et parachute : symboles ponctuels au centre de l'emprise, filtrés comme l'espace lui-même (groupe, plafond).
    if (small) features.push({ type: "Feature" as const, properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a), sty: "cross", sym: "small-area", lbl: [a.name, limitText(a.upper.label), limitText(a.lower.label)].join("\n") }, geometry: centre });
    if (isAerobatics(a)) features.push({ type: "Feature" as const, properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a), sty: "acro", sym: "acro", lbl: "" }, geometry: sh("acro") });
    if (isParachuting(a)) features.push({ type: "Feature" as const, properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a), sty: "para", sym: "para", lbl: "" }, geometry: sh("para") });
  }
  return { type: "FeatureCollection", features };
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
  if (!paved) return `ad-${cls}-unpaved`;
  // piste en dur : la barre blanche du symbole suit le cap de la plus longue piste (12 positions, de 15° en 15°, modulo 180°)
  const main = [...a.runways].filter((r) => r.trueHeading !== null).sort((p, q) => (q.lengthM ?? 0) - (p.lengthM ?? 0))[0];
  return main && main.trueHeading !== null ? `ad-${cls}-paved-h${runwayBucket(main.trueHeading)}` : `ad-${cls}-paved`;
}

/** Position (0 à 11) de la barre du symbole pour un cap de piste : arrondi aux 15° les plus proches, la piste n'ayant pas de sens. */
export function runwayBucket(headingDeg: number): number {
  return Math.round((((headingDeg % 180) + 180) % 180) / 15) % 12;
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
export function navToGeoJSON(d: NavDataset, ona: OnaDataset | null = null): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  const add = (lon: number, lat: number, properties: Record<string, unknown>) => features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates: [lon, lat] } });
  for (const v of d.navaids) {
    const sym = navaidSymbol(v);
    const freq = v.freq ? `${Number.parseFloat(v.freq)} ${v.freqUnit === 1 ? "kHz" : "MHz"}` : "";
    add(v.lon, v.lat, { sym, grp: "navaid", cat: sym === "ndb" ? "NDB" : sym === "dme" ? "DME" : sym === "vor" ? "VOR" : "VOR/DME", name: v.name, ident: v.ident, freq, h: 0, lbl: "", nm: v.name.toUpperCase(), box: navaidBox(v, sym) });
  }
  for (const r of d.reporting) add(r.lon, r.lat, { sym: r.compulsory ? "rp-c" : "rp", grp: "report", cat: r.compulsory ? "Point de report obligatoire" : "Point de report", name: r.name, h: 0, lbl: r.name });
  if (ona) {
    // Obstacles officiels (AIP ENR 5.4.1) : seuls ceux de 300 ft et plus (règle de la carte OACI) ; mât ou obstacle balisé de nuit ; éoliennes en parcs (la plus haute par maille).
    const M = 0.3048;
    const wcells = new Map<string, OnaDataset["items"][number]>();
    for (const o of ona.items) {
      const [lat, lon, h, top, wind, lit] = o;
      if (h < 300) continue;
      if (wind) {
        const key = `${Math.round(lat / 0.012)}:${Math.round(lon / 0.017)}`;
        const cur = wcells.get(key);
        if (!cur || h > cur[2]) wcells.set(key, o);
        continue;
      }
      add(lon, lat, { sym: h >= 500 ? (lit ? "mast-hi-lit" : "mast-hi") : lit ? "mast-lit" : "mast", grp: "obstacle", cat: lit ? "Obstacle balisé de nuit" : "Obstacle", name: "", heightM: Math.round(h * M), h: h * M, lbl: `${top}\n(${h})` });
    }
    for (const [lat, lon, h, top] of wcells.values()) add(lon, lat, { sym: "wind", grp: "obstacle", cat: "Éolienne", name: "", heightM: Math.round(h * M), h: h * M, lbl: `${top}\n(${h})` });
    return { type: "FeatureCollection", features };
  }
  // Éoliennes : la carte OACI les montre en parcs (un symbole par groupe). openAIP/OSM ne donne la hauteur que pour une sur cinq ; sans hauteur on suppose
  // une machine moderne (> 300 ft) et on garde un symbole par maille d'environ 1,3 km (la plus haute connue), pour ne pas saturer la carte.
  const WIND_ASSUMED_M = 100;
  const cells = new Map<string, (typeof d.obstacles)[number]>();
  for (const o of d.obstacles) {
    if (o.what !== "wind") continue;
    const key = `${Math.round(o.lat / 0.012)}:${Math.round(o.lon / 0.017)}`;
    const cur = cells.get(key);
    if (!cur || (o.heightM ?? 0) > (cur.heightM ?? 0)) cells.set(key, o);
  }
  for (const o of d.obstacles) {
    if (o.what === "wind") continue;
    const h = o.heightM ?? 0;
    add(o.lon, o.lat, { sym: h >= HIGH_OBSTACLE_M ? "mast-hi" : "mast", grp: "obstacle", cat: "Obstacle (indicatif)", name: o.name, heightM: o.heightM ?? "", h, lbl: obstacleLabel(o) });
  }
  for (const o of cells.values()) {
    const h = o.heightM ?? WIND_ASSUMED_M;
    add(o.lon, o.lat, { sym: "wind", grp: "obstacle", cat: o.heightM === null ? "Éolienne (hauteur supposée > 300 ft)" : "Éolienne (indicatif)", name: o.name, heightM: o.heightM ?? "", h, lbl: obstacleLabel(o) });
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
