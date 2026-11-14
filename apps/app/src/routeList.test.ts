import { describe, expect, it } from "vitest";
import { addPoint, newRoute } from "./routeEdit";
import { ageText, filterRoutes, orderRoutes, summarizeRoute } from "./routeList";

const route = (id: string, name: string, updatedAt: number, pts: [number, number][] = []) => {
  let r = newRoute(id, name, updatedAt);
  pts.forEach(([lat, lon], i) => { r = addPoint(r, lat, lon, `${id}-${i}`, updatedAt); });
  return { ...r, updatedAt };
};

describe("liste des routes", () => {
  it("résumé : distance, étiquette départ → arrivée, temps seulement avec une vitesse propre", () => {
    const r = route("a", "Test", 1, [[47, 2], [47.5, 2]]);
    const s = summarizeRoute(r, [], null, new Date(Date.UTC(2026, 5, 1)));
    expect(s.pointCount).toBe(2);
    expect(s.distanceM).toBeGreaterThan(55_000);
    expect(s.distanceM).toBeLessThan(56_500);
    expect(s.label).toMatch(/→/);
    expect(s.timeSec).toBeNull();
    const withTas = summarizeRoute(r, [], 50, new Date(Date.UTC(2026, 5, 1)));
    expect(withTas.timeSec).toBeGreaterThan(1000);
  });
  it("aller-retour : « A ⇄ B » avec le point le plus éloigné", () => {
    const r = route("c", "AR", 1, [[47, 2], [47.5, 2], [47, 2]]);
    const s = summarizeRoute(r, [], null, new Date());
    expect(s.label).toContain("⇄");
  });
  it("route sans point : étiquette vide, distance nulle", () => {
    const s = summarizeRoute(route("b", "Vide", 1), [], 50, new Date());
    expect(s.label).toBe("");
    expect(s.distanceM).toBe(0);
    expect(s.timeSec).toBeNull();
  });
  it("tri : la route active en premier, puis la plus récente", () => {
    const items = [{ id: "x", updatedAt: 10 }, { id: "y", updatedAt: 30 }, { id: "z", updatedAt: 20 }];
    expect(orderRoutes(items, "x").map((i) => i.id)).toEqual(["x", "y", "z"]);
    expect(orderRoutes(items, null).map((i) => i.id)).toEqual(["y", "z", "x"]);
  });
  it("recherche sans accent ni casse, sur le nom et l'étiquette", () => {
    const items = [{ name: "Tour du Beaujolais", label: "LFHV → LFHV" }, { name: "Été", label: "LFLM → LFHV" }];
    expect(filterRoutes(items, "beaujo")).toHaveLength(1);
    expect(filterRoutes(items, "ete")).toHaveLength(1);
    expect(filterRoutes(items, "lflm")).toHaveLength(1);
    expect(filterRoutes(items, "  ")).toHaveLength(2);
    expect(filterRoutes(items, "zzz")).toHaveLength(0);
  });
  it("âge lisible en français et en anglais", () => {
    const now = 1_000_000_000_000;
    expect(ageText(now - 30_000, now, "fr")).toBe("à l'instant");
    expect(ageText(now - 5 * 60_000, now, "fr")).toBe("il y a 5 min");
    expect(ageText(now - 3 * 3_600_000, now, "fr")).toBe("il y a 3 h");
    expect(ageText(now - 30 * 3_600_000, now, "fr")).toBe("hier");
    expect(ageText(now - 4 * 86_400_000, now, "en")).toBe("4 d ago");
  });
});
