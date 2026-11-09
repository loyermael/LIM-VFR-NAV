/**
 * MBTiles (SQLite) : lecture des tuiles raster sans charger le fichier.
 * Spec : https://github.com/mapbox/mbtiles-spec — la ligne de tuile est en TMS (origine en bas), on convertit en XYZ.
 *
 * Une première passe construit un index (z, x, y) → emplacement de la cellule ; il est sérialisable pour ne pas
 * relire tout le fichier à chaque ouverture.
 */
import { decodeRecord, SqliteReader, varint, type SqlValue } from "./sqlite";

export interface MbtilesInfo {
  readonly name: string;
  readonly format: "png" | "jpg" | "webp" | "pbf" | "unknown";
  readonly minZoom: number;
  readonly maxZoom: number;
  /** [ouest, sud, est, nord] en degrés, si présent dans les métadonnées. */
  readonly bounds: readonly [number, number, number, number] | null;
  readonly attribution: string | null;
  readonly tileCount: number;
}

/** Clé numérique unique (z ≤ 22) pour une tuile XYZ. */
export function tileKey(z: number, x: number, y: number): number {
  return (y * 4194304 + x) * 32 + z;
}

export class MbtilesReader {
  private constructor(
    private readonly db: SqliteReader,
    /** clé de tuile → page * 65536 + décalage de la cellule */
    private readonly index: Map<number, number>,
    readonly info: MbtilesInfo,
  ) {}

  /** Ouvre un MBTiles et construit l'index (ou le réutilise s'il est fourni). */
  static async open(
    blob: Blob,
    options: { index?: Float64Array; onProgress?: (done: number) => void } = {},
  ): Promise<MbtilesReader> {
    const db = await SqliteReader.open(blob);
    const schema = await db.schema();
    const tiles = schema.find((s) => s.type === "table" && s.name === "tiles");
    const meta = schema.find((s) => s.type === "table" && s.name === "metadata");
    if (!tiles) {
      const view = schema.find((s) => s.type === "view" && s.name === "tiles");
      throw new Error(
        view
          ? "MBTiles dédupliqué (tuiles en vue) non pris en charge : réexporte avec une table « tiles »"
          : "Pas de table « tiles » : ce n'est pas un MBTiles",
      );
    }
    if (/without\s+rowid/i.test(tiles.sql)) throw new Error("Table « tiles » WITHOUT ROWID non prise en charge");
    if (!/zoom_level[\s\S]*tile_column[\s\S]*tile_row[\s\S]*tile_data/i.test(tiles.sql)) {
      throw new Error("Colonnes de « tiles » inattendues (ordre zoom_level, tile_column, tile_row, tile_data requis)");
    }

    const index = new Map<number, number>();
    if (options.index) {
      for (let i = 0; i + 1 < options.index.length; i += 2) index.set(options.index[i] as number, options.index[i + 1] as number);
    } else {
      let done = 0;
      await db.walkTable(tiles.root, (page, pageNo, off) => {
        // On ne décode que l'en-tête et les trois premiers entiers : jamais la tuile elle-même.
        const rec = decodeRecordHead(page, off);
        if (!rec) return;
        const [z, col, row] = rec;
        const y = 2 ** z - 1 - row; // TMS → XYZ
        index.set(tileKey(z, col, y), pageNo * 65536 + off);
        if (++done % 5000 === 0) options.onProgress?.(done);
      });
      options.onProgress?.(index.size);
    }

    const md = new Map<string, string>();
    if (meta) {
      for (const r of await db.readAll(meta.root)) md.set(String(r[0]), String(r[1] ?? ""));
    }
    const zooms = [...index.keys()].map((k) => k % 32);
    const minZoom = md.has("minzoom") ? Number(md.get("minzoom")) : zooms.length ? Math.min(...zooms) : 0;
    const maxZoom = md.has("maxzoom") ? Number(md.get("maxzoom")) : zooms.length ? Math.max(...zooms) : 0;
    const b = md.get("bounds")?.split(",").map(Number);
    const fmt = (md.get("format") ?? "").toLowerCase();
    const info: MbtilesInfo = {
      name: md.get("name") ?? "",
      format: fmt === "png" || fmt === "jpg" || fmt === "webp" || fmt === "pbf" ? fmt : fmt === "jpeg" ? "jpg" : "unknown",
      minZoom,
      maxZoom,
      bounds: b && b.length === 4 && b.every(Number.isFinite) ? [b[0]!, b[1]!, b[2]!, b[3]!] : null,
      attribution: md.get("attribution") ?? null,
      tileCount: index.size,
    };
    return new MbtilesReader(db, index, info);
  }

  /** Index sérialisé (paires clé, emplacement) à conserver pour accélérer la prochaine ouverture. */
  serializeIndex(): Float64Array {
    const out = new Float64Array(this.index.size * 2);
    let i = 0;
    for (const [k, v] of this.index) {
      out[i++] = k;
      out[i++] = v;
    }
    return out;
  }

  has(z: number, x: number, y: number): boolean {
    return this.index.has(tileKey(z, x, y));
  }

  /** Octets de la tuile (PNG/JPEG/WebP), ou null si elle n'existe pas. */
  async getTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const loc = this.index.get(tileKey(z, x, y));
    if (loc === undefined) return null;
    const pageNo = Math.floor(loc / 65536);
    const off = loc % 65536;
    const page = await this.db.page(pageNo);
    const payload = await this.db.cellPayload(page, off);
    const row: SqlValue[] = decodeRecord(payload);
    const data = row[3];
    return data instanceof Uint8Array ? data : null;
  }
}

/** Lit les trois premières colonnes entières (zoom, colonne, ligne) d'une cellule sans toucher à la tuile. */
function decodeRecordHead(page: Uint8Array, cellOffset: number): [number, number, number] | null {
  // Cellule de table : taille de charge (varint), rowid (varint), puis l'enregistrement.
  // L'en-tête et les trois entiers tiennent toujours dans la partie locale de la cellule.
  const [, n1] = varint(page, cellOffset);
  const [, n2] = varint(page, cellOffset + n1);
  const start = cellOffset + n1 + n2;
  const vals = decodeRecord(page.subarray(start, Math.min(start + 64, page.length)), 3);
  const [z, c, r] = vals;
  return typeof z === "number" && typeof c === "number" && typeof r === "number" ? [z, c, r] : null;
}
