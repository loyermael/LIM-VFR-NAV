/**
 * Jeux de données aéronautiques importés (espaces aériens, terrains), stockés sur l'appareil avec leur source,
 * leur licence et leur date d'export : disponibles hors-ligne.
 */
import type { Airfield, Airspace } from "@lim/core";
import { parseOpenAipAirfields, parseOpenAipAirspaces } from "@lim/core";
import { tx } from "./db";
import type { NavDataset } from "./navData";
import type { ActivityDataset } from "./activities";

export interface DatasetMeta {
  readonly source: "openAIP";
  readonly licence: "CC BY-NC 4.0";
  /** Date d'export (ms UTC) : celle du manifeste si fourni, sinon la date du fichier. */
  readonly exportedAtMs: number;
  /** Vrai si la date vient du manifeste (date de l'export) ; faux si elle vient du fichier (date du téléchargement, jusqu'à ~1 jour plus récente). */
  readonly exactDate: boolean;
  readonly importedAtMs: number;
  readonly count: number;
  readonly skipped: number;
}

export interface AirspaceDataset { readonly id: "airspaces"; readonly meta: DatasetMeta; readonly items: Airspace[] }
export interface AirfieldDataset { readonly id: "airfields"; readonly meta: DatasetMeta; readonly items: Airfield[] }
export type Dataset = AirspaceDataset | AirfieldDataset | NavDataset | ActivityDataset;

export const loadDatasets = (): Promise<Dataset[]> => tx("datasets", "readonly", (s) => s.getAll() as IDBRequest<Dataset[]>);
export const saveDataset = (d: Dataset): Promise<IDBValidKey> => tx("datasets", "readwrite", (s) => s.put(d));
export const deleteDataset = (id: Dataset["id"]): Promise<undefined> => tx("datasets", "readwrite", (s) => s.delete(id));

interface Manifest { files?: { name?: string; lastModified?: string | null }[] }

/** Dates d'export lues dans un manifeste (`manifest.json` écrit par `npm run data:openaip`). */
export function manifestDates(m: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of (m as Manifest | null)?.files ?? []) {
    const t = typeof f?.lastModified === "string" ? Date.parse(f.lastModified) : NaN;
    if (typeof f?.name === "string" && Number.isFinite(t)) out.set(f.name, t);
  }
  return out;
}

export type ImportKind = "airspaces" | "airfields" | "manifest";

/** Reconnaît le contenu d'un fichier JSON importé, par sa structure (pas par son nom). */
export function detectKind(json: unknown): ImportKind | null {
  if (Array.isArray(json)) {
    const first = json.find((x) => typeof x === "object" && x !== null) as { geometry?: { type?: string } } | undefined;
    if (first?.geometry?.type === "Polygon") return "airspaces";
    if (first?.geometry?.type === "Point") return "airfields";
    return null;
  }
  if (typeof json === "object" && json !== null && Array.isArray((json as Manifest).files)) return "manifest";
  return null;
}

export interface ImportOutcome {
  readonly datasets: (AirspaceDataset | AirfieldDataset)[];
  /** Fichiers non reconnus ou invalides, avec la raison. */
  readonly problems: string[];
}

/** Lit des fichiers choisis par l'utilisateur (export d'espaces, de terrains, manifeste) et fabrique les jeux de données. */
export async function importAeroFiles(files: readonly File[], now: number): Promise<ImportOutcome> {
  const problems: string[] = [];
  const parsed: { file: File; kind: ImportKind; json: unknown }[] = [];
  for (const file of files) {
    try {
      const json: unknown = JSON.parse(await file.text());
      const kind = detectKind(json);
      if (kind === null) problems.push(`${file.name} : fichier non reconnu (export openAIP d'espaces ou de terrains attendu)`);
      else parsed.push({ file, kind, json });
    } catch {
      problems.push(`${file.name} : JSON illisible`);
    }
  }
  const dates = new Map<string, number>();
  for (const p of parsed) if (p.kind === "manifest") for (const [k, v] of manifestDates(p.json)) dates.set(k, v);

  const datasets: (AirspaceDataset | AirfieldDataset)[] = [];
  for (const p of parsed) {
    if (p.kind === "manifest") continue;
    const fromManifest = dates.get(p.file.name);
    const meta = (count: number, skipped: number): DatasetMeta => ({
      source: "openAIP",
      licence: "CC BY-NC 4.0",
      exportedAtMs: fromManifest ?? p.file.lastModified,
      exactDate: fromManifest !== undefined,
      importedAtMs: now,
      count,
      skipped,
    });
    try {
      if (p.kind === "airspaces") {
        const r = parseOpenAipAirspaces(p.json);
        datasets.push({ id: "airspaces", meta: meta(r.items.length, r.skipped.length), items: r.items });
      } else {
        const r = parseOpenAipAirfields(p.json);
        datasets.push({ id: "airfields", meta: meta(r.items.length, r.skipped.length), items: r.items });
      }
    } catch (e) {
      problems.push(`${p.file.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { datasets, problems };
}
