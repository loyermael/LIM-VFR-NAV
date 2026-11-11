import { describe, expect, it } from "vitest";
import { PackError, datasetsToUpdate, parseInstalled, parsePackManifest, sha256Hex, type PackManifest } from "./dataPack";

const enc = (s: string) => new TextEncoder().encode(s);
const hash = (s: string) => sha256Hex(enc(s).buffer as ArrayBuffer);

async function manifestFor(body: string, over: Record<string, unknown> = {}): Promise<unknown> {
  return {
    format: "lim-nav-data", version: 1, generatedAt: "2026-11-11T00:00:00Z",
    countries: [{ code: "fr", name: "France", datasets: [{
      id: "aero", title: "Aéro", updatedAt: "2026-11-11T01:00:00Z", maxAgeHours: 24, source: "openAIP", licence: "CC BY-NC 4.0",
      files: [{ path: "fr/aero/a.json", bytes: enc(body).length, sha256: await hash(body) }], ...over,
    }] }],
  };
}

describe("manifeste du paquet", () => {
  it("valide un manifeste correct", async () => {
    const m = parsePackManifest(await manifestFor("[]"));
    expect(m.countries[0]!.datasets[0]!.files[0]!.path).toBe("fr/aero/a.json");
  });
  it.each([
    ["format", { format: "x" }],
    ["version", { version: 2 }],
    ["pays", { countries: "x" }],
  ])("refuse : %s", async (_n, over) => {
    const base = (await manifestFor("[]")) as object;
    expect(() => parsePackManifest({ ...base, ...over })).toThrow(PackError);
  });
  it.each(["../secret.json", "/etc/passwd", "https://evil.example/x.json", "fr/../../x.json"])("refuse le chemin de fichier %s", async (path) => {
    const bad = await manifestFor("[]", { files: [{ path, bytes: 2, sha256: "a".repeat(64) }] });
    expect(() => parsePackManifest(bad)).toThrow(PackError);
  });
  it("refuse une empreinte mal formée ou une date illisible", async () => {
    expect(() => parsePackManifest(manifestFor("[]", { files: [{ path: "a.json", bytes: 2, sha256: "xyz" }] }))).toThrow(PackError); // une promesse n'est pas un manifeste
    const badHash = await manifestFor("[]", { files: [{ path: "a.json", bytes: 2, sha256: "xyz" }] });
    expect(() => parsePackManifest(badHash)).toThrow(PackError);
    expect(() => parsePackManifest({ format: "lim-nav-data", version: 1, countries: [{ code: "fr", name: "F", datasets: [{ id: "a", title: "t", updatedAt: "pas une date", maxAgeHours: 1, files: [] }] }] })).toThrow(PackError);
    expect(() => parsePackManifest(null)).toThrow(PackError);
  });
});

describe("quels jeux télécharger", () => {
  const m = (updatedAt: string): PackManifest => ({
    format: "lim-nav-data", version: 1, generatedAt: "", countries: [{ code: "fr", name: "France", datasets: [
      { id: "aero", title: "", updatedAt, maxAgeHours: 24, live: false, source: "", licence: "", files: [] },
      { id: "weather", title: "", updatedAt: "2026-11-11T08:00:00Z", maxAgeHours: 1, live: true, source: "", licence: "", files: [] },
    ] }],
  });
  it("aucun package installé : seules les données vivantes (météo) se téléchargent", () => {
    expect(datasetsToUpdate(m("2026-11-11T01:00:00Z"), { country: null, datasets: {} }).map((d) => d.id)).toEqual(["weather"]);
  });
  it("pays choisi, rien d'installé : tout", () => {
    expect(datasetsToUpdate(m("2026-11-11T01:00:00Z"), { country: "fr", datasets: {} }).map((d) => d.id)).toEqual(["aero", "weather"]);
  });
  it("seulement ce qui est plus récent que l'installé", () => {
    const inst = { country: "fr", datasets: { aero: { updatedAt: "2026-11-11T01:00:00Z", checkedAt: 1 }, weather: { updatedAt: "2026-11-11T07:00:00Z", checkedAt: 1 } } };
    expect(datasetsToUpdate(m("2026-11-11T01:00:00Z"), inst).map((d) => d.id)).toEqual(["weather"]);
    expect(datasetsToUpdate(m("2026-11-12T01:00:00Z"), inst).map((d) => d.id)).toEqual(["aero", "weather"]);
  });
  it("package absent du manifeste : traité comme non installé (météo seule)", () => {
    expect(datasetsToUpdate(m("2026-11-11T01:00:00Z"), { country: "ch", datasets: {} }).map((d) => d.id)).toEqual(["weather"]);
  });
});

describe("état mémorisé", () => {
  it("valeurs valides gardées, le reste écarté", () => {
    expect(parseInstalled({ country: "fr", datasets: { aero: { updatedAt: "2026-11-11T01:00:00Z", checkedAt: 5 }, bad: { updatedAt: "x", checkedAt: 1 }, bad2: 3 } }))
      .toEqual({ country: "fr", datasets: { aero: { updatedAt: "2026-11-11T01:00:00Z", checkedAt: 5 } } });
    expect(parseInstalled(null)).toEqual({ country: null, datasets: {} });
    expect(parseInstalled({ country: "France" }).country).toBeNull();
  });
});
