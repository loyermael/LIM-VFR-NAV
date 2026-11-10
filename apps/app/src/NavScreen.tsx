import { useEffect, useMemo, useState } from "react";
import {
  airspacesAlongRoute, computeNavLog, formatAngle, formatDuration, formatQuantity, fromSI, litersPerHour, meters, toSI, unitLabel,
  exportRoute, nearestAirfields, searchAirfields, type Airfield, type Airspace, type LatLon, type NavLogLeg, type RouteFormat, type UnitPrefs,
} from "@lim/core";
import { periodStatus } from "./aeroGeo";
import { t, type Key, type Lang } from "./i18n";
import {
  removePoint, renamePoint, reverseRoute, setDefaultWind, setLegWind, setPointAltitude, setDepartureMs, swapPoints, toRouteFile,
  toWindPlan, type RouteRecord, type StoredWind,
} from "./routeEdit";
import type { StoredPerf } from "./prefs";

/** Champ numérique : texte libre, validé à la sortie du champ (jamais de valeur inventée si le texte n'est pas un nombre). */
export function NumField(props: {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
  decimals?: number;
  suffix?: string;
  placeholder?: string;
}) {
  const decimals = props.decimals ?? 0;
  const show = (v: number | null) => (v === null ? "" : v.toFixed(decimals));
  const [text, setText] = useState(show(props.value));
  useEffect(() => setText(show(props.value)), [props.value, decimals]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const s = text.trim().replace(",", ".");
    if (s === "") return props.onCommit(null);
    const v = Number(s);
    if (Number.isFinite(v)) props.onCommit(v);
    else setText(show(props.value));
  };
  return (
    <label className="numfield">
      <span>{props.label}</span>
      <span className="nf-row">
        <input
          className="field mono"
          inputMode="decimal"
          value={text}
          placeholder={props.placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {props.suffix && <span className="suffix">{props.suffix}</span>}
      </span>
    </label>
  );
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

interface NavProps {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord | null;
  routes: readonly RouteRecord[];
  perf: StoredPerf;
  date: Date;
  importError: string | null;
  onPerf: (p: StoredPerf) => void;
  onRoute: (next: RouteRecord) => void;
  onNewRoute: () => void;
  onSelectRoute: (id: string) => void;
  onDeleteRoute: (id: string) => void;
  onImportFile: (file: File) => void;
  onDirect: (index: number) => void;
  onDrawOnMap: () => void;
  onShowRoute: () => void;
  /** Génère et télécharge le dossier de vol PDF. */
  onDossier: () => void;
  /** Espaces aériens (déjà filtrés par groupe) pour la liste des espaces traversés. */
  airspaces: readonly Airspace[];
  hasAero: boolean;
}

/** Onglet « Log » : routes, paramètres de vol, points, vents et tableau du log de navigation. */
export function NavScreen(p: NavProps) {
  const T = (k: Key) => t(p.lang, k);
  const { prefs, route } = p;
  const now = () => Date.now();
  const speedUnit = unitLabel("groundSpeed", prefs);
  const fuelUnit = unitLabel("fuel", prefs);
  const altUnit = unitLabel("altitude", prefs);

  const perf = p.perf;
  const log = useMemo(() => {
    if (!route || perf.tasMps === null) return null;
    return computeNavLog(
      route,
      { tas: perf.tasMps as never, fuelFlow: litersPerHour(perf.fuelFlowLph ?? 0) },
      toWindPlan(route),
      p.date,
      route.departureMs,
    );
  }, [route, perf.tasMps, perf.fuelFlowLph, p.date]);

  const crossed = useMemo(
    () => (route && route.points.length >= 2 && p.airspaces.length > 0 ? airspacesAlongRoute(route, p.airspaces) : []),
    [route, p.airspaces],
  );
  const showTrue = prefs.track === "true";
  const dist = (v: number) => formatQuantity("distance", prefs, v);
  const spd = (v: number | null) => (v === null ? "---" : formatQuantity("groundSpeed", prefs, v));
  const fuelTxt = (v: number | null) => (v === null || perf.fuelFlowLph === null ? "---" : formatQuantity("fuel", prefs, v));
  const wcaTxt = (l: NavLogLeg) => (l.wca === null ? "---" : `${l.wca > 0.5 ? "+" : l.wca < -0.5 ? "−" : ""}${Math.abs(Math.round(l.wca))}`);

  const windSpeedShown = (w: StoredWind | null) => (w === null ? null : fromSI("groundSpeed", prefs, w.speedMps));
  const commitWind = (dir: number | null, speed: number | null, apply: (w: StoredWind | null) => void) => {
    if (dir === null && speed === null) return apply(null);
    apply({ directionDeg: (((dir ?? 0) % 360) + 360) % 360, speedMps: toSI("groundSpeed", prefs, speed ?? 0) });
  };

  const edit = (fn: (r: RouteRecord) => RouteRecord) => route && p.onRoute(fn(route));
  const applyDefaultWind = (dir: number | null, speed: number | null) =>
    commitWind(dir, speed, (w) => edit((r) => setDefaultWind(r, w, now())));

  return (
    <div className="navscreen">
      <h3>{T("nav.routes")}</h3>
      <div className="route-list">
        {p.routes.map((r) => (
          <div key={r.id} className="route-item">
            <button className="row" aria-pressed={route?.id === r.id} onClick={() => p.onSelectRoute(r.id)}>
              {r.name} · {r.points.length}
            </button>
            <button aria-label={T("nav.delete")} onClick={() => p.onDeleteRoute(r.id)}>✕</button>
          </div>
        ))}
        {p.routes.length === 0 && <p className="muted small">{T("nav.none")}</p>}
      </div>
      <div className="choices">
        <button onClick={p.onNewRoute}>{T("nav.new")}</button>
        <button onClick={p.onDrawOnMap}>{T("nav.draw")}</button>
        <button disabled={!route || route.points.length === 0} onClick={p.onShowRoute}>{T("nav.show")}</button>
        <button disabled={!route || route.points.length < 2} onClick={p.onDossier}>{T("nav.dossier")}</button>
        <label className="filebtn">
          {T("nav.import")}
          <input
            type="file"
            hidden
            accept=".gpx,.kml,.fpl,.pln"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onImportFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {p.importError && <p className="error" role="alert">{T("nav.import.error")} — {p.importError}</p>}

      {route && (
        <>
          <label className="numfield">
            <span>{T("nav.name")}</span>
            <input
              className="field"
              defaultValue={route.name}
              key={route.id}
              onBlur={(e) => e.target.value.trim() && edit((r) => ({ ...r, name: e.target.value.trim(), updatedAt: now() }))}
            />
          </label>
          <div className="choices">
            <button onClick={() => edit((r) => reverseRoute(r, now()))}>{T("nav.reverse")}</button>
            {(["gpx", "kml", "fpl", "pln"] as RouteFormat[]).map((f) => (
              <button
                key={f}
                disabled={route.points.length === 0}
                onClick={() => download(`${route.name.replace(/[\\/:*?"<>|]/g, "_")}.${f}`, exportRoute(f, toRouteFile(route)))}
              >
                {T("nav.export")} {f.toUpperCase()}
              </button>
            ))}
          </div>

          <h3>{T("nav.params")}</h3>
          <div className="params">
            <NumField
              label={`${T("nav.tas")} (${speedUnit})`}
              value={perf.tasMps === null ? null : fromSI("groundSpeed", prefs, perf.tasMps)}
              onCommit={(v) => p.onPerf({ ...perf, tasMps: v !== null && v > 0 ? toSI("groundSpeed", prefs, v) : null })}
            />
            <NumField
              label={`${T("nav.fuelflow")} (${fuelUnit}/h)`}
              decimals={1}
              value={perf.fuelFlowLph === null ? null : fromSI("fuel", prefs, perf.fuelFlowLph)}
              onCommit={(v) => p.onPerf({ ...perf, fuelFlowLph: v !== null && v > 0 ? toSI("fuel", prefs, v) : null })}
            />
            <NumField
              label={T("nav.wind.dir")}
              value={route.windDefault?.directionDeg ?? null}
              suffix="°V"
              onCommit={(d) => applyDefaultWind(d, windSpeedShown(route.windDefault))}
            />
            <NumField
              label={`${T("nav.wind.speed")} (${speedUnit})`}
              value={windSpeedShown(route.windDefault)}
              onCommit={(sp) => applyDefaultWind(route.windDefault?.directionDeg ?? null, sp)}
            />
            <label className="numfield">
              <span>{T("nav.dep")}</span>
              <input
                className="field mono"
                type="time"
                value={route.departureMs === null ? "" : new Date(route.departureMs).toTimeString().slice(0, 5)}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(":").map(Number);
                  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return edit((r) => setDepartureMs(r, null, now()));
                  const d = new Date();
                  d.setHours(h, m, 0, 0);
                  edit((r) => setDepartureMs(r, d.getTime(), now()));
                }}
              />
            </label>
          </div>

          <h3>{T("nav.points")}</h3>
          {route.points.length === 0 && <p className="muted small">{T("nav.none")}</p>}
          {route.points.map((pt, i) => (
            <div className="point-row" key={pt.id}>
              <b className="mono">{i + 1}</b>
              <input
                className="field"
                defaultValue={pt.name}
                key={`${pt.id}-${pt.name}`}
                aria-label={T("nav.name")}
                onBlur={(e) => edit((r) => renamePoint(r, i, e.target.value, now()))}
              />
              <NumField
                label={`${T("nav.point.alt")} (${altUnit})`}
                value={pt.altitude === null ? null : fromSI("altitude", prefs, pt.altitude)}
                onCommit={(v) => edit((r) => setPointAltitude(r, i, v === null ? null : meters(toSI("altitude", prefs, v)), now()))}
              />
              <div className="point-actions">
                <button aria-label={T("nav.point.up")} disabled={i === 0} onClick={() => edit((r) => swapPoints(r, i, i - 1, now()))}>↑</button>
                <button aria-label={T("nav.point.down")} disabled={i === route.points.length - 1} onClick={() => edit((r) => swapPoints(r, i, i + 1, now()))}>↓</button>
                <button onClick={() => p.onDirect(i)}>{T("nav.point.direct")}</button>
                <button aria-label={T("nav.delete")} onClick={() => edit((r) => removePoint(r, i, now()))}>✕</button>
              </div>
            </div>
          ))}

          <h3>{T("navlog.title")}</h3>
          {perf.tasMps === null && <p className="muted">{T("navlog.needTas")}</p>}
          {log && route.points.length < 2 && <p className="muted small">{T("navlog.needPoints")}</p>}
          {log && log.warnings.map((w, i) => (
            <p className="error" role="alert" key={i}>
              {w.kind === "wind-too-strong" ? `${T("warn.wind")} ${w.leg + 1}` : T("warn.mag")}
            </p>
          ))}
          {log && log.legs.length > 0 && (
            <div className="tablewrap">
              <table className="navlog">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{T("col.leg")}</th>
                    <th>{showTrue ? T("col.tc") : T("col.mc")}</th>
                    <th>{T("col.wca")}</th>
                    <th>{showTrue ? T("col.th") : T("col.mh")}</th>
                    <th>GS</th>
                    <th>{T("col.dist")}</th>
                    <th>TSV</th>
                    <th>TAV</th>
                    <th>{T("col.fuel")}</th>
                    <th>DSD</th>
                    <th>DTA</th>
                    {route.departureMs !== null && <th>{T("col.eta")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {log.legs.map((l) => (
                    <tr key={l.index} className={l.error ? "bad" : undefined}>
                      <td>{l.index + 1}</td>
                      <td className="legname">{l.from.name} → {l.to.name}</td>
                      <td>{formatAngle(showTrue ? l.trueCourse : l.magneticCourse)}</td>
                      <td>{wcaTxt(l)}</td>
                      <td>{formatAngle(l.trueHeading === null ? null : showTrue ? l.trueHeading : l.magneticHeading)}</td>
                      <td>{spd(l.groundSpeed)}</td>
                      <td>{dist(l.distance)}</td>
                      <td>{formatDuration(l.timeNoWind)}</td>
                      <td>{formatDuration(l.timeWithWind)}</td>
                      <td>{fuelTxt(l.fuel)}</td>
                      <td>{dist(l.distanceFromStart)}</td>
                      <td>{dist(l.distanceRemaining)}</td>
                      {route.departureMs !== null && <td>{l.eta === null ? "---" : hhmm(l.eta)}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>{T("navlog.total")}</td>
                    <td>{dist(log.totals.distance)}</td>
                    <td>{formatDuration(log.totals.timeNoWind)}</td>
                    <td>{formatDuration(log.totals.timeWithWind)}</td>
                    <td>{fuelTxt(log.totals.fuel)}</td>
                    <td colSpan={route.departureMs !== null ? 3 : 2}></td>
                  </tr>
                </tfoot>
              </table>
              <p className="muted small">
                {unitLabel("distance", prefs)} · {speedUnit} · {fuelUnit} · {T("navlog.legend")}
              </p>
            </div>
          )}

          <h3>{T("navasp.title")}</h3>
          {!p.hasAero && <p className="muted small">{T("navasp.needData")}</p>}
          {p.hasAero && route.points.length >= 2 && crossed.length === 0 && <p className="muted small">{T("navasp.none")}</p>}
          {crossed.map((h) => (
            <div className={`crossed ${h.vertical}`} key={h.airspace.id}>
              <div className="crossed-head">
                <b>{h.airspace.name}</b>
                <span className="badge">{T(h.vertical === "inside" ? "navasp.inside" : h.vertical === "outside" ? "navasp.outside" : "navasp.unknown")}</span>
              </div>
              <div className="muted small">
                {h.airspace.typeLabel}{h.airspace.icaoClass ? ` · ${h.airspace.icaoClass}` : ""} · {h.airspace.lower.label} → {h.airspace.upper.label} · {T("navasp.entry")} {dist(h.entry)} {unitLabel("distance", prefs)}
                {h.airspace.byNotam || h.airspace.onRequest ? ` · ${T("navasp.activation")}` : ""}
                {(() => { const st = periodStatus(h.airspace, p.date.getTime()); return st === null ? "" : ` · ${T(st === "upcoming" ? "navasp.upcoming" : st === "ended" ? "navasp.ended" : "navasp.current")}`; })()}
              </div>
              {h.airspace.frequencies.length > 0 && (
                <div className="freqs mono">{h.airspace.frequencies.map((f) => `${f.mhz} ${f.name}`.trim()).join(" · ")}</div>
              )}
            </div>
          ))}
          {p.hasAero && crossed.length > 0 && <p className="muted small">{T("navasp.legend")}</p>}

          {log && log.legs.length > 0 && (
            <>
              <h3>{T("nav.legwind")}</h3>
              {log.legs.map((l) => {
                const own = l.index in route.windByLeg;
                const w = own ? (route.windByLeg[l.index] ?? null) : route.windDefault;
                return (
                  <div className="point-row" key={l.index}>
                    <b className="mono">{l.index + 1}</b>
                    <NumField
                      label="°V"
                      value={w?.directionDeg ?? null}
                      onCommit={(d) => commitWind(d, windSpeedShown(w), (x) => edit((r) => setLegWind(r, l.index, x, now())))}
                    />
                    <NumField
                      label={speedUnit}
                      value={windSpeedShown(w)}
                      onCommit={(s) => commitWind(w?.directionDeg ?? null, s, (x) => edit((r) => setLegWind(r, l.index, x, now())))}
                    />
                    <button disabled={!own} onClick={() => edit((r) => setLegWind(r, l.index, undefined, now()))}>{T("nav.legwind.reset")}</button>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Fiche d'un point de route (touché sur la carte). */
export function PointSheet(p: {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord;
  index: number;
  onRoute: (next: RouteRecord) => void;
  onDirect: (i: number) => void;
  onClose: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const pt = p.route.points[p.index];
  if (!pt) return null;
  const now = Date.now();
  return (
    <aside className="sheet" aria-label={T("nav.points")}>
      <header>
        <h2>{p.index + 1} · {pt.name}</h2>
        <button onClick={p.onClose}>{T("close")}</button>
      </header>
      <label className="numfield">
        <span>{T("nav.name")}</span>
        <input className="field" defaultValue={pt.name} key={pt.id} onBlur={(e) => p.onRoute(renamePoint(p.route, p.index, e.target.value, now))} />
      </label>
      <NumField
        label={`${T("nav.point.alt")} (${unitLabel("altitude", p.prefs)})`}
        value={pt.altitude === null ? null : fromSI("altitude", p.prefs, pt.altitude)}
        onCommit={(v) => p.onRoute(setPointAltitude(p.route, p.index, v === null ? null : meters(toSI("altitude", p.prefs, v)), now))}
      />
      <p className="muted small mono">{pt.position.lat.toFixed(5)}, {pt.position.lon.toFixed(5)}</p>
      <div className="choices">
        <button className="brand" onClick={() => { p.onDirect(p.index); p.onClose(); }}>{T("nav.point.direct")}</button>
        <button onClick={() => { p.onRoute(removePoint(p.route, p.index, now)); p.onClose(); }}>{T("nav.delete")}</button>
      </div>
    </aside>
  );
}

/** Fiche « Direct vers… » : un point de la route, un terrain proche ou un terrain cherché par nom ou code OACI. */
export function DirectSheet(p: {
  lang: Lang;
  prefs: UnitPrefs;
  route: RouteRecord | null;
  targetIndex: number | null;
  airfields: readonly Airfield[];
  position: LatLon | null;
  onPick: (i: number) => void;
  onPickAirfield: (a: Airfield) => void;
  onClose: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchAirfields(query, p.airfields, 8), [query, p.airfields]);
  const nearby = useMemo(
    () => (p.position && p.airfields.length > 0 ? nearestAirfields(p.position, p.airfields, 6, (a) => !a.private) : []),
    [p.position, p.airfields],
  );
  const dist = (m: number) => `${formatQuantity("distance", p.prefs, m)} ${unitLabel("distance", p.prefs)}`;
  const pick = (a: Airfield) => { p.onPickAirfield(a); p.onClose(); };
  return (
    <aside className="sheet" aria-label={T("direct.title")}>
      <header>
        <h2>{T("direct.title")}</h2>
        <button onClick={p.onClose}>{T("close")}</button>
      </header>
      {p.route && p.route.points.length > 0 && (
        <div className="choices">
          {p.route.points.map((pt, i) => (
            <button key={pt.id} aria-pressed={p.targetIndex === i} onClick={() => { p.onPick(i); p.onClose(); }}>
              {i + 1} · {pt.name}
            </button>
          ))}
        </div>
      )}
      <h3>{T("direct.airfields")}</h3>
      {p.airfields.length === 0 && <p className="muted small">{T("direct.needdata")}</p>}
      {p.airfields.length > 0 && (
        <>
          <input
            className="field"
            style={{ textAlign: "left", width: "100%" }}
            placeholder={T("direct.search")}
            aria-label={T("direct.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() !== "" && results.length === 0 && <p className="muted small">{T("direct.noresults")}</p>}
          <div className="choices">
            {results.map((a) => (
              <button key={a.id} onClick={() => pick(a)}>{a.icao ? `${a.icao} · ` : ""}{a.name}</button>
            ))}
          </div>
          {query.trim() === "" && !p.position && <p className="muted small">{T("direct.needgps")}</p>}
          {query.trim() === "" && p.position && (
            <div className="choices">
              {nearby.map((n) => (
                <button key={n.airfield.id} onClick={() => pick(n.airfield)}>
                  {n.airfield.icao ? `${n.airfield.icao} · ` : ""}{n.airfield.name} · {dist(n.distance)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {(!p.route || p.route.points.length === 0) && p.airfields.length === 0 && <p className="muted">{T("direct.none")}</p>}
    </aside>
  );
}
