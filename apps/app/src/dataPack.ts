import { useCallback, useEffect, useRef, useState } from "react";
import { AbortedError, downloadDataset, fetchJson } from "./packDownload";

/**
 * Paquet de données téléchargé automatiquement : un manifeste (manifest.json) liste, par pays, des jeux de données
 * (aero = espaces et terrains, weather = METAR/TAF/SIGMET), chacun avec ses fichiers, tailles et empreintes SHA-256.
 * Le paquet est construit par `tools/build-data-pack.mjs` et publié sur un hébergement statique.
 */
export interface PackFile { readonly path: string; readonly bytes: number; readonly sha256: string }
export interface PackDataset {
  readonly id: string;
  readonly title: string;
  /** Date de construction de ce jeu (ISO). */
  readonly updatedAt: string;
  readonly maxAgeHours: number;
  readonly source: string;
  readonly licence: string;
  readonly files: readonly PackFile[];
}
export interface PackCountry { readonly code: string; readonly name: string; readonly datasets: readonly PackDataset[] }
export interface PackManifest { readonly format: "lim-nav-data"; readonly version: 1; readonly generatedAt: string; readonly countries: readonly PackCountry[] }

export class PackError extends Error {}

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valide un manifeste ; refuse tout chemin sortant du paquet (« .. », chemin absolu, schéma d'URL). */
export function parsePackManifest(raw: unknown): PackManifest {
  const o = raw as Partial<PackManifest> | null;
  if (typeof o !== "object" || o === null || o.format !== "lim-nav-data") throw new PackError("manifeste invalide (format)");
  if (o.version !== 1) throw new PackError(`version de paquet non prise en charge : ${String(o.version)}`);
  if (!Array.isArray(o.countries)) throw new PackError("manifeste invalide (pays)");
  const countries: PackCountry[] = o.countries.map((c: unknown) => {
    const cc = c as Partial<PackCountry>;
    if (!isStr(cc.code) || !/^[a-z]{2}$/.test(cc.code) || !isStr(cc.name) || !Array.isArray(cc.datasets)) throw new PackError("manifeste invalide (pays)");
    const datasets = cc.datasets.map((d: unknown) => {
      const dd = d as Partial<PackDataset>;
      if (!isStr(dd.id) || !isStr(dd.title) || !isStr(dd.updatedAt) || Number.isNaN(Date.parse(dd.updatedAt)) || !isNum(dd.maxAgeHours) || !Array.isArray(dd.files)) throw new PackError(`jeu de données invalide dans ${cc.code}`);
      const files = dd.files.map((f: unknown) => {
        const ff = f as Partial<PackFile>;
        if (!isStr(ff.path) || ff.path.startsWith("/") || ff.path.includes("..") || /^[a-z]+:/i.test(ff.path) || !isNum(ff.bytes) || ff.bytes < 0 || !isStr(ff.sha256) || !/^[0-9a-f]{64}$/.test(ff.sha256)) {
          throw new PackError(`fichier invalide dans ${cc.code}/${dd.id}`);
        }
        return { path: ff.path, bytes: ff.bytes, sha256: ff.sha256 };
      });
      return { id: dd.id, title: dd.title, updatedAt: dd.updatedAt, maxAgeHours: dd.maxAgeHours, source: String(dd.source ?? ""), licence: String(dd.licence ?? ""), files };
    });
    return { code: cc.code, name: cc.name, datasets };
  });
  return { format: "lim-nav-data", version: 1, generatedAt: String(o.generatedAt ?? ""), countries };
}

export interface InstalledPack {
  readonly country: string | null;
  /** Par jeu de données : version installée (updatedAt du manifeste) et dernière vérification réussie (ms). */
  readonly datasets: Readonly<Record<string, { readonly updatedAt: string; readonly checkedAt: number }>>;
}
export const NO_PACK: InstalledPack = { country: null, datasets: {} };

/** Jeux à (re)télécharger : absents, ou dont la version publiée est plus récente que celle installée. */
export function datasetsToUpdate(manifest: PackManifest, state: InstalledPack): PackDataset[] {
  const c = manifest.countries.find((x) => x.code === state.country);
  if (!c) return [];
  return c.datasets.filter((d) => {
    const have = state.datasets[d.id];
    return !have || Date.parse(d.updatedAt) > Date.parse(have.updatedAt);
  });
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paquet officiel du projet (GitHub Pages du dépôt de données). */
export const DEFAULT_PACK_URL = "https://loyermael.github.io/lim-vfr-nav-data";
const STATE_KEY = "lim.datapack.v1";
const URL_KEY = "lim.dataurl.v1";

export function parseInstalled(raw: unknown): InstalledPack {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const datasets: Record<string, { updatedAt: string; checkedAt: number }> = {};
  for (const [k, v] of Object.entries((o["datasets"] ?? {}) as Record<string, unknown>)) {
    const d = v as { updatedAt?: unknown; checkedAt?: unknown };
    if (typeof d?.updatedAt === "string" && !Number.isNaN(Date.parse(d.updatedAt)) && typeof d.checkedAt === "number") datasets[k] = { updatedAt: d.updatedAt, checkedAt: d.checkedAt };
  }
  return { country: typeof o["country"] === "string" && /^[a-z]{2}$/.test(o["country"]) ? o["country"] : null, datasets };
}

function load(): InstalledPack {
  try {
    return parseInstalled(JSON.parse(localStorage.getItem(STATE_KEY) ?? "null"));
  } catch {
    return NO_PACK;
  }
}
function save(s: InstalledPack): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* stockage bloqué */
  }
}

/** Adresse du paquet : réglage de l'utilisateur, sinon celle fixée à la construction (VITE_DATA_URL), sinon aucune. */
export function packBaseUrl(): string {
  try {
    const u = localStorage.getItem(URL_KEY);
    if (u && /^https?:\/\//i.test(u)) return u.trim();
  } catch { /* ignoré */ }
  const env = (import.meta.env as Record<string, string | undefined>)["VITE_DATA_URL"];
  return env && /^https?:\/\//i.test(env) ? env : DEFAULT_PACK_URL;
}
export function setPackBaseUrl(u: string): void {
  try {
    if (u.trim() === "") localStorage.removeItem(URL_KEY);
    else localStorage.setItem(URL_KEY, u.trim());
  } catch { /* ignoré */ }
}

export type DatasetStatus =
  | { readonly state: "idle" }
  | { readonly state: "downloading"; readonly loaded: number; readonly total: number; readonly attempt: number }
  | { readonly state: "installing" }
  | { readonly state: "ok" }
  | { readonly state: "error"; readonly message: string };

export interface PackHook {
  readonly baseUrl: string;
  readonly installed: InstalledPack;
  readonly countries: readonly { code: string; name: string }[];
  readonly status: Readonly<Record<string, DatasetStatus>>;
  readonly checking: boolean;
  readonly lastError: string | null;
  readonly manifest: PackManifest | null;
  chooseCountry(code: string): void;
  /** Vérification manuelle : relance aussi ce qui a été annulé ou a échoué. */
  refresh(): void;
  /** Annule le téléchargement en cours ; les vérifications automatiques ne le relancent pas avant 10 minutes. */
  cancel(): void;
}

const CHECK_EVERY_MS = 15 * 60 * 1000;
const CANCEL_PAUSE_MS = 10 * 60 * 1000;

/**
 * Téléchargement et mise à jour automatiques : au lancement, au retour du réseau, au retour au premier plan, puis toutes
 * les 15 minutes. Un jeu n'est retéléchargé que si la version publiée est plus récente que la version installée.
 * Chaque téléchargement montre sa progression, a un délai d'inactivité, des nouveaux essais et peut être annulé.
 * Hors-ligne ou en cas d'échec : les données déjà installées restent utilisées, rien n'est effacé.
 */
export function usePackData(baseUrlOverride: string | null, onDataset: (id: string, files: File[]) => Promise<void>): PackHook {
  const [baseUrl] = useState(() => baseUrlOverride ?? packBaseUrl());
  const [installed, setInstalled] = useState<InstalledPack>(load);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [status, setStatus] = useState<Record<string, DatasetStatus>>({});
  const [checking, setChecking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const pausedUntil = useRef(0);
  const stateRef = useRef(installed);
  stateRef.current = installed;
  const cb = useRef(onDataset);
  cb.current = onDataset;

  const check = useCallback(async (manual: boolean) => {
    if (busy.current || !baseUrl) return;
    if (!manual && Date.now() < pausedUntil.current) return;
    busy.current = true;
    const ctl = new AbortController();
    abort.current = ctl;
    setChecking(true);
    if (manual) pausedUntil.current = 0;
    try {
      const m = parsePackManifest(await fetchJson(`${baseUrl.replace(/\/$/, "")}/manifest.json`, { signal: ctl.signal }));
      setManifest(m);
      setLastError(null);
      let cur = stateRef.current;
      if (cur.country === null) return;
      const country = m.countries.find((c) => c.code === cur.country);
      // Jeux déjà à jour : on note seulement la vérification.
      const now = Date.now();
      for (const ds of country?.datasets ?? []) {
        const have = cur.datasets[ds.id];
        if (have && Date.parse(ds.updatedAt) <= Date.parse(have.updatedAt)) cur = { ...cur, datasets: { ...cur.datasets, [ds.id]: { ...have, checkedAt: now } } };
      }
      const todo = datasetsToUpdate(m, cur);
      for (const ds of todo) setStatus((s) => ({ ...s, [ds.id]: { state: "downloading", loaded: 0, total: ds.files.reduce((a, f) => a + f.bytes, 0), attempt: 1 } }));
      for (const ds of todo) {
        const total = ds.files.reduce((a, f) => a + f.bytes, 0);
        try {
          const files = await downloadDataset(baseUrl, ds, { signal: ctl.signal, onProgress: (loaded) => setStatus((s) => ({ ...s, [ds.id]: { state: "downloading", loaded, total, attempt: 1 } })) });
          setStatus((s) => ({ ...s, [ds.id]: { state: "installing" } }));
          await cb.current(ds.id, files);
          cur = { ...cur, datasets: { ...cur.datasets, [ds.id]: { updatedAt: ds.updatedAt, checkedAt: Date.now() } } };
          save(cur);
          setInstalled(cur);
          setStatus((s) => ({ ...s, [ds.id]: { state: "ok" } }));
        } catch (e) {
          if (e instanceof AbortedError) {
            // Annulation : tout ce qui restait à faire repasse au repos.
            setStatus((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.state === "downloading" || v.state === "installing" ? { state: "idle" } : v])));
            pausedUntil.current = Date.now() + CANCEL_PAUSE_MS;
            break;
          }
          setStatus((s) => ({ ...s, [ds.id]: { state: "error", message: e instanceof Error ? e.message : String(e) } }));
        }
      }
      save(cur);
      setInstalled(cur);
    } catch (e) {
      if (!(e instanceof AbortedError)) setLastError(e instanceof Error ? e.message : String(e)); // hors-ligne ou serveur indisponible : on garde l'existant
      else pausedUntil.current = Date.now() + CANCEL_PAUSE_MS;
    } finally {
      busy.current = false;
      abort.current = null;
      setChecking(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    if (!baseUrl) return;
    void check(false);
    const id = setInterval(() => void check(false), CHECK_EVERY_MS);
    const wake = () => document.visibilityState !== "hidden" && void check(false);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [baseUrl, installed.country, check]);

  const chooseCountry = useCallback((code: string) => {
    const next: InstalledPack = { country: code, datasets: stateRef.current.country === code ? stateRef.current.datasets : {} };
    save(next);
    setInstalled(next);
  }, []);

  return {
    baseUrl,
    installed,
    countries: manifest?.countries.map((c) => ({ code: c.code, name: c.name })) ?? (installed.country ? [{ code: installed.country, name: installed.country.toUpperCase() }] : []),
    status,
    checking,
    lastError,
    manifest,
    chooseCountry,
    refresh: () => void check(true),
    cancel: () => abort.current?.abort(),
  };
}

/** Réglage d'adresse (pour tester ou héberger soi-même) : change la source, rechargement nécessaire. */
export function applyBaseUrl(u: string): void {
  setPackBaseUrl(u);
  location.reload();
}
