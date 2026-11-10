import { describe, expect, it } from "vitest";
import { DEFAULT_FUEL_PLAN, parseFuelPlan, parseLoads } from "./aircraftStore";

describe("charges mémorisées", () => {
  it("garde les nombres positifs ou nuls, écarte le reste", () => {
    expect(parseLoads({ a: { pilot: 80, pax: -5, bag: "x", fuel: 40, nan: null } })).toEqual({ a: { pilot: 80, fuel: 40 } });
  });
  it("n'importe quoi → vide", () => {
    expect(parseLoads(null)).toEqual({});
    expect(parseLoads("x")).toEqual({});
    expect(parseLoads({ a: 5 })).toEqual({});
  });
});

describe("plan de carburant mémorisé", () => {
  it("valeurs valides conservées, invalides remplacées champ par champ par les valeurs de départ", () => {
    expect(parseFuelPlan({ taxiLiters: 2, contingencyPercent: -1, alternateMinutes: "x", reserveMinutes: 45 })).toEqual({
      taxiLiters: 2, contingencyPercent: DEFAULT_FUEL_PLAN.contingencyPercent, alternateMinutes: DEFAULT_FUEL_PLAN.alternateMinutes, reserveMinutes: 45,
    });
    expect(parseFuelPlan(null)).toEqual(DEFAULT_FUEL_PLAN);
  });
});
