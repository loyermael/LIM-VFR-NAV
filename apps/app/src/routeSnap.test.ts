import { describe, expect, it } from "vitest";
import { isInRoute, metersPerPixel, snapTap, type SnapCandidate } from "./routeSnap";

const AD: SnapCandidate = { name: "LFCI", lat: 43.915, lon: 2.1167, kind: "airfield" };
const RP: SnapCandidate = { name: "Point 1", lat: 43.9151, lon: 2.1168, kind: "point" };

describe("aimantation du tracé", () => {
  it("s'accroche au candidat le plus proche dans le rayon", () => {
    expect(snapTap({ lat: 43.9152, lon: 2.1169 }, 500, [AD])?.name).toBe("LFCI");
    expect(snapTap({ lat: 44.5, lon: 2.1169 }, 500, [AD])).toBeNull();
  });
  it("un point déjà dans la route l'emporte sur un terrain voisin, même si le terrain est plus proche de l'appui", () => {
    expect(snapTap({ lat: 43.91505, lon: 2.11675 }, 500, [AD, RP])?.kind).toBe("point");
    expect(snapTap({ lat: 43.915, lon: 2.1167 }, 500, [AD, RP])?.kind).toBe("point");
    expect(snapTap({ lat: 43.915, lon: 2.1167 }, 500, [AD])?.kind).toBe("airfield");
  });
  it("mètres par pixel : diminue avec le zoom", () => {
    expect(metersPerPixel(45, 10)).toBeGreaterThan(metersPerPixel(45, 11));
    expect(metersPerPixel(45, 10)).toBeGreaterThan(50);
  });
  it("détecte un lieu déjà dans la route", () => {
    expect(isInRoute(43.915, 2.1167, [{ position: { lat: 43.9151, lon: 2.1168 } }])).toBe(true);
    expect(isInRoute(43.95, 2.2, [{ position: { lat: 43.9151, lon: 2.1168 } }])).toBe(false);
  });
});
