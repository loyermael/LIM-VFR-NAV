import { describe, expect, it } from "vitest";
import { DEFAULT_ALTITUDE_SETTINGS, parseStoredAltitude, STANDARD_QNH, type AltitudeSettings } from "./altitude";
import { altitudeResult } from "./altitudeSource";
import { pressureAtAltitude } from "./baro";
import { hectopascals, hpaToPa, meters } from "./units";

const s = (over: Partial<AltitudeSettings> = {}): AltitudeSettings => ({ ...DEFAULT_ALTITUDE_SETTINGS, ...over });
const p1000 = pressureAtAltitude(meters(1000));

describe("source de l'altitude", () => {
  it("source GPS : on ignore le baromètre", () => {
    const r = altitudeResult(meters(1200), p1000, s({ source: "gps" }));
    expect(r.origin).toBe("gps");
    expect(r.value).toBe(1200);
  });
  it("source baromètre, mode QNH : altitude indiquée (QNH standard → altitude pression)", () => {
    const r = altitudeResult(meters(1200), p1000, s({ source: "baro", qnh: STANDARD_QNH }));
    expect(r.origin).toBe("baro");
    expect(r.value).toBeCloseTo(1000, 6);
  });
  it("source baromètre, mode QNH : un QNH plus bas fait baisser l'altitude indiquée", () => {
    const r = altitudeResult(null, p1000, s({ source: "baro", qnh: hpaToPa(hectopascals(1003.25)) }));
    expect(r.value!).toBeLessThan(920);
  });
  it("source baromètre, niveau de vol : altitude pression, indépendante du QNH", () => {
    const r = altitudeResult(null, p1000, s({ source: "baro", mode: "fl", qnh: hpaToPa(hectopascals(1003.25)) }));
    expect(r.value).toBeCloseTo(1000, 6);
  });
  it("le calage terrain (offset) ne touche pas le baromètre", () => {
    const r = altitudeResult(null, p1000, s({ source: "baro", offset: meters(-50) }));
    expect(r.value).toBeCloseTo(1000, 6);
  });
  it("baromètre demandé mais muet : repli sur le GPS, signalé par l'origine", () => {
    const r = altitudeResult(meters(1200), null, s({ source: "baro" }));
    expect(r.origin).toBe("gps");
    expect(r.value).toBe(1200);
  });
  it("mode GPS brute : toujours le GPS, même avec un baromètre", () => {
    const r = altitudeResult(meters(1200), p1000, s({ source: "baro", mode: "gps" }));
    expect(r.origin).toBe("gps");
    expect(r.value).toBe(1200);
  });
  it("ni baromètre ni GPS : null", () => {
    expect(altitudeResult(null, null, s({ source: "baro" })).value).toBeNull();
  });
});

describe("source mémorisée", () => {
  it("relit la source ; valeur inconnue → GPS", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(parseStoredAltitude({ source: "baro" }, now).settings.source).toBe("baro");
    expect(parseStoredAltitude({ source: "radar" }, now).settings.source).toBe("gps");
    expect(parseStoredAltitude(null, now).settings.source).toBe("gps");
  });
});
