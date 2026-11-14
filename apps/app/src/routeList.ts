/**
 * Liste des routes : résumé d'une ligne (départ → arrivée, distance, temps), tri (route active épinglée, puis modification récente),
 * recherche et âge lisible. Fonctions pures, testées sans navigateur.
 */
import { computeNavLog, distance, litersPerHour, type Airfield } from "@lim/core";
import { icaoAt } from "./notam";
import { toWindPlan, type RouteRecord } from "./routeEdit";
import type { Lang } from "./i18n";

export interface RouteListItem {
  readonly id: string;
  readonly name: string;
  /** « LFHV → LFLM » (code OACI du terrain si le point en est un, sinon nom du point) ; vide sans point. */
  readonly label: string;
  readonly pointCount: number;
  readonly distanceM: number;
  /** Temps estimé (s) avec le vent de la route ; null sans avion (vitesse propre) ou avec moins de 2 points. */
  readonly timeSec: number | null;
  readonly updatedAt: number;
}

export function summarizeRoute(r: RouteRecord, airfields: readonly Airfield[], tasMps: number | null, date: Date): RouteListItem {
  const pts = r.points;
  const nm = (p: (typeof pts)[number]) => icaoAt(p.position, airfields) ?? p.name;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let label = pts.length >= 2 && first && last ? `${nm(first)} → ${nm(last)}` : first ? nm(first) : "";
  // Aller-retour (départ = arrivée) : « A ⇄ B » avec B le point le plus éloigné du départ.
  if (pts.length >= 3 && first && last && distance(first.position, last.position) < 3000) {
    let far = pts[1] as (typeof pts)[number];
    for (const p of pts) if (distance(first.position, p.position) > distance(first.position, far.position)) far = p;
    if (nm(far) !== nm(first)) label = `${nm(first)} ⇄ ${nm(far)}`;
  }
  let distanceM = 0;
  for (let i = 1; i < pts.length; i++) distanceM += distance((pts[i - 1] as (typeof pts)[number]).position, (pts[i] as (typeof pts)[number]).position);
  let timeSec: number | null = null;
  if (tasMps !== null && tasMps > 0 && pts.length >= 2) {
    const log = computeNavLog(r, { tas: tasMps as never, fuelFlow: litersPerHour(0) }, toWindPlan(r), date, r.departureMs);
    timeSec = (log.totals.timeWithWind ?? log.totals.timeNoWind) as number;
  }
  return { id: r.id, name: r.name, label, pointCount: pts.length, distanceM, timeSec, updatedAt: r.updatedAt };
}

/** La route active en premier, puis les autres de la plus récente à la plus ancienne. */
export function orderRoutes<T extends { id: string; updatedAt: number }>(items: readonly T[], activeId: string | null): T[] {
  return [...items].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : b.updatedAt - a.updatedAt));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Recherche par nom ou par « départ → arrivée » (sans accents ni casse). Requête vide = tout. */
export function filterRoutes<T extends { name: string; label: string }>(items: readonly T[], query: string): T[] {
  const q = norm(query.trim());
  if (q === "") return [...items];
  return items.filter((i) => norm(`${i.name} ${i.label}`).includes(q));
}

/** « à l'instant », « il y a 5 min », « il y a 3 h », « hier », « il y a 4 j ». */
export function ageText(updatedAt: number, nowMs: number, lang: Lang): string {
  const min = Math.max(0, (nowMs - updatedAt) / 60000);
  const fr = lang === "fr";
  if (min < 2) return fr ? "à l'instant" : "just now";
  if (min < 60) return fr ? `il y a ${Math.round(min)} min` : `${Math.round(min)} min ago`;
  const h = min / 60;
  if (h < 24) return fr ? `il y a ${Math.round(h)} h` : `${Math.round(h)} h ago`;
  const d = Math.floor(h / 24);
  if (d < 2) return fr ? "hier" : "yesterday";
  return fr ? `il y a ${d} j` : `${d} d ago`;
}
