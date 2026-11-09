import { describe, expect, it } from "vitest";
import { airacCycleAt, datasetFreshness } from "./airac";

const d = (s: string) => new Date(s + "T12:00:00Z");

describe("cycles AIRAC", () => {
  it("dates d'entrée en vigueur connues de 2026 (22/01, 19/02, 29/10, 26/11, 24/12)", () => {
    const cases: [string, string, string][] = [
      ["2026-01-22", "2601", "2026-01-22"],
      ["2026-02-19", "2602", "2026-02-19"],
      ["2026-10-29", "2611", "2026-10-29"],
      ["2026-11-26", "2612", "2026-11-26"],
      ["2026-12-24", "2613", "2026-12-24"],
    ];
    for (const [day, id, start] of cases) {
      const c = airacCycleAt(d(day));
      expect(c.id, day).toBe(id);
      expect(c.start.toISOString().slice(0, 10), day).toBe(start);
    }
  });
  it("le 10/11/2026 : cycle 2611, du 29/10 au 25/11, suivant le 26/11", () => {
    const c = airacCycleAt(d("2026-11-10"));
    expect(c.id).toBe("2611");
    expect(c.next.toISOString().slice(0, 10)).toBe("2026-11-26");
  });
  it("référence : 2 janvier 2020 = cycle 2001", () => {
    expect(airacCycleAt(d("2020-01-02")).id).toBe("2001");
    expect(airacCycleAt(d("2020-01-01")).id).toBe("1913");
  });
  it("passage d'année : le 25/12/2025 débute le dernier cycle de 2025, le 22/01/2026 le premier de 2026", () => {
    expect(airacCycleAt(d("2025-12-25")).id).toBe("2513");
    expect(airacCycleAt(d("2026-01-21")).id).toBe("2513");
    expect(airacCycleAt(d("2026-01-22")).id).toBe("2601");
  });
  it("veille d'un changement de cycle : encore l'ancien ; minuit pile : le nouveau", () => {
    expect(airacCycleAt(new Date("2026-11-25T23:59:59Z")).id).toBe("2611");
    expect(airacCycleAt(new Date("2026-11-26T00:00:00Z")).id).toBe("2612");
  });
  it("les cycles se suivent de 28 jours exactement, sur plusieurs années", () => {
    let c = airacCycleAt(d("2024-01-01"));
    for (let i = 0; i < 60; i++) {
      const n = airacCycleAt(c.next);
      expect(n.start.getTime() - c.start.getTime()).toBe(28 * 86_400_000);
      c = n;
    }
  });
});

describe("fraîcheur d'un export", () => {
  const now = d("2026-11-10");
  it("export de la veille : frais, mais antérieur au cycle courant si le cycle a changé entre-temps", () => {
    const f = datasetFreshness(d("2026-11-09"), now);
    expect(f.ageDays).toBe(1);
    expect(f.stale).toBe(false);
    expect(f.beforeCurrentCycle).toBe(false);
  });
  it("export du 23/10 (avant le cycle 2611 du 29/10) : antérieur au cycle courant, 18 jours", () => {
    const f = datasetFreshness(d("2026-10-23"), now);
    expect(f.ageDays).toBe(18);
    expect(f.beforeCurrentCycle).toBe(true);
    expect(f.stale).toBe(false);
  });
  it("plus de 28 jours : périmé", () => {
    expect(datasetFreshness(d("2026-10-01"), now).stale).toBe(true);
    expect(datasetFreshness(d("2026-10-13"), now).stale).toBe(false);
  });
  it("date d'export dans le futur : âge 0, pas d'erreur", () => {
    expect(datasetFreshness(d("2026-12-01"), now).ageDays).toBe(0);
  });
});
