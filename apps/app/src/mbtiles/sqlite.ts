/**
 * Lecteur SQLite minimal, en lecture seule, sur un Blob (fichier local ou OPFS).
 * Sert uniquement à lire les MBTiles (table `tiles` et `metadata`) sans charger le fichier en mémoire :
 * les pages sont lues à la demande avec Blob.slice().
 *
 * Limites assumées : tables « rowid » uniquement (pas de WITHOUT ROWID), encodage UTF-8, base non chiffrée.
 * Format : https://www.sqlite.org/fileformat2.html
 */

export type SqlValue = number | bigint | string | Uint8Array | null;

const MAX_CACHED_PAGES = 512;

export class SqliteReader {
  readonly pageSize: number;
  /** Octets utilisables d'une page (taille de page moins la zone réservée). */
  readonly usable: number;
  private readonly cache = new Map<number, Uint8Array>();

  private constructor(private readonly blob: Blob, pageSize: number, reserved: number) {
    this.pageSize = pageSize;
    this.usable = pageSize - reserved;
  }

  static async open(blob: Blob): Promise<SqliteReader> {
    const head = new Uint8Array(await blob.slice(0, 100).arrayBuffer());
    const magic = new TextDecoder().decode(head.slice(0, 15));
    if (magic !== "SQLite format 3") throw new Error("Ce fichier n'est pas une base SQLite");
    const dv = new DataView(head.buffer);
    let pageSize = dv.getUint16(16, false);
    if (pageSize === 1) pageSize = 65536;
    if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) throw new Error("Taille de page SQLite invalide");
    const encoding = dv.getUint32(56, false);
    if (encoding !== 1 && encoding !== 0) throw new Error("Encodage SQLite non pris en charge (UTF-8 requis)");
    return new SqliteReader(blob, pageSize, head[20] ?? 0);
  }

  /** Page numérotée à partir de 1. */
  async page(n: number): Promise<Uint8Array> {
    const hit = this.cache.get(n);
    if (hit) {
      this.cache.delete(n);
      this.cache.set(n, hit);
      return hit;
    }
    const start = (n - 1) * this.pageSize;
    const buf = new Uint8Array(await this.blob.slice(start, start + this.pageSize).arrayBuffer());
    if (buf.length < this.pageSize) throw new Error(`Page SQLite ${n} tronquée (fichier incomplet ?)`);
    this.cache.set(n, buf);
    if (this.cache.size > MAX_CACHED_PAGES) this.cache.delete(this.cache.keys().next().value as number);
    return buf;
  }

  /**
   * Parcourt toutes les lignes d'une table « rowid » (arbre B de type table) dans l'ordre des rowid.
   * `visit` reçoit la page et le décalage de la cellule : à lui de décoder ce dont il a besoin.
   */
  async walkTable(root: number, visit: (page: Uint8Array, pageNo: number, cellOffset: number) => void): Promise<void> {
    const stack: number[] = [root];
    while (stack.length) {
      const pageNo = stack.pop() as number;
      const page = await this.page(pageNo);
      const base = pageNo === 1 ? 100 : 0;
      const type = page[base];
      const cells = u16(page, base + 3);
      if (type === 0x0d) {
        for (let i = 0; i < cells; i++) visit(page, pageNo, u16(page, base + 8 + 2 * i));
      } else if (type === 0x05) {
        const children: number[] = [];
        for (let i = 0; i < cells; i++) children.push(u32(page, u16(page, base + 12 + 2 * i)));
        children.push(u32(page, base + 8));
        // Pile : on empile à l'envers pour visiter de gauche à droite.
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as number);
      } else {
        throw new Error(`Type de page SQLite inattendu (0x${(type ?? 0).toString(16)}) : table WITHOUT ROWID non prise en charge`);
      }
    }
  }

  /** Charge la charge utile complète d'une cellule de table (suit les pages de débordement). */
  async cellPayload(page: Uint8Array, cellOffset: number): Promise<Uint8Array> {
    const [total, n1] = varint(page, cellOffset);
    const [, n2] = varint(page, cellOffset + n1);
    const start = cellOffset + n1 + n2;
    const P = Number(total);
    const U = this.usable;
    const X = U - 35;
    if (P <= X) return page.subarray(start, start + P);

    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((P - M) % (U - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(P);
    out.set(page.subarray(start, start + local), 0);
    let got = local;
    let next = u32(page, start + local);
    while (got < P) {
      if (next === 0) throw new Error("Chaîne de débordement SQLite interrompue (fichier corrompu ?)");
      const ov = await this.page(next);
      const take = Math.min(U - 4, P - got);
      out.set(ov.subarray(4, 4 + take), got);
      got += take;
      next = u32(ov, 0);
    }
    return out;
  }

  /** Lit le contenu de `sqlite_master` : nom, racine et SQL de chaque table. */
  async schema(): Promise<{ type: string; name: string; root: number; sql: string }[]> {
    const rows: { type: string; name: string; root: number; sql: string }[] = [];
    const pending: Promise<void>[] = [];
    await this.walkTable(1, (page, _no, off) => {
      pending.push(
        this.cellPayload(page, off).then((payload) => {
          const r = decodeRecord(payload);
          rows.push({ type: String(r[0]), name: String(r[1]), root: Number(r[3]), sql: String(r[4] ?? "") });
        }),
      );
    });
    await Promise.all(pending);
    return rows;
  }

  /** Lit toutes les lignes d'une petite table (ex. `metadata`). */
  async readAll(root: number): Promise<SqlValue[][]> {
    const rows: SqlValue[][] = [];
    const pending: Promise<void>[] = [];
    await this.walkTable(root, (page, _no, off) => {
      pending.push(this.cellPayload(page, off).then((p) => void rows.push(decodeRecord(p))));
    });
    await Promise.all(pending);
    return rows;
  }
}

const u16 = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32 = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;

/** Entier à longueur variable SQLite (1 à 9 octets). Retourne [valeur, octets lus]. */
export function varint(b: Uint8Array, o: number): [bigint, number] {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const byte = b[o + i];
    if (byte === undefined) throw new Error("Entier variable tronqué");
    v = (v << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return [v, i + 1];
  }
  const last = b[o + 8];
  if (last === undefined) throw new Error("Entier variable tronqué");
  return [(v << 8n) | BigInt(last), 9];
}

/** Décode un enregistrement SQLite (en-tête de types puis valeurs). */
export function decodeRecord(p: Uint8Array, maxColumns = Infinity): SqlValue[] {
  const [hdrLen, hn] = varint(p, 0);
  const headerEnd = Number(hdrLen);
  const types: number[] = [];
  let pos = hn;
  while (pos < headerEnd && types.length < maxColumns) {
    const [t, n] = varint(p, pos);
    types.push(Number(t));
    pos += n;
  }
  const out: SqlValue[] = [];
  let off = headerEnd;
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  for (const t of types) {
    if (t === 0) out.push(null);
    else if (t >= 1 && t <= 6) {
      const size = [0, 1, 2, 3, 4, 6, 8][t] as number;
      out.push(readInt(dv, off, size));
      off += size;
    } else if (t === 7) {
      out.push(dv.getFloat64(off, false));
      off += 8;
    } else if (t === 8) out.push(0);
    else if (t === 9) out.push(1);
    else if (t >= 12) {
      const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
      const slice = p.subarray(off, off + len);
      out.push(t % 2 === 0 ? slice : new TextDecoder().decode(slice));
      off += len;
    } else throw new Error(`Type de colonne SQLite réservé (${t})`);
  }
  return out;
}

function readInt(dv: DataView, off: number, size: number): number | bigint {
  switch (size) {
    case 1: return dv.getInt8(off);
    case 2: return dv.getInt16(off, false);
    case 3: {
      const v = (dv.getUint8(off) << 16) | (dv.getUint8(off + 1) << 8) | dv.getUint8(off + 2);
      return v & 0x800000 ? v - 0x1000000 : v;
    }
    case 4: return dv.getInt32(off, false);
    case 6: {
      const hi = dv.getInt16(off, false);
      return hi * 2 ** 32 + dv.getUint32(off + 2, false);
    }
    default: {
      const v = dv.getBigInt64(off, false);
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
  }
}
