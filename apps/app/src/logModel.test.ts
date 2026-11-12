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
      legs: [{ rm: "165", cm: "179", d: "24", tsv: "11'", tav: "11'", he: "10:31", z: "1000", trend: "level" as const, dsd: "0", dta: "24" }],
      totals: { d: "24", dUnit: "km", tsv: "11'", tav: "11'", fuel: "2.3" },
    };
    const bytes = await buildLogPdf({ model, form: { atis: "118.255 / QNH 1018", note0: "123.500 - 600" } });
    expect(bytes.length).toBeGreaterThan(2000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});

import { buildAutoFields } from "./logModel";
import { DEFAULT_FUEL_PLAN } from "./aircraftStore";

describe("log : champs préremplis", () => {
  const prefs = { ...DEFAULT_UNIT_PREFS, fuel: "l", altitude: "ft", distance: "km" } as typeof DEFAULT_UNIT_PREFS;
  const ad = (icao: string, lat: number, len: number) => ({
    id: icao, name: icao, icao, type: 0, position: { lat, lon: 2 }, elevation: 300, private: false,
    frequencies: [{ name: "A/A", mhz: "123.500", primary: true }], runways: [{ designator: "04/22", trueHeading: 40, lengthM: len, paved: true }],
  });
  const input = {
    prefs, aircraft: { fuel: { capacity: 100, unusable: 5, density: 0.72 }, stations: [{ id: "f", kind: "fuel" }] } as never,
    loads: { f: 60 }, plan: DEFAULT_FUEL_PLAN, flow: 20,
    route: { departureMs: Date.UTC(2026, 5, 1, 8, 0) } as never,
    log: { legs: [{ from: { name: "A", position: { lat: 45, lon: 2 } }, to: { name: "B", position: { lat: 45.5, lon: 2 } } }], totals: { fuel: 10, timeWithWind: 3600 } } as never,
    airfields: [ad("LFAA", 45, 1500), ad("LFBB", 45.5, 900)] as never,
  };
  it("carburant : embarqué, autonomie, restant à l'arrivée", () => {
    const o = buildAutoFields(input);
    expect(o["fStart"]).toBe("60.0 L");
    expect(o["fAuto"]).toBe("3:00:00");
    expect(o["fStop"]).toBe("50.0 L");
  });
  it("aérodromes de départ et d'arrivée, pistes et fréquences", () => {
    const o = buildAutoFields(input);
    expect(o["dep"]).toBe("LFAA");
    expect(o["arr"]).toBe("LFBB");
    expect(o["toda2"]).toBe("~900 m");
    expect(o["arrival"]).toContain("123.500");
    expect(o["arrival"]).toContain("04/22 900 m dur");
  });
  it("sans carburant embarqué : carburant minimal annoncé", () => {
    const o = buildAutoFields({ ...input, loads: {} });
    expect(o["fStart"]).toMatch(/^mini /);
  });
});
