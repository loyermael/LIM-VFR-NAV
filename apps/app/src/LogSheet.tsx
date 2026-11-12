import { useEffect, useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import { loadLogForm, saveLogForm, type LogModel } from "./logModel";

/**
 * Log de navigation à l'écran : en-tête (avion, Vp modifiable, Fb, conso, vents FL20/50/100, MSA, ATIS), tableau en quinconce
 * (les points de report sont à cheval entre deux branches, reliés par des pointes), puis total, carburant, aérodrome d'arrivée et performances du jour.
 */

/** Champs libres communs à l'écran et au PDF (gardés par route). */
export function useLogForm(routeId: string) {
  const [form, setForm] = useState<Record<string, string>>(() => loadLogForm(routeId));
  useEffect(() => setForm(loadLogForm(routeId)), [routeId]);
  const set = (k: string, v: string) => setForm((prev) => {
    const n = { ...prev, [k]: v };
    saveLogForm(routeId, n);
    return n;
  });
  return { form, set };
}

export function LogSheet(p: {
  lang: Lang;
  routeId: string;
  model: LogModel;
  form: Record<string, string>;
  setField: (k: string, v: string) => void;
  /** Vp saisi (unité d'affichage) ; null = valeur de l'avion. */
  vpEdited: boolean;
  onVp: (v: number | null) => void;
  activeLeg: number | null;
  onLoadWinds: () => void;
  windsBusy: boolean;
  onPdf: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const { model: m, form, setField } = p;
  const [vpText, setVpText] = useState(m.vp);
  useEffect(() => setVpText(m.vp), [m.vp]);
  const commitVp = () => {
    const v = Number(vpText.replace(",", "."));
    if (Number.isFinite(v) && v > 0) p.onVp(v); else setVpText(m.vp);
  };
  const In = (props: { k: string; label?: string; def?: string; className?: string; placeholder?: string }) => (
    <label className={`ls-in ${props.className ?? ""}`}>
      {props.label && <span>{props.label}</span>}
      <input value={form[props.k] ?? props.def ?? ""} placeholder={props.placeholder} onChange={(e) => setField(props.k, e.target.value)} />
    </label>
  );
  const last = m.points[m.points.length - 1];

  return (
    <div className="lgsheet">
      <div className="ls-head">
        <div className="ls-card">
          <span>Vp ({m.vpUnit})</span>
          <input className="ls-vp mono" inputMode="decimal" value={vpText} aria-label="Vp" onChange={(e) => setVpText(e.target.value)} onBlur={commitVp} onKeyDown={(e) => e.key === "Enter" && commitVp()} />
          {p.vpEdited && <button className="btn-inline" onClick={() => p.onVp(null)}>{T("log.vpReset")}</button>}
        </div>
        <div className="ls-card"><span>Fb ({m.fbUnit})</span><b className="mono">{m.fb}</b></div>
        <div className="ls-card"><span>{T("log.fuelflow")} ({m.consoUnit})</span><b className="mono">{m.conso}</b></div>
        <div className="ls-card"><span>{T("log.dep")}</span><b className="mono">{m.departure || "---"}</b></div>
      </div>

      <div className="ls-winds">
        <span className="ls-lbl">{T("log.windLevels")}</span>
        <div><i>FL20</i><b className="mono">{m.winds.fl20}</b></div>
        <div><i>FL50</i><b className="mono">{m.winds.fl50}</b></div>
        <div><i>FL100</i><b className="mono">{m.winds.fl100}</b></div>
        <button className="btn-inline" disabled={p.windsBusy} onClick={p.onLoadWinds}>{p.windsBusy ? "…" : "↻"}</button>
      </div>
      <div className="ls-meta">
        <In k="msa" label="MSA" />
        <In k="atis" label={T("log.atis")} />
      </div>

      <div className="ls-table">
        <div className="lt-head lt-z"><span>Z vol</span><span>Z min</span></div>
        <div className="lt-head lt-c"><span>Cm</span><span>Rm</span></div>
        <div className="lt-head lt-d"><span>DSD</span><span>DIST</span><span>DTA</span></div>
        <div className="lt-head lt-t"><span>TAV</span><span>TSV</span><span>He / Hr</span></div>
        <div className="lt-head lt-r"><span>Report</span><span className="sub">RNav / Info NAV / Com / Z</span></div>
        <div className="lt-fill" style={{ gridColumn: "1 / span 4", gridRow: "2" }}><b>{T("log.start")}</b><span className="mono">{m.departure}</span></div>
        <div className="lt-fill" style={{ gridColumn: "1 / span 4", gridRow: `${2 * m.legs.length + 3}` }}><b>{T("log.endShort")}</b><span className="mono">{m.legs[m.legs.length - 1]?.he ?? ""}</span></div>
        {m.legs.map((l, i) => {
          const row = 2 * i + 3; // ligne de grille de départ (demi-lignes) : 1 = en-tête, les reports commencent à 2
          const cls = `${i % 2 ? " alt" : ""}${p.activeLeg === i ? " active" : ""}`;
          return [
            <div key={`z${i}`} className={`lt-cell lt-z${cls}`} style={{ gridRow: `${row} / span 2` }}>
              <span className="arrow">{l.trend === "climb" ? "↗" : l.trend === "descent" ? "↘" : "→"}</span>
              <b>{l.z || "---"}</b>
              <input className="zmin" aria-label="Z min" placeholder="Z min" inputMode="decimal" value={form[`z${i}`] ?? ""} onChange={(e) => setField(`z${i}`, e.target.value)} />
            </div>,
            <div key={`c${i}`} className={`lt-cell lt-c${cls}`} style={{ gridRow: `${row} / span 2` }}><i>{l.cm}</i><b>{l.rm}</b></div>,
            <div key={`d${i}`} className={`lt-cell lt-d${cls}`} style={{ gridRow: `${row} / span 2` }}><i>{l.dsd}</i><b>{l.d}</b><i>{l.dta}</i></div>,
            <div key={`t${i}`} className={`lt-cell lt-t${cls}`} style={{ gridRow: `${row} / span 2` }}>
              <i>{l.tav}</i><b>{l.tsv}</b>
              <span className="he"><em>{l.he}</em><input aria-label="Hr" placeholder="Hr" value={form[`hr${i}`] ?? ""} onChange={(e) => setField(`hr${i}`, e.target.value)} /></span>
            </div>,
          ];
        })}
        {m.points.map((pt, j) => {
          const def = [pt.freq, pt.alt].filter(Boolean).join(" · ");
          const cls = `${(j + 1) % 2 ? " alt" : ""}${p.activeLeg !== null && p.activeLeg + 1 === j ? " active" : ""}`;
          return (
            <div key={`r${j}`} className={`lt-cell lt-r${cls}`} style={{ gridRow: `${2 * j + 2} / span 2` }}>
              <b>{pt.name}</b>
              <input aria-label="RNav / Info NAV / Com / Z" value={form[`note${j}`] ?? def} onChange={(e) => setField(`note${j}`, e.target.value)} />
            </div>
          );
        })}
      </div>

      <div className="ls-total">
        <b>TOTAL</b>
        <span className="mono">{m.totals.d} {m.totals.dUnit}</span>
        <span className="mono">Tsv {m.totals.tsv}</span>
        <span className="mono">Tav {m.totals.tav}</span>
        <span className="mono">{m.totals.fuel ? `${m.totals.fuel} ${m.consoUnit.replace("/h", "")}` : ""}</span>
      </div>

      <div className="ls-bottom">
        <section>
          <h4>{T("log.fuel")}</h4>
          <In k="fStart" label="Start" />
          <In k="fAuto" label="AUTO" />
          <In k="fStop" label="Stop" />
        </section>
        <section className="ls-arr">
          <h4>{T("log.arrival")}</h4>
          <b className="ls-arr-name">{last?.name ?? ""}</b>
          <textarea aria-label={T("log.arrival")} rows={4} value={form["arrival"] ?? ""} onChange={(e) => setField("arrival", e.target.value)} />
        </section>
        <section className="ls-perf">
          <h4>{T("log.perf")}</h4>
          <div className="ls-perf-row two"><In k="deco" label="DECO" /><In k="att" label="ATT" /></div>
          <div className="ls-perf-row three">
            <In k="dep" label="DEP" /><In k="arr" label="ARR" /><In k="deg" label="DEG" />
            <In k="toda1" label="TODA" /><In k="toda2" label="TODA" /><In k="toda3" label="TODA" />
            <In k="lda1" label="LDA" /><In k="lda2" label="LDA" /><In k="lda3" label="LDA" />
          </div>
        </section>
      </div>
      <button className="brand" onClick={p.onPdf}>{T("log.pdf")}</button>
    </div>
  );
}
