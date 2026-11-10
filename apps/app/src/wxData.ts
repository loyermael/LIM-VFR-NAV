/**
 * Données météo importées (METAR, TAF, SIGMET) : lecture des fichiers de `npm run data:weather`, stockage sur l'appareil
 * avec leur date de téléchargement. Le navigateur ne peut pas télécharger ces données lui-même (pas de CORS).
 */
import { parseAwcMetars, parseAwcSigmets, parseAwcTafs, type Metar, type Sigmet, type Taf } from "@lim/core";
import { tx } from "./db";

export interface WxMeta {
  /** Date de téléchargement (ms UTC) : celle du manifeste si fourni, sinon la date du fichier. */
  readonly fetchedAtMs: number;
  readonly exactDate: boolean;
  readonly count: number;
  readonly skipped: number;
}
export interface MetarSet { readonly id: "metar"; readonly meta: WxMeta; readonly items: Metar[] }
export interface TafSet { readonly id: "taf"; readonly meta: WxMeta; readonly items: Taf[] }
export interface SigmetSet { readonly id: "sigmet"; readonly meta: WxMeta; readonly items: Sigmet[] }
export type WxSet = MetarSet | TafSet | SigmetSet;

const WX_IDS = new Set(["metar", "taf", "sigmet"]);
export const loadWx = (): Promise<WxSet[]> =>
  tx("weather", "readonly", (s) => s.getAll() as IDBRequest<{ id: string }[]>).then((all) => all.filter((r) => WX_IDS.has(r.id)) as WxSet[]);
export const saveWx = (d: WxSet): Promise<IDBValidKey> => tx("weather", "readwrite", (s) => s.put(d));

export type WxKind = "metar" | "taf" | "sigmet" | "manifest";

export function detectWxKind(json: unknown): WxKind | null {
  if (Array.isArray(json)) {
    const first = json.find((x) => typeof x === "object" && x !== null) as Record<string, unknown> | undefined;
    if (!first) return null;
    if (typeof first["rawOb"] === "string") return "metar";
    if (typeof first["rawTAF"] === "string") return "taf";
    if (typeof first["rawSigmet"] === "string" || Array.isArray(first["coords"])) return "sigmet";
    return null;
  }
  const o = json as { downloadedAt?: unknown; files?: unknown } | null;
  return o && typeof o === "object" && typeof o.downloadedAt === "string" && Array.isArray(o.files) ? "manifest" : null;
}

export interface WxImportOutcome { readonly sets: WxSet[]; readonly problems: string[] }

export async function importWxFiles(files: readonly File[]): Promise<WxImportOutcome> {
  const problems: string[] = [];
  const parsed: { file: File; kind: WxKind; json: unknown }[] = [];
  for (const file of files) {
    try {
      const json: unknown = JSON.parse(await file.text());
      const kind = detectWxKind(json);
      if (kind === null) problems.push(`${file.name} : fichier non reconnu (METAR, TAF ou SIGMET d'aviationweather.gov attendu)`);
      else parsed.push({ file, kind, json });
    } catch {
      problems.push(`${file.name} : JSON illisible`);
    }
  }
  const manifestMs = parsed
    .filter((p) => p.kind === "manifest")
    .map((p) => Date.parse((p.json as { downloadedAt: string }).downloadedAt))
    .find((t) => Number.isFinite(t));
  const sets: WxSet[] = [];
  for (const p of parsed) {
    if (p.kind === "manifest") continue;
    const meta = (count: number, skipped: number): WxMeta => ({ fetchedAtMs: manifestMs ?? p.file.lastModified, exactDate: manifestMs !== undefined, count, skipped });
    try {
      if (p.kind === "metar") { const r = parseAwcMetars(p.json); sets.push({ id: "metar", meta: meta(r.items.length, r.skipped), items: r.items }); }
      else if (p.kind === "taf") { const r = parseAwcTafs(p.json); sets.push({ id: "taf", meta: meta(r.items.length, r.skipped), items: r.items }); }
      else { const r = parseAwcSigmets(p.json); sets.push({ id: "sigmet", meta: meta(r.items.length, r.skipped), items: r.items }); }
    } catch (e) {
      problems.push(`${p.file.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sets, problems };
}
