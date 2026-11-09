import { describe, expect, it } from "vitest";
import { PressureFilter, indicatedAltitude, isPlausiblePressure, pressureAtAltitude, qnhFromElevation } from "./baro";
import { pressureAltitudeOf, STANDARD_QNH } from "./altitude";
import { hectopascals, hpaToPa, meters, pascals } from "./units";

const hpa = (v: number) => hpaToPa(hectopascals(v));

describe("pression et altitude (atmosphère standard)", () => {
  it("pression à 0 m = 1013,25 hPa ; à 1500 m ≈ 845,6 hPa ; à 3000 m ≈ 701,1 hPa", () => {
    expect(pressureAtAltitude(meters(0))).toBeCloseTo(101325, 6);
    expect(pressureAtAltitude(meters(1500)) / 100).toBeCloseTo(845.6, 0);
    expect(pressureAtAltitude(meters(3000)) / 100).toBeCloseTo(701.1, 0);
  });
  it("aller-retour avec l'altitude pression", () => {
    for (const h of [-300, 0, 450, 1500, 3200, 5500]) {
      expect(pressureAltitudeOf(pressureAtAltitude(meters(h)))).toBeCloseTo(h, 6);
    }
  });
});

describe("altitude indiquée", () => {
  it("QNH standard : l'altitude indiquée est l'altitude pression", () => {
    expect(indicatedAltitude(pressureAtAltitude(meters(1500)), STANDARD_QNH)).toBeCloseTo(1500, 6);
  });
  it("au niveau de la mer avec le bon QNH : 0 m", () => {
    expect(indicatedAltitude(hpa(1021), hpa(1021))).toBeCloseTo(0, 9);
  });
  it("QNH plus bas, même pression : l'altitude indiquée BAISSE (≈ 27 ft par hPa, comme sur un altimètre)", () => {
    const p = pressureAtAltitude(meters(1000));
    const diff = indicatedAltitude(p, hpa(1003.25)) - indicatedAltitude(p, STANDARD_QNH);
    expect(diff).toBeLessThan(-80);
    expect(diff).toBeGreaterThan(-86);
  });
});

describe("QNH depuis l'altitude d'un terrain", () => {
  it("sur un terrain à 300 m avec 977,4 hPa mesurés : le QNH redonne 300 m", () => {
    const measured = hpa(977.4);
    const qnh = qnhFromElevation(measured, meters(300));
    expect(indicatedAltitude(measured, qnh)).toBeCloseTo(300, 6);
  });
  it("valeur plausible : 300 m et 977 hPa → QNH ≈ 1013 hPa", () => {
    const qnh = qnhFromElevation(hpa(977), meters(300)) / 100;
    expect(qnh).toBeGreaterThan(1010);
    expect(qnh).toBeLessThan(1016);
  });
  it("terrain au niveau de la mer : QNH = pression mesurée", () => {
    expect(qnhFromElevation(hpa(1008), meters(0))).toBeCloseTo(hpa(1008), 6);
  });
});

describe("filtre de pression", () => {
  const ms = (s: number) => s * 1000;
  it("la première mesure valide est reprise telle quelle", () => {
    const f = new PressureFilter();
    expect(f.update(hpa(1000), 0)).toBe(100000);
  });
  it("lisse un bruit : la sortie reste entre les extrêmes et se rapproche de la moyenne", () => {
    const f = new PressureFilter(2);
    let out = 0;
    for (let i = 0; i < 60; i++) out = f.update(100000 + (i % 2 === 0 ? 30 : -30), ms(i * 0.5))!;
    expect(Math.abs(out - 100000)).toBeLessThan(15);
  });
  it("suit un vrai changement de pression, avec un retard borné par la constante de temps", () => {
    const f = new PressureFilter(1);
    f.update(100000, 0);
    let out = 0;
    for (let i = 1; i <= 10; i++) out = f.update(99000, ms(i))!;
    expect(out).toBeCloseTo(99000, -1);
  });
  it("ignore une mesure aberrante sans casser le filtre", () => {
    const f = new PressureFilter();
    f.update(101000, 0);
    expect(f.update(5, 1000)).toBe(101000);
    expect(f.update(Number.NaN, 2000)).toBe(101000);
  });
  it("aucune mesure valide : null ; après un long silence, repart de zéro", () => {
    const f = new PressureFilter(1, 10);
    expect(f.update(5, 0)).toBeNull();
    f.update(101000, 1000);
    expect(f.update(95000, ms(60))).toBe(95000);
  });
  it("last() donne l'âge de la dernière mesure", () => {
    const f = new PressureFilter();
    f.update(101000, 5000);
    expect(f.last(7500)?.ageMs).toBe(2500);
    expect(new PressureFilter().last(0)).toBeNull();
  });
});

describe("plausibilité", () => {
  it("accepte 300 à 1100 hPa", () => {
    expect(isPlausiblePressure(pascals(101325))).toBe(true);
    expect(isPlausiblePressure(pascals(29000))).toBe(false);
    expect(isPlausiblePressure(pascals(111000))).toBe(false);
    expect(isPlausiblePressure(pascals(Number.NaN))).toBe(false);
  });
});
