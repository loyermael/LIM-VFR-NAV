import { describe, expect, it } from "vitest";
import { PackError, parsePackManifest, sha256Hex, type PackDataset } from "./dataPack";
import { AbortedError, downloadDataset, fetchJson } from "./packDownload";

const enc = (s: string) => new TextEncoder().encode(s);

async function dataset(...bodies: string[]): Promise<PackDataset> {
  const files = await Promise.all(bodies.map(async (b, i) => ({ path: `fr/x/f${i}.json`, bytes: enc(b).length, sha256: await sha256Hex(enc(b).buffer as ArrayBuffer) })));
  return parsePackManifest({ format: "lim-nav-data", version: 1, countries: [{ code: "fr", name: "France", datasets: [{ id: "x", title: "X", updatedAt: "2026-11-11T00:00:00Z", maxAgeHours: 1, files }] }] }).countries[0]!.datasets[0]!;
}

/** Réponse livrée en plusieurs morceaux ; `stallAfter` : plus aucun octet après ce nombre de morceaux. */
function streamed(body: string, chunks = 4, stallAfter = Infinity): Response {
  const b = enc(body);
  const size = Math.ceil(b.length / chunks);
  let i = 0;
  const rs = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (i >= stallAfter) return new Promise<void>(() => undefined); // bloqué : ne rend jamais la main
      if (i * size >= b.length) { ctl.close(); return; }
      ctl.enqueue(b.slice(i * size, (i + 1) * size));
      i++;
    },
  });
  return new Response(rs);
}
const fast = { backoffMs: 1, idleTimeoutMs: 200 };

describe("téléchargement avec progression", () => {
  it("rapporte des pourcentages croissants jusqu'à 100 % sur plusieurs fichiers", async () => {
    const ds = await dataset("a".repeat(100), "b".repeat(300));
    const seen: number[] = [];
    const files = await downloadDataset("https://x.example", ds, {
      ...fast,
      fetchFn: (async (u: string) => streamed(u.endsWith("f0.json") ? "a".repeat(100) : "b".repeat(300))) as unknown as typeof fetch,
      onProgress: (l, t) => { expect(t).toBe(400); seen.push(l); },
    });
    expect(files).toHaveLength(2);
    expect(seen[seen.length - 1]).toBe(400);
    expect(seen.every((v, i) => i === 0 || v >= (seen[i - 1] as number))).toBe(true);
    expect(seen.length).toBeGreaterThan(3); // progression par morceaux, pas seulement à la fin
    expect(seen.some((v) => v > 0 && v < 400)).toBe(true);
  });
});

describe("téléchargement fiable", () => {
  it("contenu altéré de même taille : refusé après les nouveaux essais (SHA-256)", async () => {
    const ds = await dataset('{"a":1}');
    await expect(downloadDataset("https://x.example", ds, { ...fast, retries: 1, fetchFn: (async () => streamed('{"a":2}')) as unknown as typeof fetch })).rejects.toThrow(/SHA-256/);
  });
  it("fichier tronqué : refusé (taille)", async () => {
    const ds = await dataset('{"a":1}');
    await expect(downloadDataset("https://x.example", ds, { ...fast, retries: 0, fetchFn: (async () => streamed('{"a"')) as unknown as typeof fetch })).rejects.toThrow(/taille/);
  });
  it("erreur HTTP : refusée", async () => {
    const ds = await dataset("[]");
    await expect(downloadDataset("https://x.example", ds, { ...fast, retries: 0, fetchFn: (async () => new Response("", { status: 404 })) as unknown as typeof fetch })).rejects.toThrow(/404/);
  });
  it("réseau coupé au premier essai, bon au deuxième : réussit (nouvel essai automatique)", async () => {
    const ds = await dataset('{"ok":true}');
    let calls = 0;
    const files = await downloadDataset("https://x.example", ds, {
      ...fast,
      fetchFn: (async () => { if (++calls === 1) throw new TypeError("Failed to fetch"); return streamed('{"ok":true}'); }) as unknown as typeof fetch,
    });
    expect(calls).toBe(2);
    expect(await files[0]!.text()).toBe('{"ok":true}');
  });
  it("flux bloqué (plus aucun octet) : abandonné après le délai, puis nouvel essai qui réussit — jamais d'attente infinie", async () => {
    const body = "z".repeat(200);
    const ds = await dataset(body);
    let calls = 0;
    const t0 = Date.now();
    const files = await downloadDataset("https://x.example", ds, {
      ...fast,
      fetchFn: (async () => (++calls === 1 ? streamed(body, 4, 1) : streamed(body))) as unknown as typeof fetch,
    });
    expect(calls).toBe(2);
    expect(files).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("serveur qui ne répond jamais : erreur claire après les essais, pas de blocage", async () => {
    const ds = await dataset("[]");
    const hang = ((_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(downloadDataset("https://x.example", ds, { ...fast, retries: 1, fetchFn: hang })).rejects.toThrow(/pas de réponse/);
  });
  it("annulation par l'utilisateur : arrêt immédiat, sans nouvel essai", async () => {
    const ds = await dataset("a".repeat(100));
    const ctl = new AbortController();
    let calls = 0;
    const p = downloadDataset("https://x.example", ds, {
      ...fast, signal: ctl.signal,
      fetchFn: (async () => { calls++; return streamed("a".repeat(100), 4, 1); }) as unknown as typeof fetch,
      onProgress: () => ctl.abort(),
    });
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(calls).toBe(1);
  });
});

describe("manifeste avec délai", () => {
  it("lit un JSON correct", async () => {
    expect(await fetchJson("https://x.example/m.json", { fetchFn: (async () => new Response('{"a":1}')) as unknown as typeof fetch })).toEqual({ a: 1 });
  });
  it("serveur muet : erreur claire après le délai", async () => {
    const hang = ((_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    await expect(fetchJson("https://x.example/m.json", { fetchFn: hang, timeoutMs: 50, retries: 1, backoffMs: 1 })).rejects.toBeInstanceOf(PackError);
  });
  it("HTTP 500 puis 200 : le nouvel essai réussit", async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? new Response("", { status: 500 }) : new Response("[1]"))) as unknown as typeof fetch;
    expect(await fetchJson("https://x.example/m.json", { fetchFn: f, backoffMs: 1 })).toEqual([1]);
  });
});

describe("fetch par défaut", () => {
  it("appelé sans contexte d'objet, comme l'exige le navigateur (« Illegal invocation » sinon)", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("[7]"));
    } as unknown as typeof fetch;
    try {
      expect(await fetchJson("https://x.example/m.json")).toEqual([7]);
      const ds = await dataset("[7]");
      const files = await downloadDataset("https://x.example", ds, { ...fast, retries: 0 });
      expect(files).toHaveLength(1);
    } finally {
      globalThis.fetch = real;
    }
  });
});
