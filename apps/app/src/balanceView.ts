import type { BalanceState } from "@lim/core";

/** Présentation du centrage : niveaux de prudence, graduations rondes, placement des étiquettes. Aucun calcul de masse ni de CG ici. */

/** Marge au CG (mm) en dessous de laquelle une phase est « marge faible » (orange). */
export const CAUTION_MARGIN_MM = 30;

export type Level = "ok" | "caution" | "bad";

const RANK: Record<Level, number> = { ok: 0, caution: 1, bad: 2 };
export const worst = (a: Level, b: Level): Level => (RANK[b] > RANK[a] ? b : a);

/** Niveau d'une phase : hors limites si le calcul signale un problème, marge faible sous le seuil, sinon OK. */
export function levelOf(s: Pick<BalanceState, "issues" | "cgMargin">): Level {
  if (s.issues.length > 0) return "bad";
  if (s.cgMargin !== null && s.cgMargin * 1000 < CAUTION_MARGIN_MM) return "caution";
  return "ok";
}

/** Remplissage d'un champ par rapport à sa limite : neutre, orange à partir de 90 %, rouge au-delà de 100 %. */
export function fillLevel(value: number | null, limit: number | null): { ratio: number; level: Level } | null {
  if (value === null || limit === null || !(limit > 0)) return null;
  const ratio = Math.max(0, value / limit);
  return { ratio, level: ratio > 1 ? "bad" : ratio >= 0.9 ? "caution" : "ok" };
}

/** Phase de plus faible marge (parmi celles qui ont une marge). */
export function minMargin<T extends { state: Pick<BalanceState, "cgMargin"> }>(phases: readonly T[]): T | null {
  let best: T | null = null;
  for (const p of phases) {
    if (p.state.cgMargin === null || !Number.isFinite(p.state.cgMargin)) continue;
    if (best === null || p.state.cgMargin < (best.state.cgMargin as number)) best = p;
  }
  return best;
}

/** Pas « rond » (1, 2, 2,5, 5 × 10^n) donnant au plus `maxTicks` graduations sur l'intervalle. */
export function niceStep(range: number, maxTicks: number): number {
  const raw = Math.max(range, 1e-9) / Math.max(1, maxTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw - 1e-12) return m * pow;
  return 10 * pow;
}

/** Bornes arrondies au pas (avec une petite marge) et graduations rondes entre elles. */
export function niceAxis(min: number, max: number, maxTicks: number): { lo: number; hi: number; step: number; ticks: number[] } {
  const step = niceStep(max - min, maxTicks);
  const lo = Math.floor((min - step * 0.25) / step + 1e-9) * step;
  const hi = Math.ceil((max + step * 0.25) / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, step, ticks };
}

export interface Box { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface Placed { dx: number; dy: number; anchor: "start" | "end" | "middle"; leader: boolean; box: Box }

/**
 * Place chaque étiquette près de son point sans recouvrir un point, une autre étiquette ni sortir du cadre.
 * Essaie d'abord des positions proches ; sinon une position éloignée avec un trait de rappel.
 */
export function placeLabels(points: { x: number; y: number; text: string }[], frame: Box, fontSize: number, markerR: number): Placed[] {
  const out: Placed[] = [];
  const taken: Box[] = points.map((p) => ({ x: p.x - markerR - 2, y: p.y - markerR - 2, w: 2 * markerR + 4, h: 2 * markerR + 4 }));
  const gaps = [markerR + 4, markerR + 26];
  points.forEach((p) => {
    const w = p.text.length * fontSize * 0.62;
    const h = fontSize + 2;
    let chosen: Placed | null = null;
    outer: for (let gi = 0; gi < gaps.length; gi++) {
      const g = gaps[gi] as number;
      const cands: { dx: number; dy: number; anchor: "start" | "end" | "middle" }[] = [
        { dx: g, dy: -g * 0.6, anchor: "start" }, { dx: g, dy: g * 0.6 + h * 0.6, anchor: "start" },
        { dx: -g, dy: -g * 0.6, anchor: "end" }, { dx: -g, dy: g * 0.6 + h * 0.6, anchor: "end" },
        { dx: g, dy: h * 0.3, anchor: "start" }, { dx: -g, dy: h * 0.3, anchor: "end" },
        { dx: 0, dy: -g - 2, anchor: "middle" }, { dx: 0, dy: g + h, anchor: "middle" },
      ];
      for (const c of cands) {
        const x = p.x + c.dx;
        const box: Box = { x: c.anchor === "start" ? x : c.anchor === "end" ? x - w : x - w / 2, y: p.y + c.dy - h + 3, w, h };
        const inside = box.x >= frame.x && box.y >= frame.y && box.x + box.w <= frame.x + frame.w && box.y + box.h <= frame.y + frame.h;
        if (inside && !taken.some((t) => hit(box, t))) { chosen = { ...c, leader: gi > 0, box }; break outer; }
      }
    }
    if (!chosen) {
      const x = p.x + gaps[0]!, box: Box = { x, y: p.y - h / 2, w, h };
      chosen = { dx: gaps[0]!, dy: 4, anchor: "start", leader: false, box };
    }
    taken.push(chosen.box);
    out.push(chosen);
  });
  return out;
}
