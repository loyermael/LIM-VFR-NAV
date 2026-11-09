/**
 * Écriture dans le stockage privé du navigateur (OPFS). `createSyncAccessHandle` n'existe que dans un Worker,
 * et c'est la seule méthode d'écriture disponible partout (y compris Safari sur iPhone/iPad).
 * Copie par blocs : un MBTiles de plusieurs centaines de Mo ne passe jamais entièrement en mémoire.
 */

const CHUNK = 4 * 1024 * 1024;

type WorkerRequest =
  | { id: number; type: "copy"; name: string; file: File }
  | { id: number; type: "write"; name: string; data: ArrayBuffer }
  | { id: number; type: "remove"; name: string };

/** Poignée d'accès synchrone (absente des types du navigateur : n'existe que dans un Worker). */
interface SyncAccess {
  truncate(size: number): void;
  write(buffer: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type SyncCapableHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccess> };

async function handle(name: string): Promise<SyncCapableHandle> {
  const root = await navigator.storage.getDirectory();
  return (await root.getFileHandle(name, { create: true })) as SyncCapableHandle;
}

// Ce fichier tourne dans un Worker ; le projet est compilé avec les types du navigateur, d'où ce typage minimal.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown): void;
};

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "remove") {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(req.name).catch(() => undefined);
    } else {
      const access = await (await handle(req.name)).createSyncAccessHandle();
      try {
        access.truncate(0);
        if (req.type === "write") {
          access.write(new Uint8Array(req.data), { at: 0 });
        } else {
          let offset = 0;
          while (offset < req.file.size) {
            const buf = new Uint8Array(await req.file.slice(offset, offset + CHUNK).arrayBuffer());
            access.write(buf, { at: offset });
            offset += buf.length;
            ctx.postMessage({ id: req.id, progress: offset / req.file.size });
          }
        }
        access.flush();
      } finally {
        access.close();
      }
    }
    ctx.postMessage({ id: req.id, done: true });
  } catch (err) {
    ctx.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
