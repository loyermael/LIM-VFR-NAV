import { useLayoutEffect, useRef, useState } from "react";
import { formatQuantity, fromSI, toSI, unitLabel, type RouteHit, type UnitPrefs } from "@lim/core";
import { Icon } from "./ui/Icon";
import { t, type Key, type Lang } from "./i18n";
import type { RouteRecord } from "./routeEdit";
import { nextSpace, segmentsAhead, windowOptionsFor } from "./flightProfileView";
import { limitToMeters, isGroundRelative, niceStep, positionAlong, profileTop, routeProfilePoints } from "./spacesProfile";

/** Largeur disponible du conteneur (px), suivie au redimensionnement : le dessin garde ses textes à taille fixe. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const ICON = { inside: "triangle-alert", unknown: "diamond-alert", outside: "circle-check" } as const;

/**
 * Bandeau « profil des espaces en vol » : les prochains milles devant l'avion (altitude prévue, altitude GPS, points de route, espaces à l'altitude de la route).
 * Pas de relief (donnée absente) : le sol est la ligne 0. Tout est estimé d'après la route ; l'alerte d'espace reste celle de la carte.
 */
export function FlightProfile(p: {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord;
  hits: RouteHit[];
  /** Position de l'avion le long de la route (m), ou null s'il est loin de la route. */
  aircraftM: number | null;
  /** Vrai si une position GPS est disponible (sinon : attente du GPS, pas « hors route »). */
  hasFix: boolean;
  /** Altitude GPS de l'avion (m, MSL), ou null. */
  altitudeM: number | null;
  windowIdx: 0 | 1 | 2;
  showOutside: boolean;
  onWindow: (i: 0 | 1 | 2) => void;
  onClose: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const [ref, W] = useWidth();
  const opts = windowOptionsFor(p.prefs);
  const winDisp = opts[p.windowIdx];
  const winM = toSI("distance", p.prefs, winDisp);
  const du = unitLabel("distance", p.prefs);
  const au = unitLabel("altitude", p.prefs);
  const along = p.aircraftM;
  const segs = along === null ? [] : segmentsAhead(p.hits, along, winM, p.showOutside, winM * 0.12);
  const next = nextSpace(segs);
  const dist = (m: number) => formatQuantity("distance", p.prefs, m);

  const H = Math.max(90, Math.min(124, Math.round(window.innerHeight * 0.14))), L = 36, R = 8, Tm = 12, B = 18;
  const pw = W - L - R, ph = H - Tm - B;
  const x0 = 0.12;
  const X = (rel: number) => L + (x0 + (rel / winM) * (1 - x0)) * pw;
  const pts = routeProfilePoints(p.route.points);
  const altsInWin = along === null ? [] : [positionAlong(p.route.points, along)?.alt, positionAlong(p.route.points, along + winM)?.alt, ...pts.filter((q) => q.d >= along && q.d <= along + winM).map((q) => q.alt), p.altitudeM].filter((a): a is number => typeof a === "number");
  const maxDisp = altsInWin.length ? fromSI("altitude", p.prefs, Math.max(...altsInWin)) : 0;
  const topDisp = profileTop(maxDisp, p.prefs.altitude === "ft" ? 6000 : 2000);
  const topM = toSI("altitude", p.prefs, topDisp);
  const Y = (m: number) => Tm + ph - (Math.min(Math.max(m, 0), topM) / topM) * ph;
  const stepDisp = niceStep(topDisp, 3);

  let chart = null;
  if (along !== null) {
    const routeLine: string[] = [];
    const edge = (d: number) => positionAlong(p.route.points, d)?.alt ?? null;
    const a0 = edge(Math.max(0, along - winM * 0.12)), a1 = edge(along + winM);
    if (a0 !== null) routeLine.push(`${X(-winM * 0.12)},${Y(a0)}`);
    pts.filter((q) => q.alt !== null && q.d > along - winM * 0.12 && q.d < along + winM).forEach((q) => routeLine.push(`${X(q.d - along)},${Y(q.alt as number)}`));
    if (a1 !== null) routeLine.push(`${X(winM)},${Y(a1)}`);
    const yT: number[] = [];
    for (let v = 0; v <= topDisp + 1e-9; v += stepDisp) yT.push(v);
    const placed: { x1: number; x2: number; y: number }[] = [];
    chart = (
      <svg className="fp-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={T("fp.aria")}>
        <rect className="fp-sky" x={L} y={Tm} width={pw} height={ph} />
        {yT.map((v) => (
          <g key={v}>
            <line className="sp-grid" x1={L} x2={W - R} y1={Y(toSI("altitude", p.prefs, v))} y2={Y(toSI("altitude", p.prefs, v))} />
            <text className="sp-tick" x={L - 4} y={Y(toSI("altitude", p.prefs, v)) + 4} textAnchor="end">{v >= 1000 ? `${v / 1000}k` : v}</text>
          </g>
        ))}
        {[...segs].sort((a, b) => limitToMeters(b.airspace.upper) - limitToMeters(a.airspace.upper)).map((s) => {
          const a = s.airspace;
          const lo = limitToMeters(a.lower), up = Math.min(limitToMeters(a.upper), topM);
          if (lo >= topM) return null;
          const x1 = X(s.entry), x2 = X(s.exit), y1 = Y(up), y2 = Y(lo);
          const dashed = isGroundRelative(a.lower) || isGroundRelative(a.upper) || s.vertical === "unknown";
          const w = Math.max(2, x2 - x1);
          const label = a.icaoClass ? `${a.name} · ${a.icaoClass}` : a.name;
          const maxCh = Math.floor((w - 8) / 6.2);
          const shown = label.length > maxCh ? `${label.slice(0, Math.max(1, maxCh - 1))}…` : label;
          // pas de nom posé sur un autre : les espaces les plus hauts sont servis d'abord
          const lx2 = x1 + 4 + shown.length * 6.2, ly = y1 + 12;
          const clash = w <= 50 || y2 - y1 <= 14 || placed.some((q) => Math.abs(q.y - ly) < 12 && q.x1 < lx2 && x1 + 4 < q.x2);
          if (!clash) placed.push({ x1: x1 + 4, x2: lx2, y: ly });
          return (
            <g key={s.key} className={`sp-box ${s.vertical}`}>
              <rect x={x1} y={y1} width={w} height={Math.max(2, y2 - y1)} strokeDasharray={dashed ? "5 3" : undefined} />
              {!clash && <text x={x1 + 4} y={ly}>{shown}</text>}
            </g>
          );
        })}
        <line className="sp-base" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
        {routeLine.length > 1 && <polyline className="sp-route" points={routeLine.join(" ")} />}
        {p.route.points.map((_, i) => {
          const q = pts[i];
          if (!q || q.alt === null || q.d < along - winM * 0.12 || q.d > along + winM) return null;
          return (
            <g key={i} className="fp-wp">
              <circle cx={X(q.d - along)} cy={Y(q.alt)} r="10" />
              <text x={X(q.d - along)} y={Y(q.alt) + 4} textAnchor="middle">{i + 1}</text>
            </g>
          );
        })}
        <line className="fp-me" x1={X(0)} x2={X(0)} y1={Tm} y2={Y(0)} />
        {p.altitudeM !== null && (
          <g className="fp-ac">
            <path d={`M${X(0)} ${Y(p.altitudeM)} l-9 -6 v12 z`} />
            <text x={X(0) - 12} y={Math.max(Tm + 10, Y(p.altitudeM) - 8)} textAnchor="end">{formatQuantity("altitude", p.prefs, p.altitudeM)} {au}</text>
          </g>
        )}
        {[0, 0.5, 1].map((f) => <text key={f} className="sp-tick" x={f === 1 ? W - R : X(winM * f)} y={H - 4} textAnchor={f === 1 ? "end" : "middle"}>{f === 0 ? "0" : `+${Math.round(winDisp * f)}${f === 1 ? ` ${du}` : ""}`}</text>)}
      </svg>
    );
  }

  return (
    <section className="fprofile" aria-label={T("fp.title")}>
      <div className="fp-bar">
        <div className="fp-next" aria-live="polite">
          {along === null ? (
            <span className="fp-hint">{T(p.hasFix ? "fp.offRoute" : "fp.noGps")}</span>
          ) : next ? (
            <>
              <b>{next.airspace.name}{next.airspace.icaoClass ? ` · ${next.airspace.icaoClass}` : ""}</b>
              <div className="fp-l2">
                <span className={`fp-st ${next.vertical}`}><Icon name={ICON[next.vertical]} size={16} />{next.here ? `${T("fp.inNow")} · ${T("fp.exit")} ${dist(next.exitIn)} ${du}` : `${T("fp.in")} ${dist(next.entryIn)} ${du}`}</span>
                <span className="fp-lim">{next.airspace.lower.label} → {next.airspace.upper.label}</span>
              </div>
            </>
          ) : (
            <span className="fp-hint">{T("fp.none")} {winDisp} {du}</span>
          )}
        </div>
        <div className="fp-seg" role="group" aria-label={T("fp.window")}>
          {([0, 1, 2] as const).map((i) => (
            <button key={i} aria-pressed={p.windowIdx === i} onClick={() => p.onWindow(i)}>{opts[i]}</button>
          ))}
        </div>
        <button className="fp-close" aria-label={T("fp.hide")} title={T("fp.hide")} onClick={p.onClose}><Icon name="x" size={20} /></button>
      </div>
      <div className="fp-chart" ref={ref}>{chart}</div>
    </section>
  );
}
