import { describe, expect, it } from "vitest";
import { detectKind, importAeroFiles, manifestDates } from "./datasets";

const file = (name: string, content: unknown, lastModified = 1_700_000_000_000) =>
  new File([JSON.stringify(content)], name, { lastModified });
const asp = [{ _id: "a", name: "TMA X", type: 7, icaoClass: 3, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, lowerLimit: { value: 1500, unit: 1, referenceDatum: 1 }, upperLimit: { value: 65, unit: 6, referenceDatum: 2 } }];
const apt = [{ _id: "t", name: "TERRAIN", icaoCode: "LFXX", type: 2, geometry: { type: "Point", coordinates: [2, 46] } }];

describe("reconnaissance des fichiers", () => {
  it("par la structure, pas par le nom", () => {
    expect(detectKind(asp)).toBe("airspaces");
    expect(detectKind(apt)).toBe("airfields");
    expect(detectKind({ files: [] })).toBe("manifest");
    expect(detectKind({ autre: 1 })).toBeNull();
    expect(detectKind([])).toBeNull();
    expect(detectKind("x")).toBeNull();
  });
  it("dates d'export du manifeste, valeurs invalides ignorées", () => {
    const m = manifestDates({ files: [{ name: "fr_asp.json", lastModified: "Mon, 09 Nov 2026 01:51:07 GMT" }, { name: "x", lastModified: "pas une date" }, { lastModified: "Mon, 09 Nov 2026 01:51:07 GMT" }] });
    expect(m.get("fr_asp.json")).toBe(Date.parse("2026-11-09T01:51:07Z"));
    expect(m.size).toBe(1);
  });
});

describe("import de fichiers aéronautiques", () => {
  it("avec manifeste : la date d'export du manifeste l'emporte sur la date du fichier", async () => {
    const out = await importAeroFiles(
      [file("fr_asp.json", asp), file("fr_apt.json", apt), file("manifest.json", { files: [{ name: "fr_asp.json", lastModified: "Mon, 09 Nov 2026 01:51:07 GMT" }] })],
      5,
    );
    expect(out.problems).toEqual([]);
    const a = out.datasets.find((d) => d.id === "airspaces")!;
    const t = out.datasets.find((d) => d.id === "airfields")!;
    expect(a.meta.exportedAtMs).toBe(Date.parse("2026-11-09T01:51:07Z"));
    expect(a.meta.exactDate).toBe(true);
    expect(t.meta.exactDate).toBe(false); // pas dans le manifeste : date du fichier, signalée comme approximative
    expect(t.meta.exportedAtMs).toBe(1_700_000_000_000);
    expect(a.meta.count).toBe(1);
  });
  it("sans manifeste : date du fichier, marquée approximative", async () => {
    const out = await importAeroFiles([file("fr_asp.json", asp, 1_750_000_000_000)], 5);
    expect(out.datasets[0]!.meta.exactDate).toBe(false);
    expect(out.datasets[0]!.meta.exportedAtMs).toBe(1_750_000_000_000);
  });
  it("fichiers inutilisables : problème signalé, rien d'inventé", async () => {
    const bad = new File(["pas du json"], "x.json");
    const out = await importAeroFiles([bad, file("autre.json", { a: 1 })], 5);
    expect(out.datasets).toEqual([]);
    expect(out.problems).toHaveLength(2);
    expect(out.problems[0]).toMatch(/illisible/);
    expect(out.problems[1]).toMatch(/non reconnu/);
  });
  it("décompte des enregistrements écartés", async () => {
    const out = await importAeroFiles([file("fr_asp.json", [...asp, { name: "CASSÉ", type: 7, geometry: { type: "Polygon", coordinates: [[[0, 0]]] } }])], 5);
    expect(out.datasets[0]!.meta.count).toBe(1);
    expect(out.datasets[0]!.meta.skipped).toBe(1);
  });
});
