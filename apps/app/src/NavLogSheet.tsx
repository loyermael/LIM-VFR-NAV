import { useEffect, useState } from "react";
import { formatAngle, formatDuration, formatQuantity, unitLabel, type Aircraft, type NavLog, type UnitPrefs } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import type { RouteRecord } from "./routeEdit";

/**
 * Log de navigation VFR à la manière de la fiche papier : en-tête (QNH, Vp, Vw, table de dérive), tableau branche par branche
 * (Rm/X, distance, temps sans/avec vent, heures estimées/réelles, reports, notes), puis bas de page (carburant, aérodrome d'arrivée, vitesses).
 * Les zones de saisie libre sont conservées par route sur l'appareil ; les valeurs calculables sont préremplies et modifiables.
 */

const HHMM = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Heure du coucher du soleil (algorithme NOAA simplifié, précision de l'ordre de la minute), ou null (nuit ou jour polaire). */
export function sunsetMs(lat: number, lon: number, day: Date): number | null {
  const rad = Math.PI / 180;
  const start = Date.UTC(day.getFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - start) / 864e5);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const c = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (c < -1 || c > 1) return null;
  const ha = Math.acos(c) / rad;
  const minutesUtc = 720 - 4 * (lon - ha) - eqt;
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) + minutesUtc * 60_000;
}

/** Dérive (°) d'un vent de force `vw` à l'angle `alphaDeg` de la route, pour une vitesse propre `vp` (même unité). */
export function driftDeg(vw: number, vp: number, alphaDeg: number): number {
  if (vp <= 0) return 0;
  const s = (vw * Math.sin((alphaDeg * Math.PI) / 180)) / vp;
  return Math.abs(s) >= 1 ? 90 : (Math.asin(s) * 180) / Math.PI;
}
const half = (v: number) => (Math.round(v * 2) / 2).toString();

const loadExtras = (key: string): Record<string, string> => {
  try { const o = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown; return o && typeof o === "object" ? (o as Record<string, string>) : {}; } catch { return {}; }
};

export function PaperLog(p: {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord;
  log: NavLog;
  aircraft: Aircraft;
  tas: number;
  flow: number | null;
  now: Date;
}) {
  const T = (k: Key) => t(p.lang, k);
  const key = `lim.logExtras.${p.route.id}`;
  const [m, setM] = useState<Record<string, string>>(() => loadExtras(key));
  useEffect(() => setM(loadExtras(key)), [key]);
  const set = (k: string, v: string) => setM((prev) => {
    const n = { ...prev, [k]: v };
    try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* stockage bloqué */ }
    return n;
  });
  const F = (props: { k: string; label: string; def?: string; wide?: boolean }) => (
    <label className={`pf${props.wide ? " wide" : ""}`}>
      <span>{props.label}</span>
      <input value={m[props.k] ?? props.def ?? ""} onChange={(e) => set(props.k, e.target.value)} />
    </label>
  );

  const { log, route, prefs } = p;
  const speedUnit = unitLabel("groundSpeed", prefs);
  const fuelUnit = unitLabel("fuel", prefs);
  const showTrue = prefs.track === "true";
  const dist = (v: number) => formatQuantity("distance", prefs, v);
  const vpShown = Number(formatQuantity("groundSpeed", prefs, p.tas));
  const winds = log.legs.map((l) => l.wind).filter((w): w is NonNullable<typeof w> => w !== null);
  const vwMps = winds.length > 0 ? winds.reduce((s, w) => s + (w.speed as number), 0) / winds.length : 0;
  const vwShown = Number(formatQuantity("groundSpeed", prefs, vwMps as never));
  const xm = driftDeg(vwShown, vpShown, 90);
  const fl = (v: number | null) => (v === null || p.flow === null ? "" : formatQuantity("fuel", prefs, v as never));
  const per = (minutes: number) => (p.flow === null ? null : (p.flow * minutes) / 60);
  const trip = log.totals.fuel as number | null;
  const reserve = per(20), roul = per(10), integ = per(10);
  const miniDef = trip !== null && roul !== null && reserve !== null && integ !== null ? trip + roul + reserve + integ : null;
  const last = log.legs[log.legs.length - 1];
  const arrival = last?.to;
  const sunset = arrival ? sunsetMs(arrival.position.lat, arrival.position.lon, p.now) : null;
  const dateDef = p.now.toLocaleDateString(p.lang === "fr" ? "fr-FR" : "en-GB");
  const embarked = Number(m["embarked"] ?? "");
  const endurance = p.flow !== null && p.flow > 0 && Number.isFinite(embarked) && embarked > 0 ? formatDuration((embarked / p.flow) * 3600) : "";

  return (
    <div className="paperlog">
      <div className="pl-top">
        <div className="pl-col">
          <F k="qnh" label="QNH" />
          <F k="trsp" label="Trsp" />
        </div>
        <div className="pl-col">
          <F k="bd" label="BD" />
          <F k="ba" label="BA" />
        </div>
        <div className="pl-col">
          <div className="pf ro"><span>Vp</span><b>{vpShown} {speedUnit}</b></div>
          <div className="pf ro"><span>Fb</span><b>{p.flow === null ? "---" : `${formatQuantity("fuel", prefs, p.flow as never)} ${fuelUnit}/h`}</b></div>
        </div>
        <div className="pl-wind">
          <div className="pl-wind-head">
            <div className="pf ro"><span>Vw</span><b>{vwShown} {speedUnit}</b></div>
            <div className="pf ro"><span>Xm</span><b>{half(xm)}°</b></div>
          </div>
          <table className="pl-alpha">
            <tbody>
              <tr><th>α</th>{[0, 30, 45, 60, 90].map((a) => <td key={a}>{a}</td>)}</tr>
              <tr><th>X</th>{[0, 30, 45, 60, 90].map((a) => <td key={a}>{half(driftDeg(vwShown, vpShown, a))}</td>)}</tr>
              <tr><th>Tc</th>{[0, 30, 45, 60, 90].map((a) => <td key={a}>{half(xm * Math.cos((a * Math.PI) / 180))}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="pl-tablewrap">
        <table className="pl-table">
          <thead>
            <tr>
              <th className="c-rm"><span>{showTrue ? "Rv" : "Rm"}</span><span className="sub">X</span></th>
              <th className="c-dist">Dist</th>
              <th className="c-t"><span className="sub">{T("log.noWind")}</span><b>T</b><span className="sub">{T("log.withWind")}</span></th>
              <th className="c-er">{T("log.times")}</th>
              <th className="c-rep">{T("log.reports")}</th>
              <th className="c-note"></th>
            </tr>
          </thead>
          <tbody>
            {log.legs.map((l) => (
              <tr key={l.index} className={l.error ? "bad" : undefined}>
                <td className="c-rm diag">
                  <span className="tl mono">{formatAngle(showTrue ? l.trueCourse : l.magneticCourse)}</span>
                  <span className="br mono">{l.wca === null ? "---" : `${l.wca > 0.5 ? "+" : l.wca < -0.5 ? "−" : ""}${Math.abs(Math.round(l.wca))}`}</span>
                </td>
                <td className="c-dist mono">{dist(l.distance)}</td>
                <td className="c-t diag">
                  <span className="tl mono">{formatDuration(l.timeNoWind)}</span>
                  <span className="br mono">{formatDuration(l.timeWithWind)}</span>
                </td>
                <td className="c-er diag">
                  <span className="tl mono">{route.departureMs !== null && l.eta !== null ? HHMM(l.eta) : ""}</span>
                  <span className="br mono">
                    <input className="pl-real" aria-label="R" value={m[`r${l.index}`] ?? ""} onChange={(e) => set(`r${l.index}`, e.target.value)} />
                  </span>
                </td>
                <td className="c-rep"><b>{l.to.name}</b></td>
                <td className="c-note"><input aria-label="notes" value={m[`n${l.index}`] ?? ""} onChange={(e) => set(`n${l.index}`, e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="c-rm">TOTAL</td>
              <td className="c-dist mono">{dist(log.totals.distance)}</td>
              <td className="c-t diag">
                <span className="tl mono">{formatDuration(log.totals.timeNoWind)}</span>
                <span className="br mono">{formatDuration(log.totals.timeWithWind)}</span>
              </td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pl-bottom">
        <div className="pl-fuel">
          <F k="roul" label="Roul/décol 10'" def={fl(roul)} />
          <F k="deles" label="Délestage" def={fl(trip)} />
          <F k="vent" label="Vent" />
          <F k="reserve" label="Réserve 20'" def={fl(reserve)} />
          <F k="cdeb" label="Choix CdeB" />
          <F k="integ" label="Intégration 10'" def={fl(integ)} />
          <F k="mini" label="Carbu. mini" def={fl(miniDef)} />
          <div className="pf"><span>Embarqué</span><input inputMode="decimal" value={m["embarked"] ?? ""} onChange={(e) => set("embarked", e.target.value)} /></div>
          <div className="pf ro"><span>Autonomie départ</span><b className="mono">{endurance}</b></div>
          <F k="extinct" label="Extinct. mot. à" />
        </div>
        <div className="pl-arr">
          <div className="pl-arr-name"><span>{T("log.arrival")}</span><b>{arrival?.name}</b></div>
          <F k="piste" label="Piste" />
          <F k="qnhad" label="QNH" />
          <F k="tdp" label="Tdp G / D" />
          <F k="qfe" label="QFE" />
          <F k="vhf" label="VHF" />
          <F k="atis" label="Atis" />
        </div>
        <div className="pl-speeds">
          <F k="vrot" label="V rotat" />
          <F k="vmont" label="V montée" />
          <F k="vappr" label="V approche" />
          <F k="ddec" label="D. décollage" />
          <F k="datt" label="D. atterrissage" />
          <F k="date" label="Date" def={dateDef} />
          <F k="avion" label="Avion" def={p.aircraft.registration || p.aircraft.name} />
          <div className="pf ro wide"><span>Couché du soleil (HL)</span><b className="mono">{sunset === null ? "---" : HHMM(sunset)}</b></div>
        </div>
      </div>
      <p className="pl-caption">Chrono - Cap - Altitude - Estime - Radio - Radio-nav - Moteur - carburant</p>
    </div>
  );
}
