import { PackError, sha256Hex, type PackDataset, type PackFile } from "./dataPack";

export interface DownloadOptions {
  readonly fetchFn?: typeof fetch;
  /** Annulation par l'utilisateur : arrête tout, sans nouvel essai. */
  readonly signal?: AbortSignal;
  /** Octets reçus / octets attendus pour tout le jeu (somme de ses fichiers). */
  readonly onProgress?: (loadedBytes: number, totalBytes: number) => void;
  /** Un fichier qui ne reçoit plus aucun octet pendant ce délai est abandonné puis retenté. */
  readonly idleTimeoutMs?: number;
  readonly retries?: number;
  readonly backoffMs?: number;
}

export class AbortedError extends Error {
  constructor() {
    super("annulé");
    this.name = "AbortedError";
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new AbortedError()); }, { once: true });
  });

/** Lit le corps d'une réponse en continu : progression, et abandon si plus rien n'arrive pendant `idleMs`. */
async function readBody(res: Response, idleMs: number, signal: AbortSignal | undefined, onChunk: (n: number) => void): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk(buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    if (signal?.aborted) { void reader.cancel(); throw new AbortedError(); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PackError(`plus de données reçues depuis ${Math.round(idleMs / 1000)} s`)), idleMs); });
    try {
      const r = await Promise.race([reader.read(), idle]);
      if (r.done) break;
      chunks.push(r.value);
      total += r.value.length;
      onChunk(r.value.length);
    } catch (e) {
      void reader.cancel().catch(() => undefined);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function fetchOnce(url: string, f: PackFile, o: Required<Pick<DownloadOptions, "fetchFn" | "idleTimeoutMs">> & DownloadOptions, onChunk: (n: number) => void): Promise<Uint8Array> {
  // Délai pour obtenir les en-têtes : même règle que pour les données.
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const headTimer = setTimeout(() => ctl.abort(), o.idleTimeoutMs);
  try {
    let res: Response;
    try {
      res = await o.fetchFn(url, { cache: "no-store", signal: ctl.signal });
    } catch (e) {
      if (o.signal?.aborted) throw new AbortedError();
      throw new PackError(ctl.signal.aborted ? `pas de réponse du serveur depuis ${Math.round(o.idleTimeoutMs / 1000)} s` : `réseau indisponible (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      clearTimeout(headTimer);
    }
    if (!res.ok) throw new PackError(`${f.path} : HTTP ${res.status}`);
    const buf = await readBody(res, o.idleTimeoutMs, o.signal, onChunk);
    if (buf.byteLength !== f.bytes) throw new PackError(`${f.path} : taille ${buf.byteLength} au lieu de ${f.bytes} (téléchargement tronqué ?)`);
    if ((await sha256Hex(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)) !== f.sha256) throw new PackError(`${f.path} : empreinte SHA-256 différente (fichier altéré ou publication en cours)`);
    return buf;
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Télécharge les fichiers d'un jeu avec progression, délai d'inactivité et nouveaux essais (3 par défaut, attente croissante),
 * et contrôle taille et SHA-256 : un fichier altéré ou tronqué n'est jamais importé. Annulable.
 */
export async function downloadDataset(base: string, ds: PackDataset, opts: DownloadOptions = {}): Promise<File[]> {
  const o = { ...opts, fetchFn: opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), idleTimeoutMs: opts.idleTimeoutMs ?? 30_000 };
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 1500;
  const total = ds.files.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  const files: File[] = [];
  for (const f of ds.files) {
    const url = `${base.replace(/\/$/, "")}/${f.path}`;
    for (let attempt = 1; ; attempt++) {
      let got = 0;
      try {
        const buf = await fetchOnce(url, f, o, (n) => { got += n; o.onProgress?.(Math.min(done + got, total), total); });
        done += buf.byteLength;
        o.onProgress?.(done, total);
        files.push(new File([buf as BlobPart], f.path.split("/").pop() as string, { type: "application/json" }));
        break;
      } catch (e) {
        if (e instanceof AbortedError || o.signal?.aborted) throw new AbortedError();
        o.onProgress?.(done, total); // la progression repart de ce qui est déjà acquis
        if (attempt > retries) throw e;
        await sleep(backoff * attempt, o.signal);
      }
    }
  }
  return files;
}

/** Récupère un JSON avec délai et nouveaux essais (manifeste). */
export async function fetchJson(url: string, opts: { fetchFn?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; retries?: number; backoffMs?: number } = {}): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a)); // jamais « fetch » rangé dans un objet : le navigateur refuse (« Illegal invocation »)
  const timeout = opts.timeoutMs ?? 30_000;
  const retries = opts.retries ?? 2;
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetchFn(url, { cache: "no-store", signal: ctl.signal });
      if (!res.ok) throw new PackError(`manifeste : HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (opts.signal?.aborted) throw new AbortedError();
      if (attempt > retries) throw e instanceof PackError ? e : new PackError(ctl.signal.aborted ? `pas de réponse du serveur depuis ${Math.round(timeout / 1000)} s` : `réseau indisponible (${e instanceof Error ? e.message : String(e)})`);
      await sleep((opts.backoffMs ?? 1500) * attempt, opts.signal);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}
