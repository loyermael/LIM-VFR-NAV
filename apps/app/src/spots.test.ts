import { describe, expect, it } from "vitest";
import { parseSpots, spotsToGeoJSON } from "./spots";

describe("points cotés", () => {
  it("lit les points valides, écarte les autres", () => {
    const d = parseSpots({ format: "lim-nav-spots", items: [[2.1, 43.5, 1037], [200, 1, 5], [1, 2], "x", [1.5, 44, 3100]] }, 1);
    expect(d.items).toHaveLength(2);
    expect(() => parseSpots({ format: "autre" }, 1)).toThrow();
  });
  it("GeoJSON : étiquette en pieds, sommets > 3 000 ft marqués", () => {
    const f = spotsToGeoJSON(parseSpots({ format: "lim-nav-spots", items: [[2.1, 43.5, 1037], [1.5, 44, 3100]] }, 1)).features;
    expect(f.map((x) => x.properties?.["lbl"])).toEqual(["1037", "3100"]);
    expect(f.map((x) => x.properties?.["major"])).toEqual([false, true]);
  });
});
