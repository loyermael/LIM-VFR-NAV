import { ConfirmButton } from "./ui/ConfirmButton";
import { useMemo, useState } from "react";
import {
  computeBalance, formatDuration, formatQuantity, fromSI, planFuel, toSI, unitLabel, validateAircraft,
  type Aircraft, type BalanceIssue, type BalanceState, type Loads, type StationKind, type UnitPrefs,
} from "@lim/core";
import { NumField } from "./NavScreen";
import { Section } from "./Section";
import { t, type Key, type Lang } from "./i18n";
import {
  addStation, addVertex, duplicateAircraft, envelopeArea, newAircraft, orderEnvelope, patchAircraft, patchFuel, patchStation,
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

const f1 = (v: number) => v.toFixed(1);
const f3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");

/** Graphique d'enveloppe : masse (kg) en fonction du bras du CG (m). Zéro carburant, décollage, atterrissage. */
export function BalanceChart(p: { aircraft: Aircraft; zeroFuel: BalanceState; takeoff: BalanceState; landing: BalanceState; label: (k: Key) => string }) {
  const env = p.aircraft.envelope;
  if (env.length < 3) return null;
  const pts = [p.zeroFuel, p.takeoff, p.landing].filter((s) => Number.isFinite(s.cg));
  const xs = [...env.map((v) => v[0]), ...pts.map((s) => s.cg)];
  const ys = [...env.map((v) => v[1]), ...pts.map((s) => s.mass)];
  const pad = (lo: number, hi: number) => { const d = (hi - lo) * 0.08 || 1; return [lo - d, hi + d] as const; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const W = 360, H = 270, L = 48, R = 12, T = 12, B = 34;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => H - B - ((y - y0) / (y1 - y0)) * (H - T - B);
  const ticks = (lo: number, hi: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
  const poly = env.map((v) => `${sx(v[0])},${sy(v[1])}`).join(" ");
  const mark = (s: BalanceState, shape: "sq" | "ci" | "tr", name: string) => {
    if (!Number.isFinite(s.cg)) return null;
    const x = sx(s.cg), y = sy(s.mass);
    const color = s.inEnvelope ? "var(--zone-good)" : "var(--zone-bad)";
    return (
      <g key={name}>
        {shape === "sq" && <rect x={x - 5} y={y - 5} width={10} height={10} fill={color} stroke="var(--ink)" />}
        {shape === "ci" && <circle cx={x} cy={y} r={6} fill={color} stroke="var(--ink)" />}
        {shape === "tr" && <path d={`M${x} ${y - 7} L${x + 6} ${y + 5} L${x - 6} ${y + 5} Z`} fill={color} stroke="var(--ink)" />}
        <text x={x + 9} y={y + 4} fontSize="11" fontFamily="var(--font-mono)" fill="var(--ink)">{name}</text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="balchart" role="img" aria-label={p.label("bal.chart")}>
      {ticks(x0, x1, 4).map((x) => (
        <g key={`x${x}`}>
          <line x1={sx(x)} y1={T} x2={sx(x)} y2={H - B} stroke="var(--hair)" />
          <text x={sx(x)} y={H - B + 14} fontSize="10" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink-muted)">{x.toFixed(2)}</text>
        </g>
      ))}
      {ticks(y0, y1, 4).map((y) => (
        <g key={`y${y}`}>
          <line x1={L} y1={sy(y)} x2={W - R} y2={sy(y)} stroke="var(--hair)" />
          <text x={L - 4} y={sy(y) + 3} fontSize="10" fontFamily="var(--font-mono)" textAnchor="end" fill="var(--ink-muted)">{Math.round(y)}</text>
        </g>
      ))}
      <polygon points={poly} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2" />
      <line x1={sx(p.takeoff.cg)} y1={sy(p.takeoff.mass)} x2={sx(p.landing.cg)} y2={sy(p.landing.mass)} stroke="var(--ink)" strokeDasharray="4 3" />
      {mark(p.zeroFuel, "sq", "ZFM")}
      {mark(p.takeoff, "ci", "DEC")}
      {mark(p.landing, "tr", "ATT")}
      <text x={(L + W - R) / 2} y={H - 4} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink)">{p.label("bal.axisArm")}</text>
      <text x={12} y={(T + H - B) / 2} fontSize="11" fontFamily="var(--font-mono)" textAnchor="middle" fill="var(--ink)" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{p.label("bal.axisMass")}</text>
    </svg>
  );
}

const KINDS: StationKind[] = ["occupant", "baggage", "fuel", "other"];

/** Contour de l'enveloppe, tracé en direct pendant la saisie des sommets. */
function EnvelopeSketch({ aircraft }: { aircraft: Aircraft }) {
  const e = aircraft.envelope;
  if (e.length < 2) return null;
  const xs = e.map((v) => v[0]), ys = e.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 240, H = 130, m = 14;
  const sx = (x: number) => m + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * m);
  const sy = (y: number) => H - m - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * m);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="balchart" style={{ maxWidth: 320 }} role="img" aria-label="enveloppe">
      <polygon points={e.map((v) => `${sx(v[0])},${sy(v[1])}`).join(" ")} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth="2" />
      {e.map((v, i) => (
        <g key={i}>
          <circle cx={sx(v[0])} cy={sy(v[1])} r="4" fill="var(--brand)" stroke="var(--ink)" />
          <text x={sx(v[0]) + 6} y={sy(v[1]) - 5} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink)">{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}

/** Éditeur d'une fiche avion, en sections repliables. Aucune valeur par défaut : tout vient du manuel de vol et de la pesée. */
export function AircraftEditor(p: { lang: Lang; prefs: UnitPrefs; aircraft: Aircraft; onChange: (a: Aircraft) => void; onDone: () => void }) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.aircraft;
  const now = () => Date.now();
  const set = (patch: Partial<Aircraft>) => p.onChange(patchAircraft(a, patch, now()));
  const fuelUnit = unitLabel("fuel", p.prefs);
  const speedUnit = unitLabel("groundSpeed", p.prefs);
  const ok = {
    cruise: a.tasMps !== null && a.fuelFlowLph !== null,
    mass: a.emptyMass > 0 && a.maxTakeoffMass > a.emptyMass,
    fuel: a.fuel.capacity > 0 && a.fuel.density > 0,
    stations: a.stations.length > 0 && a.stations.every((s) => s.arm !== 0),
    envelope: a.envelope.length >= 3 && envelopeArea(a) > 1e-6,
  };
  const order = ["cruise", "mass", "fuel", "stations", "envelope"] as const;
  const todo = order.filter((k) => !ok[k]);
  // À l'ouverture : la première section à compléter est ouverte (les autres repliées).
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(todo.length > 0 ? [todo[0] as string] : []));
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sec = (id: (typeof order)[number], title: string, children: React.ReactNode) => (
    <Section id={id} title={title} ok={ok[id]} open={open.has(id)} onToggle={toggle} okLabel={T("ac.secOk")} todoLabel={T("ac.secTodo")}>{children}</Section>
  );
  return (
    <div className="navscreen">
      <div className="choices"><button onClick={p.onDone}>← {T("ac.list")}</button></div>
      <label className="numfield">
        <span>{T("nav.name")}</span>
        <input className="field" defaultValue={a.name} key={`${a.id}-n`} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} />
      </label>
      <label className="numfield">
        <span>{T("ac.registration")}</span>
        <input className="field" defaultValue={a.registration} key={`${a.id}-r`} onBlur={(e) => set({ registration: e.target.value.trim().toUpperCase() })} />
      </label>
      <p className={todo.length === 0 ? "muted small" : "error"} role={todo.length === 0 ? undefined : "status"}>
        {todo.length === 0 ? T("ac.ready") : `${T("ac.progress")} : ${order.length - todo.length} / ${order.length}`}
      </p>
      <p className="muted small">{T("ac.warning")}</p>

      {sec("cruise", T("ac.cruise"), (
        <div className="params">
          <NumField label={`${T("nav.tas")} (${speedUnit})`} value={a.tasMps === null ? null : fromSI("groundSpeed", p.prefs, a.tasMps)} onCommit={(v) => set({ tasMps: v !== null && v > 0 ? toSI("groundSpeed", p.prefs, v) : null })} />
          <NumField label={`${T("nav.fuelflow")} (${fuelUnit}/h)`} decimals={1} value={a.fuelFlowLph === null ? null : fromSI("fuel", p.prefs, a.fuelFlowLph)} onCommit={(v) => set({ fuelFlowLph: v !== null && v > 0 ? toSI("fuel", p.prefs, v) : null })} />
        </div>
      ))}

      {sec("mass", T("ac.mass"), (
        <div className="params">
          <NumField label={`${T("ac.emptyMass")} (kg)`} decimals={1} value={a.emptyMass || null} onCommit={(v) => set({ emptyMass: v ?? 0 })} />
          <NumField label={`${T("ac.emptyArm")} (m)`} decimals={3} value={a.emptyMass ? a.emptyArm : null} onCommit={(v) => set({ emptyArm: v ?? 0 })} />
          <NumField label={`${T("ac.mtow")} (kg)`} decimals={1} value={a.maxTakeoffMass || null} onCommit={(v) => set({ maxTakeoffMass: v ?? 0 })} />
          <NumField label={`${T("ac.mlw")} (kg)`} decimals={1} value={a.maxLandingMass} onCommit={(v) => set({ maxLandingMass: v })} />
        </div>
      ))}

      {sec("fuel", T("ac.fuel"), (
        <div className="params">
          <NumField label={`${T("ac.capacity")} (${fuelUnit})`} decimals={1} value={a.fuel.capacity ? fromSI("fuel", p.prefs, a.fuel.capacity) : null} onCommit={(v) => p.onChange(patchFuel(a, { capacity: v !== null ? toSI("fuel", p.prefs, v) : 0 }, now()))} />
          <NumField label={`${T("ac.unusable")} (${fuelUnit})`} decimals={1} value={a.fuel.unusable ? fromSI("fuel", p.prefs, a.fuel.unusable) : null} onCommit={(v) => p.onChange(patchFuel(a, { unusable: v !== null ? toSI("fuel", p.prefs, v) : 0 }, now()))} />
          <NumField label={`${T("ac.density")} (kg/L)`} decimals={3} value={a.fuel.density} onCommit={(v) => v !== null && v > 0 && p.onChange(patchFuel(a, { density: v }, now()))} />
        </div>
      ))}

      {sec("stations", T("ac.stations"), (
        <>
          {a.stations.map((s, i) => (
            <div className="stationcard" key={s.id}>
              <div className="stationhead">
                <input className="field" defaultValue={s.name} key={`${s.id}-${s.name}`} aria-label={T("nav.name")} onBlur={(e) => p.onChange(patchStation(a, i, { name: e.target.value.trim() || s.name }, now()))} />
                <select className="field" value={s.kind} aria-label={T("ac.kindLabel")} onChange={(e) => p.onChange(patchStation(a, i, { kind: e.target.value as StationKind }, now()))}>
                  {KINDS.map((k) => <option key={k} value={k}>{T(`ac.kind.${k}` as Key)}</option>)}
                </select>
                <button aria-label={T("nav.delete")} onClick={() => p.onChange(removeStation(a, i, now()))}>✕</button>
              </div>
              <div className="params">
                <NumField label={`${T("ac.arm")} (m)`} decimals={3} value={s.arm || null} onCommit={(v) => p.onChange(patchStation(a, i, { arm: v ?? 0 }, now()))} />
                {s.kind !== "fuel" && <NumField label={`${T("ac.maxMass")} (kg)`} decimals={1} value={s.maxMass} onCommit={(v) => p.onChange(patchStation(a, i, { maxMass: v }, now()))} />}
              </div>
            </div>
          ))}
          <div className="choices"><button onClick={() => p.onChange(addStation(a, `${a.id}-${crypto.randomUUID().slice(0, 6)}`, now()))}>{T("ac.addStation")}</button></div>
        </>
      ))}

      {sec("envelope", T("ac.envelope"), (
        <>
          <p className="muted small">{T("ac.envelopeHelp")}</p>
          <EnvelopeSketch aircraft={a} />
          {a.envelope.map((v, i) => (
            <div className="point-row" key={i} style={{ gridTemplateColumns: "28px 1fr 1fr auto" }}>
              <b className="mono">{i + 1}</b>
              <NumField label={`${T("ac.arm")} (m)`} decimals={3} value={v[0]} onCommit={(x) => x !== null && p.onChange(patchVertex(a, i, x, v[1], now()))} />
              <NumField label={`${T("ac.mass")} (kg)`} decimals={1} value={v[1]} onCommit={(m) => m !== null && p.onChange(patchVertex(a, i, v[0], m, now()))} />
              <button aria-label={T("nav.delete")} onClick={() => p.onChange(removeVertex(a, i, now()))}>✕</button>
            </div>
          ))}
          <div className="choices">
            <button onClick={() => p.onChange(addVertex(a, a.envelope[a.envelope.length - 1]?.[0] ?? 0, a.envelope[a.envelope.length - 1]?.[1] ?? 0, now()))}>{T("ac.addVertex")}</button>
            <button disabled={a.envelope.length < 3} onClick={() => p.onChange(orderEnvelope(a, now()))}>{T("ac.order")}</button>
          </div>
          {a.envelope.length >= 3 && envelopeArea(a) < 1e-6 && <p className="error" role="alert">{T("ac.degenerate")}</p>}
        </>
      ))}
      <div className="choices"><button className="brand" onClick={p.onDone}>{T("ac.done")}</button></div>
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
}

/** Onglet « Fiche » : liste de mes avions (état de chaque fiche), puis édition d'une seule fiche à la fois. */
export function AircraftTab(p: AircraftTabProps) {
  const T = (k: Key) => t(p.lang, k);
  const [editing, setEditing] = useState(false);
  const a = p.active;
  if (a && editing) return <AircraftEditor lang={p.lang} prefs={p.prefs} aircraft={a} onChange={p.onPut} onDone={() => setEditing(false)} />;
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
        {p.aircraft.map((x) => (
          <div className={a?.id === x.id ? "aircard active" : "aircard"} key={x.id}>
            <button className="row" aria-pressed={a?.id === x.id} onClick={() => p.onSelect(x.id)}>
              <b>{x.registration ? `${x.registration} · ` : ""}{x.name}</b>
              <span className="muted small"> — {status(x)}</span>
            </button>
            {a?.id === x.id && (
              <div className="choices">
                <button className="brand" onClick={() => setEditing(true)}>{T("ac.edit")}</button>
                <button onClick={() => { const c = duplicateAircraft(x, crypto.randomUUID(), Date.now()); p.onPut(c); p.onSelect(c.id); }}>{T("ac.duplicate")}</button>
                <ConfirmButton label={T("nav.delete")} confirmLabel={T("tr.confirmDelete")} onConfirm={() => p.onRemove(x.id)} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="choices"><button onClick={create}>{T("ac.new")}</button></div>
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

/** Onglet « Centrage » : charges, résultats et graphique d'enveloppe de l'avion actif. */
export function BalanceTab(p: BalanceProps) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.active;
  const defects = a ? validateAircraft(a) : [];
  const res = useMemo(() => (a && defects.length === 0 ? computeBalance(a, p.loads, p.burnLiters ?? 0) : null), [a, p.loads, p.burnLiters]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="navscreen">
      {!a && (
        <>
          <p className="muted">{T("fuel.noAircraft")}</p>
          <div className="choices"><button className="brand" onClick={p.onOpenSheet}>{T("ac.goSheet")}</button></div>
        </>
      )}
      {a && <p className="muted small">{a.registration ? `${a.registration} · ` : ""}{a.name}</p>}
      {a && defects.length > 0 && (
        <>
          <p className="error" role="alert">{T("ac.missing")} : {defects.join(", ")}</p>
          <div className="choices"><button className="brand" onClick={p.onOpenSheet}>{T("ac.goSheet")}</button></div>
        </>
      )}
      {a && res && (
        <>
          <h3>{T("bal.loads")}</h3>
          <p className="muted small">{T("bal.units")}</p>
          <div className="params">
            {a.stations.map((s) => {
              const isFuel = s.kind === "fuel";
              const v = p.loads[s.id];
              return (
                <NumField
                  key={s.id}
                  label={`${s.name} (${isFuel ? unitLabel("fuel", p.prefs) : "kg"})${s.maxMass !== null && !isFuel ? ` ≤ ${s.maxMass}` : ""}`}
                  decimals={1}
                  value={v === undefined ? null : isFuel ? fromSI("fuel", p.prefs, v) : v}
                  onCommit={(x) => {
                    const next = { ...p.loads };
                    if (x === null) delete next[s.id];
                    else next[s.id] = isFuel ? toSI("fuel", p.prefs, x) : x;
                    p.onLoads(next);
                  }}
                />
              );
            })}
          </div>
          {p.burnLiters !== null && <p className="muted small">{T("bal.burn")} : {formatQuantity("fuel", p.prefs, p.burnLiters)} {unitLabel("fuel", p.prefs)}</p>}
          {p.burnLiters === null && <p className="muted small">{T("bal.noBurn")}</p>}

          <h3>{T("bal.results")}</h3>
          <div className="tablewrap">
            <table className="navlog">
              <thead><tr><th></th><th>{T("bal.mass")} (kg)</th><th>{T("bal.cg")} (m)</th><th>{T("bal.margin")} (m)</th><th>{T("bal.state")}</th></tr></thead>
              <tbody>
                {([["bal.zfm", res.zeroFuel], ["bal.takeoff", res.takeoff], ["bal.landing", res.landing]] as const).map(([k, s]) => (
                  <tr key={k} className={s.issues.length > 0 ? "bad" : undefined}>
                    <td className="legname">{T(k)}</td>
                    <td>{f1(s.mass)}</td>
                    <td>{f3(s.cg)}</td>
                    <td>{s.cgMargin === null ? "—" : f3(s.cgMargin)}</td>
                    <td>{s.issues.length === 0 ? T("bal.ok") : T("bal.limit")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {[...res.takeoff.issues, ...res.landing.issues.filter((i) => !res.takeoff.issues.includes(i))].map((i) => (
            <p className="error" role="alert" key={i}>{T(ISSUE_KEYS[i])}</p>
          ))}
          <BalanceChart aircraft={a} zeroFuel={res.zeroFuel} takeoff={res.takeoff} landing={res.landing} label={T} />
          <p className="muted small">{T("bal.note")}</p>
        </>
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
    <div className="navscreen">
      {!a && (
        <>
          <p className="muted">{T("fuel.noAircraft")}</p>
          <div className="choices"><button className="brand" onClick={p.onOpenSheet}>{T("ac.goSheet")}</button></div>
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
