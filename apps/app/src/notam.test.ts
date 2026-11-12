import { describe, expect, it } from "vitest";
import { mergeNotams, notamSubject, notamsForFlight, notamsFromApi, parseNotams } from "./notam";

const SAMPLE = `(A1234/26 NOTAMN
Q) LFFF/QMRLC/IV/NBO/A/000/999/4509N00623E005
A) LFLB B) 2601011200 C) 2601011800
E) RWY 18/36 CLSD DUE WORK.
F) SFC G) UNL)

(A1235/26 NOTAMN
Q) LFFF/QWULW/IV/BO/W/000/030/4521N00300E010
A) LFLY B) 2601011000 C) 2601301700 EST
D) MON-FRI 0800-1700
E) UAS ACT WI 10NM RADIUS. A) TEST INSIDE TEXT B) NOT A FIELD.
F) SFC G) 1000FT AGL)

(A1236/26 NOTAMC A1234/26
Q) LFFF/QMRXX/IV/NBO/A/000/999/4509N00623E005
A) LFLB B) 2601011300 C) PERM
E) CANCELLED)`;

describe("analyse des NOTAM (format OACI)", () => {
  const all = parseNotams(SAMPLE);
  it("lit les blocs, la ligne Q, les lieux et les dates", () => {
    expect(all.map((n) => n.id)).toEqual(["A1234/26", "A1235/26", "A1236/26"]);
    const a = all[0]!;
    expect(a.fir).toBe("LFFF");
    expect(a.qcode).toBe("QMRLC");
    expect(a.locations).toEqual(["LFLB"]);
    expect(a.lat).toBeCloseTo(45.15, 2);
    expect(a.lon).toBeCloseTo(6.383, 2);
    expect(a.radiusNm).toBe(5);
    expect(a.fromMs).toBe(Date.UTC(2026, 0, 1, 12, 0));
    expect(a.toMs).toBe(Date.UTC(2026, 0, 1, 18, 0));
    expect(a.text).toBe("RWY 18/36 CLSD DUE WORK.");
  });
  it("EST, horaires et lettres dans le texte", () => {
    const b = all[1]!;
    expect(b.estimated).toBe(true);
    expect(b.schedule).toBe("MON-FRI 0800-1700");
    expect(b.text).toContain("TEST INSIDE TEXT");
    expect(b.lowerFl).toBe(0);
    expect(b.upperFl).toBe(30);
  });
  it("NOTAMC annule le NOTAM visé, PERM = sans fin", () => {
    expect(all[2]!.kind).toBe("C");
    expect(all[2]!.toMs).toBeNull();
    expect(mergeNotams([], all).map((n) => n.id)).toEqual(["A1235/26"]);
  });
  it("un texte sans NOTAM donne une liste vide", () => {
    expect(parseNotams("bonjour")).toEqual([]);
  });
  it("sujet du code Q en clair", () => {
    expect(notamSubject("QMRLC")).toBe("Piste");
    expect(notamSubject("QWULW")).toBe("Aéronefs sans pilote");
    expect(notamSubject("QZZZZ")).toBe("QZZZZ");
  });
});

describe("pertinence pour un vol", () => {
  const notams = parseNotams(SAMPLE).filter((n) => n.kind === "N");
  const af = (icao: string, lat: number, lon: number) => ({ id: icao, name: icao, icao, type: 0, position: { lat, lon }, elevation: 0, private: false, frequencies: [], runways: [] }) as never;
  const airfields = [af("LFLB", 45.638, 5.88), af("LFLY", 45.727, 5.09)];
  const win = { startMs: Date.UTC(2026, 0, 1, 13, 0), endMs: Date.UTC(2026, 0, 1, 15, 0) };
  it("départ, arrivée et couloir", () => {
    const route = [{ position: { lat: 45.638, lon: 5.88 } }, { position: { lat: 45.727, lon: 5.09 } }];
    const r = notamsForFlight(notams, route, airfields, win);
    expect(r.find((x) => x.notam.id === "A1234/26")?.role).toBe("dep");
    expect(r.find((x) => x.notam.id === "A1235/26")?.role).toBe("arr");
  });
  it("hors fenêtre de temps : écarté", () => {
    const route = [{ position: { lat: 45.638, lon: 5.88 } }, { position: { lat: 45.727, lon: 5.09 } }];
    const late = { startMs: Date.UTC(2026, 5, 1), endMs: Date.UTC(2026, 5, 2) };
    expect(notamsForFlight(notams, route, airfields, late)).toEqual([]);
  });
  it("zone traversée par la route (sans terrain)", () => {
    const route = [{ position: { lat: 45.5, lon: 2.8 } }, { position: { lat: 45.5, lon: 3.2 } }];
    const r = notamsForFlight(notams, route, [], { startMs: Date.UTC(2026, 0, 2), endMs: Date.UTC(2026, 0, 3) });
    expect(r.map((x) => x.notam.id)).toEqual(["A1235/26"]);
  });
});

describe("réponse de l'API", () => {
  it("lit le NOTAM complet du champ all", () => {
    const j = [{ id: "x", all: "(A9999/26 NOTAMN\nQ) LFFF/QFALC/IV/NBO/A/000/999/4509N00623E005\nA) LFLB B) 2601011200 C) 2601011800\nE) AD CLSD)" }];
    expect(notamsFromApi(j)[0]?.id).toBe("A9999/26");
    expect(() => notamsFromApi({})).toThrow();
  });
});
