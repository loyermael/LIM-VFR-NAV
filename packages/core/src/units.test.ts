import { describe, expect, it } from "vitest";
import {
  feet, feetToMeters, hectopascals, hpaToPa, knots, knotsToMps, meters, metersToFeet,
  metersToNm, mpsToKnots, nauticalMiles, nmToMeters, paToHpa,
} from "./units";
import {
  magDeg, magToTrue, normalize180, normalize360, relDeg, trueDeg, trueToMag, variationDeg,
} from "./angles";

describe("unités", () => {
  it("valeurs exactes de référence", () => {
    expect(feetToMeters(feet(1000))).toBeCloseTo(304.8, 10);
    expect(nmToMeters(nauticalMiles(1))).toBe(1852);
    expect(knotsToMps(knots(1))).toBeCloseTo(0.514444, 6);
    expect(hpaToPa(hectopascals(1013.25))).toBeCloseTo(101325, 6);
  });
  it("aller-retour", () => {
    expect(metersToFeet(feetToMeters(feet(4500)))).toBeCloseTo(4500, 9);
    expect(metersToNm(nmToMeters(nauticalMiles(37.5)))).toBeCloseTo(37.5, 9);
    expect(mpsToKnots(knotsToMps(knots(95)))).toBeCloseTo(95, 9);
    expect(paToHpa(hpaToPa(hectopascals(1020)))).toBeCloseTo(1020, 9);
    expect(metersToFeet(meters(0))).toBe(0);
  });
});

describe("angles", () => {
  it("normalise", () => {
    expect(normalize360(-10)).toBe(350);
    expect(normalize360(360)).toBe(0);
    expect(normalize360(725)).toBe(5);
    expect(normalize180(190)).toBe(-170);
    expect(normalize180(180)).toBe(180);
    expect(normalize180(-180)).toBe(180);
    expect(relDeg(270)).toBe(-90);
  });
  it("vrai ↔ magnétique (variation Est positive : MAG = TRUE − VAR)", () => {
    // France métropolitaine ≈ +1° E : route vraie 090 → magnétique 089
    expect(trueToMag(trueDeg(90), variationDeg(1))).toBe(89);
    expect(magToTrue(magDeg(89), variationDeg(1))).toBe(90);
    // variation Ouest (négative) : magnétique plus grand que vrai
    expect(trueToMag(trueDeg(90), variationDeg(-10))).toBe(100);
    // passage par le nord
    expect(trueToMag(trueDeg(0), variationDeg(2))).toBe(358);
  });
});
