import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { formatQuantity, fromSI, toSI, unitLabel, type Airspace, type NavLog, type RouteHit, type UnitPrefs } from "@lim/core";
import { Icon } from "./ui/Icon";
import { t, type Key, type Lang } from "./i18n";
import { periodStatus, sortAirspacesTopDown } from "./aeroGeo";
import { isGroundRelative, limitToMeters, niceStep, positionAlong, profileTop, routeProfilePoints } from "./spacesProfile";
import type { RouteRecord } from "./routeEdit";

const ZOOMS = [1, 1.5, 2, 3, 4, 6];
const stepZoom = (z: number, dir: 1 | -1) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + dir))] ?? 1;

type Status = "inside" | "unknown" | "outside";
const ICON = { inside: "triangle-alert", unknown: "diamond-alert", outside: "circle-check" } as const;
const STATUS_KEY: Record<Status, Key> = { inside: "sp.inside", unknown: "sp.unknown", outside: "sp.outside" };

/** Un bloc par espace, de la première entrée à la dernière sortie (un espace traversé deux fois reste un seul bloc). */
function Profile(p: { hits: RouteHit[]; route: RouteRecord; prefs: UnitPrefs; T: (k: Key) => string; zx: number; zy: number; cursorM: number | null; aircraftM: number | null; onCursor: (d: number | null) => void }) {
  const { hits, prefs, T } = p;
  const pts = routeProfilePoints(p.route.points);
  const total = pts[pts.length - 1]?.d ?? 0;
  const alts = pts.map((x) => x.alt).filter((a): a is number => a !== null);
  const aU = (m: number) => fromSI("altitude", prefs, m);
  const routeMaxDisp = alts.length ? aU(Math.max(...alts)) : 0;
  const topDisp = profileTop(routeMaxDisp, prefs.altitude === "ft" ? 8000 : 2500);
  const topM = toSI("altitude", prefs, topDisp);
  const stepDisp = niceStep(topDisp, 5 * p.zy);

  // Zoom : le dessin grandit (marges et textes gardent leur taille), le cadre défile.
  const W = 800 * p.zx, H = 320 * p.zy, L = 52, R = 12, Tm = 30, B = 30;
  const pw = W - L - R, ph = H - Tm - B;
  const X = (m: number) => L + (total === 0 ? 0 : (m / total) * pw);
  const Y = (m: number) => Tm + ph - (Math.min(Math.max(m, 0), topM) / topM) * ph;

  const drawn = hits
    .filter((h) => limitToMeters(h.airspace.lower) < topM)
    .sort((a, b) => (b.exit - b.entry) * (limitToMeters(b.airspace.upper) - limitToMeters(b.airspace.lower)) - (a.exit - a.entry) * (limitToMeters(a.airspace.upper) - limitToMeters(a.airspace.lower)));
  // Noms : on ne pose pas un nom sur un autre (même zone du dessin) ; les espaces les plus hauts sont servis d'abord.
  const placed: { x1: number; x2: number; y: number }[] = [];
  const labelOf = new Map<string, string>();
  [...drawn].sort((a, b) => limitToMeters(b.airspace.upper) - limitToMeters(a.airspace.upper)).forEach((h) => {
    const a = h.airspace;
    const x1 = X(h.entry), x2 = X(h.exit), y = Y(Math.min(limitToMeters(a.upper), topM)) + 13;
    const hh = Y(limitToMeters(a.lower)) - Y(Math.min(limitToMeters(a.upper), topM));
    if (x2 - x1 <= 56 || hh <= 16) return;
    const maxCh = Math.floor((x2 - x1 - 8) / 6.2);
    const full = a.icaoClass ? `${a.name} · ${a.icaoClass}` : a.name;
    const text = full.length > maxCh ? `${full.slice(0, maxCh - 1)}…` : full;
    const bx2 = x1 + 5 + text.length * 6.2;
    if (placed.some((q) => Math.abs(q.y - y) < 12 && q.x1 < bx2 && x1 + 5 < q.x2)) return;
    placed.push({ x1: x1 + 5, x2: bx2, y });
    labelOf.set(a.id, text);
  });
  const dU = (m: number) => fromSI("distance", prefs, m);
  const distStep = niceStep(dU(total), 5 * p.zx);
  const xTicks: number[] = [];
  for (let v = 0; v <= dU(total) + 1e-9; v += distStep) xTicks.push(v);
  const yTicks: number[] = [];
  for (let v = 0; v <= topDisp + 1e-9; v += stepDisp) yTicks.push(v);
  const polyline = pts.filter((x) => x.alt !== null).map((x) => `${X(x.d)},${Y(x.alt as number)}`).join(" ");

  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || total === 0) return;
    const d = ((((e.clientX - r.left) / r.width) * W - L) / pw) * total;
    p.onCursor(Math.min(total, Math.max(0, d)));
  };
  const cur = p.cursorM;
  return (
    <svg className="sp-svg" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => p.onCursor(null)} viewBox={`0 0 ${W} ${H}`} style={{ width: `${p.zx * 100}%`, minWidth: 560 * p.zx }} role="img" aria-label={T("sp.profileAria")}>
      <defs>
        <pattern id="sp-gnd" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="2" /></pattern>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="sp-grid" x1={L} x2={W - R} y1={Y(toSI("altitude", prefs, v))} y2={Y(toSI("altitude", prefs, v))} />
          <text className="sp-tick" x={L - 6} y={Y(toSI("altitude", prefs, v)) + 4} textAnchor="end">{v.toLocaleString("fr-FR")}</text>
        </g>
      ))}
      <text className="sp-tick" x={L - 6} y={Tm - 18} textAnchor="end">{unitLabel("altitude", prefs)}</text>
      {drawn.map((h) => {
        const a = h.airspace;
        const lo = limitToMeters(a.lower), up = Math.min(limitToMeters(a.upper), topM);
        const x1 = X(h.entry), x2 = X(h.exit), y1 = Y(up), y2 = Y(lo);
        const dashed = isGroundRelative(a.lower) || isGroundRelative(a.upper) || h.vertical === "unknown";
        const w = Math.max(2, x2 - x1), hh = Math.max(2, y2 - y1);
        return (
          <g key={a.id} className={`sp-box ${h.vertical}${cur !== null && cur >= h.entry && cur <= h.exit ? " at" : ""}`}>
            <title>{`${a.name} — ${a.typeLabel}${a.icaoClass ? ` ${p.T("sp.class")} ${a.icaoClass}` : ""} — ${a.upper.label} / ${a.lower.label}`}</title>
            <rect x={x1} y={y1} width={w} height={hh} strokeDasharray={dashed ? "6 3" : undefined} />
            {labelOf.has(a.id) && <text x={x1 + 5} y={y1 + 13}>{labelOf.get(a.id)}</text>}
          </g>
        );
      })}
      <rect className="sp-ground" x={L} y={Y(0)} width={pw} height={B - 14} fill="url(#sp-gnd)" />
      <line className="sp-base" x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} />
      {polyline && <polyline className="sp-route" points={polyline} />}
      {pts.map((q, i) => (
        <g key={i}>
          <line className="sp-wpt" x1={X(q.d)} x2={X(q.d)} y1={Tm - 8} y2={Y(0)} />
          <circle className="sp-dot" cx={X(q.d)} cy={Tm - 10} r="4" />
          {(i === 0 || i === pts.length - 1) && (
            <text className="sp-wname" x={i === 0 ? X(q.d) + 8 : X(q.d) - 8} y={Tm - 14} textAnchor={i === 0 ? "start" : "end"}>{p.route.points[i]?.name ?? ""}</text>
          )}
        </g>
      ))}
      {p.aircraftM !== null && (
        <g className="sp-ac"><line x1={X(p.aircraftM)} x2={X(p.aircraftM)} y1={Tm - 8} y2={Y(0)} /><path d={`M${X(p.aircraftM)} ${Tm - 4} l-6 -10 h12 z`} /></g>
      )}
      {cur !== null && (
        <g className="sp-cursor" pointerEvents="none">
          <line x1={X(cur)} x2={X(cur)} y1={Tm - 8} y2={Y(0)} />
          <circle cx={X(cur)} cy={Tm - 10} r="5" />
        </g>
      )}
      {xTicks.map((v) => <text key={v} className="sp-tick" x={L + (total === 0 ? 0 : (toSI("distance", prefs, v) / total) * pw)} y={H - 8} textAnchor="middle">{v}</text>)}
      <text className="sp-tick" x={W - R} y={H - 8} textAnchor="end">{unitLabel("distance", prefs)}</text>
    </svg>
  );
}

function Card(p: { hit: RouteHit; prefs: UnitPrefs; nowMs: number; minutes: number | null; T: (k: Key) => string }) {
  const { hit: h, prefs, T } = p;
  const a: Airspace = h.airspace;
  const dist = (m: number) => `${formatQuantity("distance", prefs, m)}`;
  const du = unitLabel("distance", prefs);
  const st = periodStatus(a, p.nowMs);
  const f0 = a.frequencies[0];
  const status = h.vertical as Status;
  return (
    <div className={`sp-card ${status}`}>
      <div className="sp-ct">
        <b>{a.name}</b>
        <span className={`sp-st ${status}`}><Icon name={ICON[status]} size={16} />{T(STATUS_KEY[status])}</span>
      </div>
      <div className="sp-cd">{a.typeLabel}{a.icaoClass ? ` · ${T("sp.class")} ${a.icaoClass}` : ""}{st === null ? "" : ` · ${T(st === "upcoming" ? "navasp.upcoming" : st === "ended" ? "navasp.ended" : "navasp.current")}`}</div>
      <dl className="sp-lim">
        <dt>{T("sp.ceiling")}</dt><dd>{a.upper.label}</dd>
        <dt>{T("sp.floor")}</dt><dd>{a.lower.label}</dd>
      </dl>
      <div className="sp-cf"><span>{T("sp.entry")}</span> {dist(h.entry)} <span>· {T("sp.exit")}</span> {dist(h.exit)} {du}{p.minutes !== null && <><span> · {T("sp.inside.time")}</span> ≈ {p.minutes} min</>}</div>
      {f0 && <div className="sp-cf"><span>{T("sp.freq")}</span> {f0.mhz} {f0.name}</div>}
      {(a.byNotam || a.onRequest) && <div className="sp-cf warn">{T("navasp.activation")}</div>}
    </div>
  );
}

export function SpacesTab(p: {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord | null;
  /** Espaces traversés, dans l'ordre de rencontre (calcul commun avec le log). */
  hits: RouteHit[];
  hasAero: boolean;
  navLog: NavLog | null;
  nowMs: number;
  exportedAtMs: number | null;
  /** Curseur partagé avec la carte : distance le long de la route (m), ou null. */
  cursorM: number | null;
  onCursor: (d: number | null) => void;
  /** Position de l'avion projetée sur la route (m), ou null. */
  aircraftM: number | null;
}): ReactNode {
  const T = (k: Key) => t(p.lang, k);
  const { route, hits } = p;
  const [zx, setZx] = useState(1);
  const [zy, setZy] = useState(1);
  if (!route || route.points.length < 2) return <div className="sp-page"><p className="muted">{T("navlog.needPoints")}</p></div>;
  if (!p.hasAero) return <div className="sp-page"><p className="muted">{T("navasp.needData")}</p></div>;
  const withAlt = route.points.some((x) => x.altitude !== null);
  const sorted = sortAirspacesTopDown(hits.map((h) => ({ ...h, lower: h.airspace.lower, upper: h.airspace.upper })));
  const rel = sorted.filter((h) => h.vertical !== "outside") as unknown as RouteHit[];
  const out = sorted.filter((h) => h.vertical === "outside") as unknown as RouteHit[];
  const count = (v: Status) => hits.filter((h) => h.vertical === v).length;
  const totalSec = p.navLog ? ((p.navLog.totals.timeWithWind ?? p.navLog.totals.timeNoWind) as number) : null;
  const totalM = p.navLog ? (p.navLog.totals.distance as number) : null;
  const minutes = (h: RouteHit) => (totalSec !== null && totalM ? Math.max(1, Math.round((((h.exit - h.entry) / totalM) * totalSec) / 60)) : null);
  const here = p.cursorM !== null ? positionAlong(route.points, p.cursorM) : null;
  const atCursor = p.cursorM === null ? [] : sorted.filter((h) => p.cursorM! >= h.entry && p.cursorM! <= h.exit);
  const readout = here && p.cursorM !== null ? (
    <>
      <b>{formatQuantity("distance", p.prefs, p.cursorM)} {unitLabel("distance", p.prefs)}</b>
      {here.alt !== null && <span> · {T("sp.routeAlt")} {formatQuantity("altitude", p.prefs, here.alt)} {unitLabel("altitude", p.prefs)}</span>}
      <div className="sp-here">
        {atCursor.length === 0 ? T("sp.noneHere") : atCursor.map((h) => (
          <span key={h.airspace.id} className={`sp-hc ${h.vertical}`}><Icon name={ICON[h.vertical as Status]} size={16} />{h.airspace.name}{h.airspace.icaoClass ? ` · ${h.airspace.icaoClass}` : ""} <i>{h.airspace.upper.label} / {h.airspace.lower.label}</i></span>
        ))}
      </div>
    </>
  ) : <span className="sp-hint">{T("sp.hint")}</span>;
  const exported = p.exportedAtMs !== null ? new Date(p.exportedAtMs).toLocaleDateString(p.lang === "fr" ? "fr-FR" : "en-GB") : null;
  return (
    <div className="sp-page">
      {hits.length === 0 ? (
        <p className="muted">{T("navasp.none")}</p>
      ) : (
        <>
          <div className="sp-sum">
            <span className="sp-chip inside"><Icon name="triangle-alert" size={16} />{count("inside")} {T("sp.chipInside")}</span>
            <span className="sp-chip unknown"><Icon name="diamond-alert" size={16} />{count("unknown")} {T("sp.chipUnknown")}</span>
            <span className="sp-chip outside"><Icon name="circle-check" size={16} />{count("outside")} {T("sp.chipOutside")}</span>
          </div>
          <section className="sp-sec">
            <h3>{T("sp.profile")}</h3>
            <div className="sp-zoom" role="group" aria-label={T("sp.zoom")}>
              <span className="sp-zl">{T("sp.zoomDist")}</span>
              <Button size="touch" icon="minus" aria-label={`${T("sp.zoomOut")} ${T("sp.zoomDist")}`} disabled={zx <= 1} onClick={() => setZx(stepZoom(zx, -1))} />
              <b className="sp-zv">×{zx}</b>
              <Button size="touch" icon="plus" aria-label={`${T("sp.zoomIn")} ${T("sp.zoomDist")}`} disabled={zx >= ZOOMS[ZOOMS.length - 1]!} onClick={() => setZx(stepZoom(zx, 1))} />
              <span className="sp-zl">{T("sp.zoomAlt")}</span>
              <Button size="touch" icon="minus" aria-label={`${T("sp.zoomOut")} ${T("sp.zoomAlt")}`} disabled={zy <= 1} onClick={() => setZy(stepZoom(zy, -1))} />
              <b className="sp-zv">×{zy}</b>
              <Button size="touch" icon="plus" aria-label={`${T("sp.zoomIn")} ${T("sp.zoomAlt")}`} disabled={zy >= ZOOMS[ZOOMS.length - 1]!} onClick={() => setZy(stepZoom(zy, 1))} />
              {(zx > 1 || zy > 1) && <Button size="touch" icon="rotate-ccw" onClick={() => { setZx(1); setZy(1); }}>{T("sp.zoomReset")}</Button>}
            </div>
            <div className="sp-profile"><Profile hits={hits} route={route} prefs={p.prefs} T={T} zx={zx} zy={zy} cursorM={p.cursorM} aircraftM={p.aircraftM} onCursor={p.onCursor} /></div>
            <div className="sp-readout" aria-live="polite">{readout}</div>
            <div className="sp-legend">
              <span><svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" className="sp-route" /></svg>{T("sp.legendRoute")}</span>
              <span className="inside"><Icon name="triangle-alert" size={16} />{T("sp.legendInside")}</span>
              <span className="unknown"><Icon name="diamond-alert" size={16} />{T("sp.legendUnknown")}</span>
              <span className="outside"><Icon name="circle-check" size={16} />{T("sp.legendOutside")}</span>
            </div>
            {!withAlt && <p className="sp-note"><Icon name="info" size={16} />{T("sp.noAlt")}</p>}
            <p className="sp-note"><Icon name="info" size={16} />{T("sp.note")}</p>
          </section>
          <section className="sp-sec">
            <h3>{T("sp.topDown")}</h3>
            <div className="sp-list">{rel.map((h) => <Card key={h.airspace.id} hit={h} prefs={p.prefs} nowMs={p.nowMs} minutes={minutes(h)} T={T} />)}</div>
            {out.length > 0 && (
              <details className="sp-fold">
                <summary>{out.length} {T("navasp.outsideGroup")}</summary>
                <div className="sp-list">{out.map((h) => <Card key={h.airspace.id} hit={h} prefs={p.prefs} nowMs={p.nowMs} minutes={minutes(h)} T={T} />)}</div>
              </details>
            )}
          </section>
          <p className="sp-note"><Icon name="info" size={16} />{T("sp.source")}{exported ? ` — ${T("sp.export")} ${exported}` : ""}. {T("sp.verify")}</p>
        </>
      )}
    </div>
  );
}
