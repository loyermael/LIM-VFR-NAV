import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIT_PREFS, formatAngle, formatQuantity, fromSI, parseUnitPrefs, toSI, unitLabel, type UnitPrefs,
} from "./display";
import { knotsToMps, knots, feet, feetToMeters } from "./units";

const base = DEFAULT_UNIT_PREFS;
const with_ = (p: Partial<UnitPrefs>): UnitPrefs => ({ ...base, ...p });

describe("conversion d'affichage", () => {
  it("100 kt = 185,2 km/h = 115,08 mph", () => {
    const v = knotsToMps(knots(100));
    expect(fromSI("groundSpeed", base, v)).toBeCloseTo(100, 9);
    expect(fromSI("groundSpeed", with_({ groundSpeed: "kmh" }), v)).toBeCloseTo(185.2, 6);
    expect(fromSI("groundSpeed", with_({ groundSpeed: "mph" }), v)).toBeCloseTo(115.078, 2);
  });
  it("1000 ft = 304,8 m ; 1 NM = 1,852 km", () => {
    expect(fromSI("altitude", with_({ altitude: "m" }), feetToMeters(feet(1000)))).toBeCloseTo(304.8, 9);
    expect(fromSI("distance", with_({ distance: "km" }), 1852)).toBeCloseTo(1.852, 9);
    expect(fromSI("distance", with_({ distance: "sm" }), 1609.344)).toBeCloseTo(1, 9);
  });
  it("1013,25 hPa = 29,92 inHg ; 500 ft/min = 2,54 m/s", () => {
    expect(fromSI("pressure", with_({ pressure: "inhg" }), 101325)).toBeCloseTo(29.92, 2);
    expect(fromSI("verticalSpeed", with_({ verticalSpeed: "ms" }), feetToMeters(feet(500)) / 60)).toBeCloseTo(2.54, 3);
  });
  it("aller-retour pour toutes les combinaisons d'unités", () => {
    for (const s of ["kt", "kmh", "mph", "ms"] as const)
      expect(toSI("groundSpeed", with_({ groundSpeed: s }), fromSI("groundSpeed", with_({ groundSpeed: s }), 51.4))).toBeCloseTo(51.4, 9);
    for (const d of ["nm", "km", "sm", "m"] as const)
      expect(toSI("distance", with_({ distance: d }), fromSI("distance", with_({ distance: d }), 12345))).toBeCloseTo(12345, 9);
  });
});

describe("affichage", () => {
  it("arrondi selon l'unité et « --- » si la valeur n'existe pas", () => {
    expect(formatQuantity("groundSpeed", base, knotsToMps(knots(95.4)))).toBe("95");
    expect(formatQuantity("distance", base, 1852 * 12.44)).toBe("12.4");
    expect(formatQuantity("groundSpeed", base, Number.NaN)).toBe("---");
    expect(formatQuantity("altitude", base, Number.POSITIVE_INFINITY)).toBe("---");
  });
  it("libellés, angle vrai ou magnétique toujours indiqué", () => {
    expect(unitLabel("groundSpeed", with_({ groundSpeed: "kmh" }))).toBe("km/h");
    expect(unitLabel("track", base)).toBe("°M");
    expect(unitLabel("bearing", with_({ bearing: "true" }))).toBe("°V");
  });
});

describe("parseUnitPrefs", () => {
  it("valeurs inconnues ou données corrompues → défauts, champ par champ", () => {
    expect(parseUnitPrefs(null)).toEqual(base);
    expect(parseUnitPrefs("n'importe quoi")).toEqual(base);
    expect(parseUnitPrefs({ groundSpeed: "furlong", altitude: "m" })).toEqual({ ...base, altitude: "m" });
  });
  it("accepte des préférences valides", () => {
    const p = with_({ groundSpeed: "kmh", distance: "km", track: "true" });
    expect(parseUnitPrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe("formatAngle", () => {
  it("3 chiffres, 360 devient 000, inconnu devient ---", () => {
    expect(formatAngle(90)).toBe("090");
    expect(formatAngle(5.4)).toBe("005");
    expect(formatAngle(359.6)).toBe("000");
    expect(formatAngle(0)).toBe("000");
    expect(formatAngle(-10)).toBe("350");
    expect(formatAngle(null)).toBe("---");
    expect(formatAngle(Number.NaN)).toBe("---");
  });
});
