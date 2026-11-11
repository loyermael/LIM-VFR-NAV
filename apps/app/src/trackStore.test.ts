import { describe, expect, it } from "vitest";
import type { TrackPoint } from "@lim/core";
import { closeInterrupted, findResumable, mergeResumed, type TrackRecord } from "./trackStore";

const T0 = Date.UTC(2026, 10, 11, 9, 0, 0);
const pt = (sec: number, lat = 47): TrackPoint => ({ t: T0 + sec * 1000, lat, lon: 2, alt: 500, gs: 45, trk: 90 });
const rec = (id: string, pts: TrackPoint[], over: Partial<TrackRecord> = {}): TrackRecord => ({
  id, name: id, startMs: (pts[0] as TrackPoint).t, endMs: (pts[pts.length - 1] as TrackPoint).t, takeoffMs: T0 + 30_000, landingMs: null, interrupted: true, points: pts, ...over,
});

describe("reprise d'une trace interrompue", () => {
  const old = rec("a", [pt(0), pt(60), pt(120)]);
  it("trouve la trace interrompue que le nouveau point prolonge", () => {
    expect(findResumable([old], pt(180, 47.01))?.id).toBe("a");
  });
  it("ignore une trace terminée normalement", () => {
    expect(findResumable([{ ...old, interrupted: false }], pt(180))).toBeNull();
  });
  it("ignore une coupure trop longue ou trop lointaine", () => {
    expect(findResumable([old], pt(120 + 3600))).toBeNull();
    expect(findResumable([old], pt(180, 49))).toBeNull();
  });
  it("plusieurs candidates : la plus récente", () => {
    const older = rec("b", [pt(-200), pt(-100)]);
    expect(findResumable([older, old], pt(180, 47.005))?.id).toBe("a");
  });
  it("recolle : points dans l'ordre, décollage d'origine gardé, trou et nombre de reprises cumulés", () => {
    const m = mergeResumed(old, [pt(180), pt(240)], T0 + 170_000);
    expect(m.points.map((p) => (p.t - T0) / 1000)).toEqual([0, 60, 120, 180, 240]);
    expect(m.takeoffMs).toBe(T0 + 30_000);
    expect(m.resumes).toBe(1);
    expect(m.gapSeconds).toBe(60);
    const again = mergeResumed({ ...old, resumes: 1, gapSeconds: 60 }, [pt(300)], null);
    expect(again.resumes).toBe(2);
    expect(again.gapSeconds).toBe(60 + 180);
  });
  it("sans décollage d'origine : prend celui du nouvel enregistrement", () => {
    expect(mergeResumed({ ...old, takeoffMs: null }, [pt(180)], T0 + 170_000).takeoffMs).toBe(T0 + 170_000);
  });
  it("une trace coupée à nouveau reste marquée interrompue et garde ses reprises", () => {
    const resumed = rec("a", [pt(0), pt(60)], { endMs: null, interrupted: false, resumes: 1, gapSeconds: 60 });
    const closed = closeInterrupted(resumed);
    expect(closed.interrupted).toBe(true);
    expect(closed.resumes).toBe(1);
  });
});
