import { describe, expect, it } from "vitest";
import { activitiesToGeoJSON, activitySymbol, limitFeet, parseActivities, shiftedPosition } from "./activities";

describe("activités de l'AIP", () => {
  it("lit les entrées valides, écarte les autres", () => {
    const d = parseActivities({ format: "lim-nav-activities", version: 1, cycle: "2026-10-29", items: [
      { ref: "200", kind: "para", name: "LILLE", lat: 50.7, lon: 3.1, upper: "FL 140", lower: "SFC", hours: "SR-SS" },
      { ref: "x", kind: "inconnu", lat: 1, lon: 1 }, { kind: "acro", lat: 1, lon: 1 }, null,
    ] }, 5);
    expect(d.items).toHaveLength(1);
    expect(d.meta.cycle).toBe("2026-10-29");
    expect(() => parseActivities({ format: "autre" }, 1)).toThrow();
  });
  it("hauteur en pieds : pieds, niveau de vol, illisible", () => {
    expect(limitFeet("1700ft AMSL")).toBe(1700);
    expect(limitFeet("FL 055")).toBe(5500);
    expect(limitFeet("SFC")).toBeNull();
  });
  it("symbole : type et couleur de l'aéromodélisme selon la hauteur", () => {
    expect(activitySymbol({ kind: "para", upper: null })).toBe("para");
    expect(activitySymbol({ kind: "aeromodel", upper: "700ft AMSL" })).toBe("aeromodel-orange");
    expect(activitySymbol({ kind: "aeromodel", upper: "1500ft AMSL" })).toBe("aeromodel-purple");
    expect(activitySymbol({ kind: "aeromodel", upper: "2300ft AMSL" })).toBe("aeromodel");
    expect(activitySymbol({ kind: "other", upper: null })).toBeNull();
  });
  it("GeoJSON : un point par activité dessinable, avec son numéro", () => {
    const d = parseActivities({ format: "lim-nav-activities", items: [{ ref: "6000", kind: "acro", lat: 50, lon: 3 }, { ref: "13-001", kind: "other", lat: 1, lon: 1 }] }, 1);
    const f = activitiesToGeoJSON(d).features;
    expect(f).toHaveLength(1);
    expect(f[0]?.properties?.["lbl"]).toBe("6000");
  });
});

describe("décalage géographique des activités", () => {
  it("fixé en mètres sur le terrain : même décalage à tout zoom, pas de décalage pour l'aéromodélisme", () => {
    const [lon, lat] = shiftedPosition(45, 2, "glider");
    expect((lon - 2) * 111320 * Math.cos((45 * Math.PI) / 180)).toBeCloseTo(900, 0);
    expect((lat - 45) * 111320).toBeCloseTo(350, 0);
    expect(shiftedPosition(45, 2, "aeromodel")).toEqual([2, 45]);
  });
});
