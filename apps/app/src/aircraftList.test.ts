import { describe, expect, it } from "vitest";
import { listAircraft, matchesAircraft } from "./aircraftList";

const ac = (id: string, registration: string, name: string, updatedAt: number) => ({ id, registration, name, updatedAt }) as never;
const list = [ac("1", "F-GBBB", "Robin DR400", 10), ac("2", "F-AAAA", "Cessna 172", 30), ac("3", "", "Évasion 2", 20), ac("4", "F-CCCC", "Alpha", 5)];

describe("liste d'avions : choisi en tête, recherche, tri", () => {
  it("l'avion choisi passe en premier, même sans correspondance", () => {
    expect(listAircraft(list, "1", "cessna", "reg").map((a) => a.id)).toEqual(["1", "2"]);
  });
  it("tri par immatriculation (sans immat : par nom), par nom, par récence", () => {
    expect(listAircraft(list, null, "", "reg").map((a) => a.id)).toEqual(["3", "2", "4", "1"]);
    expect(listAircraft(list, null, "", "name").map((a) => a.id)).toEqual(["4", "2", "3", "1"]);
    expect(listAircraft(list, null, "", "recent").map((a) => a.id)).toEqual(["2", "3", "1", "4"]);
  });
  it("recherche sur immat ou nom, sans accents ni casse, mots multiples", () => {
    expect(matchesAircraft(list[2] as never, "evasion")).toBe(true);
    expect(matchesAircraft(list[0] as never, "f-gbbb robin")).toBe(true);
    expect(matchesAircraft(list[0] as never, "cessna")).toBe(false);
  });
});
