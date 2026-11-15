import { describe, expect, it } from "vitest";
import { fillLevel, levelOf, minMargin, niceAxis, niceStep, placeLabels } from "./balanceView";

describe("balanceView", () => {
  it("niveau d'une phase : hors limites, marge faible, ok", () => {
    expect(levelOf({ issues: ["cg-aft"], cgMargin: -0.01 })).toBe("bad");
    expect(levelOf({ issues: [], cgMargin: 0.029 })).toBe("caution");
    expect(levelOf({ issues: [], cgMargin: 0.03 })).toBe("ok");
    expect(levelOf({ issues: [], cgMargin: 0.113 })).toBe("ok");
    expect(levelOf({ issues: [], cgMargin: null })).toBe("ok");
  });

  it("remplissage par rapport à la limite", () => {
    expect(fillLevel(null, 110)).toBeNull();
    expect(fillLevel(60, null)).toBeNull();
    expect(fillLevel(60, 110)?.level).toBe("ok");
    expect(fillLevel(99, 110)?.level).toBe("caution");
    expect(fillLevel(111, 110)?.level).toBe("bad");
  });

  it("phase de plus faible marge", () => {
    const ph = [{ n: "a", state: { cgMargin: 0.05 } }, { n: "b", state: { cgMargin: 0.029 } }, { n: "c", state: { cgMargin: null } }];
    expect(minMargin(ph)?.n).toBe("b");
    expect(minMargin([{ state: { cgMargin: null } }])).toBeNull();
  });

  it("pas et graduations rondes", () => {
    expect(niceStep(0.35, 7)).toBeCloseTo(0.05, 9);
    expect(niceStep(250, 6)).toBe(50);
    const ax = niceAxis(2.2, 2.45, 7);
    expect(ax.lo).toBeCloseTo(2.15, 9);
    expect(ax.hi).toBeCloseTo(2.5, 9);
    const ay = niceAxis(560, 800, 6);
    expect(ay.ticks.every((v) => v % 50 === 0)).toBe(true);
    expect(ay.lo).toBeLessThanOrEqual(560);
    expect(ay.hi).toBeGreaterThanOrEqual(800);
  });

  it("étiquettes : jamais sur un point ni l'une sur l'autre", () => {
    const pts = [{ x: 200, y: 100, text: "Zéro carburant" }, { x: 210, y: 90, text: "Décollage" }, { x: 205, y: 95, text: "Atterrissage" }];
    const frame = { x: 0, y: 0, w: 400, h: 300 };
    const pl = placeLabels(pts, frame, 12, 8);
    pl.forEach((a, i) => {
      pts.forEach((p) => {
        const hitPt = a.box.x < p.x + 8 && p.x - 8 < a.box.x + a.box.w && a.box.y < p.y + 8 && p.y - 8 < a.box.y + a.box.h;
        expect(hitPt).toBe(false);
      });
      pl.slice(i + 1).forEach((b) => {
        expect(a.box.x < b.box.x + b.box.w && b.box.x < a.box.x + a.box.w && a.box.y < b.box.y + b.box.h && b.box.y < a.box.y + a.box.h).toBe(false);
      });
    });
  });
});
