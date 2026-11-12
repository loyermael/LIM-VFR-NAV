import { describe, expect, it } from "vitest";
import { driftDeg, sunsetMs } from "./NavLogSheet";

describe("log papier : calculs", () => {
  it("dérive d'un vent de travers (modèle de la fiche : 5 kt, Vp 85 → 3,4°)", () => {
    expect(driftDeg(5, 85, 90)).toBeCloseTo(3.37, 1);
    expect(driftDeg(5, 85, 0)).toBeCloseTo(0, 5);
    expect(driftDeg(5, 0, 90)).toBe(0);
  });
  it("coucher du soleil à Paris le 21 juin : environ 19:58 UTC", () => {
    const ms = sunsetMs(48.85, 2.35, new Date(2026, 5, 21));
    expect(ms).not.toBeNull();
    const d = new Date(ms as number);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    expect(Math.abs(minutes - (19 * 60 + 58))).toBeLessThanOrEqual(5);
  });
  it("jour polaire : pas de coucher", () => {
    expect(sunsetMs(80, 0, new Date(2026, 5, 21))).toBeNull();
  });
});
