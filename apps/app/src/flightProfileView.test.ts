import { describe, expect, it } from "vitest";
import { nextSpace, segmentsAhead, windowOptions } from "./flightProfileView";

const asp = (id: string) => ({ id, name: id }) as never;
const hit = (id: string, segs: [number, number, "inside" | "unknown" | "outside"][]) =>
  ({ airspace: asp(id), segments: segs.map(([entry, exit, vertical]) => ({ entry, exit, vertical })) }) as never;

describe("profil en vol : espaces devant l'avion", () => {
  const hits = [hit("A", [[1000, 5000, "inside"]]), hit("B", [[0, 2000, "outside"], [30000, 40000, "unknown"]]), hit("C", [[60000, 70000, "inside"]])];
  it("distances relatives à l'avion, coupées à la fenêtre ; hors limites omis par défaut", () => {
    const s = segmentsAhead(hits, 500, 37000, false, 2000);
    expect(s.map((x) => x.key)).toEqual(["A-0", "B-1"]);
    expect(s[0]!.entry).toBe(500);
    expect(s[1]!.exit).toBe(37000); // coupé à la fin de la fenêtre
    expect(segmentsAhead(hits, 500, 37000, true, 2000).map((x) => x.key)).toContain("B-0");
  });
  it("ce qui est entièrement derrière ou au-delà de la fenêtre est écarté", () => {
    expect(segmentsAhead(hits, 10000, 15000, false, 2000)).toEqual([]);
  });
  it("prochain espace : celui où l'on est, sinon le plus proche devant", () => {
    const inside = nextSpace(segmentsAhead(hits, 2000, 37000, false, 2000))!;
    expect(inside.airspace).toMatchObject({ id: "A" });
    expect(inside.here).toBe(true);
    expect(inside.entryIn).toBe(0);
    expect(inside.exitIn).toBe(3000);
    const ahead = nextSpace(segmentsAhead(hits, 6000, 37000, false, 2000))!;
    expect(ahead.airspace).toMatchObject({ id: "B" });
    expect(ahead.here).toBe(false);
    expect(ahead.entryIn).toBe(24000);
    expect(nextSpace([])).toBeNull();
  });
  it("fenêtres : 10 / 20 / 40 en nautiques, 20 / 40 / 80 sinon", () => {
    expect(windowOptions("nm")).toEqual([10, 20, 40]);
    expect(windowOptions("km")).toEqual([20, 40, 80]);
  });
});
