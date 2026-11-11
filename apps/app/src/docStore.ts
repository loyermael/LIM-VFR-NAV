import { useCallback, useEffect, useState } from "react";
import type { ControlPoint, Georef } from "@lim/core";
import { tx } from "./db";

export type DocKind = "vac" | "aip" | "sup" | "other";
export const DOC_KINDS: readonly DocKind[] = ["vac", "aip", "sup", "other"];

/** Calage d'une carte : points, transformation, et image rendue (l'affichage en vol n'a pas besoin de relire le PDF). */
export interface DocGeoref {
  readonly points: readonly ControlPoint[];
  readonly georef: Georef;
  readonly width: number;
  readonly height: number;
  readonly rmsError: number;
  /** Calage approximatif tiré d'une piste (cap, longueur, ARP de la base de données) : pas de contrôle possible. */
  readonly assisted?: boolean;
  readonly page: number;
  readonly image: Blob;
}

/** Document personnel importé par l'utilisateur (le SIA et les autres éditeurs ne sont pas téléchargés par l'appli). */
export interface DocRecord {
  readonly id: string;
  readonly name: string;
  readonly kind: DocKind;
  /** Code OACI du terrain lié (majuscules), ou vide. */
  readonly icao: string;
  /** Date ou cycle de la source, saisi par l'utilisateur (« AIRAC 13/2026 », « 10/11/2026 »), ou vide. */
  readonly sourceDate: string;
  readonly mime: string;
  readonly size: number;
  readonly addedAt: number;
  readonly data: Blob;
  readonly georef: DocGeoref | null;
  /** Affichage de la carte calée : « auto » = à l'approche du terrain. */
  readonly show: "auto" | "on" | "off";
}

export const loadDocs = (): Promise<DocRecord[]> => tx("docs", "readonly", (s) => s.getAll() as IDBRequest<DocRecord[]>);
export const saveDoc = (d: DocRecord): Promise<IDBValidKey> => tx("docs", "readwrite", (s) => s.put(d));
export const deleteDoc = (id: string): Promise<undefined> => tx("docs", "readwrite", (s) => s.delete(id));

const urls = new WeakMap<Blob, string>();
/** Adresse locale d'un Blob (créée une fois par Blob, valable pour la session). */
export function blobUrl(b: Blob): string {
  let u = urls.get(b);
  if (!u) { u = URL.createObjectURL(b); urls.set(b, u); }
  return u;
}

export const isPdf = (d: Pick<DocRecord, "mime" | "name">): boolean => d.mime === "application/pdf" || /\.pdf$/i.test(d.name);

/** Type de document deviné d'après le nom de fichier (modifiable ensuite) : « AD-2.LFBI », « VAC », « SUP »… */
export function guessKind(fileName: string): { kind: DocKind; icao: string } {
  const icao = /\b(L[A-Z]{3})\b/i.exec(fileName)?.[1]?.toUpperCase() ?? "";
  if (/\bSUP\b/i.test(fileName)) return { kind: "sup", icao };
  if (/VAC/i.test(fileName)) return { kind: "vac", icao };
  if (/\bAIP\b|AD[-_ ]?2/i.test(fileName)) return { kind: /AD[-_ ]?2/i.test(fileName) && icao ? "vac" : "aip", icao };
  return { kind: "other", icao };
}

export function newDoc(file: File, now: number, id: string): DocRecord {
  const g = guessKind(file.name);
  return {
    id, name: file.name.replace(/\.[^.]+$/, ""), kind: g.kind, icao: g.icao, sourceDate: "", mime: file.type || "application/octet-stream",
    size: file.size, addedAt: now, data: file, georef: null, show: "auto",
  };
}

/** Bibliothèque de documents, sur l'appareil (IndexedDB) : disponible hors-ligne. */
export function useDocs() {
  const [list, setList] = useState<DocRecord[]>([]);
  useEffect(() => {
    loadDocs().then(setList).catch(() => setList([]));
  }, []);
  const put = useCallback((d: DocRecord) => {
    setList((prev) => (prev.some((x) => x.id === d.id) ? prev.map((x) => (x.id === d.id ? d : x)) : [...prev, d]));
    void saveDoc(d).catch(() => undefined);
  }, []);
  const remove = useCallback((id: string) => {
    void deleteDoc(id).catch(() => undefined);
    setList((prev) => prev.filter((x) => x.id !== id));
  }, []);
  return { list, put, remove };
}
