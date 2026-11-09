import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { windComponents, windTriangle, type Wind } from "./wind";
import { knots, knotsToMps, mpsToKnots, type Knots } from "./units";
import { trueDeg } from "./angles";

const kt = (v: number) => knotsToMps(knots(v));
const wind = (dir: number, speed: number): Wind => ({ direction: trueDeg(dir), speed: kt(speed) });
const inKt = (v: number) => mpsToKnots(v as never) as Knots;

describe("triangle des vitesses : cas connus calculés à la main", () => {
  it("pas de vent : cap = route, vitesse sol = vitesse propre", () => {
    const r = windTriangle(trueDeg(90), kt(100), null)!;
    expect(r.wca).toBe(0);
    expect(r.trueHeading).toBe(90);
    expect(inKt(r.groundSpeed)).toBeCloseTo(100, 9);
  });
  it("vent de face 20 kt (route 090, vent 090) : GS 80, pas de dérive", () => {
    const r = windTriangle(trueDeg(90), kt(100), wind(90, 20))!;
    expect(inKt(r.groundSpeed)).toBeCloseTo(80, 6);
    expect(r.wca).toBeCloseTo(0, 6);
    expect(r.trueHeading).toBeCloseTo(90, 6);
  });
  it("vent arrière 20 kt (route 090, vent 270) : GS 120", () => {
    const r = windTriangle(trueDeg(90), kt(100), wind(270, 20))!;
    expect(inKt(r.groundSpeed)).toBeCloseTo(120, 6);
    expect(r.wca).toBeCloseTo(0, 6);
  });
  it("vent traversier de droite 30 kt, TAS 100, route 090 (vent 180) : dérive +17,46°, cap 107,46°, GS 95,39 kt", () => {
    const r = windTriangle(trueDeg(90), kt(100), wind(180, 30))!;
    expect(r.wca).toBeCloseTo(17.4576, 3);
    expect(r.trueHeading).toBeCloseTo(107.4576, 3);
    expect(inKt(r.groundSpeed)).toBeCloseTo(95.394, 2);
  });
  it("vent traversier de gauche (vent 360) : dérive négative, cap 72,54°", () => {
    const r = windTriangle(trueDeg(90), kt(100), wind(360, 30))!;
    expect(r.wca).toBeCloseTo(-17.4576, 3);
    expect(r.trueHeading).toBeCloseTo(72.5424, 3);
    expect(inKt(r.groundSpeed)).toBeCloseTo(95.394, 2);
  });
  it("cap vrai qui passe par le nord : route 350, vent de droite", () => {
    const r = windTriangle(trueDeg(350), kt(100), wind(80, 30))!;
    expect(r.wca).toBeGreaterThan(0);
    expect(r.trueHeading).toBeGreaterThanOrEqual(0);
    expect(r.trueHeading).toBeLessThan(20);
  });
  it("vent oblique : route 090, vent 150 / 20 kt, TAS 90", () => {
    // sin(WCA) = 20/90 · sin(60°) = 0,19245 → WCA = 11,098° ; GS = 90·0,98130 − 20·0,5 = 88,317 − 10 = 78,32 kt
    const r = windTriangle(trueDeg(90), kt(90), wind(150, 20))!;
    expect(r.wca).toBeCloseTo(11.098, 2);
    expect(inKt(r.groundSpeed)).toBeCloseTo(78.318, 2);
  });
});

describe("triangle impossible", () => {
  it("vent traversier plus fort que la vitesse propre : null", () => {
    expect(windTriangle(trueDeg(90), kt(20), wind(180, 30))).toBeNull();
  });
  it("vent de face égal à la vitesse propre (GS nulle) : null", () => {
    expect(windTriangle(trueDeg(90), kt(50), wind(90, 50))).toBeNull();
  });
  it("vent de face plus fort que la vitesse propre (recul) : null", () => {
    expect(windTriangle(trueDeg(90), kt(50), wind(90, 70))).toBeNull();
  });
  it("vitesse propre nulle ou négative : null", () => {
    expect(windTriangle(trueDeg(90), kt(0), null)).toBeNull();
  });
});

describe("composantes du vent", () => {
  it("face, arrière, traversier de droite", () => {
    const c1 = windComponents(trueDeg(90), wind(90, 20));
    expect(inKt(c1.headwind)).toBeCloseTo(20, 6);
    expect(inKt(c1.crosswind)).toBeCloseTo(0, 6);
    expect(inKt(windComponents(trueDeg(90), wind(270, 20)).headwind)).toBeCloseTo(-20, 6);
    expect(inKt(windComponents(trueDeg(90), wind(180, 20)).crosswind)).toBeCloseTo(20, 6);
  });
});

describe("propriétés du triangle (fast-check)", () => {
  const angle = fc.double({ min: 0, max: 359.99, noNaN: true });
  const tasKt = fc.double({ min: 40, max: 250, noNaN: true });
  const wsKt = fc.double({ min: 0, max: 60, noNaN: true });

  it("la vitesse sol est comprise entre TAS − vent et TAS + vent", () => {
    fc.assert(
      fc.property(angle, tasKt, angle, wsKt, (tc, tas, wd, ws) => {
        const r = windTriangle(trueDeg(tc), kt(tas), wind(wd, ws));
        if (r === null) return true;
        const gs = inKt(r.groundSpeed);
        return gs >= tas - ws - 1e-6 && gs <= tas + ws + 1e-6;
      }),
      { numRuns: 500 },
    );
  });
  it("fermeture du triangle : vecteur air + vecteur vent = vecteur sol dirigé exactement sur la route", () => {
    fc.assert(
      fc.property(angle, tasKt, angle, wsKt, (tc, tas, wd, ws) => {
        const r = windTriangle(trueDeg(tc), kt(tas), wind(wd, ws));
        if (r === null) return true;
        const rad = (d: number) => (d * Math.PI) / 180;
        const th = rad(r.trueHeading);
        // air : (est, nord) ; le vent pousse VERS wd + 180
        const airE = tas * Math.sin(th);
        const airN = tas * Math.cos(th);
        const wE = ws * Math.sin(rad(wd + 180));
        const wN = ws * Math.cos(rad(wd + 180));
        const gE = airE + wE;
        const gN = airN + wN;
        const gs = inKt(r.groundSpeed);
        const tcR = rad(tc);
        return Math.abs(gE - gs * Math.sin(tcR)) < 1e-6 && Math.abs(gN - gs * Math.cos(tcR)) < 1e-6;
      }),
      { numRuns: 500 },
    );
  });
  it("la dérive est du signe du vent traversier et ne dépasse jamais 90°", () => {
    fc.assert(
      fc.property(angle, tasKt, angle, wsKt, (tc, tas, wd, ws) => {
        const r = windTriangle(trueDeg(tc), kt(tas), wind(wd, ws));
        if (r === null) return true;
        const cross = inKt(windComponents(trueDeg(tc), wind(wd, ws)).crosswind);
        const sameSign = Math.abs(cross) < 1e-9 || Math.sign(cross) === Math.sign(r.wca) || Math.abs(r.wca) < 1e-9;
        return sameSign && Math.abs(r.wca) < 90;
      }),
      { numRuns: 500 },
    );
  });
});
