import { useMemo, useState } from "react";
import {
  ageMinutes, distance, formatQuantity, latestMetarByStation, latestTafByStation, METAR_STALE_MINUTES, nmToMeters, nauticalMiles,
  sigmetsAlongRoute, stationsNearRoute, tafPeriodsAt, tafStatus, unitLabel,
  type Conditions, type LatLon, type Metar, type Taf, type TafPeriod, type UnitPrefs,
} from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import type { RouteRecord } from "./routeEdit";
import type { MetarSet, SigmetSet, TafSet } from "./wxData";
import {
  ageText, cloudsText, ceilingText, hazardLabel, levelsText, temperatureText, utcDateTime, utcRange, utcTime, visibilityText, windText,
} from "./wxFormat";

/** Données au-delà de cet âge : l'ensemble est à actualiser (les messages eux-mêmes se périment plus vite). JUGÉ. */
const DATASET_STALE_MIN = 180;
const CORRIDOR_NM = 25;

export interface WxCommon {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord | null;
  gps: LatLon | null;
  nowMs: number;
  metars: MetarSet | null;
  tafs: TafSet | null;
  sigmets: SigmetSet | null;
  /** Fenêtre du vol (ms UTC) : départ prévu et arrivée estimée. */
  window: { startMs: number; endMs: number };
  problems: string[];
  busy: boolean;
  onImport: (files: File[]) => void;
}

const Category = ({ c }: { c: Conditions["category"] }) => <span className={`cat cat-${c ?? "none"}`}>{c ?? "?"}</span>;

/** Import des fichiers météo + âge des données. */
export function WxSource(p: WxCommon) {
  const T = (k: Key) => t(p.lang, k);
  const sets = [p.metars, p.tafs, p.sigmets].filter((s) => s !== null);
  const oldest = sets.length ? Math.min(...sets.map((s) => s.meta.fetchedAtMs)) : null;
  const age = oldest === null ? null : ageMinutes(oldest, p.nowMs);
  return (
    <div className="wx-source">
      {sets.length === 0 && <p className="muted">{T("wxd.none")}</p>}
      {age !== null && (
        <p className={age > DATASET_STALE_MIN ? "error" : "muted small"}>
          {T("wxd.fetched")} {ageText(age)}{!sets.every((s) => s.meta.exactDate) ? ` ${T("aero.approx")}` : ""}
          {age > DATASET_STALE_MIN ? ` — ${T("wxd.stale")}` : ""}
        </p>
      )}
      <label className="filebtn">
        {T("wxd.import")}
        <input type="file" hidden multiple accept=".json" disabled={p.busy} onChange={(e) => { p.onImport(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </label>
      <p className="muted small">{T("wxd.help")}</p>
      {p.problems.map((m, i) => <p className="error" role="alert" key={i}>{T("wxd.problem")} — {m}</p>)}
    </div>
  );
}

/** Stations à afficher : recherche, sinon près de la route, sinon près de la position GPS, sinon les premières. */
function useStations<S extends { station: string; name: string; lat: number; lon: number }>(
  all: readonly S[], p: WxCommon, query: string,
): { list: { s: S; dist: number | null }[]; title: Key } {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q !== "") {
      const hit = all.filter((s) => s.station.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 30);
      return { list: hit.map((s) => ({ s, dist: null })), title: "wxm.results" as Key };
    }
    if (p.route && p.route.points.length > 0) {
      const near = stationsNearRoute(p.route, all, nmToMeters(nauticalMiles(CORRIDOR_NM)), 12);
      return { list: near.map((n) => ({ s: n.station, dist: n.distance as number })), title: "wxm.nearRoute" as Key };
    }
    if (p.gps) {
      const here = p.gps;
      const sorted = all.map((s) => ({ s, dist: distance(here, { lat: s.lat, lon: s.lon }) as number })).sort((a, b) => a.dist - b.dist).slice(0, 12);
      return { list: sorted, title: "wxm.nearMe" as Key };
    }
    return { list: all.filter((s) => s.station.startsWith("LF")).sort((a, b) => a.station.localeCompare(b.station)).slice(0, 20).map((s) => ({ s, dist: null })), title: "wxm.first" as Key };
  }, [all, p.route, p.gps, query]);
}

function MetarCard({ m, p }: { m: Metar; p: WxCommon }) {
  const T = (k: Key) => t(p.lang, k);
  const c = m.conditions;
  const age = ageMinutes(m.observedAt, p.nowMs);
  return (
    <div className="wx-card">
      <div className="wx-head">
        <b>{m.station}</b> <span className="muted small">{m.name}</span>
        <Category c={c.category} />
      </div>
      <div className={age > METAR_STALE_MINUTES ? "error" : "muted small"}>
        {m.special ? "SPECI · " : ""}{utcDateTime(m.observedAt)} · {T("wxm.age")} {ageText(age)}
        {age > METAR_STALE_MINUTES ? ` — ${T("wxm.old")}` : ""}
      </div>
      <dl className="wx-dl">
        <div><dt>{T("wxm.wind")}</dt><dd>{windText(c, p.prefs)}</dd></div>
        <div><dt>{T("wxm.vis")}</dt><dd>{visibilityText(c.visibility)}</dd></div>
        <div><dt>{T("wxm.clouds")}</dt><dd>{cloudsText(c.clouds)} · {T("wxm.ceiling")} {ceilingText(c)}</dd></div>
        {c.weather && <div><dt>{T("wxm.wx")}</dt><dd>{c.weather}</dd></div>}
        <div><dt>{T("wxm.temp")}</dt><dd>{temperatureText(m.temperature, m.dewpoint)}</dd></div>
        <div><dt>QNH</dt><dd>{m.qnh === null ? "—" : `${formatQuantity("pressure", p.prefs, m.qnh)} ${unitLabel("pressure", p.prefs)}`}</dd></div>
      </dl>
      <pre className="wx-raw">{m.raw}</pre>
    </div>
  );
}

function SearchBox({ p, value, onChange }: { p: WxCommon; value: string; onChange: (v: string) => void }) {
  return <input className="field" style={{ textAlign: "left", width: "100%" }} placeholder={t(p.lang, "wxm.search")} aria-label={t(p.lang, "wxm.search")} value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function MetarTab(p: WxCommon) {
  const T = (k: Key) => t(p.lang, k);
  const [q, setQ] = useState("");
  const latest = useMemo(() => [...latestMetarByStation(p.metars?.items ?? []).values()], [p.metars]);
  const { list, title } = useStations(latest, p, q);
  return (
    <div className="navscreen">
      <WxSource {...p} />
      {p.metars && (
        <>
          <SearchBox p={p} value={q} onChange={setQ} />
          <h3>{T(title)}</h3>
          {list.length === 0 && <p className="muted small">{T("wxm.none")}</p>}
          {list.map(({ s, dist }) => (
            <div key={s.station}>
              {dist !== null && <div className="muted small mono">{formatQuantity("distance", p.prefs, dist)} {unitLabel("distance", p.prefs)}</div>}
              <MetarCard m={s} p={p} />
            </div>
          ))}
          <p className="muted small">{T("wxm.categoryNote")}</p>
        </>
      )}
    </div>
  );
}

const periodLine = (per: TafPeriod, p: WxCommon) => {
  const c = per.conditions;
  return `${windText(c, p.prefs)} · ${visibilityText(c.visibility)} · ${cloudsText(c.clouds)}${c.weather ? ` · ${c.weather}` : ""}`;
};

function TafCard({ taf, p }: { taf: Taf; p: WxCommon }) {
  const T = (k: Key) => t(p.lang, k);
  const status = tafStatus(taf, p.nowMs);
  const now = tafPeriodsAt(taf, p.window.startMs);
  return (
    <div className="wx-card">
      <div className="wx-head">
        <b>{taf.station}</b> <span className="muted small">{taf.name}</span>
        {now.base && <Category c={now.base.conditions.category} />}
      </div>
      <div className={status === "expired" ? "error" : "muted small"}>
        {utcDateTime(taf.validFrom)} → {utcDateTime(taf.validTo)} · {T(status === "valid" ? "wxt.valid" : status === "expired" ? "wxt.expired" : "wxt.future")}
      </div>
      <table className="navlog">
        <tbody>
          {taf.periods.map((per, i) => {
            const active = p.window.startMs >= per.from && p.window.startMs < per.to;
            return (
              <tr key={i} className={active ? "now" : undefined}>
                <td>{utcRange(per.from, per.to)}</td>
                <td>{per.change ?? "—"}{per.probability !== null ? ` ${per.probability}%` : ""}</td>
                <td className="legname" style={{ whiteSpace: "normal" }}>{periodLine(per, p)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{T("wxt.nowNote")}</p>
      <pre className="wx-raw">{taf.raw}</pre>
    </div>
  );
}

export function TafTab(p: WxCommon) {
  const T = (k: Key) => t(p.lang, k);
  const [q, setQ] = useState("");
  const latest = useMemo(() => [...latestTafByStation(p.tafs?.items ?? []).values()], [p.tafs]);
  const { list, title } = useStations(latest, p, q);
  return (
    <div className="navscreen">
      <WxSource {...p} />
      {p.tafs && (
        <>
          <SearchBox p={p} value={q} onChange={setQ} />
          <h3>{T(title)}</h3>
          {list.length === 0 && <p className="muted small">{T("wxm.none")}</p>}
          {list.map(({ s }) => <TafCard key={s.station} taf={s} p={p} />)}
        </>
      )}
    </div>
  );
}

export function SigmetTab(p: WxCommon) {
  const T = (k: Key) => t(p.lang, k);
  const items = p.sigmets?.items ?? [];
  const onRoute = useMemo(
    () => (p.route && p.route.points.length >= 2 ? sigmetsAlongRoute(p.route, items, p.window.startMs, p.window.endMs) : []),
    [p.route, items, p.window],
  );
  const routeIds = new Set(onRoute.map((x) => x.sigmet.id));
  const active = items.filter((s) => s.validTo >= p.nowMs);
  return (
    <div className="navscreen">
      <WxSource {...p} />
      {p.sigmets && (
        <>
          <h3>{T("wxs.title")} ({active.length})</h3>
          {active.length === 0 && <p className="muted small">{T("wxs.none")}</p>}
          {[...active].sort((a, b) => Number(routeIds.has(b.id)) - Number(routeIds.has(a.id))).map((s) => (
            <div className={`wx-card${routeIds.has(s.id) ? " onroute" : ""}`} key={s.id}>
              <div className="wx-head">
                <b>{hazardLabel(s.hazard)}</b>{s.qualifier ? ` ${s.qualifier}` : ""} <span className="muted small">{s.firName}</span>
                {routeIds.has(s.id) && <span className="badge">{T("wxs.onroute")}</span>}
              </div>
              <div className="muted small">
                {utcDateTime(s.validFrom)} → {utcDateTime(s.validTo)} · {levelsText(s.base, s.top)}
              </div>
              <pre className="wx-raw">{s.raw}</pre>
            </div>
          ))}
          <p className="muted small">{T("wxs.note")}</p>
        </>
      )}
    </div>
  );
}

export function BriefingTab(p: WxCommon) {
  const T = (k: Key) => t(p.lang, k);
  const route = p.route;
  const metarBy = useMemo(() => latestMetarByStation(p.metars?.items ?? []), [p.metars]);
  const tafBy = useMemo(() => latestTafByStation(p.tafs?.items ?? []), [p.tafs]);
  const stations = useMemo(
    () => (route && route.points.length > 0 ? stationsNearRoute(route, [...metarBy.values()], nmToMeters(nauticalMiles(CORRIDOR_NM)), 10) : []),
    [route, metarBy],
  );
  const sig = useMemo(
    () => (route && route.points.length >= 2 && p.sigmets ? sigmetsAlongRoute(route, p.sigmets.items, p.window.startMs, p.window.endMs) : []),
    [route, p.sigmets, p.window],
  );
  return (
    <div className="navscreen">
      <WxSource {...p} />
      {!route || route.points.length === 0 ? (
        <p className="muted">{T("wxb.noroute")}</p>
      ) : (
        <>
          <h3>{route.name} · {utcDateTime(p.window.startMs)} → {utcDateTime(p.window.endMs)}</h3>
          <h3>{T("wxb.stations")} (≤ {CORRIDOR_NM} NM)</h3>
          {!p.metars && <p className="muted small">{T("wxd.none")}</p>}
          {p.metars && stations.length === 0 && <p className="muted small">{T("wxm.none")}</p>}
          {stations.map((n) => {
            const m = n.station;
            const taf = tafBy.get(m.station);
            const per = taf ? tafPeriodsAt(taf, p.window.startMs).base : null;
            return (
              <div className="wx-card" key={m.station}>
                <div className="wx-head">
                  <b>{m.station}</b> <span className="muted small">{m.name}</span>
                  <Category c={m.conditions.category} />
                </div>
                <div className="muted small mono">
                  {formatQuantity("distance", p.prefs, n.along)} {unitLabel("distance", p.prefs)} {T("wxb.alongRoute")} · {formatQuantity("distance", p.prefs, n.distance)} {unitLabel("distance", p.prefs)} {T("wxb.offRoute")}
                </div>
                <div className="mono small">METAR {utcTime(m.observedAt)} ({ageText(ageMinutes(m.observedAt, p.nowMs))}) : {windText(m.conditions, p.prefs)} · {visibilityText(m.conditions.visibility)} · {cloudsText(m.conditions.clouds)}</div>
                {taf && per && <div className="mono small">TAF {utcRange(per.from, per.to)}{tafStatus(taf, p.nowMs) === "expired" ? ` (${T("wxt.expired")})` : ""} : <Category c={per.conditions.category} /> {periodLine(per, p)}</div>}
                {taf && !per && <div className="muted small">TAF : {T("wxb.noPeriod")}</div>}
                {!taf && <div className="muted small">TAF : {T("wxb.noTaf")}</div>}
              </div>
            );
          })}
          <h3>{T("wxb.sigmets")}</h3>
          {!p.sigmets && <p className="muted small">{T("wxd.none")}</p>}
          {p.sigmets && sig.length === 0 && <p className="muted small">{T("wxb.noSigmet")}</p>}
          {sig.map((x) => (
            <div className="wx-card onroute" key={x.sigmet.id}>
              <div className="wx-head">
                <b>{hazardLabel(x.sigmet.hazard)}</b> <span className="muted small">{x.sigmet.firName}</span>
                <span className="badge">{T(x.vertical === "inside" ? "wxs.inside" : x.vertical === "outside" ? "wxs.outside" : "wxs.unknown")}</span>
              </div>
              <div className="muted small">{utcDateTime(x.sigmet.validFrom)} → {utcDateTime(x.sigmet.validTo)} · {levelsText(x.sigmet.base, x.sigmet.top)}</div>
            </div>
          ))}
          <p className="muted small">{T("wxb.disclaimer")}</p>
        </>
      )}
    </div>
  );
}
