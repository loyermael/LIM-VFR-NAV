import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PREFS } from "@lim/core";
import { baseFactor, minutesText } from "./logModel";
import { buildLogPdf } from "./logPdf";

describe("log : facteur de base et durées", () => {
  const kmh = { ...DEFAULT_UNIT_PREFS, groundSpeed: "kmh", distance: "km" } as typeof DEFAULT_UNIT_PREFS;
  const kt = { ...DEFAULT_UNIT_PREFS, groundSpeed: "kt", distance: "nm" } as typeof DEFAULT_UNIT_PREFS;
  it("Fb = 60 / vitesse : 130 km/h → 0,46 min/km ; 85 kt → 0,71 min/NM", () => {
    expect(baseFactor(130 / 3.6, kmh)).toBeCloseTo(0.4615, 3);
    expect(baseFactor(85 * 1852 / 3600, kt)).toBeCloseTo(0.7059, 3);
    expect(baseFactor(0, kt)).toBeNull();
  });
  it("durées en minutes avec apostrophe", () => {
    expect(minutesText(11 * 60 + 20)).toBe("11'");
    expect(minutesText(3900)).toBe("1h05");
    expect(minutesText(null)).toBe("---");
  });
  it("le PDF du log se génère (A4 paysage)", async () => {
    const model = {
      route: "Test", aircraft: "F-TEST", vp: "130", vpUnit: "km/h", fb: "0.46", fbUnit: "min/km", conso: "12", consoUnit: "L/h",
      winds: { fl20: "270°/10", fl50: "---", fl100: "---" }, departure: "10:20",
      points: [{ name: "LFHV", freq: "118.255", alt: "1000" }, { name: "LFKL", freq: "", alt: "" }],
      legs: [{ rm: "165", cm: "179", d: "24", tsv: "11'", tav: "11'", he: "10:31" }],
      totals: { d: "24", dUnit: "km", tsv: "11'", tav: "11'", fuel: "2.3" },
    };
    const bytes = await buildLogPdf({ model, form: { atis: "118.255 / QNH 1018", note0: "123.500 - 600" } });
    expect(bytes.length).toBeGreaterThan(2000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
