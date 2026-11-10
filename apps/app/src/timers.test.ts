import { describe, expect, it } from "vitest";
import { STOPWATCH_ZERO, advanceReplay, cdCancel, cdDue, cdRemaining, cdStart, hms, swElapsed, swStart, swStop } from "./timers";

describe("chronomètre", () => {
  it("démarre, s'arrête, reprend en cumulant", () => {
    let s = swStart(STOPWATCH_ZERO, 1000);
    expect(swElapsed(s, 4000)).toBe(3000);
    s = swStop(s, 4000);
    expect(swElapsed(s, 99_000)).toBe(3000); // arrêté : ne bouge plus
    s = swStart(s, 10_000);
    expect(swElapsed(s, 12_000)).toBe(5000);
  });
  it("double démarrage ou double arrêt : sans effet", () => {
    const s = swStart(STOPWATCH_ZERO, 1000);
    expect(swStart(s, 5000)).toBe(s);
    expect(swStop(STOPWATCH_ZERO, 5000)).toBe(STOPWATCH_ZERO);
  });
  it("horloge qui recule : jamais négatif", () => {
    expect(swElapsed(swStart(STOPWATCH_ZERO, 5000), 1000)).toBe(0);
  });
});

describe("compte à rebours", () => {
  const c = { durationMs: 60_000, endsAt: null, fired: false };
  it("reste, alarme une fois à l'échéance, annulation", () => {
    const r = cdStart(c, 1000);
    expect(cdRemaining(r, 31_000)).toBe(30_000);
    expect(cdDue(r, 60_999)).toBe(false);
    expect(cdDue(r, 61_000)).toBe(true);
    expect(cdDue({ ...r, fired: true }, 70_000)).toBe(false);
    expect(cdRemaining(r, 99_000)).toBe(0);
    expect(cdRemaining(cdCancel(r), 5000)).toBe(60_000);
  });
  it("durée nulle : ne démarre pas", () => {
    expect(cdStart({ ...c, durationMs: 0 }, 1000).endsAt).toBeNull();
  });
});

describe("hms", () => {
  it("formats", () => {
    expect(hms(0)).toBe("00:00");
    expect(hms(65_000)).toBe("01:05");
    expect(hms(3_725_000)).toBe("1:02:05");
    expect(hms(null)).toBe("--:--");
    expect(hms(-1)).toBe("--:--");
    expect(hms(NaN)).toBe("--:--");
  });
});

describe("rejeu", () => {
  it("avance à la vitesse choisie, borné, signale la fin", () => {
    expect(advanceReplay(1000, 200, 8, 0, 100_000)).toEqual({ t: 2600, ended: false });
    expect(advanceReplay(99_900, 200, 8, 0, 100_000)).toEqual({ t: 100_000, ended: true });
    expect(advanceReplay(50, 200, -1, 0, 100_000)).toEqual({ t: 0, ended: false });
  });
});
