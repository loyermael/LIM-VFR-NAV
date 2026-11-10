import { tx, type StoreName } from "./db";

/**
 * Sauvegarde / restauration : fichier JSON unique à copier d'un appareil à l'autre (synchronisation SANS serveur).
 * Contient les routes, fiches avion, traces et réglages (clés « lim.* » du stockage local).
 * Ne contient PAS : documents et cartes importés (PDF, MBTiles, couches), données aéro et météo (volumineux, à réimporter).
 */
export const BACKUP_FORMAT = "lim-vfr-nav-backup";
export const BACKUP_STORES = ["routes", "aircraft", "tracks"] as const satisfies readonly StoreName[];
type BackupStore = (typeof BACKUP_STORES)[number];

export interface Backup {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: 1;
  readonly createdAt: number;
  readonly stores: Readonly<Record<BackupStore, readonly { id: string }[]>>;
  readonly local: Readonly<Record<string, string>>;
}

export function buildBackup(stores: Record<BackupStore, readonly { id: string }[]>, local: Record<string, string>, now: number): Backup {
  return { format: BACKUP_FORMAT, version: 1, createdAt: now, stores, local };
}

export class BackupError extends Error {}

/** Valide un fichier de sauvegarde : format, version, enregistrements munis d'un identifiant, réglages « lim.* » seulement. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("fichier illisible (JSON invalide)");
  }
  const o = raw as Partial<Backup> | null;
  if (typeof o !== "object" || o === null || o.format !== BACKUP_FORMAT) throw new BackupError("ce n'est pas une sauvegarde L!M VFR Nav");
  if (o.version !== 1) throw new BackupError(`version de sauvegarde non prise en charge : ${String(o.version)}`);
  const stores = {} as Record<BackupStore, { id: string }[]>;
  for (const s of BACKUP_STORES) {
    const arr = (o.stores as Record<string, unknown> | undefined)?.[s];
    if (arr !== undefined && !Array.isArray(arr)) throw new BackupError(`section « ${s} » invalide`);
    const items = (arr ?? []) as unknown[];
    if (items.some((x) => typeof x !== "object" || x === null || typeof (x as { id?: unknown }).id !== "string")) throw new BackupError(`section « ${s} » : enregistrement sans identifiant`);
    stores[s] = items as { id: string }[];
  }
  const local: Record<string, string> = {};
  for (const [k, v] of Object.entries((o.local ?? {}) as Record<string, unknown>)) if (k.startsWith("lim.") && typeof v === "string") local[k] = v;
  return { format: BACKUP_FORMAT, version: 1, createdAt: typeof o.createdAt === "number" ? o.createdAt : 0, stores, local };
}

/** Lit les données de l'appareil et produit le texte du fichier de sauvegarde. */
export async function exportBackup(): Promise<string> {
  const stores = {} as Record<BackupStore, { id: string }[]>;
  for (const s of BACKUP_STORES) stores[s] = await tx(s, "readonly", (st) => st.getAll() as IDBRequest<{ id: string }[]>);
  const local: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = k === null ? null : localStorage.getItem(k);
    if (k !== null && v !== null && k.startsWith("lim.")) local[k] = v;
  }
  return JSON.stringify(buildBackup(stores, local, Date.now()));
}

/** Restaure : les enregistrements de même identifiant sont remplacés, les autres conservés ; les réglages sont réécrits. */
export async function importBackup(text: string): Promise<Record<BackupStore, number>> {
  const b = parseBackup(text);
  const counts = {} as Record<BackupStore, number>;
  for (const s of BACKUP_STORES) {
    for (const item of b.stores[s]) await tx(s, "readwrite", (st) => st.put(item));
    counts[s] = b.stores[s].length;
  }
  for (const [k, v] of Object.entries(b.local)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* stockage bloqué */
    }
  }
  return counts;
}
