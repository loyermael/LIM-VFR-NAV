import { useMemo, useState } from "react";
import {
  formatDuration, formatQuantity, legWindsFromForecasts, unitLabel,
  type LatLon, type LegWindEstimate, type UnitPrefs, type WindForecast,
} from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import { Section } from "./Section";
import { windKey, WIND_STALE_MS } from "./windClient";
import type { RouteRecord } from "./routeEdit";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const hourLabel = (ms: number) => `${pad(new Date(ms).getUTCHours())}Z`;

interface WindsProps {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord | null;
  gps: LatLon | null;
  tasMps: number | null;
  nowMs: number;
  forecasts: ReadonlyMap<string, WindForecast>;
  busy: boolean;
  error: string | null;
  onLoad: (points: LatLon[]) => void;
  /** Applique les vents estimés aux branches de la route. */
  onApply: (estimates: LegWindEstimate[]) => void;
}

/** Onglet « Vents » : tableau des 18 niveaux de pression sur 24 h en un point, et vents de la route issus du modèle. */
export function WindsTab(p: WindsProps) {
  const [openTable, setOpenTable] = useState(false);
  const T = (k: Key) => t(p.lang, k);
  const points = useMemo(() => (p.route?.points ?? []).map((pt) => ({ id: pt.id, label: pt.name, position: pt.position })), [p.route]);
  const [selected, setSelected] = useState<string>("gps");
  const choice = selected === "gps" ? (p.gps ? { label: T("wxw.gps"), position: p.gps } : null) : (points.find((x) => x.id === selected) ?? null);
  const fallback = choice ?? points[0] ?? (p.gps ? { label: T("wxw.gps"), position: p.gps } : null);
  const forecast = fallback ? (p.forecasts.get(windKey(fallback.position.lat, fallback.position.lon)) ?? null) : null;

  const allPoints = (): LatLon[] => {
    const set = new Map<string, LatLon>();
    if (fallback) set.set(windKey(fallback.position.lat, fallback.position.lon), fallback.position);
    for (const x of points) set.set(windKey(x.position.lat, x.position.lon), x.position);
    return [...set.values()];
  };

  // Colonnes : une toutes les 3 h sur 24 h.
  const cols = useMemo(() => {
    if (!forecast) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < forecast.times.length && i <= 24; i += 3) out.push(i);
    return out;
  }, [forecast]);

  const spd = (ms: number | null) => (ms === null ? "—" : formatQuantity("groundSpeed", p.prefs, ms));
  const cell = (dir: number | null, speed: number | null, under: boolean) =>
    under ? "—" : dir === null || speed === null ? "—" : `${pad(Math.round(dir) % 360, 3)}/${spd(speed)}`;
  const altShown = (m: number | null) => (m === null ? "—" : formatQuantity("altitude", p.prefs, m));

  // Vents de la route : estimation par branche.
  const estimates = useMemo(() => {
    if (!p.route || p.route.points.length < 2 || p.tasMps === null) return null;
    const fcs = p.route.points.map((pt) => p.forecasts.get(windKey(pt.position.lat, pt.position.lon)) ?? null);
    return legWindsFromForecasts(p.route.points, fcs, p.route.departureMs ?? p.nowMs, p.tasMps as never);
  }, [p.route, p.forecasts, p.tasMps, p.nowMs]);

  const reasonText = (r: LegWindEstimate["reason"]) =>
    r === "no-altitude" ? T("wxw.needAlt") : r === "no-forecast" ? T("wxw.noforecast") : T("wxw.outofrange");

  const ageMin = forecast ? Math.floor((p.nowMs - forecast.fetchedAt) / 60_000) : null;
  const stale = forecast ? p.nowMs - forecast.fetchedAt > WIND_STALE_MS : false;

  return (
    <div className="navscreen">
      <p className="muted small">{T("wxw.model")}</p>
      {!fallback && <p className="muted">{T("wxw.noPoint")}</p>}
      <div className="choices">
        <button className="brand" disabled={!fallback || p.busy} onClick={() => p.onLoad(allPoints())}>
          {p.busy ? T("wxw.loading") : T("wxw.load")}
        </button>
      </div>
      {p.error && <p className="error" role="alert">{T("wxw.error")} — {p.error}</p>}

      {p.route && p.route.points.length >= 2 && (
        <>
          <h3>{T("wxw.routeWinds")}</h3>
          {p.tasMps === null && <p className="muted small">{T("wxw.needTas")}</p>}
          {estimates && estimates.length > 0 && estimates.every((e) => e.reason === "no-altitude") && <p className="error" role="alert">{T("wxw.needAltAll")}</p>}
          {estimates && !estimates.every((e) => e.reason === "no-altitude") && estimates.map((e) => (
            <div className="point-row" key={e.leg} style={{ gridTemplateColumns: "28px 1fr auto" }}>
              <b className="mono">{e.leg + 1}</b>
              <span className="mono">
                {e.wind
                  ? `${pad(Math.round(e.wind.direction) % 360, 3)}°V / ${spd(e.wind.speed)} ${unitLabel("groundSpeed", p.prefs)} · ${altShown(e.altitude as number | null)} ${unitLabel("altitude", p.prefs)} · ${hourLabel(e.timeMs)}`
                  : reasonText(e.reason)}
              </span>
            </div>
          ))}
          <div className="choices">
            <button disabled={!estimates || !estimates.some((e) => e.wind !== null)} onClick={() => estimates && p.onApply(estimates)}>
              {T("wxw.apply")}
            </button>
          </div>
          <p className="muted small">{T("wxw.applyHelp")}</p>
        </>
      )}
      <Section plain id="table" title={T("wxw.tableTitle")} ok open={openTable} onToggle={() => setOpenTable(!openTable)}>
      {(points.length > 0 || p.gps) && (
        <>
          <h3>{T("wxw.at")}</h3>
          <div className="choices">
            {p.gps && <button aria-pressed={selected === "gps"} onClick={() => setSelected("gps")}>{T("wxw.gps")}</button>}
            {points.map((x, i) => (
              <button key={x.id} aria-pressed={selected === x.id} onClick={() => setSelected(x.id)}>{i + 1} · {x.label}</button>
            ))}
          </div>
        </>
      )}
      {forecast && (
        <>
          <p className={stale ? "error" : "muted small"}>
            {T("wxw.age")} {ageMin === null ? "" : ageMin < 60 ? `${ageMin} min` : formatDuration(ageMin * 60).replace(/:\d\d$/, "")}
            {stale ? ` — ${T("wxw.stale")}` : ""}
          </p>
          <div className="tablewrap">
            <table className="navlog">
              <thead>
                <tr>
                  <th>{T("wxw.level")}</th>
                  <th>{unitLabel("altitude", p.prefs)}</th>
                  {cols.map((i) => <th key={i}>{hourLabel(forecast.times[i] as number)}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...forecast.levels].reverse().map((lv) => {
                  const h0 = lv.height[0] ?? null;
                  const under = h0 !== null && h0 <= forecast.elevation + 10;
                  return (
                    <tr key={lv.hpa} className={under ? "under" : undefined}>
                      <td>{lv.hpa} hPa</td>
                      <td>{altShown(h0)}</td>
                      {cols.map((i) => (
                        <td key={i}>{cell(lv.direction[i] ?? null, lv.speed[i] ?? null, (lv.height[i] ?? 0) <= forecast.elevation + 10)}</td>
                      ))}
                    </tr>
                  );
                })}
                <tr>
                  <td>{T("wxw.surface")}</td>
                  <td>{altShown(forecast.elevation + 10)}</td>
                  {cols.map((i) => <td key={i}>{cell(forecast.surface.direction[i] ?? null, forecast.surface.speed[i] ?? null, false)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">{T("wxw.legend")} ({unitLabel("groundSpeed", p.prefs)}, °V) · {T("wxw.attribution")}</p>
        </>
      )}

      </Section>
    </div>
  );
}
