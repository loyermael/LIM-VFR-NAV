import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { useEffect, useState, type ReactNode } from "react";
import { t, type Key, type Lang } from "./i18n";
import { hrDeviation, loadLogForm, saveLogForm, type ArrivalSheet, type FuelFigures, type LogModel } from "./logModel";

/**
 * Page « log de navigation » : titre et export PDF, paramètres, vent, résumé, log (cartes sur téléphone, tableau dès 700 px),
 * carburant, espaces traversés (fournis par la page), performances du jour et fiche du terrain d'arrivée.
 * Les valeurs viennent toutes du modèle de log (même source que le PDF) ; seuls les champs libres sont saisis ici.
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

/** Écart d'une heure réelle saisie avec l'heure estimée : « +2′ », en orange à partir de 5 min. */
function Deviation({ he, hr }: { he: string; hr: string }) {
  const d = hrDeviation(he, hr);
  if (d === null) return null;
  return <span className={Math.abs(d) >= 5 ? "ls-dev big" : "ls-dev"}>{d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d)}′</span>;
}

export function LogSheet(p: {
  lang: Lang;
  routeId: string;
  model: LogModel;
  form: Record<string, string>;
  /** Valeurs préremplies (carburant, arrivée, perfo) : affichées tant que l'utilisateur n'a rien saisi. */
  defaults: Record<string, string>;
  setField: (k: string, v: string) => void;
  /** Vp saisi (unité d'affichage) ; null = valeur de l'avion. */
  vpEdited: boolean;
  onVp: (v: number | null) => void;
  activeLeg: number | null;
  onLoadWinds: () => void;
  windsBusy: boolean;
  /** Heure de la dernière mise à jour des vents (ms), ou null. */
  windsUpdatedMs: number | null;
  onPdf: () => void;
  altUnit: string;
  fuel: FuelFigures | null;
  fmtFuel: (liters: number) => string;
  fmtDuration: (seconds: number) => string;
  arrival: ArrivalSheet | null;
  /** Bloc « Espaces traversés » (calculé par la page), placé entre le carburant et la perfo. */
  spaces: ReactNode;
}) {
  const T = (k: Key) => t(p.lang, k);
  const { model: m, form, setField } = p;
  const [vpText, setVpText] = useState(m.vp);
  useEffect(() => setVpText(m.vp), [m.vp]);
  const commitVp = () => {
    const v = Number(vpText.replace(",", "."));
    if (Number.isFinite(v) && v > 0) p.onVp(v); else setVpText(m.vp);
  };
  const val = (k: string, def?: string) => form[k] ?? p.defaults[k] ?? def ?? "";
  const In = (props: { k: string; label?: string; className?: string; placeholder?: string; ariaLabel?: string }) => (
    <label className={`ls-in ${props.className ?? ""}`}>
      {props.label && <span>{props.label}</span>}
      <input value={val(props.k)} placeholder={props.placeholder ?? "—"} aria-label={props.ariaLabel ?? props.label} onChange={(e) => setField(props.k, e.target.value)} />
    </label>
  );
  const lastHe = m.legs[m.legs.length - 1]?.he ?? "";
  const windMissing = m.winds.fl20 === "---" && m.winds.fl50 === "---" && m.winds.fl100 === "---";
  const windCell = (v: string) => (v === "---" ? <span className="ls-na">—</span> : v);
  const reserve = p.fuel?.reserve ?? null;
  const arrivalL = p.fuel?.arrival ?? null;
  const fuelLevel: "ok" | "caution" | "bad" | null = arrivalL === null || reserve === null ? null : arrivalL <= 0 ? "bad" : arrivalL < reserve ? "caution" : "ok";
  const [showAlt, setShowAlt] = useState(false);
  const altShown = showAlt || ["deg", "toda3", "lda3"].some((k) => val(k) !== "");
  const pt = (j: number) => m.points[j];
  const noteDefault = (j: number) => [pt(j)?.freq, pt(j)?.alt].filter(Boolean).join(" · ");
  const surfaceText = (s: "paved" | "unpaved" | "unknown") => (s === "paved" ? T("log.rwy.paved") : s === "unpaved" ? T("log.rwy.unpaved") : "—");

  const zmin = (i: number) => (
    <div className="ls-fld"><input inputMode="decimal" aria-label="Z min" placeholder={p.altUnit} value={form[`z${i}`] ?? ""} onChange={(e) => setField(`z${i}`, e.target.value)} /></div>
  );
  const hr = (i: number, he: string) => (
    <div className="ls-fld"><Deviation he={he} hr={form[`hr${i}`] ?? ""} /><input aria-label="Hr" placeholder="hh:mm" value={form[`hr${i}`] ?? ""} onChange={(e) => setField(`hr${i}`, e.target.value)} /></div>
  );
  const report = (j: number) => (
    <input className="ls-report" aria-label="RNav / Info NAV / Com / Z" value={form[`note${j}`] ?? noteDefault(j)} placeholder="—" onChange={(e) => setField(`note${j}`, e.target.value)} />
  );

  return (
    <div className="lgsheet">
      <div className="ls-top">
        <div>
          <h2 className="ls-title">{m.route}</h2>
          <div className="ls-sub">{[m.aircraft, `${m.totals.d} ${m.totals.dUnit}`].filter(Boolean).join(" · ")}</div>
        </div>
        <Button icon="file-down" onClick={p.onPdf}>{T("log.pdfShort")}</Button>
      </div>

      <h3>{T("log.params")}</h3>
      <div className="ls-params">
        <div className="ls-p">
          <span className="ls-lbl">Vp</span>
          <div className="ls-fld ls-vpf"><input className="mono" inputMode="decimal" aria-label="Vp" value={vpText} onChange={(e) => setVpText(e.target.value)} onBlur={commitVp} onKeyDown={(e) => e.key === "Enter" && commitVp()} /><u>{m.vpUnit}</u></div>
          {p.vpEdited && <Button size="compact" icon="rotate-ccw" onClick={() => p.onVp(null)}>{T("log.vpReset")}</Button>}
        </div>
        <div className="ls-p"><span className="ls-lbl">Fb <em>{T("log.calc")}</em></span><div className="ls-ro"><b>{m.fb}</b><u>{m.fbUnit}</u></div></div>
        <div className="ls-p"><span className="ls-lbl">{T("log.fuelflow")} <em>{T("log.calc")}</em></span><div className="ls-ro"><b>{m.conso}</b><u>{m.consoUnit}</u></div></div>
        <div className="ls-p"><span className="ls-lbl">{T("log.dep")}</span><div className="ls-ro"><b>{m.departure || "—"}</b></div></div>
      </div>

      <div className="ls-wind">
        <table>
          <thead><tr><th>{T("log.windLevels")}</th><th>FL20</th><th>FL50</th><th>FL100</th></tr></thead>
          <tbody><tr><td className="ls-lbl">{T("log.windDirSpeed")}</td><td>{windCell(m.winds.fl20)}</td><td>{windCell(m.winds.fl50)}</td><td>{windCell(m.winds.fl100)}</td></tr></tbody>
        </table>
        <div className="ls-wind-foot">
          <span>{windMissing ? T("log.windNone") : p.windsUpdatedMs !== null ? `${T("log.windUpdated")} ${new Date(p.windsUpdatedMs).toLocaleTimeString(p.lang === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          <Button size="touch" icon="refresh-cw" aria-label={T("log.winds.reload")} aria-busy={p.windsBusy} disabled={p.windsBusy} onClick={p.onLoadWinds} />
        </div>
      </div>

      <h3>{T("log.summary")}</h3>
      <div className="ls-sum">
        <div><span className="ls-lbl">{T("log.sum.dist")}</span><b>{m.totals.d} <small>{m.totals.dUnit}</small></b></div>
        <div><span className="ls-lbl">{T("log.sum.noWind")}</span><b>{m.totals.tsv}</b></div>
        <div><span className="ls-lbl">{T("log.sum.wind")}</span><b>{m.totals.tav}</b></div>
        <div><span className="ls-lbl">{T("log.sum.fuel")}</span><b>{m.totals.fuel || "—"} {m.totals.fuel && <small>{m.consoUnit.replace("/h", "")}</small>}</b></div>
        <div className={fuelLevel === "ok" || fuelLevel === null ? "" : `lvl-${fuelLevel}`}>
          <span className="ls-lbl">{T("log.sum.arrival")}</span>
          <b>{arrivalL === null ? "—" : p.fmtFuel(arrivalL)}</b>
          {fuelLevel && fuelLevel !== "ok" && reserve !== null && arrivalL !== null && (
            <span className="ls-chip"><Icon name={fuelLevel === "bad" ? "triangle-alert" : "diamond-alert"} size={16} />{p.fmtFuel(Math.max(0, reserve - arrivalL))} {T("log.fuel.belowReserve")}</span>
          )}
          {fuelLevel === "ok" && reserve !== null && arrivalL !== null && <span className="ls-chip ok"><Icon name="circle-check" size={16} />{p.fmtFuel(arrivalL - reserve)} {T("log.fuel.aboveReserve")}</span>}
        </div>
        <div><span className="ls-lbl">{T("log.sum.endurance")}</span><b>{p.fuel?.enduranceSec != null ? p.fmtDuration(p.fuel.enduranceSec) : "—"}</b></div>
      </div>

      <h3>{T("log.logTitle")}</h3>
      {/* Téléphone : une carte par branche. */}
      <div className="ls-cards">
        <div className="lc-end">
          <b>{T("log.start")}</b>
          <span className="mono">{m.departure}</span>
          {report(0)}
        </div>
        {m.legs.map((l, i) => {
          const from = pt(i), to = pt(i + 1);
          const cur = p.activeLeg === i;
          return (
            <section key={`lc${i}`} className={cur ? "lc-leg cur" : "lc-leg"}>
              <div className="lc-h">
                <span className="lc-n">{i + 1}</span>
                <span>{from?.name} → {to?.name}</span>
                {cur && <span className="ls-badge">{T("log.current")}</span>}
                <span className="lc-he mono">{l.he || "—"}</span>
              </div>
              <div className="lc-l1">
                <div><span>{T("log.col.course")} Rm</span><b>{l.rm}°</b></div>
                <div><span>{T("log.col.time")} TSV</span><b>{l.tsv}</b></div>
                <div><span>{T("log.col.dist")} {m.totals.dUnit}</span><b className="lc-mid">{l.d}</b></div>
              </div>
              <div className="lc-l2"><div><span>{T("log.col.alt")} Z vol</span>{l.z ? `${l.z} ${p.altUnit}` : <i className="ls-na">—</i>}</div></div>
              <div className="lc-l3">
                <div><span>Cm</span>{l.cm}°</div>
                <div><span>TAV</span>{l.tav}</div>
                <div><span>DSD · DTA</span>{l.dsd} · {l.dta}</div>
              </div>
              <div className="lc-ent">
                <label><span>Z min</span>{zmin(i)}</label>
                <label><span>Hr</span>{hr(i, l.he)}</label>
              </div>
              <div className="lc-rep"><span className="ls-lbl">{T("log.col.report")} · {to?.name}</span>{report(i + 1)}</div>
            </section>
          );
        })}
        <div className="lc-end"><b>{T("log.endShort")}</b><span className="mono">{lastHe}</span></div>
      </div>

      {/* Tablette et plus : tableau, une ligne par branche, report à droite. */}
      <table className="ls-grid">
        <thead>
          <tr>
            <th className="l">{T("log.col.branch")}</th>
            <th>{T("log.col.alt")}<small>Z vol · Z min</small></th>
            <th>{T("log.col.course")}<small>Rm · Cm</small></th>
            <th>{T("log.col.dist")}<small>DSD · DTA</small></th>
            <th>{T("log.col.time")}<small>TSV · TAV</small></th>
            <th>{T("log.col.eta")}<small>He · Hr</small></th>
            <th className="l">{T("log.col.report")}<small>{T("log.col.reportSub")}</small></th>
          </tr>
        </thead>
        <tbody>
          <tr className="ls-edge"><td colSpan={6}><b>{T("log.start")}</b> <span className="mono">{m.departure}</span></td><td className="rp">{report(0)}</td></tr>
          {m.legs.map((l, i) => {
            const cur = p.activeLeg === i;
            return (
              <tr key={`g${i}`} className={cur ? "cur" : undefined}>
                <td className="l"><span className="g-n">{i + 1}</span> {pt(i)?.name} → {pt(i + 1)?.name}{cur && <span className="ls-badge">{T("log.current")}</span>}</td>
                <td><span className="g-b">{l.z ? `${l.z} ${p.altUnit}` : <i className="ls-na">—</i>}</span>{zmin(i)}</td>
                <td><span className="g-a">{l.rm}°</span><span className="g-c">{l.cm}°</span></td>
                <td><span className="g-b">{l.d}</span><span className="g-c">{l.dsd} · {l.dta}</span></td>
                <td><span className="g-a">{l.tsv}</span><span className="g-c">{l.tav}</span></td>
                <td><span className="g-a">{l.he || "—"}</span>{hr(i, l.he)}</td>
                <td className="rp">{report(i + 1)}</td>
              </tr>
            );
          })}
          <tr className="ls-edge"><td colSpan={7}><b>{T("log.endShort")}</b> <span className="mono">{lastHe}</span></td></tr>
        </tbody>
      </table>

      <details className="ls-legend">
        <summary><Icon name="info" size={20} />{T("log.legendTitle")}</summary>
        <dl>
          <div><dt>Rm</dt><dd>{T("log.leg.rm")}</dd></div>
          <div><dt>Cm</dt><dd>{T("log.leg.cm")}</dd></div>
          <div><dt>DSD</dt><dd>{T("log.leg.dsd")}</dd></div>
          <div><dt>DTA</dt><dd>{T("log.leg.dta")}</dd></div>
          <div><dt>TSV</dt><dd>{T("log.leg.tsv")}</dd></div>
          <div><dt>TAV</dt><dd>{T("log.leg.tav")}</dd></div>
          <div><dt>He</dt><dd>{T("log.leg.he")}</dd></div>
          <div><dt>Hr</dt><dd>{T("log.leg.hr")}</dd></div>
          <div><dt>Z min</dt><dd>{T("log.leg.zmin")}</dd></div>
        </dl>
      </details>

      <div className="ls-lower">
        <section className="ls-blk">
          <h3>{T("log.fuel")}</h3>
          <div className="ls-box ls-fuel">
            <In k="fStart" label={T("log.f.start")} />
            <In k="fAuto" label={T("log.f.auto")} />
            <In k="fStop" label={T("log.f.stop")} className={fuelLevel && fuelLevel !== "ok" ? `lvl-${fuelLevel}` : ""} />
          </div>
        </section>

        {p.spaces}

        <section className="ls-blk">
          <h3>{T("log.perf")}</h3>
          <div className="ls-box">
            <div className="ls-perf-row"><In k="deco" label="DECO" /><In k="att" label="ATT" /></div>
            <table className="ls-perf">
              <thead>
                <tr><th /><th>{T("log.perf.dep")}</th><th>{T("log.perf.arr")}</th>{altShown && <th>{T("log.perf.alt")}</th>}</tr>
              </thead>
              <tbody>
                <tr><th scope="row">{T("log.perf.ad")}</th><td><In k="dep" ariaLabel={`${T("log.perf.ad")} ${T("log.perf.dep")}`} /></td><td><In k="arr" ariaLabel={`${T("log.perf.ad")} ${T("log.perf.arr")}`} /></td>{altShown && <td><In k="deg" ariaLabel={`${T("log.perf.ad")} ${T("log.perf.alt")}`} /></td>}</tr>
                <tr><th scope="row">TODA</th><td><In k="toda1" ariaLabel={`TODA ${T("log.perf.dep")}`} /></td><td><In k="toda2" ariaLabel={`TODA ${T("log.perf.arr")}`} /></td>{altShown && <td><In k="toda3" ariaLabel={`TODA ${T("log.perf.alt")}`} /></td>}</tr>
                <tr><th scope="row">LDA</th><td><In k="lda1" ariaLabel={`LDA ${T("log.perf.dep")}`} /></td><td><In k="lda2" ariaLabel={`LDA ${T("log.perf.arr")}`} /></td>{altShown && <td><In k="lda3" ariaLabel={`LDA ${T("log.perf.alt")}`} /></td>}</tr>
              </tbody>
            </table>
            {!altShown && <button type="button" className="ls-link" onClick={() => setShowAlt(true)}>{T("log.perf.add")}</button>}
          </div>
        </section>

        <section className="ls-blk">
          <h3>{T("log.arrival")}</h3>
          <div className="ls-box">
            {p.arrival ? (
              <>
                <div className="ls-arr-head">
                  <b>{p.arrival.icao}</b>
                  {p.arrival.elevation && <span className="ls-lbl">{T("log.arr.alt")} {p.arrival.elevation}</span>}
                  {p.arrival.frequencies[0] && <span className="ls-arr-f">{p.arrival.frequencies[0].mhz}</span>}
                </div>
                {p.arrival.frequencies.length > 1 && (
                  <div className="ls-arr-more">{p.arrival.frequencies.map((f) => `${f.mhz}${f.name ? ` (${f.name})` : ""}`).join(" · ")}</div>
                )}
                {p.arrival.runways.length > 0 && (
                  <table className="ls-rwy">
                    <thead><tr><th>{T("log.rwy.qfu")}</th><th>{T("log.rwy.len")}</th><th>{T("log.rwy.surf")}</th></tr></thead>
                    <tbody>{p.arrival.runways.map((r) => <tr key={r.designator}><td>{r.designator}</td><td>{r.length || "—"}</td><td>{surfaceText(r.surface)}</td></tr>)}</tbody>
                  </table>
                )}
              </>
            ) : (
              <p className="muted small">{T("log.arr.none")}</p>
            )}
            <label className="ls-in">
              <span>{T("log.arr.notes")}</span>
              <textarea rows={2} value={form["arrivalNotes"] ?? ""} placeholder="—" onChange={(e) => setField("arrivalNotes", e.target.value)} />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
