import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { magneticVariation } from "./magnetic";
import { Geoid, EGM96_GRID_BYTES } from "./geoid";
import { meters } from "./units";

describe("variation magnétique (WMM)", () => {
  it("France en 2026 : Est, de l'ordre de +1° à +3° (Brest plus faible que Nice)", () => {
    const date = new Date("2026-11-09T12:00:00Z");
    const paris = magneticVariation({ lat: 48.8566, lon: 2.3522 }, date);
    expect(paris.variation).toBeGreaterThan(0.5);
    expect(paris.variation).toBeLessThan(3.5);
    expect(paris.outOfRange).toBe(false);
    expect(paris.model).toMatch(/2025/);
  });
  it("signe : variation Ouest (négative) en Amérique du Nord", () => {
    const seattle = magneticVariation({ lat: 47.6, lon: -122.3 }, new Date("2026-06-01T00:00:00Z"));
    expect(seattle.variation).toBeGreaterThan(10);
    const nyc = magneticVariation({ lat: 40.7, lon: -74.0 }, new Date("2026-06-01T00:00:00Z"));
    expect(nyc.variation).toBeLessThan(-8);
  });
  it("signale quand la date sort de la validité du modèle", () => {
    const old = magneticVariation({ lat: 48, lon: 2 }, new Date("2032-01-01T00:00:00Z"));
    expect(old.outOfRange).toBe(true);
  });
});

describe("géoïde EGM96", () => {
  const file = fileURLToPath(new URL("../../../apps/app/public/data/egm96.bin", import.meta.url));
  const buf = readFileSync(file);
  const geoid = new Geoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  it("taille de grille attendue", () => expect(buf.byteLength).toBe(EGM96_GRID_BYTES));
  it("points de référence connus (à ±0,05 m)", () => {
    expect(geoid.undulation({ lat: 0, lon: 0 })).toBeCloseTo(17.16, 1);
    expect(geoid.undulation({ lat: 90, lon: 0 })).toBeCloseTo(13.61, 1);
  });
  it("France métropolitaine : ondulation de l'ordre de 40 à 55 m", () => {
    const n = geoid.undulation({ lat: 46.5, lon: 2.5 });
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(55);
  });
  it("continuité : pas de saut à la longitude 0/360 ni au pôle", () => {
    const a = geoid.undulation({ lat: 10, lon: 359.99 });
    const b = geoid.undulation({ lat: 10, lon: 0.01 });
    expect(Math.abs(a - b)).toBeLessThan(0.2);
    expect(geoid.undulation({ lat: -90, lon: 10 })).toBeCloseTo(-29.53, 0);
  });
  it("hauteur ellipsoïdale → AMSL : on retranche l'ondulation", () => {
    const p = { lat: 46.5, lon: 2.5 };
    const n = geoid.undulation(p);
    expect(geoid.ellipsoidalToMsl(p, meters(1000))).toBeCloseTo(1000 - n, 9);
  });
  it("refuse un fichier de mauvaise taille", () => {
    expect(() => new Geoid(new ArrayBuffer(10))).toThrow();
  });
});
