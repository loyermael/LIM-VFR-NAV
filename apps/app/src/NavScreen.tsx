import { useEffect, useMemo, useState } from "react";
import {
  airspacesAlongRoute, computeNavLog, formatAngle, formatDuration, formatQuantity, fromSI, litersPerHour, meters, toSI, unitLabel,
  exportRoute, nearestAirfields, searchAirfields, type Aircraft, type Airfield, type Airspace, type LatLon, type NavLogLeg, type RouteFormat, type UnitPrefs,
} from "@lim/core";
import { periodStatus } from "./aeroGeo";
import { LogSheet, useLogForm } from "./LogSheet";
import { buildLogModel, vpKey } from "./logModel";
import { buildLogPdf } from "./logPdf";
import { windKey } from "./windClient";
import type { WindForecast } from "@lim/core";
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
  /** Sous-page affichée : 0 = route (points, vent), 1 = log. */
  tab: number;
  /** Retour à la liste des routes. */
  onGoRoutes: () => void;
  /** Espaces aériens (déjà filtrés par groupe) pour la liste des espaces traversés. */
  airspaces: readonly Airspace[];
  hasAero: boolean;
  /** Terrains (fréquences affichées sous chaque report) et point visé (branche en cours surlignée). */
  airfields: readonly Airfield[];
  targetIndex: number | null;
  /** Avions déjà créés dans l'écran Avion, et celui qui est choisi. */
  aircraftList: readonly Aircraft[];
  aircraft: Aircraft | null;
  onSelectAircraft: (id: string) => void;
  onGoAircraft: () => void;
  /** Vent de chaque branche d'après la météo : altitude de croisière (m) et heure de décollage (ms) ; rend un message d'erreur ou null. */
  onAutoWind: (altitudeM: number, departureMs: number) => Promise<string | null>;
  autoWindBusy: boolean;
  /** Heure de décollage détectée (ms), sinon null. */
  takeoffMs: number | null;
  /** Prévisions de vent déjà reçues (clé = position arrondie) ; chargement de celles des points donnés. */
  windForecasts: ReadonlyMap<string, WindForecast>;
  onLoadWinds: (points: LatLon[]) => void;
  windsBusy: boolean;
}

const CRUISE_KEY = "lim.cruiseAltM";
const loadCruise = (): number => {
  try { const v = Number(localStorage.getItem(CRUISE_KEY)); if (Number.isFinite(v) && v > 0) return v; } catch { /* stockage bloqué */ }
  return 914; // 3000 ft
};

/** Écran Route : routes, points, vent (sous-page 0) et log de navigation (sous-page 1). */
export function NavScreen(p: NavProps) {
  const T = (k: Key) => t(p.lang, k);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  /** Deux vues séparées : la liste des routes (choix), puis la route elle-même. */
  const [view, setView] = useState<"list" | "detail">("list");
  const [cruiseM, setCruiseM] = useState(loadCruise);
  const [awMsg, setAwMsg] = useState<string | null>(null);
  const logForm = useLogForm(p.route?.id ?? "none");
  /** Vp modifié sur le log (m/s), par route ; null = vitesse de l'avion. */
  const [vpOver, setVpOver] = useState<number | null>(null);
  useEffect(() => {
    if (!p.route) return setVpOver(null);
    try { const v = Number(localStorage.getItem(vpKey(p.route.id))); setVpOver(Number.isFinite(v) && v > 0 ? v : null); } catch { setVpOver(null); }
  }, [p.route?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setVp = (mps: number | null) => {
    setVpOver(mps);
    if (!p.route) return;
    try { if (mps === null) localStorage.removeItem(vpKey(p.route.id)); else localStorage.setItem(vpKey(p.route.id), String(mps)); } catch { /* stockage bloqué */ }
  };
  const { prefs, route } = p;
  const now = () => Date.now();
  const speedUnit = unitLabel("groundSpeed", prefs);
  const fuelUnit = unitLabel("fuel", prefs);
  const altUnit = unitLabel("altitude", prefs);
  const distUnit = unitLabel("distance", prefs);

  // Les performances viennent de l'avion choisi dans l'écran Avion.
  const ac = p.aircraft;
  const tas = vpOver ?? ac?.tasMps ?? null;
  const flow = ac?.fuelFlowLph ?? null;
  const log = useMemo(() => {
    if (!route || tas === null) return null;
    return computeNavLog(route, { tas: tas as never, fuelFlow: litersPerHour(flow ?? 0) }, toWindPlan(route), p.date, route.departureMs);
  }, [route, tas, flow, p.date]);

  const depPoint = route?.points[0]?.position ?? null;
  const depForecast = depPoint ? (p.windForecasts.get(windKey(depPoint.lat, depPoint.lon)) ?? null) : null;
  const logModel = useMemo(() => {
    if (!route || !log || tas === null || log.legs.length === 0) return null;
    return buildLogModel({ prefs, route, log, aircraftName: ac ? `${ac.registration ? ac.registration + " " : ""}${ac.name}`.trim() : "", tasMps: tas, fuelFlowLph: flow, airfields: p.airfields, airspaces: p.airspaces, departureForecast: depForecast, nowMs: p.date.getTime() });
  }, [route, log, tas, flow, prefs, ac, p.airfields, p.airspaces, depForecast, p.date]);
  const makeLogPdf = async () => {
    if (!logModel || !route) return;
    const bytes = await buildLogPdf({ model: logModel, form: logForm.form });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${route.name.replace(/[\\/:*?"<>|]/g, "_")}-log.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const crossed = useMemo(
    () => (route && route.points.length >= 2 && p.airspaces.length > 0 ? airspacesAlongRoute(route, p.airspaces) : []),
    [route, p.airspaces],
  );
  const showTrue = prefs.track === "true";
  const dist = (v: number) => formatQuantity("distance", prefs, v);
  const spd = (v: number | null) => (v === null ? "---" : formatQuantity("groundSpeed", prefs, v));
  const fuelTxt = (v: number | null) => (v === null || flow === null ? "---" : formatQuantity("fuel", prefs, v));
  const wcaTxt = (l: NavLogLeg) => (l.wca === null ? "---" : `${l.wca > 0.5 ? "+" : l.wca < -0.5 ? "−" : ""}${Math.abs(Math.round(l.wca))}`);

  const windSpeedShown = (w: StoredWind | null) => (w === null ? null : fromSI("groundSpeed", prefs, w.speedMps));
  const commitWind = (dir: number | null, speed: number | null, apply: (w: StoredWind | null) => void) => {
    if (dir === null && speed === null) return apply(null);
    apply({ directionDeg: (((dir ?? 0) % 360) + 360) % 360, speedMps: toSI("groundSpeed", prefs, speed ?? 0) });
  };
  const edit = (fn: (r: RouteRecord) => RouteRecord) => route && p.onRoute(fn(route));
  const applyDefaultWind = (dir: number | null, speed: number | null) =>
    commitWind(dir, speed, (w) => edit((r) => setDefaultWind(r, w, now())));
  const detected = route !== null && p.takeoffMs !== null && route.departureMs === p.takeoffMs;
  const setCruise = (m: number) => { setCruiseM(m); try { localStorage.setItem(CRUISE_KEY, String(m)); } catch { /* stockage bloqué */ } };
  const runAutoWind = async () => {
    setAwMsg(null);
    const dep = route?.departureMs ?? now();
    const msg = await p.onAutoWind(cruiseM, dep);
    setAwMsg(msg ?? T("nav.aw.done"));
  };

  return (
    <div className="navscreen">
      {p.tab === 0 && view === "list" && (
        <>
          <h3>{T("nav.routes")}</h3>
          <div className="route-list">
            {p.routes.map((r) => (
              <div key={r.id} className="route-item">
                <button className="row" aria-pressed={route?.id === r.id} onClick={() => { p.onSelectRoute(r.id); setView("detail"); }}>
                  {r.name} · {r.points.length}
                </button>
                {confirmDel === r.id
                  ? <button className="brand" onClick={() => { p.onDeleteRoute(r.id); setConfirmDel(null); }}>{T("tr.confirmDelete")}</button>
                  : <button aria-label={T("nav.delete")} onClick={() => setConfirmDel(r.id)}>✕</button>}
              </div>
            ))}
            {p.routes.length === 0 && <p className="muted small">{T("nav.none")}</p>}
          </div>
          <div className="choices">
            <button className="brand" onClick={() => { p.onNewRoute(); setView("detail"); }}>{T("nav.new")}</button>
            <label className="filebtn">
              {T("nav.import")}
              <input type="file" hidden accept=".gpx,.kml,.fpl,.pln" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImportFile(f); e.target.value = ""; }} />
            </label>
          </div>
          {p.importError && <p className="error" role="alert">{T("nav.import.error")} — {p.importError}</p>}
        </>
      )}

      {p.tab === 0 && view === "detail" && (
        <>
          <div className="route-head">
            <button onClick={() => setView("list")}>← {T("nav.routes")}</button>
          </div>
          {!route && <p className="muted">{T("nav.needRoute")}</p>}
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
                <button onClick={p.onDrawOnMap}>{T("nav.draw")}</button>
                <button disabled={route.points.length === 0} onClick={p.onShowRoute}>{T("nav.show")}</button>
                <button onClick={() => edit((r) => reverseRoute(r, now()))}>{T("nav.reverse")}</button>
              </div>

              <h3>{T("nav.points")}</h3>
              {route.points.length === 0 && <p className="muted small">{T("nav.pointsNone")}</p>}
              {route.points.map((pt, i) => (
                <div className="pt-row" key={pt.id}>
                  <b className="pt-num mono">{i + 1}</b>
                  <input
                    className="field pt-name"
                    defaultValue={pt.name}
                    key={`${pt.id}-${pt.name}`}
                    aria-label={T("nav.name")}
                    onBlur={(e) => edit((r) => renamePoint(r, i, e.target.value, now()))}
                  />
                  <button className="pt-del" aria-label={T("nav.delete")} onClick={() => edit((r) => removePoint(r, i, now()))}>✕</button>
                  <div className="pt-sub">
                    <NumField
                      label={`${T("nav.point.alt")} (${altUnit})`}
                      value={pt.altitude === null ? null : fromSI("altitude", prefs, pt.altitude)}
                      onCommit={(v) => edit((r) => setPointAltitude(r, i, v === null ? null : meters(toSI("altitude", prefs, v)), now()))}
                    />
                    <div className="pt-actions">
                      <button aria-label={T("nav.point.up")} disabled={i === 0} onClick={() => edit((r) => swapPoints(r, i, i - 1, now()))}>↑</button>
                      <button aria-label={T("nav.point.down")} disabled={i === route.points.length - 1} onClick={() => edit((r) => swapPoints(r, i, i + 1, now()))}>↓</button>
                      <button onClick={() => p.onDirect(i)}>{T("nav.point.direct")}</button>
                    </div>
                  </div>
                </div>
              ))}

              <h3>{T("nav.wind")}</h3>
              <div className="params">
                <label className="numfield">
                  <span>{T("nav.dep")}{detected ? ` · ${T("nav.dep.detected")}` : ""}</span>
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
                <NumField
                  label={`${T("nav.aw.alt")} (${altUnit})`}
                  value={fromSI("altitude", prefs, cruiseM)}
                  onCommit={(v) => v !== null && v > 0 && setCruise(toSI("altitude", prefs, v))}
                />
              </div>
              <button className="brand" disabled={route.points.length < 2 || p.autoWindBusy} onClick={() => void runAutoWind()}>
                {p.autoWindBusy ? T("nav.aw.busy") : T("nav.aw.run")}
              </button>
              {awMsg && <p className={awMsg === T("nav.aw.done") ? "muted small" : "error"} role="status">{awMsg}</p>}
              <details className="perfbox">
                <summary>{T("nav.legwind")}</summary>
                <div className="params">
                  <NumField label={T("nav.wind.dir")} value={route.windDefault?.directionDeg ?? null} suffix="°V" onCommit={(d) => applyDefaultWind(d, windSpeedShown(route.windDefault))} />
                  <NumField label={`${T("nav.wind.speed")} (${speedUnit})`} value={windSpeedShown(route.windDefault)} onCommit={(sp) => applyDefaultWind(route.windDefault?.directionDeg ?? null, sp)} />
                </div>
                {route.points.slice(1).map((pt, k) => {
                  const own = k in route.windByLeg;
                  const w = own ? (route.windByLeg[k] ?? null) : route.windDefault;
                  return (
                    <div className="point-row" key={pt.id}>
                      <b className="mono">{k + 1}</b>
                      <NumField label="°V" value={w?.directionDeg ?? null} onCommit={(d) => commitWind(d, windSpeedShown(w), (x) => edit((r) => setLegWind(r, k, x, now())))} />
                      <NumField label={speedUnit} value={windSpeedShown(w)} onCommit={(sp) => commitWind(w?.directionDeg ?? null, sp, (x) => edit((r) => setLegWind(r, k, x, now())))} />
                      <button disabled={!own} onClick={() => edit((r) => setLegWind(r, k, undefined, now()))}>{T("nav.legwind.reset")}</button>
                    </div>
                  );
                })}
              </details>

              <h3>{T("nav.exportTitle")}</h3>
              <div className="choices">
                {(["gpx", "kml", "fpl", "pln"] as RouteFormat[]).map((f) => (
                  <button key={f} disabled={route.points.length === 0} onClick={() => download(`${route.name.replace(/[\\/:*?"<>|]/g, "_")}.${f}`, exportRoute(f, toRouteFile(route)))}>{f.toUpperCase()}</button>
                ))}
                <button className="brand" disabled={route.points.length < 2} onClick={p.onDossier}>{T("nav.dossier")}</button>
              </div>
            </>
          )}
        </>
      )}

      {p.tab === 1 && !route && (
        <>
          <p className="muted">{T("nav.needRoute")}</p>
          <div className="choices"><button className="brand" onClick={p.onGoRoutes}>{T("nav.goRoutes")}</button></div>
        </>
      )}

      {p.tab === 1 && route && (
        <div className="vfrlog">
          <h3>{route.name}</h3>
          <div className="log-ac">
            <label className="numfield">
              <span>{T("log.aircraft")}</span>
              <select className="field" value={ac?.id ?? ""} onChange={(e) => e.target.value && p.onSelectAircraft(e.target.value)}>
                {!ac && <option value="">{T("log.choose")}</option>}
                {p.aircraftList.map((a) => <option key={a.id} value={a.id}>{a.registration ? `${a.registration} · ` : ""}{a.name}</option>)}
              </select>
            </label>
            <button onClick={p.onGoAircraft}>{p.aircraftList.length === 0 ? T("log.createAircraft") : T("log.editAircraft")}</button>
          </div>
          {!ac && <p className="muted">{p.aircraftList.length === 0 ? T("log.noAircraft") : T("log.pickAircraft")}</p>}
          {ac && tas === null && <p className="muted">{T("log.needTas")}</p>}
          {ac && tas !== null && route.points.length < 2 && <p className="muted">{T("navlog.needPoints")}</p>}

          {log && log.legs.length > 0 && (
            <>
              {log.warnings.map((w, i) => (
                <p className="error" role="alert" key={i}>{w.kind === "wind-too-strong" ? `${T("warn.wind")} ${w.leg + 1}` : T("warn.mag")}</p>
              ))}
              {logModel && (
                <LogSheet
                  lang={p.lang}
                  routeId={route.id}
                  model={logModel}
                  form={logForm.form}
                  setField={logForm.set}
                  vpEdited={vpOver !== null}
                  onVp={(v) => setVp(v === null ? null : toSI("groundSpeed", prefs, v))}
                  activeLeg={p.targetIndex !== null && p.targetIndex >= 1 ? p.targetIndex - 1 : null}
                  onLoadWinds={() => depPoint && p.onLoadWinds([depPoint])}
                  windsBusy={p.windsBusy}
                  onPdf={() => void makeLogPdf()}
                />
              )}
            </>
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
                {h.airspace.typeLabel}{h.airspace.icaoClass ? ` · ${h.airspace.icaoClass}` : ""} · {h.airspace.lower.label} → {h.airspace.upper.label} · {T("navasp.entry")} {dist(h.entry)} {distUnit}
                {h.airspace.byNotam || h.airspace.onRequest ? ` · ${T("navasp.activation")}` : ""}
                {(() => { const st = periodStatus(h.airspace, p.date.getTime()); return st === null ? "" : ` · ${T(st === "upcoming" ? "navasp.upcoming" : st === "ended" ? "navasp.ended" : "navasp.current")}`; })()}
              </div>
              {h.airspace.frequencies.length > 0 && (
                <div className="freqs mono">{h.airspace.frequencies.map((f) => `${f.mhz} ${f.name}`.trim()).join(" · ")}</div>
              )}
            </div>
          ))}
          {p.hasAero && crossed.length > 0 && <p className="muted small">{T("navasp.legend")}</p>}
        </div>
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
  const row = (key: string, label: string, side: string | null, pressed: boolean, onClick: () => void) => (
    <button className="dirrow" key={key} aria-pressed={pressed} onClick={onClick}>
      <span className="dirname">{label}</span>
      {side && <span className="dirside mono">{side}</span>}
    </button>
  );
  const afName = (a: Airfield) => `${a.icao ? `${a.icao} · ` : ""}${a.name}`;
  const hasRoute = !!p.route && p.route.points.length > 0;
  return (
    <aside className="sheet directsheet" aria-label={T("direct.title")}>
      <header>
        <h2>{T("direct.title")}</h2>
        <button className="btn-inline" aria-label={T("close")} onClick={p.onClose}>✕</button>
      </header>
      <p className="muted small">{T("direct.help")}</p>
      {p.airfields.length > 0 && (
        <input
          className="field dirsearch"
          placeholder={T("direct.search")}
          aria-label={T("direct.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {query.trim() === "" && hasRoute && (
        <>
          <h3>{T("direct.route")}</h3>
          <div className="dirlist">
            {p.route!.points.map((pt, i) => row(pt.id, `${i + 1} · ${pt.name}`, null, p.targetIndex === i, () => { p.onPick(i); p.onClose(); }))}
          </div>
        </>
      )}
      {p.airfields.length === 0 && <p className="muted small">{T("direct.needdata")}</p>}
      {p.airfields.length > 0 && query.trim() !== "" && (
        <>
          <h3>{T("direct.airfields")}</h3>
          {results.length === 0 && <p className="muted small">{T("direct.noresults")}</p>}
          <div className="dirlist">{results.map((a) => row(a.id, afName(a), null, false, () => pick(a)))}</div>
        </>
      )}
      {p.airfields.length > 0 && query.trim() === "" && (
        <>
          <h3>{T("direct.nearby")}</h3>
          {!p.position && <p className="muted small">{T("direct.needgps")}</p>}
          <div className="dirlist">{nearby.map((n) => row(n.airfield.id, afName(n.airfield), dist(n.distance), false, () => pick(n.airfield)))}</div>
        </>
      )}
      {!hasRoute && p.airfields.length === 0 && <p className="muted">{T("direct.none")}</p>}
    </aside>
  );
}
