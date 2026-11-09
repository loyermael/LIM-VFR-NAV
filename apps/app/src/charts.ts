/**
 * Cartes raster importées (MBTiles, par ex. IGN OACI). Le fichier est copié dans le stockage de l'application
 * (OPFS) pour rester disponible hors-ligne ; l'index des tuiles est conservé à côté pour une ouverture instantanée.
 */
import { tx } from "./db";
import { MbtilesReader, type MbtilesInfo } from "./mbtiles/mbtiles";
import { copyToOpfs, openOpfsFile, opfsAvailable, removeFromOpfs, requestPersistence, writeToOpfs } from "./opfs";

export interface ChartRecord {
  readonly id: string;
  readonly name: string;
  readonly info: MbtilesInfo;
  readonly importedAt: string;
  readonly sizeBytes: number;
  /** Affichée ou masquée. */
  visible: boolean;
  /** Plage de zoom où cette carte s'affiche : permet de passer d'une carte à une autre selon le zoom. */
  showFromZoom: number;
  showToZoom: number;
}

export type ImportPhase = "copy" | "index";
export type ImportProgress = (phase: ImportPhase, value: number) => void;

/** Lecteurs ouverts, par identifiant de carte (consultés par le protocole de tuiles de la carte). */
const readers = new Map<string, MbtilesReader>();
export const getReader = (id: string): MbtilesReader | undefined => readers.get(id);

const fileName = (id: string) => `chart-${id}.mbtiles`;
const indexName = (id: string) => `chart-${id}.idx`;

export const MAX_ZOOM = 18;

export async function loadCharts(): Promise<ChartRecord[]> {
  const records = await tx("charts", "readonly", (s) => s.getAll() as IDBRequest<ChartRecord[]>);
  const usable: ChartRecord[] = [];
  for (const r of records) {
    try {
      const file = await openOpfsFile(fileName(r.id));
      let index: Float64Array | undefined;
      try {
        index = new Float64Array(await (await openOpfsFile(indexName(r.id))).arrayBuffer());
      } catch {
        index = undefined; // index absent : il sera reconstruit
      }
      readers.set(r.id, await MbtilesReader.open(file, index ? { index } : {}));
      usable.push(r);
    } catch {
      // Fichier disparu (stockage purgé) : on oublie la carte plutôt que d'afficher une carte fantôme.
      void tx("charts", "readwrite", (s) => s.delete(r.id));
    }
  }
  return usable;
}

/** Importe un MBTiles. Sans OPFS (navigation privée), la carte n'est gardée que pour la session. */
export async function importMbtiles(file: File, onProgress: ImportProgress): Promise<{ record: ChartRecord; persisted: boolean }> {
  const id = crypto.randomUUID();
  const persisted = opfsAvailable();
  let blob: Blob = file;
  if (persisted) {
    await copyToOpfs(file, fileName(id), (p) => onProgress("copy", p));
    blob = await openOpfsFile(fileName(id));
    void requestPersistence();
  }
  let reader: MbtilesReader;
  try {
    reader = await MbtilesReader.open(blob, { onProgress: (n) => onProgress("index", n) });
  } catch (e) {
    if (persisted) await removeFromOpfs(fileName(id));
    throw e;
  }
  readers.set(id, reader);
  const record: ChartRecord = {
    id,
    name: reader.info.name || file.name.replace(/\.mbtiles$/i, ""),
    info: reader.info,
    importedAt: new Date().toISOString(),
    sizeBytes: file.size,
    visible: true,
    showFromZoom: reader.info.minZoom,
    showToZoom: MAX_ZOOM,
  };
  if (persisted) {
    const idx = reader.serializeIndex();
    await writeToOpfs(indexName(id), idx.buffer as ArrayBuffer);
    await saveChart(record);
  }
  return { record, persisted };
}

export const saveChart = (r: ChartRecord): Promise<IDBValidKey> => tx("charts", "readwrite", (s) => s.put(r));

export async function removeChart(id: string): Promise<void> {
  readers.delete(id);
  await tx("charts", "readwrite", (s) => s.delete(id));
  if (opfsAvailable()) {
    await removeFromOpfs(fileName(id));
    await removeFromOpfs(indexName(id));
  }
}
