import { Icon } from "./ui/Icon";
import { Button } from "./ui/Button";
import { ConfirmButton } from "./ui/ConfirmButton";
import { useId, useMemo, useRef, useState } from "react";
import { TextField } from "./ui/TextField";
import { TrashButton } from "./ui/TrashButton";
import { StatusBanner, LevelMark } from "./ui/StatusBanner";
import { ResultTable } from "./ui/ResultTable";
import { UnitField } from "./ui/UnitField";
import { fillLevel, levelOf, minMargin, niceAxis, placeLabels, worst, type Level } from "./balanceView";
import {
  computeBalance, formatDuration, formatQuantity, fromSI, planFuel, toSI, unitLabel, validateAircraft,
  type Aircraft, type BalanceIssue, type BalanceState, type Loads, type StationKind, type UnitPrefs,
} from "@lim/core";
import { MiniNum, NumField } from "./NavScreen";
import { Section } from "./Section";
import { t, type Key, type Lang } from "./i18n";
import {
  addStation, addVertex, duplicateAircraft, envelopeArea, envelopeSelfIntersects, insertStation, insertVertex, newAircraft, orderEnvelope, patchAircraft, patchFuel, patchStation,
  patchVertex, removeStation, removeVertex,
} from "./aircraftEdit";
import type { FuelPlanParams } from "./aircraftStore";

const ISSUE_KEYS: Record<BalanceIssue, Key> = {
  overweight: "bal.issue.overweight",
  "overweight-landing": "bal.issue.overweightLanding",
  "cg-forward": "bal.issue.cgForward",
  "cg-aft": "bal.issue.cgAft",
  "outside-envelope": "bal.issue.outside",
  "station-overload": "bal.issue.station",
  "fuel-over-capacity": "bal.issue.fuelCap",
  "negative-load": "bal.issue.negative",
};

export interface ChartPhase { key: string; name: string; state: BalanceState; level: Level }
const LEVEL_COLOR: Record<Level, string> = { ok: "var(--zone-good)", caution: "var(--caution)", bad: "var(--signal)" };
const fmtCg = (lang: Lang, v: number) => (Number.isFinite(v) ? (lang === "fr" ? v.toFixed(3).replace(".", ",") : v.toFixed(3)) : "—");
const mmOf = (m: number | null) => (m === null || !Number.isFinite(m) ? "—" : String(Math.round(m * 1000)));

/**
 * Graphique d'enveloppe : masse (kg) en fonction du bras du CG (m). Graduations rondes, cadrage serré, points reliés
 * dans l'ordre des phases (flèches), une forme par phase et une couleur par état, étiquettes sans recouvrement.
 */
export function BalanceChart(p: { aircraft: Aircraft; phases: ChartPhase[]; label: (k: Key) => string; lang: Lang }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [sel, setSel] = useState<number | null>(null);
  const env = p.aircraft.envelope;
  if (env.length < 3) return null;
  const maxMass = p.aircraft.maxTakeoffMass > 0 ? p.aircraft.maxTakeoffMass : null;
  const pts = p.phases.map((ph) => ph.state).filter((st) => Number.isFinite(st.cg));
  const xs = [...env.map((v) => v[0]), ...pts.map((st) => st.cg)];
  const ys = [...env.map((v) => v[1]), ...pts.map((st) => st.mass), ...(maxMass !== null ? [maxMass] : [])];
  const ax = niceAxis(Math.min(...xs), Math.max(...xs), 7);
  const ay = niceAxis(Math.min(...ys), Math.max(...ys), 7);
  const W = 420, H = 320, L = 50, R = 14, T = 16, B = 38;
  const sx = (x: number) => L + ((x - ax.lo) / (ax.hi - ax.lo)) * (W - L - R);
  const sy = (y: number) => H - B - ((y - ay.lo) / (ay.hi - ay.lo)) * (H - T - B);
  const xDec = ax.step < 0.01 ? 3 : ax.step < 0.1 ? 2 : 1;
  const poly = env.map((v) => `${sx(v[0])},${sy(v[1])}`).join(" ");
  const shown = p.phases.map((ph, idx) => ({ ph, idx })).filter(({ ph }) => Number.isFinite(ph.state.cg));
  const q = shown.map(({ ph }) => ({ x: sx(ph.state.cg), y: sy(ph.state.mass) }));
  const placed = placeLabels(shown.map(({ ph }, k) => ({ x: (q[k] as { x: number }).x, y: (q[k] as { y: number }).y, text: ph.name })), { x: L, y: T, w: W - L - R, h: H - T - B }, 12, 9);
  const marker = (idx: number, x: number, y: number, color: string) => {
    if (idx === 0) return <rect x={x - 6.5} y={y - 6.5} width={13} height={13} fill={color} stroke="var(--ink)" strokeWidth="1.5" />;
    if (idx === 1) return <circle cx={x} cy={y} r={7.5} fill={color} stroke="var(--ink)" strokeWidth="1.5" />;
    return <path d={`M${x} ${y - 9} L${x + 8} ${y + 6} L${x - 8} ${y + 6} Z`} fill={color} stroke="var(--ink)" strokeWidth="1.5" />;
  };
  const sPh = sel !== null ? p.phases[sel] : undefined;
  return (
    <div className="balchart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="balchart" role="img" aria-label={p.label("bal.chart")}>
        <defs>
          <marker id={`ar${uid}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10Z" fill="var(--ink)" /></marker>
        </defs>
        {ax.ticks.map((x) => (
          <g key={`x${x}`}>
            <line x1={sx(x)} y1={T} x2={sx(x)} y2={H - B} stroke="var(--hair)" />
            <text x={sx(x)} y={H - B + 15} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)">{x.toFixed(xDec)}</text>
          </g>
        ))}
        {ay.ticks.map((y) => (
          <g key={`y${y}`}>
            <line x1={L} y1={sy(y)} x2={W - R} y2={sy(y)} stroke="var(--hair)" />
            <text x={L - 5} y={sy(y) + 4} fontSize="11" fontFamily="var(--font-mono)" textAnchor="end" fill="var(--ink-muted)">{Math.round(y)}</text>
          </g>
        ))}
        <polygon points={poly} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2" />
        {maxMass !== null && (
          <g>
            <line x1={L} y1={sy(maxMass)} x2={W - R} y2={sy(maxMass)} stroke="var(--signal)" strokeWidth="1.5" strokeDasharray="6 4" />
            <text x={W - R - 4} y={sy(maxMass) - 5} fontSize="11" fontFamily="var(--font-mono)" fontWeight="700" textAnchor="end" fill="var(--signal)">{p.label("bal.maxMass")} {maxMass}</text>
          </g>
        )}
        {q.slice(0, -1).map((a, k) => {
          const b = q[k + 1] as { x: number; y: number };
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if (d < 26) return null;
          const f = 12 / d;
          return <line key={k} x1={a.x + dx * f} y1={a.y + dy * f} x2={b.x - dx * f} y2={b.y - dy * f} stroke="var(--ink)" strokeWidth="1.6" markerEnd={`url(#ar${uid})`} />;
        })}
        {shown.map(({ ph, idx }, k) => {
          const pt = q[k] as { x: number; y: number };
          const pl = placed[k]!;
          return (
            <g key={ph.key} role="button" tabIndex={0} aria-label={`${ph.name} : ${Math.round(ph.state.mass)} kg, CG ${fmtCg(p.lang, ph.state.cg)} m`} className="bal-pt"
              onClick={() => setSel(sel === idx ? null : idx)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(sel === idx ? null : idx)}>
              {pl.leader && <line x1={pt.x} y1={pt.y} x2={pt.x + pl.dx + (pl.anchor === "end" ? 2 : pl.anchor === "start" ? -2 : 0)} y2={pt.y + pl.dy - 4} stroke="var(--ink-muted)" strokeWidth="1" />}
              {marker(idx, pt.x, pt.y, LEVEL_COLOR[ph.level])}
              <text x={pt.x + pl.dx} y={pt.y + pl.dy} textAnchor={pl.anchor} fontSize="12" fontWeight="700" fontFamily="var(--font-mono)" fill="var(--ink)" paintOrder="stroke" stroke="var(--paper)" strokeWidth="3">{ph.name}</text>
              <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" />
              <title>{`${ph.name} — ${Math.round(ph.state.mass)} kg · CG ${fmtCg(p.lang, ph.state.cg)} m · ${p.label("bal.margin").toLowerCase()} ${mmOf(ph.state.cgMargin)} mm`}</title>
            </g>
          );
        })}
        <text x={(L + W - R) / 2} y={H - 4} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)">{p.label("bal.axisArm")}</text>
        <text x={12} y={(T + H - B) / 2} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{p.label("bal.axisMass")}</text>
      </svg>
      <div className="bal-legend">
        <span>■ {p.phases[0]?.name}</span><span>● {p.phases[1]?.name}</span><span>▲ {p.phases[2]?.name}</span>
        <span className="lvl-ok">● {p.label("bal.ok")}</span><span className="lvl-caution">● {p.label("bal.status.caution")}</span><span className="lvl-bad">● {p.label("bal.limit")}</span>
      </div>
      <p className="bal-readout muted small" aria-live="polite">
        {sPh ? <><b>{sPh.name}</b> — {Math.round(sPh.state.mass)} kg · CG {fmtCg(p.lang, sPh.state.cg)} m · {p.label("bal.margin").toLowerCase()} {mmOf(sPh.state.cgMargin)} mm</> : p.label("bal.tapHint")}
      </p>
    </div>
  );
}

const KINDS: StationKind[] = ["occupant", "baggage", "fuel", "other"];

/** Aperçu de l'enveloppe, tracé en direct pendant la saisie : axes gradués (valeurs rondes), sommets numérotés. */
function EnvelopeSketch({ aircraft, label }: { aircraft: Aircraft; label: { arm: string; mass: string; aria: string } }) {
  const e = aircraft.envelope;
  if (e.length < 2) return null;
  const ax = niceAxis(Math.min(...e.map((v) => v[0])), Math.max(...e.map((v) => v[0])), 7);
  const ay = niceAxis(Math.min(...e.map((v) => v[1])), Math.max(...e.map((v) => v[1])), 7);
  const W = 420, H = 300, L = 46, R = 12, T = 14, B = 34;
  const sx = (x: number) => L + ((x - ax.lo) / (ax.hi - ax.lo || 1)) * (W - L - R);
  const sy = (y: number) => H - B - ((y - ay.lo) / (ay.hi - ay.lo || 1)) * (H - T - B);
  const xDec = ax.step < 0.01 ? 3 : ax.step < 0.1 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="balchart ac-sketch" role="img" aria-label={label.aria}>
      {ax.ticks.map((x) => (
        <g key={`x${x}`}>
          <line x1={sx(x)} y1={T} x2={sx(x)} y2={H - B} stroke="var(--hair)" />
          <text x={sx(x)} y={H - B + 14} fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)">{x.toFixed(xDec)}</text>
        </g>
      ))}
      {ay.ticks.map((y) => (
        <g key={`y${y}`}>
          <line x1={L} y1={sy(y)} x2={W - R} y2={sy(y)} stroke="var(--hair)" />
          <text x={L - 5} y={sy(y) + 3} fontSize="10" fontFamily="var(--font-mono)" textAnchor="end" fill="var(--ink-muted)">{Math.round(y)}</text>
        </g>
      ))}
      <polygon points={e.map((v) => `${sx(v[0])},${sy(v[1])}`).join(" ")} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2" />
      {e.map((v, i) => (
        <g key={i}>
          <circle cx={sx(v[0])} cy={sy(v[1])} r="9" fill="var(--ink)" />
          <text x={sx(v[0])} y={sy(v[1]) + 4} fontSize="11" fontWeight="700" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--paper)">{i + 1}</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 3} fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)">{label.arm}</text>
      <text x={10} y={(T + H - B) / 2} fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)" transform={`rotate(-90 10 ${(T + H - B) / 2})`}>{label.mass}</text>
    </svg>
  );
}

const dec1 = (v: number | null) => (v === null || Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);

/** Éditeur d'une fiche avion, en sections repliables. Aucune valeur par défaut : tout vient du manuel de vol et de la pesée. */
export function AircraftEditor(p: {
  lang: Lang; prefs: UnitPrefs; aircraft: Aircraft; onChange: (a: Aircraft) => void; onDone: () => void;
  /** Propose d'annuler une suppression (toast « Annuler »). */
  onUndoable?: ((text: string, restore: () => void) => void) | undefined;
}) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.aircraft;
  const latest = useRef(a);
  latest.current = a;
  const now = () => Date.now();
  const set = (patch: Partial<Aircraft>) => p.onChange(patchAircraft(a, patch, now()));
  const fuelUnit = unitLabel("fuel", p.prefs);
  const speedUnit = unitLabel("groundSpeed", p.prefs);
  const optional = T("ac.optional");
  const ok = {
    cruise: a.tasMps !== null && a.fuelFlowLph !== null,
    mass: a.emptyMass > 0 && a.maxTakeoffMass > a.emptyMass,
    fuel: a.fuel.capacity > 0 && a.fuel.density > 0,
    stations: a.stations.length > 0 && a.stations.every((s) => s.arm !== 0),
    envelope: a.envelope.length >= 3 && envelopeArea(a) > 1e-6,
  };
  const order = ["cruise", "mass", "fuel", "stations", "envelope"] as const;
  const titles: Record<(typeof order)[number], string> = { cruise: T("ac.cruise"), mass: T("ac.mass"), fuel: T("ac.fuel"), stations: T("ac.stations"), envelope: T("ac.envelope") };
  const todo = order.filter((k) => !ok[k]);
  // À l'ouverture : la première section à compléter est ouverte (les autres repliées) ; fiche complète : tout est replié.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(todo.length > 0 ? [todo[0] as string] : []));
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const goto = (id: string) => {
    setOpen((cur) => new Set([...cur, id]));
    requestAnimationFrame(() => document.getElementById(`sect-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };
  const sec = (id: (typeof order)[number], children: React.ReactNode) => (
    <Section id={id} title={titles[id]} ok={ok[id]} open={open.has(id)} onToggle={toggle} okLabel={T("ac.secOk")} todoLabel={T("ac.secTodo")}>{children}</Section>
  );
  const crossed = envelopeSelfIntersects(a.envelope);
  const kg = (label: string, v: number | null, commit: (v: number | null) => void, opt = false) => (
    <UnitField layout="stack" label={label} unit="kg" decimals={dec1(v)} value={v} optional={opt ? optional : undefined} onCommit={commit} />
  );
  return (
    <div className="navscreen aced">
      <div className="acbar">
        <button className="has-icon" onClick={p.onDone}><Icon name="arrow-left" size={20} />{T("ac.list")}</button>
      </div>
      <div className="aced-title">
        <h2>{a.registration || a.name}</h2>
        {a.registration && <div className="aced-sub">{a.name}</div>}
      </div>
      <div className="aced-grid">
        <TextField label={T("ac.registration")} value={a.registration} upper onCommit={(v) => set({ registration: v.toUpperCase() })} />
        <TextField label={T("ac.typeModel")} value={a.name} onCommit={(v) => v && set({ name: v })} />
      </div>
      <div className="ac-progress" role="group" aria-label={T("ac.progress")}>
        <span className="ac-segs">{order.map((k) => <button key={k} type="button" className={ok[k] ? "seg done" : "seg"} title={titles[k]} aria-label={`${titles[k]} : ${ok[k] ? T("ac.secOk") : T("ac.secTodo")}`} onClick={() => goto(k)} />)}</span>
        <span className={todo.length === 0 ? "muted small" : "small"}>{todo.length === 0 ? T("ac.ready") : `${T("ac.progress")} : ${order.length - todo.length} / ${order.length}`}</span>
      </div>
      <p className="muted small">{T("ac.warning")}</p>

      {sec("cruise", (
        <div className="aced-grid">
          <UnitField layout="stack" label={T("nav.tas")} unit={speedUnit} value={a.tasMps === null ? null : fromSI("groundSpeed", p.prefs, a.tasMps)} onCommit={(v) => set({ tasMps: v !== null && v > 0 ? toSI("groundSpeed", p.prefs, v) : null })} />
          <UnitField layout="stack" label={T("nav.fuelflow")} unit={`${fuelUnit}/h`} decimals={1} value={a.fuelFlowLph === null ? null : fromSI("fuel", p.prefs, a.fuelFlowLph)} onCommit={(v) => set({ fuelFlowLph: v !== null && v > 0 ? toSI("fuel", p.prefs, v) : null })} />
        </div>
      ))}

      {sec("mass", (
        <div className="aced-grid">
          {kg(T("ac.emptyMass"), a.emptyMass || null, (v) => set({ emptyMass: v ?? 0 }))}
          <UnitField layout="stack" label={T("ac.emptyArm")} unit="m" decimals={3} value={a.emptyMass ? a.emptyArm : null} onCommit={(v) => set({ emptyArm: v ?? 0 })} />
          {kg(T("ac.mtow"), a.maxTakeoffMass || null, (v) => set({ maxTakeoffMass: v ?? 0 }))}
          {kg(T("ac.mlw"), a.maxLandingMass, (v) => set({ maxLandingMass: v }), true)}
        </div>
      ))}

      {sec("fuel", (
        <div className="aced-grid">
          <UnitField layout="stack" label={T("ac.capacity")} unit={fuelUnit} decimals={dec1(a.fuel.capacity ? fromSI("fuel", p.prefs, a.fuel.capacity) : null)} value={a.fuel.capacity ? fromSI("fuel", p.prefs, a.fuel.capacity) : null} onCommit={(v) => p.onChange(patchFuel(a, { capacity: v !== null ? toSI("fuel", p.prefs, v) : 0 }, now()))} />
          <UnitField layout="stack" label={T("ac.unusable")} unit={fuelUnit} decimals={dec1(a.fuel.unusable ? fromSI("fuel", p.prefs, a.fuel.unusable) : null)} value={a.fuel.unusable ? fromSI("fuel", p.prefs, a.fuel.unusable) : null} onCommit={(v) => p.onChange(patchFuel(a, { unusable: v !== null ? toSI("fuel", p.prefs, v) : 0 }, now()))} />
          <UnitField layout="stack" label={T("ac.density")} unit="kg/L" decimals={3} value={a.fuel.density} onCommit={(v) => v !== null && v > 0 && p.onChange(patchFuel(a, { density: v }, now()))} />
        </div>
      ))}

      {sec("stations", (
        <>
          <table className="edtable st">
            <thead>
              <tr>
                <th>{T("nav.name")}</th><th>{T("ac.colType")}</th>
                <th className="n">{T("ac.arm")} (m)</th><th className="n">{T("ac.maxMass")} (kg)</th><th><span className="sr-only">{T("nav.delete")}</span></th>
              </tr>
            </thead>
            <tbody>
              {a.stations.map((s, i) => (
                <tr key={s.id}>
                  <td className="c-n"><input className="ed-cell" defaultValue={s.name} key={`${s.id}-${s.name}`} aria-label={T("nav.name")} onBlur={(e) => p.onChange(patchStation(a, i, { name: e.target.value.trim() || s.name }, now()))} /></td>
                  <td className="c-t">
                    <select className="ed-cell sel" value={s.kind} aria-label={T("ac.kindLabel")} onChange={(e) => p.onChange(patchStation(a, i, { kind: e.target.value as StationKind }, now()))}>
                      {KINDS.map((k) => <option key={k} value={k}>{T(`ac.kind.${k}` as Key)}</option>)}
                    </select>
                  </td>
                  <td className="c-a" data-l={`${T("ac.arm")} (m)`}><MiniNum label={`${T("ac.arm")} (m)`} decimals={3} placeholder="—" value={s.arm || null} onCommit={(v) => p.onChange(patchStation(a, i, { arm: v ?? 0 }, now()))} /></td>
                  <td className="c-m" data-l={`${T("ac.maxMass")} (kg)`}>
                    {s.kind !== "fuel"
                      ? <MiniNum label={`${T("ac.maxMass")} (kg)`} decimals={dec1(s.maxMass)} placeholder="—" value={s.maxMass} onCommit={(v) => p.onChange(patchStation(a, i, { maxMass: v }, now()))} />
                      : <span className="cell-note">{T("ac.capacityShort")}</span>}
                  </td>
                  <td className="c-x">
                    <TrashButton label={T("nav.delete")} onClick={() => {
                      p.onChange(removeStation(a, i, now()));
                      p.onUndoable?.(`${T("ac.removed")} : ${s.name}`, () => p.onChange(insertStation(latest.current, i, s, now())));
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="addrow"><Button icon="plus" onClick={() => p.onChange(addStation(a, `${a.id}-${crypto.randomUUID().slice(0, 6)}`, now()))}>{T("ac.addStation")}</Button></div>
        </>
      ))}

      {sec("envelope", (
        <>
          <p className="muted small">{T("ac.envelopeHelp")}</p>
          {a.envelope.length >= 3 && envelopeArea(a) < 1e-6 && <p className="error" role="alert">{T("ac.degenerate")}</p>}
          {crossed && <p className="aced-warn" role="alert"><Icon name="diamond-alert" size={20} />{T("ac.crossed")}</p>}
          <div className="aced-env">
            <div className="aced-env-tab">
              {a.envelope.length > 0 && <table className="edtable vx">
                <thead><tr><th className="n">#</th><th className="n">{T("ac.arm")} (m)</th><th className="n">{T("ac.mass")} (kg)</th><th><span className="sr-only">{T("nav.delete")}</span></th></tr></thead>
                <tbody>
                  {a.envelope.map((v, i) => (
                    <tr key={i}>
                      <td className="num mono">{i + 1}</td>
                      <td><MiniNum label={`${i + 1} — ${T("ac.arm")} (m)`} decimals={3} value={v[0]} onCommit={(x) => x !== null && p.onChange(patchVertex(a, i, x, v[1], now()))} /></td>
                      <td><MiniNum label={`${i + 1} — ${T("ac.mass")} (kg)`} decimals={dec1(v[1])} value={v[1]} onCommit={(m) => m !== null && p.onChange(patchVertex(a, i, v[0], m, now()))} /></td>
                      <td>
                        <TrashButton label={T("nav.delete")} onClick={() => {
                          p.onChange(removeVertex(a, i, now()));
                          p.onUndoable?.(`${T("ac.removedVertex")} ${i + 1}`, () => p.onChange(insertVertex(latest.current, i, v, now())));
                        }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
              <div className="addrow">
                <Button icon="plus" onClick={() => p.onChange(addVertex(a, a.envelope[a.envelope.length - 1]?.[0] ?? 0, a.envelope[a.envelope.length - 1]?.[1] ?? 0, now()))}>{T("ac.addVertex")}</Button>
                <Button icon="arrow-left-right" title={T("ac.sortHint")} disabled={a.envelope.length < 3} onClick={() => p.onChange(orderEnvelope(a, now()))}>{T("ac.order")}</Button>
              </div>
            </div>
            <EnvelopeSketch aircraft={a} label={{ arm: `${T("ac.arm").toLowerCase()} (m)`, mass: `${T("ac.mass").toLowerCase()} (kg)`, aria: T("ac.envelope") }} />
          </div>
        </>
      ))}
      <div className="aced-bar">
        <span className="aced-saved"><Icon name="circle-check" size={16} />{T("ac.saved")}</span>
        <Button role="primary" icon="circle-check" onClick={p.onDone}>{T("ac.done")}</Button>
      </div>
    </div>
  );
}

interface AircraftTabProps {
  lang: Lang;
  prefs: UnitPrefs;
  aircraft: Aircraft[];
  active: Aircraft | null;
  onSelect: (id: string | null) => void;
  onPut: (a: Aircraft) => void;
  onRemove: (id: string) => void;
  onUndoable?: ((text: string, restore: () => void) => void) | undefined;
}

/** Onglet « Fiche » : liste de mes avions (état de chaque fiche), puis édition d'une seule fiche à la fois. */
export function AircraftTab(p: AircraftTabProps) {
  const T = (k: Key) => t(p.lang, k);
  const [editing, setEditing] = useState(false);
  const a = p.active;
  if (a && editing) return <AircraftEditor lang={p.lang} prefs={p.prefs} aircraft={a} onChange={p.onPut} onUndoable={p.onUndoable} onDone={() => setEditing(false)} />;
  const create = () => {
    const na = newAircraft(crypto.randomUUID(), `${T("ac.new")} ${p.aircraft.length + 1}`, Date.now());
    p.onPut(na);
    p.onSelect(na.id);
    setEditing(true);
  };
  const status = (x: Aircraft) => { const d = validateAircraft(x); return d.length === 0 ? T("ac.statusOk") : `${T("ac.statusTodo")} (${d.length})`; };
  return (
    <div className="navscreen">
      <h3>{T("ac.list")}</h3>
      {p.aircraft.length === 0 && <p className="muted">{T("ac.none")}</p>}
      <div className="route-list">
        {p.aircraft.map((x) => {
          const sel = a?.id === x.id;
          const tas = x.tasMps === null ? "---" : `${formatQuantity("groundSpeed", p.prefs, x.tasMps as never)} ${unitLabel("groundSpeed", p.prefs)}`;
          const flow = x.fuelFlowLph === null ? "---" : `${fromSI("fuel", p.prefs, x.fuelFlowLph).toFixed(1)} ${unitLabel("fuel", p.prefs)}/h`;
          const mtow = x.maxTakeoffMass > 0 ? `${x.maxTakeoffMass} kg` : "---";
          const done = validateAircraft(x).length === 0;
          return (
            <div className={sel ? "air-card sel" : "air-card"} key={x.id}>
              <button className="air-main" aria-current={sel ? "true" : undefined} onClick={() => p.onSelect(x.id)}>
                <span className="air-top">
                  {sel && <span className="route-badge"><Icon name="circle-check" size={16} />{T("ac.chosen")}</span>}
                  <span className={done ? "stat-good" : "stat-caution"}><Icon name={done ? "circle-check" : "diamond-alert"} size={16} />{status(x)}</span>
                </span>
                <b>{x.registration ? `${x.registration} · ` : ""}{x.name}</b>
                <span className="muted small">{T("nav.tas")} {tas} · {flow} · MTOW {mtow}</span>
              </button>
              {sel && (
                <div className="air-actions">
                  <Button size="touch" icon="pencil" onClick={() => setEditing(true)}>{T("ac.edit")}</Button>
                  <Button size="touch" icon="copy" onClick={() => { const c = duplicateAircraft(x, crypto.randomUUID(), Date.now()); p.onPut(c); p.onSelect(c.id); }}>{T("ac.duplicate")}</Button>
                  <ConfirmButton className="end" label={T("nav.delete")} confirmLabel={T("tr.confirmDelete")} onConfirm={() => p.onRemove(x.id)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="choices"><Button role="primary" icon="plus" onClick={create}>{T("ac.new")}</Button></div>
      {a && validateAircraft(a).length === 0 && <p className="muted small">{T("ac.ready")}</p>}
      <p className="muted small">{T("ac.warning")}</p>
    </div>
  );
}

interface BalanceProps {
  lang: Lang;
  prefs: UnitPrefs;
  active: Aircraft | null;
  loads: Loads;
  /** Carburant consommé pendant le vol selon le log de nav (L), ou null. */
  burnLiters: number | null;
  onLoads: (l: Loads) => void;
  onOpenSheet: () => void;
}

/** Onglet « Centrage » : chargement (colonne gauche) et résultats (colonne droite) de l'avion actif. */
export function BalanceTab(p: BalanceProps) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.active;
  const defects = a ? validateAircraft(a) : [];
  const res = useMemo(() => (a && defects.length === 0 ? computeBalance(a, p.loads, p.burnLiters ?? 0) : null), [a, p.loads, p.burnLiters]); // eslint-disable-line react-hooks/exhaustive-deps
  const fuelUnit = unitLabel("fuel", p.prefs);
  const dec = (v: number | null) => (v === null || Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);
  const phases: ChartPhase[] = res
    ? ([["zfm", "bal.zfm", res.zeroFuel], ["takeoff", "bal.takeoff", res.takeoff], ["landing", "bal.landing", res.landing]] as const).map(([key, k, state]) => ({ key, name: T(k), state, level: levelOf(state) }))
    : [];
  const overall = phases.reduce<Level>((l, ph) => worst(l, ph.level), "ok");
  const mm = minMargin(phases.map((ph) => ({ ...ph, state: ph.state })));
  const issues = res ? [...new Set([...res.zeroFuel.issues, ...res.takeoff.issues, ...res.landing.issues])] : [];
  const mto = a && res && a.maxTakeoffMass > 0 ? { mass: res.takeoff.mass, max: a.maxTakeoffMass, fill: fillLevel(res.takeoff.mass, a.maxTakeoffMass) } : null;
  return (
    <div className="navscreen acform bal">
      {!a && (
        <>
          <p className="muted">{T("fuel.noAircraft")}</p>
          <div className="choices"><Button role="primary" onClick={p.onOpenSheet}>{T("ac.goSheet")}</Button></div>
        </>
      )}
      {a && (
        <div className="bal-id">
          {a.registration ? <><b>{a.registration}</b><span>{a.name}</span></> : <b>{a.name}</b>}
        </div>
      )}
      {a && defects.length > 0 && (
        <>
          <p className="error" role="alert">{T("ac.missing")} : {defects.join(", ")}</p>
          <div className="choices"><Button role="primary" onClick={p.onOpenSheet}>{T("ac.goSheet")}</Button></div>
        </>
      )}
      {a && res && (
        <div className="bal-cols">
          <section className="bal-sec" aria-label={T("bal.loads")}>
            <h3>{T("bal.loads")}</h3>
            {a.stations.map((s) => {
              const isFuel = s.kind === "fuel";
              const v = p.loads[s.id];
              const shown = v === undefined ? null : isFuel ? fromSI("fuel", p.prefs, v) : v;
              const limit = isFuel ? fromSI("fuel", p.prefs, a.fuel.capacity) : s.maxMass;
              return (
                <div key={s.id}>
                  <UnitField
                    label={s.name}
                    unit={isFuel ? fuelUnit : "kg"}
                    decimals={dec(shown)}
                    value={shown}
                    limit={limit !== null && limit > 0 ? limit : null}
                    hint={isFuel ? `≈ ${Math.round((v ?? 0) * a.fuel.density)} kg` : undefined}
                    onCommit={(x) => {
                      const next = { ...p.loads };
                      if (x === null) delete next[s.id];
                      else next[s.id] = isFuel ? toSI("fuel", p.prefs, x) : x;
                      p.onLoads(next);
                    }}
                  />
                  {isFuel && (
                    <div className="bal-burn">
                      <span>{T("bal.burnShort")}</span>
                      <b className="mono">{p.burnLiters !== null ? `${formatQuantity("fuel", p.prefs, p.burnLiters)} ${fuelUnit}` : "—"}</b>
                      {p.burnLiters === null && <small>{T("bal.noBurn")}</small>}
                    </div>
                  )}
                </div>
              );
            })}
            {!a.stations.some((s) => s.kind === "fuel") && (p.burnLiters === null ? <p className="muted small">{T("bal.noBurn")}</p> : <p className="muted small">{T("bal.burn")} : {formatQuantity("fuel", p.prefs, p.burnLiters)} {fuelUnit}</p>)}
          </section>

          <section className="bal-sec" aria-label={T("bal.results")}>
            <h3>{T("bal.results")}</h3>
            <StatusBanner level={overall} title={T(`bal.status.${overall}` as Key)}>
              {mm && <span>{T("bal.minMargin")} {mmOf(mm.state.cgMargin)} mm · {mm.name}</span>}
              {issues.map((i) => <span key={i}>{T(ISSUE_KEYS[i])}</span>)}
            </StatusBanner>
            {mto && (
              <div className="bal-mto">
                <div><span>{T("bal.mto")}</span><span><b className="mono">{Math.round(mto.mass)}</b> / {mto.max} kg</span></div>
                {mto.fill && <div className={`uf-bar lvl-${mto.fill.level}`} aria-hidden="true"><i style={{ width: `${Math.min(100, mto.fill.ratio * 100)}%` }} /></div>}
              </div>
            )}
            <BalanceChart aircraft={a} phases={phases} label={T} lang={p.lang} />
            <ResultTable
              columns={[
                { key: "ph", header: T("bal.phase") },
                { key: "m", header: `${T("bal.mass")} (kg)` },
                { key: "cg", header: `${T("bal.cg")} (m)` },
                { key: "mg", header: `${T("bal.margin")} (mm)` },
                { key: "st", header: T("bal.state") },
              ]}
              rows={phases.map((ph) => ({
                key: ph.key,
                highlight: mm?.key === ph.key,
                cells: [
                  ph.name,
                  Math.round(ph.state.mass),
                  fmtCg(p.lang, ph.state.cg),
                  mmOf(ph.state.cgMargin),
                  <LevelMark key="l" level={ph.level} label={ph.level === "ok" ? T("bal.ok") : ph.level === "caution" ? T("bal.status.caution") : T("bal.limit")} />,
                ],
              }))}
            />
            <p className="bal-note"><Icon name="info" size={16} />{T("bal.note")}</p>
          </section>
        </div>
      )}
    </div>
  );
}

interface FuelProps {
  lang: Lang;
  prefs: UnitPrefs;
  active: Aircraft | null;
  loads: Loads;
  tripLiters: number | null;
  plan: FuelPlanParams;
  onPlan: (p: FuelPlanParams) => void;
  onLoads: (l: Loads) => void;
  onOpenSheet: () => void;
}

/** Onglet « Carburant » : carburant nécessaire (trajet, aléas, déroutement, réserve) et comparaison avec l'embarqué. */
export function FuelTab(p: FuelProps) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.active;
  const fuelStation = a?.stations.find((s) => s.kind === "fuel") ?? null;
  const onboard = fuelStation ? (p.loads[fuelStation.id] ?? 0) : 0;
  const plan = a
    ? planFuel({
        tripLiters: p.tripLiters,
        taxiLiters: p.plan.taxiLiters,
        contingencyPercent: p.plan.contingencyPercent,
        alternateMinutes: p.plan.alternateMinutes,
        reserveMinutes: p.plan.reserveMinutes,
        fuelFlowLph: a.fuelFlowLph,
        onboardLiters: onboard,
        usableCapacityLiters: Math.max(0, a.fuel.capacity - a.fuel.unusable),
      })
    : null;
  const L = (v: number | null) => (v === null ? "—" : `${formatQuantity("fuel", p.prefs, v)} ${unitLabel("fuel", p.prefs)}`);
  return (
    <div className="navscreen acform">
      {!a && (
        <>
          <p className="muted">{T("fuel.noAircraft")}</p>
          <div className="choices"><Button role="primary" onClick={p.onOpenSheet}>{T("ac.goSheet")}</Button></div>
        </>
      )}
      {a && plan && (
        <>
          <p className="muted small">{T("fuel.defaultsNote")}</p>
          <div className="params">
            <NumField label={`${T("fuel.taxi")} (${unitLabel("fuel", p.prefs)})`} decimals={1} value={fromSI("fuel", p.prefs, p.plan.taxiLiters)} onCommit={(v) => p.onPlan({ ...p.plan, taxiLiters: v === null ? 0 : Math.max(0, toSI("fuel", p.prefs, v)) })} />
            <NumField label={`${T("fuel.contingency")} (%)`} decimals={0} value={p.plan.contingencyPercent} onCommit={(v) => p.onPlan({ ...p.plan, contingencyPercent: v === null ? 0 : Math.max(0, v) })} />
            <NumField label={`${T("fuel.alternate")} (min)`} decimals={0} value={p.plan.alternateMinutes} onCommit={(v) => p.onPlan({ ...p.plan, alternateMinutes: v === null ? 0 : Math.max(0, v) })} />
            <NumField label={`${T("fuel.reserve")} (min)`} decimals={0} value={p.plan.reserveMinutes} onCommit={(v) => p.onPlan({ ...p.plan, reserveMinutes: v === null ? 0 : Math.max(0, v) })} />
            {fuelStation && (
              <NumField label={`${T("fuel.onboard")} (${unitLabel("fuel", p.prefs)})`} decimals={1} value={fromSI("fuel", p.prefs, onboard)} onCommit={(v) => p.onLoads({ ...p.loads, [fuelStation.id]: v === null ? 0 : Math.max(0, toSI("fuel", p.prefs, v)) })} />
            )}
          </div>
          <h3>{T("fuel.plan")}</h3>
          {plan.trip === null && <p className="muted small">{T("fuel.noTrip")}</p>}
          {a.fuelFlowLph === null && <p className="muted small">{T("fuel.noFlow")}</p>}
          <div className="tablewrap">
            <table className="navlog">
              <tbody>
                <tr><td className="legname">{T("fuel.taxi")}</td><td>{L(plan.taxi)}</td></tr>
                <tr><td className="legname">{T("fuel.trip")}</td><td>{L(plan.trip)}</td></tr>
                <tr><td className="legname">{T("fuel.contingency")} ({p.plan.contingencyPercent} %)</td><td>{L(plan.contingency)}</td></tr>
                <tr><td className="legname">{T("fuel.alternate")} ({p.plan.alternateMinutes} min)</td><td>{L(plan.alternate)}</td></tr>
                <tr><td className="legname">{T("fuel.reserve")} ({p.plan.reserveMinutes} min)</td><td>{L(plan.reserve)}</td></tr>
              </tbody>
              <tfoot>
                <tr><td className="legname">{T("fuel.required")}</td><td>{L(plan.required)}</td></tr>
                <tr><td className="legname">{T("fuel.onboard")}</td><td>{L(plan.onboard)}</td></tr>
                <tr><td className="legname">{T("fuel.surplus")}</td><td>{L(plan.surplus)}</td></tr>
                <tr><td className="legname">{T("fuel.endurance")}</td><td>{plan.endurance === null ? "—" : formatDuration(plan.endurance * 3600).replace(/:\d\d$/, "")}</td></tr>
              </tfoot>
            </table>
          </div>
          {plan.sufficient === false && <p className="error" role="alert">{T("fuel.insufficient")}</p>}
          {plan.sufficient === true && <p className="muted small">{T("fuel.sufficient")}</p>}
          {plan.overCapacity && <p className="error" role="alert">{T("fuel.overCapacity")}</p>}
          <p className="muted small">{T("fuel.note")}</p>
        </>
      )}
    </div>
  );
}
