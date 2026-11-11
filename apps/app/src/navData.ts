/**
 * Données de navigation pour la carte aéro (exports openAIP France) : balises, points de report, obstacles, décollages
 * parapente/delta, points chauds. Elles ne servent qu'à dessiner : tout est lu avec prudence, un élément invalide est écarté.
 * Les obstacles viennent d'OpenStreetMap via openAIP : liste incomplète, à présenter comme indicative.
 */
export interface NavPoint { readonly lat: number; readonly lon: number }
/** `kind` = code numérique openAIP du type (balise : VOR, NDB… ; obstacle : catégorie) ; sa correspondance exacte reste à confirmer. */
export interface Navaid extends NavPoint { readonly name: string; readonly ident: string; readonly kind: number; readonly freq: string | null; readonly elevM: number | null; readonly rangeNm: number | null }
export interface ReportingPoint extends NavPoint { readonly name: string; readonly compulsory: boolean }
export interface Obstacle extends NavPoint { readonly name: string; readonly kind: number; readonly elevM: number | null; readonly heightM: number | null; readonly what: string | null }
export interface SitePoint extends NavPoint { readonly name: string; readonly kind: number; readonly elevM: number | null }

export interface NavDataset {
  readonly id: "navdata";
  readonly meta: { readonly source: "openAIP"; readonly licence: string; readonly exportedAtMs: number; readonly importedAtMs: number };
  readonly navaids: Navaid[];
  readonly reporting: ReportingPoint[];
  readonly obstacles: Obstacle[];
  readonly hang: SitePoint[];
  readonly hotspots: SitePoint[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const val = (v: unknown): number | null => (isRec(v) ? num(v["value"]) : null);

function point(o: Rec): NavPoint | null {
  const g = o["geometry"];
  const c = isRec(g) && g["type"] === "Point" && Array.isArray(g["coordinates"]) ? g["coordinates"] : null;
  const lon = num(c?.[0]), lat = num(c?.[1]);
  return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}
function each(json: unknown, f: (o: Rec, p: NavPoint) => void): void {
  if (!Array.isArray(json)) throw new Error("un tableau était attendu");
  for (const o of json) {
    if (!isRec(o)) continue;
    const p = point(o);
    if (p) f(o, p);
  }
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const parseNavaids = (json: unknown): Navaid[] => {
  const out: Navaid[] = [];
  each(json, (o, p) => {
    const f = isRec(o["frequency"]) ? o["frequency"] : null;
    out.push({ ...p, name: str(o["name"]), ident: str(o["identifier"]), kind: num(o["type"]) ?? -1, freq: f && typeof f["value"] === "string" ? f["value"] : null, elevM: val(o["elevation"]), rangeNm: val(o["range"]) });
  });
  return out;
};
export const parseReporting = (json: unknown): ReportingPoint[] => {
  const out: ReportingPoint[] = [];
  each(json, (o, p) => out.push({ ...p, name: str(o["name"]), compulsory: o["compulsory"] === true }));
  return out;
};
export const parseObstacles = (json: unknown): Obstacle[] => {
  const out: Obstacle[] = [];
  each(json, (o, p) => out.push({ ...p, name: str(o["name"]), kind: num(o["type"]) ?? -1, elevM: val(o["elevation"]), heightM: val(o["height"]), what: typeof o["what"] === "string" ? o["what"] : null }));
  return out;
};
export const parseSites = (json: unknown): SitePoint[] => {
  const out: SitePoint[] = [];
  each(json, (o, p) => out.push({ ...p, name: str(o["name"]), kind: num(o["type"]) ?? -1, elevM: val(o["elevation"]) }));
  return out;
};

/** Fabrique le jeu de données à partir des fichiers du paquet (reconnus par leur nom : *_nav, *_rpp, *_obs, *_hgl, *_hot, manifest). */
export async function importNavFiles(files: readonly File[], now: number): Promise<{ dataset: NavDataset; problems: string[] }> {
  const problems: string[] = [];
  const ds: NavDataset = {
    id: "navdata", meta: { source: "openAIP", licence: "CC BY-NC 4.0 (obstacles : © contributeurs OpenStreetMap, ODbL)", exportedAtMs: now, importedAtMs: now },
    navaids: [], reporting: [], obstacles: [], hang: [], hotspots: [],
  };
  const dates: number[] = [];
  for (const f of files) {
    const m = /_(nav|rpp|obs|hgl|hot)\.json$/i.exec(f.name);
    try {
      const json: unknown = JSON.parse(await f.text());
      if (!m) {
        for (const e of isRec(json) && Array.isArray(json["files"]) ? json["files"] : []) {
          const t = isRec(e) && typeof e["lastModified"] === "string" ? Date.parse(e["lastModified"]) : NaN;
          if (Number.isFinite(t)) dates.push(t);
        }
        continue;
      }
      const k = (m[1] as string).toLowerCase();
      if (k === "nav") ds.navaids.push(...parseNavaids(json));
      else if (k === "rpp") ds.reporting.push(...parseReporting(json));
      else if (k === "obs") ds.obstacles.push(...parseObstacles(json));
      else if (k === "hgl") ds.hang.push(...parseSites(json));
      else ds.hotspots.push(...parseSites(json));
    } catch (e) {
      problems.push(`${f.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { dataset: dates.length > 0 ? { ...ds, meta: { ...ds.meta, exportedAtMs: Math.min(...dates) } } : ds, problems };
}
