import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectWxKind, importWxFiles } from "./wxData";

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../../../packages/core/src/fixtures/weather/${name}.json`, import.meta.url)), "utf8");
const file = (name: string, content: string, lastModified = 1_700_000_000_000) => new File([content], name, { lastModified });
const manifest = JSON.stringify({ downloadedAt: "2026-11-10T06:31:23.784Z", files: [] });

describe("reconnaissance des fichiers météo", () => {
  it("par la structure : METAR, TAF, SIGMET, manifeste", () => {
    expect(detectWxKind(JSON.parse(fx("metar")))).toBe("metar");
    expect(detectWxKind(JSON.parse(fx("taf")))).toBe("taf");
    expect(detectWxKind(JSON.parse(fx("isigmet")))).toBe("sigmet");
    expect(detectWxKind(JSON.parse(manifest))).toBe("manifest");
    expect(detectWxKind({ x: 1 })).toBeNull();
    expect(detectWxKind([])).toBeNull();
    expect(detectWxKind([{ a: 1 }])).toBeNull();
    expect(detectWxKind(null)).toBeNull();
  });
});

describe("import des fichiers météo", () => {
  it("avec manifeste : date de téléchargement exacte pour tous les jeux", async () => {
    const out = await importWxFiles([file("metar.json", fx("metar")), file("taf.json", fx("taf")), file("isigmet.json", fx("isigmet")), file("manifest.json", manifest)]);
    expect(out.problems).toEqual([]);
    expect(out.sets.map((s) => s.id).sort()).toEqual(["metar", "sigmet", "taf"]);
    for (const s of out.sets) {
      expect(s.meta.exactDate).toBe(true);
      expect(s.meta.fetchedAtMs).toBe(Date.parse("2026-11-10T06:31:23.784Z"));
    }
    expect(out.sets.find((s) => s.id === "metar")!.meta.count).toBe(10);
  });
  it("sans manifeste : date du fichier, marquée approximative", async () => {
    const out = await importWxFiles([file("metar.json", fx("metar"), 1_750_000_000_000)]);
    expect(out.sets[0]!.meta.exactDate).toBe(false);
    expect(out.sets[0]!.meta.fetchedAtMs).toBe(1_750_000_000_000);
  });
  it("fichiers inutilisables : problème signalé, rien d'inventé", async () => {
    const out = await importWxFiles([file("a.json", "pas du json"), file("b.json", JSON.stringify({ a: 1 }))]);
    expect(out.sets).toEqual([]);
    expect(out.problems).toHaveLength(2);
    expect(out.problems[0]).toMatch(/illisible/);
    expect(out.problems[1]).toMatch(/non reconnu/);
  });
});
