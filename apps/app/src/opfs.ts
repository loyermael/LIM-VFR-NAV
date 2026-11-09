/** Stockage privé du navigateur (OPFS) pour les cartes : persistant, hors-ligne, sans compte. */

export const opfsAvailable = (): boolean =>
  typeof navigator !== "undefined" && !!navigator.storage?.getDirectory && typeof Worker !== "undefined";

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: () => void; fail: (m: string) => void; progress?: (p: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./opfsWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; done?: boolean; error?: string; progress?: number }>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    if (e.data.progress !== undefined) w.progress?.(e.data.progress);
    if (e.data.error !== undefined) {
      waiting.delete(e.data.id);
      w.fail(e.data.error);
    } else if (e.data.done) {
      waiting.delete(e.data.id);
      w.ok();
    }
  };
  return worker;
}

function call(msg: Record<string, unknown>, progress?: (p: number) => void, transfer: Transferable[] = []): Promise<void> {
  return new Promise((ok, fail) => {
    const id = nextId++;
    waiting.set(id, { ok, fail: (m) => fail(new Error(m)), ...(progress ? { progress } : {}) });
    getWorker().postMessage({ id, ...msg }, transfer);
  });
}

/** Copie un fichier choisi par l'utilisateur dans le stockage de l'application. */
export const copyToOpfs = (file: File, name: string, onProgress?: (fraction: number) => void) =>
  call({ type: "copy", name, file }, onProgress);

export const writeToOpfs = (name: string, data: ArrayBuffer) => call({ type: "write", name, data }, undefined, [data]);

export const removeFromOpfs = (name: string) => call({ type: "remove", name });

export async function openOpfsFile(name: string): Promise<File> {
  const root = await navigator.storage.getDirectory();
  return (await root.getFileHandle(name)).getFile();
}

/** Demande au navigateur de ne pas purger nos données (sinon une carte peut disparaître avant le vol). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
