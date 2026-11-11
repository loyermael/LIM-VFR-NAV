import { describe, expect, it } from "vitest";
import { importNavFiles, parseNavaids, parseObstacles, parseReporting } from "./navData";

const pt = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const file = (name: string, data: unknown) => new File([JSON.stringify(data)], name);

describe("données de navigation", () => {
  it("balises : champs lus, éléments sans position écartés", () => {
    const r = parseNavaids([{ name: "AUXERRE", identifier: "AX", type: 2, frequency: { value: "417.000", unit: 1 }, geometry: pt(3.5, 47.8), elevation: { value: 147, unit: 0 }, range: { value: 25, unit: 2 } }, { name: "X" }, null, { geometry: pt(500, 0) }]);
    expect(r).toEqual([{ lat: 47.8, lon: 3.5, name: "AUXERRE", ident: "AX", kind: 2, freq: "417.000", elevM: 147, rangeNm: 25 }]);
  });
  it("points de report et obstacles (hauteur parfois absente)", () => {
    expect(parseReporting([{ name: "NA", compulsory: true, geometry: pt(2.6, 50) }])[0]?.compulsory).toBe(true);
    const o = parseObstacles([{ name: "Obstacle", type: 0, geometry: pt(1, 46), height: { value: 80, unit: 0 }, what: "wind" }, { name: "Obstacle", type: 4, geometry: pt(1, 46) }]);
    expect(o.map((x) => x.heightM)).toEqual([80, null]);
    expect(o[0]?.what).toBe("wind");
  });
  it("un fichier qui n'est pas un tableau est signalé, sans casser les autres", async () => {
    const r = await importNavFiles([file("fr_nav.json", { pas: "un tableau" }), file("fr_rpp.json", [{ name: "A", geometry: pt(1, 45) }]), file("manifest.json", { files: [{ name: "fr_nav.json", lastModified: "Wed, 11 Nov 2026 01:55:39 GMT" }] })], 5);
    expect(r.problems).toHaveLength(1);
    expect(r.dataset.reporting).toHaveLength(1);
    expect(r.dataset.meta.exportedAtMs).toBe(Date.parse("Wed, 11 Nov 2026 01:55:39 GMT"));
  });
});
