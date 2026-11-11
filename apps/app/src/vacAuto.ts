import { cropGeoref, type Georef } from "@lim/core";
import { packBaseUrl, sha256Hex } from "./dataPack";
import { fetchJson } from "./packDownload";
import type { DocRecord } from "./docStore";
import { RENDER_SCALE, renderPdfPage } from "./pdfRender";

/**
 * Calage automatique des VAC du SIA : un index (construit par `tools/build-vac-index.py`) associe l'empreinte SHA-256 de chaque
 * PDF au calage tiré de son graticule. Si le PDF importé est identique à un fichier de l'index, il est posé sur la carte sans
 * aucune saisie. Un PDF d'une autre édition n'est jamais calé « au jugé » : il faut le caler à la main ou avec la piste.
 */
export interface VacIndexEntry {
  readonly icao: string;
  readonly sha256: string;
  /** Nature de la carte : approche à vue (app), atterrissage à vue (att), transit VFR (tran) ou VAC unique (vac). */
  readonly kind: "app" | "att" | "tran" | "vac";
  /** Nom du PDF publié à côté de l'index (absent : à importer soi-même). */
  readonly file: string | null;
  readonly bytes: number | null;
  readonly chartDate: string | null;
  readonly page: number;
  readonly georef: Georef;
  readonly renderScale: number;
  /** Cadre de la carte dans la page (points PDF) : x0, y0, x1, y1. */
  readonly frame: readonly [number, number, number, number] | null;
  readonly groundMetersPerPoint: number;
  readonly residualPt: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valide l'index : une entrée mal formée est écartée, jamais devinée. */
export function parseVacIndex(raw: unknown): Map<string, VacIndexEntry> {
  const o = raw as { format?: unknown; version?: unknown; entries?: unknown } | null;
  if (!o || o.format !== "lim-nav-vac-index" || o.version !== 1 || !Array.isArray(o.entries)) throw new Error("index VAC invalide");
  const out = new Map<string, VacIndexEntry>();
  for (const e of o.entries as Record<string, unknown>[]) {
    const g = e["georef"] as Record<string, unknown> | undefined;
    const fr = e["frame"];
    if (typeof e["icao"] !== "string" || typeof e["sha256"] !== "string" || !/^[0-9a-f]{64}$/.test(e["sha256"]) || !g) continue;
    if (!isNum(g["ar"]) || !isNum(g["ai"]) || !isNum(g["tx"]) || !isNum(g["ty"]) || (g["ay"] !== undefined && !isNum(g["ay"]))) continue;
    if (!isNum(e["renderScale"]) || !isNum(e["page"]) || !isNum(e["groundMetersPerPoint"]) || !isNum(e["residualPt"])) continue;
    if (fr !== null && !(Array.isArray(fr) && fr.length === 4 && fr.every(isNum))) continue;
    // plusieurs cartes par PDF (approche, atterrissage) : une entrée par page
    out.set(`${e["sha256"]}#${e["page"] as number}`, {
      icao: e["icao"], sha256: e["sha256"], kind: e["kind"] === "app" || e["kind"] === "att" || e["kind"] === "tran" ? e["kind"] : "vac", file: typeof e["file"] === "string" && /^[A-Za-z0-9._-]+\.pdf$/.test(e["file"]) ? e["file"] : null, bytes: isNum(e["bytes"]) ? e["bytes"] : null, chartDate: typeof e["chartDate"] === "string" ? e["chartDate"] : null, page: e["page"] as number,
      georef: { ar: g["ar"] as number, ai: g["ai"] as number, tx: g["tx"] as number, ty: g["ty"] as number, ...(g["ay"] !== undefined ? { ay: g["ay"] as number } : {}) },
      renderScale: e["renderScale"] as number, frame: fr as VacIndexEntry["frame"], groundMetersPerPoint: e["groundMetersPerPoint"] as number, residualPt: e["residualPt"] as number,
    });
  }
  return out;
}

/** Index des VAC publié avec les PDF (repli) : même dépôt de données, branche vac-data. */
const VAC_INDEX_FALLBACK = "https://raw.githubusercontent.com/loyermael/lim-vfr-nav-data/vac-data/index.json";
let lastFilesBase: string | null = null;
let lastCycle: string | null = null;
let cache: { url: string; at: number; index: Map<string, VacIndexEntry> } | null = null;

/** Index des VAC publié avec les données (`<paquet>/vac/index.json`) ; gardé en mémoire 10 minutes. */
export async function loadVacIndex(base: string = packBaseUrl(), fetchFn?: typeof fetch): Promise<Map<string, VacIndexEntry>> {
  if (!base) throw new Error("adresse des données non configurée");
  const url = `${base.replace(/\/$/, "")}/vac/index.json`;
  if (cache && cache.url === url && Date.now() - cache.at < 600_000) return cache.index;
  const opts = { ...(fetchFn ? { fetchFn } : {}), retries: 1, timeoutMs: 20_000 };
  let raw: unknown;
  try {
    raw = await fetchJson(url, opts);
  } catch (e) {
    // L'index des VAC peut aussi être publié avec les PDF (branche vac-data) : on l'y cherche si le paquet principal n'en a pas.
    try { raw = await fetchJson(VAC_INDEX_FALLBACK, opts); } catch { throw e; }
  }
  const fb = (raw as { filesBase?: unknown } | null)?.filesBase;
  lastFilesBase = typeof fb === "string" && /^https:\/\//.test(fb) ? fb.replace(/\/$/, "") : `${base.replace(/\/$/, "")}/vac`;
  const cy = (raw as { cycle?: unknown } | null)?.cycle;
  lastCycle = typeof cy === "string" ? cy.replace(/_/g, " ") : null;
  const index = parseVacIndex(raw);
  cache = { url, at: Date.now(), index };
  return index;
}

async function cropPng(png: Blob, x0: number, y0: number, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(png);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image illisible"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")?.drawImage(img, x0, y0, w, h, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas vide"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Première carte (page la plus basse) d'un PDF reconnu par son empreinte. */
export function entryBySha(index: Map<string, VacIndexEntry>, sha: string): VacIndexEntry | null {
  let best: VacIndexEntry | null = null;
  for (const e of index.values()) if (e.sha256 === sha && (!best || e.page < best.page)) best = e;
  return best;
}

export const KIND_LABEL: Readonly<Record<VacIndexEntry["kind"], string>> = { app: "Approche à vue", att: "Atterrissage à vue", tran: "Transit VFR", vac: "VAC" };
const KIND_ORDER: Readonly<Record<VacIndexEntry["kind"], number>> = { app: 0, att: 1, tran: 2, vac: 3 };

export type AutoResult = { readonly doc: DocRecord } | { readonly reason: "not-pdf" | "unknown-edition" | "no-index" };

/** Cale automatiquement un PDF importé s'il figure dans l'index (même empreinte) ; sinon explique pourquoi pas. */
export async function autoGeoreference(doc: DocRecord, index: Map<string, VacIndexEntry>): Promise<AutoResult> {
  if (doc.mime !== "application/pdf" && !/\.pdf$/i.test(doc.name)) return { reason: "not-pdf" };
  const sha = await sha256Hex(await doc.data.arrayBuffer());
  const e = entryBySha(index, sha);
  if (!e) return { reason: "unknown-edition" };
  const rendered = await renderPdfPage(doc.data, e.page);
  const k = RENDER_SCALE / e.renderScale; // l'index suppose le même facteur de rendu : on corrige sinon
  const g: Georef = k === 1 ? e.georef : { ...e.georef, ar: e.georef.ar / k, ai: e.georef.ai / k, ...(e.georef.ay !== undefined ? { ay: e.georef.ay / k } : {}) };
  const fr = e.frame ?? [0, 0, rendered.width / RENDER_SCALE, rendered.height / RENDER_SCALE];
  const x0 = Math.max(0, Math.floor(fr[0] * RENDER_SCALE)), y0 = Math.max(0, Math.floor(fr[1] * RENDER_SCALE));
  const x1 = Math.min(rendered.width, Math.ceil(fr[2] * RENDER_SCALE)), y1 = Math.min(rendered.height, Math.ceil(fr[3] * RENDER_SCALE));
  const image = await cropPng(rendered.blob, x0, y0, x1 - x0, y1 - y0);
  return {
    doc: {
      ...doc,
      icao: doc.icao || e.icao,
      sourceDate: doc.sourceDate || (e.chartDate ? `SIA ${e.chartDate}` : "SIA"),
      kind: "vac",
      show: "auto",
      georef: {
        points: [], georef: cropGeoref(g, x0, y0), width: x1 - x0, height: y1 - y0, rmsError: e.residualPt * e.groundMetersPerPoint,
        auto: true, page: e.page, image,
      },
    },
  };
}

/** Cartes d'un terrain publiées dans l'index : approche à vue d'abord (elle couvre la zone autour du terrain), puis atterrissage à vue. */
export function vacsFor(index: Map<string, VacIndexEntry>, icao: string): VacIndexEntry[] {
  const out = [...index.values()].filter((e) => e.icao === icao && e.file && e.kind !== "tran");
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.page - b.page);
}

/** Carte préférée d'un terrain (approche à vue, sinon atterrissage). */
export function vacFor(index: Map<string, VacIndexEntry>, icao: string): VacIndexEntry | null {
  return vacsFor(index, icao)[0] ?? null;
}

/** Télécharge le PDF d'une VAC une seule fois (pourcentage), vérifie l'empreinte, puis crée un document calé par carte demandée (approche, atterrissage). */
export async function downloadVacPages(
  entries: readonly VacIndexEntry[], onProgress: (done: number, total: number) => void, signal?: AbortSignal, fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<DocRecord[]> {
  const e0 = entries[0];
  if (!e0) return [];
  if (!e0.file || !lastFilesBase) throw new Error("VAC non publiée : importe le PDF toi-même (Docs)");
  const res = await fetchFn(`${lastFilesBase}/${e0.file}`, { signal: signal ?? AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) throw new Error(`téléchargement refusé (${res.status})`);
  const total = Number(res.headers.get("content-length")) || e0.bytes || 0;
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    got += r.value.byteLength;
    onProgress(got, Math.max(total, got));
  }
  const data = new Blob(chunks as BlobPart[], { type: "application/pdf" });
  if ((await sha256Hex(await data.arrayBuffer())) !== e0.sha256) throw new Error("fichier corrompu (empreinte différente)");
  const docs: DocRecord[] = [];
  for (const e of entries) {
    const doc: DocRecord = {
      id: crypto.randomUUID(), name: entries.length > 1 || e.kind !== "vac" ? `VAC ${e.icao} – ${KIND_LABEL[e.kind]}` : `VAC ${e.icao}`, kind: "vac", icao: e.icao,
      sourceDate: e.chartDate ? `SIA ${e.chartDate}` : lastCycle ? `SIA AIRAC ${lastCycle}` : "SIA",
      mime: "application/pdf", size: data.size, addedAt: Date.now(), data, georef: null, show: "off",
    };
    try {
      const g = await autoGeoreference(doc, new Map([[`${e.sha256}#${e.page}`, e]]));
      docs.push("doc" in g ? g.doc : doc);
    } catch {
      docs.push(doc); // calage impossible (rendu PDF indisponible) : le PDF reste téléchargé, à caler dans Docs
    }
  }
  return docs;
}

/** Une seule carte (compatibilité) : voir downloadVacPages. */
export async function downloadVac(
  e: VacIndexEntry, onProgress: (done: number, total: number) => void, signal?: AbortSignal, fetchFn: typeof fetch = (...a) => fetch(...a),
): Promise<DocRecord> {
  const [d] = await downloadVacPages([e], onProgress, signal, fetchFn);
  if (!d) throw new Error("VAC indisponible");
  return { ...d, show: "auto" };
}
