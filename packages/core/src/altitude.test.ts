import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALTITUDE_SETTINGS, STANDARD_QNH, altitudeForDisplay, calibrationOffset, flightLevelOf,
  isPlausibleQnh, parseStoredAltitude, pressureAltitudeOf, type AltitudeSettings,
} from "./altitude";
import { feet, feetToMeters, hpaToPa, hectopascals, meters } from "./units";

const hpa = (v: number) => hpaToPa(hectopascals(v));
const settings = (over: Partial<AltitudeSettings> = {}): AltitudeSettings => ({ ...DEFAULT_ALTITUDE_SETTINGS, ...over });

describe("altitude pression (atmosphère standard)", () => {
  it("1013,25 hPa → 0 m", () => expect(pressureAltitudeOf(STANDARD_QNH)).toBeCloseTo(0, 9));
  it("pression ISA à 1500 m (84 559,9 Pa) → 1500 m ± 2 m", () => {
    expect(pressureAltitudeOf(hpaToPa(hectopascals(845.599)))).toBeCloseTo(1500, -1);
    expect(Math.abs(pressureAltitudeOf(hpaToPa(hectopascals(845.599))) - 1500)).toBeLessThan(2);
  });
  it("QNH 1003,25 (10 hPa de moins) → environ +83 m, soit 27 ft/hPa", () => {
    const d = pressureAltitudeOf(hpa(1003.25));
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(86);
  });
  it("QNH élevé → altitude pression négative", () => expect(pressureAltitudeOf(hpa(1030))).toBeLessThan(0));
});

describe("altitude affichée", () => {
  const gps = meters(1000);
  it("mode QNH : altitude GPS plus calage", () => {
    expect(altitudeForDisplay(gps, settings({ offset: meters(-12) }))).toBe(988);
  });
  it("mode GPS : brute, sans calage", () => {
    expect(altitudeForDisplay(gps, settings({ mode: "gps", offset: meters(-12) }))).toBe(1000);
  });
  it("mode niveau de vol : plus l'altitude pression du QNH (QNH bas → FL plus haut que l'altitude)", () => {
    const fl = altitudeForDisplay(gps, settings({ mode: "fl", qnh: hpa(1003.25) }))!;
    expect(fl).toBeGreaterThan(1080);
    expect(flightLevelOf(fl)).toBe(36); // ≈ 3 560 ft
  });
  it("QNH standard : le niveau de vol correspond à l'altitude", () => {
    const fl = altitudeForDisplay(feetToMeters(feet(6500)), settings({ mode: "fl" }))!;
    expect(flightLevelOf(fl)).toBe(65);
  });
  it("altitude GPS inconnue → null dans tous les modes", () => {
    for (const mode of ["qnh", "gps", "fl"] as const) expect(altitudeForDisplay(null, settings({ mode }))).toBeNull();
  });
});

describe("calage sur un terrain", () => {
  it("le décalage fait afficher l'altitude connue", () => {
    const gps = meters(361);
    const known = meters(300);
    const off = calibrationOffset(gps, known);
    expect(altitudeForDisplay(gps, settings({ offset: off }))).toBe(300);
  });
});

describe("QNH plausible", () => {
  it("accepte 940–1060, refuse le reste", () => {
    expect(isPlausibleQnh(1013)).toBe(true);
    expect(isPlausibleQnh(940)).toBe(true);
    expect(isPlausibleQnh(939)).toBe(false);
    expect(isPlausibleQnh(10130)).toBe(false);
    expect(isPlausibleQnh(Number.NaN)).toBe(false);
  });
});

describe("réglages mémorisés", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("rien ou n'importe quoi → défauts", () => {
    expect(parseStoredAltitude(null, now).settings).toEqual(DEFAULT_ALTITUDE_SETTINGS);
    expect(parseStoredAltitude("x", now).settings).toEqual(DEFAULT_ALTITUDE_SETTINGS);
  });
  it("QNH récent conservé", () => {
    const r = parseStoredAltitude({ mode: "fl", qnhHpa: 1021, qnhSetAtMs: now - 3_600_000, offsetM: 5, offsetSetAtMs: now - 1000 }, now);
    expect(r.settings.mode).toBe("fl");
    expect(r.settings.qnh).toBe(102100);
    expect(r.settings.offset).toBe(5);
    expect(r.qnhExpired).toBe(false);
  });
  it("QNH de plus de 6 h abandonné et signalé", () => {
    const r = parseStoredAltitude({ mode: "qnh", qnhHpa: 1021, qnhSetAtMs: now - 7 * 3_600_000 }, now);
    expect(r.settings.qnh).toBe(STANDARD_QNH);
    expect(r.qnhExpired).toBe(true);
  });
  it("QNH invraisemblable, date future ou calage absurde : ignorés", () => {
    expect(parseStoredAltitude({ qnhHpa: 5, qnhSetAtMs: now }, now).settings.qnh).toBe(STANDARD_QNH);
    expect(parseStoredAltitude({ qnhHpa: 1021, qnhSetAtMs: now + 1000 }, now).settings.qnh).toBe(STANDARD_QNH);
    expect(parseStoredAltitude({ offsetM: 99999, offsetSetAtMs: now }, now).settings.offset).toBe(0);
  });
  it("calage sans date, ou de plus de 6 h : abandonné", () => {
    expect(parseStoredAltitude({ offsetM: 5 }, now).settings.offset).toBe(0);
    expect(parseStoredAltitude({ offsetM: 5, offsetSetAtMs: now - 7 * 3_600_000 }, now).settings.offset).toBe(0);
  });
});
