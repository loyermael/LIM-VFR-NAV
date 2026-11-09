import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { flightValues } from "./flightValues";
import { Geoid } from "./geoid";
import { magneticVariation } from "./magnetic";
import { meters, metersPerSecond } from "./units";
import { trueDeg } from "./angles";
import type { GpsFix } from "./gps";

const file = fileURLToPath(new URL("../../../apps/app/public/data/egm96.bin", import.meta.url));
const buf = readFileSync(file);
const geoid = new Geoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const date = new Date("2026-11-09T12:00:00Z");

const fix = (over: Partial<GpsFix> = {}): GpsFix => ({
  timeMs: date.getTime(),
  position: { lat: 46.5, lon: 2.5 },
  altitude: meters(1000),
  altitudeReference: "msl",
  groundSpeed: metersPerSecond(50),
  track: trueDeg(90),
  accuracy: meters(5),
  ...over,
});

describe("valeurs de vol", () => {
  it("route magnétique = route vraie − variation", () => {
    const v = flightValues(fix(), geoid, date);
    const expected = magneticVariation({ lat: 46.5, lon: 2.5 }, date).variation;
    expect(v.trackTrue).toBe(90);
    expect(v.trackMagnetic).toBeCloseTo(90 - expected, 9);
  });
  it("altitude déjà AMSL : inchangée", () => {
    expect(flightValues(fix(), geoid, date).altitudeMsl).toBe(1000);
  });
  it("hauteur ellipsoïdale : corrigée du géoïde (≈ −40 à −55 m en France)", () => {
    const v = flightValues(fix({ altitudeReference: "ellipsoid", altitude: meters(1000) }), geoid, date);
    expect(v.altitudeMsl!).toBeGreaterThan(945);
    expect(v.altitudeMsl!).toBeLessThan(960);
  });
  it("hauteur ellipsoïdale sans géoïde chargé : pas de valeur plutôt qu'une valeur fausse", () => {
    const v = flightValues(fix({ altitudeReference: "ellipsoid" }), null, date);
    expect(v.altitudeMsl).toBeNull();
  });
  it("vitesse trop faible : pas de route ; altitude inconnue : null", () => {
    const v = flightValues(fix({ groundSpeed: metersPerSecond(0.2), altitude: null }), geoid, date);
    expect(v.trackTrue).toBeNull();
    expect(v.trackMagnetic).toBeNull();
    expect(v.altitudeMsl).toBeNull();
  });
});
