/**
 * Import / export de routes : GPX 1.1, KML 2.2, Garmin FPL (flight-plan v1) et MSFS PLN.
 *
 * Toutes les fonctions travaillent sur un `RouteFile` neutre (nom + points). Les altitudes sont en mètres AMSL ou null.
 * AVERTISSEMENT : ces formats ont été écrits d'après leur structure publique et vérifiés par aller-retour sur nos propres
 * fichiers ; ils n'ont PAS été essayés avec le logiciel d'origine (GPS Garmin, simulateur). Voir docs/formats.md.
 */
import { XMLParser } from "fast-xml-parser";
import { feet, feetToMeters, meters, metersToFeet, type Meters } from "./units";

export interface RouteFilePoint {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly altitude: Meters | null;
}

export interface RouteFile {
  readonly name: string;
  readonly points: readonly RouteFilePoint[];
}

export class FormatError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // tout reste du texte : on convertit nous-mêmes (évite « 0123 » → 123)
  trimValues: true,
  isArray: (name) => ["rtept", "wpt", "Placemark", "waypoint", "route-point", "ATCWaypoint"].includes(name),
});

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Texte d'un nœud fast-xml-parser (chaîne, ou objet avec attributs et #text). */
function text(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "object") return text((node as Record<string, unknown>)["#text"]);
  return String(node).trim();
}

function num(s: unknown): number | null {
  const t = text(s);
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function checkCoord(lat: number | null, lon: number | null, what: string): { lat: number; lon: number } {
  if (lat === null || lon === null) throw new FormatError(`${what} : coordonnées absentes ou illisibles`);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new FormatError(`${what} : coordonnées hors limites (${lat}, ${lon})`);
  return { lat, lon };
}

function parse(xml: string): Record<string, unknown> {
  if (xml.trim() === "") throw new FormatError("Fichier vide");
  try {
    return parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new FormatError(`XML illisible : ${e instanceof Error ? e.message : String(e)}`);
  }
}

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const fmt = (v: number, digits = 6) => v.toFixed(digits);
const defaultName = (i: number) => `WPT${String(i + 1).padStart(2, "0")}`;

/* ------------------------------------------------------------------ GPX */

export function exportGPX(route: RouteFile): string {
  const pts = route.points
    .map(
      (p) =>
        `    <rtept lat="${fmt(p.lat)}" lon="${fmt(p.lon)}">\n` +
        (p.altitude !== null ? `      <ele>${fmt(p.altitude, 1)}</ele>\n` : "") +
        `      <name>${esc(p.name)}</name>\n    </rtept>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="L!M VFR Nav" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <rte>\n    <name>${esc(route.name)}</name>\n${pts}\n  </rte>\n</gpx>\n`
  );
}

/** Lit une route GPX : `<rte>` en priorité, sinon les `<wpt>` dans l'ordre du fichier. Les traces (`<trk>`) sont ignorées. */
export function importGPX(xml: string): RouteFile {
  const gpx = parse(xml)["gpx"] as Record<string, unknown> | undefined;
  if (!gpx) throw new FormatError("Ce n'est pas un fichier GPX");
  const rte = arr(gpx["rte"] as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];
  const raw = rte ? arr(rte["rtept"] as Record<string, unknown>[] | undefined) : arr(gpx["wpt"] as Record<string, unknown>[] | undefined);
  if (raw.length === 0) throw new FormatError("Aucun point de route dans ce GPX (les traces ne sont pas importées comme route)");
  const points = raw.map((p, i) => {
    const { lat, lon } = checkCoord(num(p["@_lat"]), num(p["@_lon"]), `Point ${i + 1}`);
    const ele = num(p["ele"]);
    return { name: text(p["name"]) || defaultName(i), lat, lon, altitude: ele === null ? null : meters(ele) };
  });
  return { name: text(rte?.["name"]) || text((gpx["metadata"] as Record<string, unknown> | undefined)?.["name"]) || "Route", points };
}

/* ------------------------------------------------------------------ KML */

export function exportKML(route: RouteFile): string {
  const coords = route.points.map((p) => `${fmt(p.lon)},${fmt(p.lat)},${p.altitude === null ? 0 : fmt(p.altitude, 1)}`).join(" ");
  const marks = route.points
    .map(
      (p) =>
        `    <Placemark>\n      <name>${esc(p.name)}</name>\n      <Point><coordinates>${fmt(p.lon)},${fmt(p.lat)},${p.altitude === null ? 0 : fmt(p.altitude, 1)}</coordinates></Point>\n    </Placemark>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${esc(route.name)}</name>\n` +
    `    <Placemark>\n      <name>${esc(route.name)}</name>\n      <LineString><altitudeMode>absolute</altitudeMode><coordinates>${coords}</coordinates></LineString>\n    </Placemark>\n` +
    `${marks}\n  </Document>\n</kml>\n`
  );
}

function kmlCoords(s: string, label: string): { lat: number; lon: number; alt: number | null }[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((c, i) => {
      const [lon, lat, alt] = c.split(",").map((x) => (x === "" ? null : Number(x)));
      const k = checkCoord(lat ?? null, lon ?? null, `${label} ${i + 1}`);
      return { ...k, alt: alt !== undefined && alt !== null && Number.isFinite(alt) && alt !== 0 ? alt : null };
    });
}

/** Lit un KML : les repères ponctuels (dans l'ordre) forment la route ; à défaut, les sommets de la première ligne. */
export function importKML(xml: string): RouteFile {
  const kml = parse(xml)["kml"] as Record<string, unknown> | undefined;
  if (!kml) throw new FormatError("Ce n'est pas un fichier KML");
  const found: { name: string; point?: ReturnType<typeof kmlCoords>[number]; line?: ReturnType<typeof kmlCoords> }[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const o = node as Record<string, unknown>;
    for (const pm of arr(o["Placemark"] as Record<string, unknown>[] | undefined)) {
      const point = (pm["Point"] as Record<string, unknown> | undefined)?.["coordinates"];
      const line = (pm["LineString"] as Record<string, unknown> | undefined)?.["coordinates"];
      if (point !== undefined) found.push({ name: text(pm["name"]), point: kmlCoords(text(point), "Repère")[0] as never });
      else if (line !== undefined) found.push({ name: text(pm["name"]), line: kmlCoords(text(line), "Sommet") });
    }
    for (const key of ["Document", "Folder"]) for (const child of arr(o[key] as unknown)) walk(child);
  };
  walk(kml);
  const pointMarks = found.filter((f) => f.point);
  const title = text((kml["Document"] as Record<string, unknown> | undefined)?.["name"]);
  const line = found.find((f) => f.line);
  const toPoint = (c: { lat: number; lon: number; alt: number | null }, name: string, i: number): RouteFilePoint => ({
    name: name || defaultName(i), lat: c.lat, lon: c.lon, altitude: c.alt === null ? null : meters(c.alt),
  });
  if (pointMarks.length > 0) {
    return { name: title || line?.name || "Route", points: pointMarks.map((f, i) => toPoint(f.point as never, f.name, i)) };
  }
  if (line?.line && line.line.length > 0) {
    return { name: title || line.name || "Route", points: line.line.map((c, i) => toPoint(c, "", i)) };
  }
  throw new FormatError("Aucun repère ni ligne dans ce KML");
}

/* ------------------------------------------------------------------ Garmin FPL */

const FPL_NS = "http://www8.garmin.com/xmlschemas/FlightPlan/v1";
/** Identifiant Garmin : majuscules sans espaces, 12 caractères au plus. */
const fplId = (name: string, i: number) => (name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || `WPT${i + 1}`);

export function exportFPL(route: RouteFile): string {
  const ids = route.points.map((p, i) => fplId(p.name, i));
  const unique = ids.map((id, i) => (ids.indexOf(id) === i ? id : `${id.slice(0, 10)}${i}`));
  const table = route.points
    .map(
      (p, i) =>
        `    <waypoint>\n      <identifier>${unique[i]}</identifier>\n      <type>USER WAYPOINT</type>\n      <country-code></country-code>\n      <lat>${fmt(p.lat)}</lat>\n      <lon>${fmt(p.lon)}</lon>\n      <comment>${esc(p.name)}</comment>\n    </waypoint>`,
    )
    .join("\n");
  const pts = route.points
    .map((_, i) => `    <route-point>\n      <waypoint-identifier>${unique[i]}</waypoint-identifier>\n      <waypoint-type>USER WAYPOINT</waypoint-type>\n      <waypoint-country-code></waypoint-country-code>\n    </route-point>`)
    .join("\n");
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n<flight-plan xmlns="${FPL_NS}">\n` +
    `  <created>${new Date(0).toISOString().replace(/\.\d+Z$/, "Z")}</created>\n` +
    `  <waypoint-table>\n${table}\n  </waypoint-table>\n` +
    `  <route>\n    <route-name>${esc(route.name.toUpperCase().slice(0, 25))}</route-name>\n    <flight-plan-index>1</flight-plan-index>\n${pts}\n  </route>\n</flight-plan>\n`
  );
}

export function importFPL(xml: string): RouteFile {
  const fp = parse(xml)["flight-plan"] as Record<string, unknown> | undefined;
  if (!fp) throw new FormatError("Ce n'est pas un plan de vol Garmin FPL");
  const table = new Map<string, { lat: number; lon: number; comment: string }>();
  for (const w of arr((fp["waypoint-table"] as Record<string, unknown> | undefined)?.["waypoint"] as Record<string, unknown>[] | undefined)) {
    const id = text(w["identifier"]);
    const c = checkCoord(num(w["lat"]), num(w["lon"]), `Point ${id || "?"}`);
    table.set(id, { ...c, comment: text(w["comment"]) });
  }
  const route = fp["route"] as Record<string, unknown> | undefined;
  const refs = arr(route?.["route-point"] as Record<string, unknown>[] | undefined);
  if (refs.length === 0) throw new FormatError("Aucun point dans la route de ce FPL");
  const points = refs.map((r, i) => {
    const id = text(r["waypoint-identifier"]);
    const w = table.get(id);
    if (!w) throw new FormatError(`Le point « ${id} » de la route n'est pas dans la table des points`);
    return { name: id || defaultName(i), lat: w.lat, lon: w.lon, altitude: null };
  });
  return { name: text(route?.["route-name"]) || "Route", points };
}

/* ------------------------------------------------------------------ MSFS PLN */

function dms(value: number, pos: string, neg: string): string {
  const hemi = value >= 0 ? pos : neg;
  const a = Math.abs(value);
  const d = Math.floor(a);
  const mFull = (a - d) * 60;
  const m = Math.floor(mFull);
  const s = (mFull - m) * 60;
  // 2 décimales de seconde ; report des retenues (59,995 → 60,00)
  let sec = Math.round(s * 100) / 100;
  let mm = m;
  let dd = d;
  if (sec >= 60) { sec -= 60; mm += 1; }
  if (mm >= 60) { mm -= 60; dd += 1; }
  return `${hemi}${dd}° ${mm}' ${sec.toFixed(2)}"`;
}

function altString(m: Meters | null): string {
  const ft = m === null ? 0 : metersToFeet(m);
  return `${ft < 0 ? "-" : "+"}${String(Math.abs(Math.round(ft * 100) / 100).toFixed(2)).padStart(9, "0")}`;
}

export function exportPLN(route: RouteFile): string {
  const wps = route.points
    .map(
      (p, i) =>
        `    <ATCWaypoint id="${esc(fplId(p.name, i))}">\n      <ATCWaypointType>User</ATCWaypointType>\n      <WorldPosition>${dms(p.lat, "N", "S")},${dms(p.lon, "E", "W")},${altString(p.altitude)}</WorldPosition>\n    </ATCWaypoint>`,
    )
    .join("\n");
  const cruise = Math.max(0, ...route.points.map((p) => (p.altitude === null ? 0 : Math.round(metersToFeet(p.altitude)))));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<SimBase.Document Type="AceXML" version="1,0">\n` +
    `  <Descr>AceXML Document</Descr>\n  <FlightPlan.FlightPlan>\n    <Title>${esc(route.name)}</Title>\n    <FPType>VFR</FPType>\n    <RouteType>Direct</RouteType>\n    <CruisingAlt>${cruise}</CruisingAlt>\n` +
    `${wps}\n  </FlightPlan.FlightPlan>\n</SimBase.Document>\n`
  );
}

function parseDMS(s: string, what: string): number {
  const m = /^\s*([NSEW])\s*(\d+)°\s*(\d+)'\s*([\d.]+)"/.exec(s);
  if (!m) throw new FormatError(`${what} : position illisible (« ${s} »)`);
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return m[1] === "S" || m[1] === "W" ? -v : v;
}

export function importPLN(xml: string): RouteFile {
  const doc = parse(xml)["SimBase.Document"] as Record<string, unknown> | undefined;
  const fp = doc?.["FlightPlan.FlightPlan"] as Record<string, unknown> | undefined;
  if (!fp) throw new FormatError("Ce n'est pas un plan de vol MSFS PLN");
  const raw = arr(fp["ATCWaypoint"] as Record<string, unknown>[] | undefined);
  if (raw.length === 0) throw new FormatError("Aucun point dans ce PLN");
  const points = raw.map((w, i) => {
    const pos = text(w["WorldPosition"]).split(",");
    if (pos.length < 2) throw new FormatError(`Point ${i + 1} : position absente`);
    const k = checkCoord(parseDMS(pos[0] as string, `Point ${i + 1}`), parseDMS(pos[1] as string, `Point ${i + 1}`), `Point ${i + 1}`);
    const alt = pos[2] === undefined ? null : Number(pos[2]);
    return {
      name: text(w["@_id"]) || defaultName(i),
      ...k,
      altitude: alt !== null && Number.isFinite(alt) && alt !== 0 ? feetToMeters(feet(alt)) : null,
    };
  });
  return { name: text(fp["Title"]) || "Route", points };
}

/* ------------------------------------------------------------------ détection */

export type RouteFormat = "gpx" | "kml" | "fpl" | "pln";

export function detectFormat(fileName: string, content: string): RouteFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (ext === "gpx" || ext === "kml" || ext === "fpl" || ext === "pln") return ext;
  if (/<gpx[\s>]/.test(content)) return "gpx";
  if (/<kml[\s>]/.test(content)) return "kml";
  if (/<flight-plan[\s>]/.test(content)) return "fpl";
  if (/<SimBase\.Document[\s>]/.test(content)) return "pln";
  return null;
}

export function importRoute(fileName: string, content: string): RouteFile {
  switch (detectFormat(fileName, content)) {
    case "gpx": return importGPX(content);
    case "kml": return importKML(content);
    case "fpl": return importFPL(content);
    case "pln": return importPLN(content);
    default: throw new FormatError("Format non reconnu (GPX, KML, FPL ou PLN attendu)");
  }
}

export function exportRoute(format: RouteFormat, route: RouteFile): string {
  switch (format) {
    case "gpx": return exportGPX(route);
    case "kml": return exportKML(route);
    case "fpl": return exportFPL(route);
    case "pln": return exportPLN(route);
  }
}
