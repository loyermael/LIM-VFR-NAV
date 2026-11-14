import { Icon } from "./ui/Icon";
import { Button } from "./ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  airspacesAlongRoute, computeNavLog, formatAngle, formatDuration, formatQuantity, fromSI, litersPerHour, meters, toSI, unitLabel,
  exportRoute, nearestAirfields, searchAirfields, type Aircraft, type Airfield, type Airspace, type Loads, type LatLon, type NavLogLeg, type RouteFormat, type UnitPrefs,
} from "@lim/core";
import { periodStatus } from "./aeroGeo";
import { ageText, filterRoutes, orderRoutes, summarizeRoute } from "./routeList";
import { ConfirmButton } from "./ui/ConfirmButton";
import { LogSheet, useLogForm } from "./LogSheet";
import { buildAutoFields, buildLogModel, vpKey } from "./logModel";
import type { FuelPlanParams } from "./aircraftStore";
import { buildLogPdf } from "./logPdf";
import { WIND_HORIZON_H, windKey } from "./windClient";
import type { WindForecast } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import {
  addPoint, removePoint, renamePoint, reverseRoute, setDefaultWind, setLegWind, setPointAltitude, setDepartureMs, swapPoints, toRouteFile,
  toWindPlan, type RouteRecord, type StoredWind,
} from "./routeEdit";
import type { StoredPerf } from "./prefs";

/** Champ numérique compact (sans libellé) pour les tableaux : texte libre, validé à la sortie du champ. */
export function MiniNum(props: { value: number | null; onCommit: (v: number | null) => void; label: string; decimals?: number; placeholder?: string }) {
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
    <input
      className="mini mono"
      inputMode="decimal"
      aria-label={props.label}
      value={text}
      placeholder={props.placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

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
  /** Route suivie (une seule) ; l'aperçu est une route affichée qui n'est pas la route suivie. */
  activeRouteId: string | null;
  isPreview: boolean;
  /** Ouvre la route en aperçu : n'active rien. */
  onOpenRoute: (id: string) => void;
  onActivate: (id: string) => void;
  onDeactivate: () => void;
  onDuplicate: (id: string) => void;
  onReverseRoute: (id: string) => void;
  /** Supprime (annulable) ; l'écran demande une confirmation pour la route active. */
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
  /** Vue de l'onglet Route (liste ou détail), tenue par l'application pour que « Retour » remonte d'un niveau. */
  routeView: "list" | "detail";
  onRouteView: (v: "list" | "detail") => void;
  /** Propose d'annuler une suppression pendant quelques secondes (bandeau « Annuler »). */
  onUndoable: (text: string, restore: () => void) => void;
  /** Espaces aériens (déjà filtrés par groupe) pour la liste des espaces traversés. */
  airspaces: readonly Airspace[];
  hasAero: boolean;
  /** Terrains (fréquences affichées sous chaque report) et point visé (branche en cours surlignée). */
  airfields: readonly Airfield[];
  targetIndex: number | null;
  /** Avions déjà créés dans l'écran Avion, et celui qui est choisi. */
  aircraftList: readonly Aircraft[];
  aircraft: Aircraft | null;
  /** Charges et réglages carburant de l'écran Avion (carburant embarqué, roulage, réserves). */
  loads: Loads;
  fuelPlan: FuelPlanParams;
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
  return 914.4; // 3000 ft
};

/** Écran Route : routes, points, vent (sous-page 0) et log de navigation (sous-page 1). */
export function NavScreen(p: NavProps) {
  const T = (k: Key) => t(p.lang, k);
  /** Deux vues séparées : la liste des routes (choix), puis la route elle-même. */
  const view = p.routeView;
  const setView = p.onRouteView;
  const [cruiseM, setCruiseM] = useState(loadCruise);
  const [awMsg, setAwMsg] = useState<string | null>(null);
  const [awRetry, setAwRetry] = useState(0);
  useEffect(() => { const on = () => setAwRetry((n) => n + 1); window.addEventListener("online", on); return () => window.removeEventListener("online", on); }, []);
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
  const [routeQuery, setRouteQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [wantRename, setWantRename] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = useRef(false);
  useEffect(() => {
    if (!menuId) return;
    const away = (e: Event) => { if (!(e.target as Element).closest(".route-card")) setMenuId(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuId(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [menuId]);
  useEffect(() => {
    if (wantRename && view === "detail" && nameRef.current) { nameRef.current.focus(); nameRef.current.select(); setWantRename(false); }
  });
  const isActiveRoute = !!route && route.id === p.activeRouteId;
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

  const routeItems = useMemo(
    () => orderRoutes(filterRoutes(p.routes.map((r) => summarizeRoute(r, p.airfields, ac?.tasMps ?? null, p.date)), routeQuery), p.activeRouteId),
    [p.routes, p.airfields, ac?.tasMps, p.date, routeQuery, p.activeRouteId],
  );
  const startHold = (id: string) => {
    holdFired.current = false;
    holdTimer.current = setTimeout(() => { holdFired.current = true; setMenuId(id); }, 500);
  };
  const endHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const exportById = (id: string, f: RouteFormat) => {
    const r = p.routes.find((x) => x.id === id);
    if (r) download(`${r.name.replace(/[\\/:*?"<>|]/g, "_")}.${f}`, exportRoute(f, toRouteFile(r)));
  };

  const depPoint = route?.points[0]?.position ?? null;
  const depForecast = depPoint ? (p.windForecasts.get(windKey(depPoint.lat, depPoint.lon)) ?? null) : null;
  const logModel = useMemo(() => {
    if (!route || !log || tas === null || log.legs.length === 0) return null;
    return buildLogModel({ prefs, route, log, aircraftName: ac ? `${ac.registration ? ac.registration + " " : ""}${ac.name}`.trim() : "", tasMps: tas, fuelFlowLph: flow, airfields: p.airfields, airspaces: p.airspaces, departureForecast: depForecast, nowMs: p.date.getTime() });
  }, [route, log, tas, flow, prefs, ac, p.airfields, p.airspaces, depForecast, p.date]);
  const autoFields = useMemo(
    () => (route && log && log.legs.length > 0 ? buildAutoFields({ prefs, route, log, aircraft: ac, loads: p.loads, plan: p.fuelPlan, flow, airfields: p.airfields }) : {}),
    [route, log, prefs, ac, p.loads, p.fuelPlan, flow, p.airfields],
  );
  const makeLogPdf = async () => {
    if (!logModel || !route) return;
    const bytes = await buildLogPdf({ model: logModel, form: { ...autoFields, ...logForm.form } });
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
  const applyDefaultWind = (dir: number | null, speed: number | null) => {
    setAutoOff();
    commitWind(dir, speed, (w) => edit((r) => setDefaultWind(r, w, now())));
  };
  const setAutoOff = () => setAuto(false);
  const detected = route !== null && p.takeoffMs !== null && route.departureMs === p.takeoffMs;
  const setCruise = (m: number) => { setCruiseM(m); try { localStorage.setItem(CRUISE_KEY, String(m)); } catch { /* stockage bloqué */ } };
  // Vent automatique : à chaque changement de route, d'heure de décollage, d'altitude ou d'avion, le vent de chaque branche est repris des prévisions.
  // Toute saisie manuelle du vent coupe l'automatique pour cette route (réactivable dans « Vent par branche »).
  const [autoOn, setAutoOn] = useState(true);
  useEffect(() => {
    if (!p.route) return;
    try { setAutoOn(localStorage.getItem(`lim.autoWind.${p.route.id}`) !== "off"); } catch { setAutoOn(true); }
  }, [p.route?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setAuto = (on: boolean) => {
    setAutoOn(on);
    if (!p.route) return;
    try { if (on) localStorage.removeItem(`lim.autoWind.${p.route.id}`); else localStorage.setItem(`lim.autoWind.${p.route.id}`, "off"); } catch { /* stockage bloqué */ }
  };
  const posKey = route ? route.points.map((pt) => `${pt.position.lat.toFixed(4)},${pt.position.lon.toFixed(4)}`).join("|") : "";
  const canAuto = !!route && route.points.length >= 2 && ac?.tasMps != null;
  useEffect(() => {
    if (!canAuto || !autoOn || !route) return;
    let cancelled = false;
    setAwMsg(null);
    const timer = setTimeout(() => {
      void p.onAutoWind(cruiseM, Math.max(route.departureMs ?? Date.now(), Date.now())).then((msg) => { if (!cancelled) setAwMsg(msg ?? T("nav.aw.done")); });
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canAuto, autoOn, route?.id, posKey, route?.departureMs, cruiseM, ac?.tasMps, awRetry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Décollage : date et heure à venir seulement (jamais dans le passé, ni au-delà de l'horizon des prévisions).
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const toLocalInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const nowMin = Math.floor(Date.now() / 60_000) * 60_000;
  const maxDep = nowMin + WIND_HORIZON_H * 3_600_000;
  const awFailed = awMsg !== null && awMsg !== T("nav.aw.done");
  const depStale = !!route && route.departureMs !== null && route.departureMs < nowMin && !detected;
  const changeDeparture = (v: string) => {
    if (!route) return;
    const ms = v === "" ? NaN : new Date(v).getTime();
    if (Number.isNaN(ms)) return edit((r) => setDepartureMs(r, null, now()));
    edit((r) => setDepartureMs(r, Math.min(maxDep, Math.max(nowMin, ms)), now()));
  };

  return (
    <div className="navscreen">
      {p.tab === 0 && view === "list" && (
        <>
          <h3>{T("nav.routes")}</h3>
          {p.routes.length > 6 && (
            <input className="field route-search" type="search" placeholder={T("route.search")} aria-label={T("route.search")} value={routeQuery} onChange={(e) => setRouteQuery(e.target.value)} />
          )}
          <div className="route-list">
            {routeItems.map((r) => {
              const isActive = r.id === p.activeRouteId;
              const km = formatQuantity("distance", prefs, r.distanceM as never);
              return (
                <div key={r.id} className={isActive ? "route-card active" : "route-card"}>
                  <button
                    className="route-main"
                    onPointerDown={() => startHold(r.id)}
                    onPointerUp={endHold}
                    onPointerLeave={endHold}
                    onPointerCancel={endHold}
                    onContextMenu={(e) => e.preventDefault()}
                    onClick={() => { if (holdFired.current) { holdFired.current = false; return; } p.onOpenRoute(r.id); }}
                  >
                    {isActive && <span className="route-badge"><Icon name="route" size={16} />{T("nav.active")}</span>}
                    <b>{r.name}</b>
                    <span className="muted small">
                      {r.label ? `${r.label} · ` : ""}{km} {distUnit}{r.timeSec !== null ? ` · ${formatDuration(r.timeSec as never)}` : ""} · {ageText(r.updatedAt, Date.now(), p.lang)}
                    </span>
                  </button>
                  <div className="route-actions">
                    {isActive
                      ? <Button size="touch" icon="square" onClick={p.onDeactivate}>{T("route.deactivate")}</Button>
                      : <Button role="primary" size="touch" icon="play" onClick={() => p.onActivate(r.id)}>{T("route.activate")}</Button>}
                    <Button size="touch" icon="ellipsis" aria-label={T("route.manage")} aria-haspopup="true" aria-expanded={menuId === r.id} onClick={() => setMenuId(menuId === r.id ? null : r.id)} />
                  </div>
                  {menuId === r.id && (
                    <div className="route-menu">
                      <Button size="touch" icon="text-cursor-input" onClick={() => { setMenuId(null); setWantRename(true); p.onOpenRoute(r.id); }}>{T("route.rename")}</Button>
                      <Button size="touch" icon="copy" onClick={() => { setMenuId(null); p.onDuplicate(r.id); }}>{T("route.duplicate")}</Button>
                      <Button size="touch" icon="arrow-left-right" disabled={r.pointCount < 2} onClick={() => { setMenuId(null); p.onReverseRoute(r.id); }}>{T("nav.reverse")}</Button>
                      {(["gpx", "kml", "fpl", "pln"] as const).map((f) => (
                        <Button key={f} size="touch" disabled={r.pointCount === 0} icon="download" aria-label={`${T("route.export")} ${f.toUpperCase()}`} onClick={() => { setMenuId(null); exportById(r.id, f); }}>{f.toUpperCase()}</Button>
                      ))}
                      {isActive
                        ? <ConfirmButton className="end" label={T("nav.delete")} confirmLabel={T("tr.confirmDelete")} onConfirm={() => { setMenuId(null); p.onDeleteRoute(r.id); }} />
                        : <Button size="touch" role="danger" icon="trash-2" className="end" onClick={() => { setMenuId(null); p.onDeleteRoute(r.id); }}>{T("nav.delete")}</Button>}
                    </div>
                  )}
                </div>
              );
            })}
            {p.routes.length === 0 && (
              <>
                <p className="muted">{T("route.empty")}</p>
                <div className="choices"><Button role="primary" icon="plus" onClick={() => p.onNewRoute()}>{T("route.create")}</Button></div>
              </>
            )}
            {p.routes.length > 0 && routeItems.length === 0 && <p className="muted small">{T("route.noMatch")}</p>}
          </div>
          {p.routes.length > 0 && (
            <div className="choices">
              <Button icon="plus" onClick={() => p.onNewRoute()}>{T("nav.new")}</Button>
              <label className="filebtn has-icon">
                <Icon name="upload" size={20} />{T("nav.import")}
                <input type="file" hidden accept=".gpx,.kml,.fpl,.pln" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImportFile(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
          {p.routes.length === 0 && (
            <div className="choices">
              <label className="filebtn has-icon">
                <Icon name="upload" size={20} />{T("nav.import")}
                <input type="file" hidden accept=".gpx,.kml,.fpl,.pln" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImportFile(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
          {p.importError && <p className="error" role="alert">{T("nav.import.error")} — {p.importError}</p>}
        </>
      )}

      {p.tab === 0 && view === "detail" && (
        <>
          {!route && <p className="muted">{T("nav.needRoute")}</p>}
          {route && (
            <div className="cols">
              <div className="col">
              <div className="route-head">
                {isActiveRoute ? (
                  <>
                    <span className="route-badge"><Icon name="route" size={16} />{T("nav.active")}</span>
                    <Button size="touch" icon="square" onClick={p.onDeactivate}>{T("route.deactivate")}</Button>
                  </>
                ) : (
                  <>
                    <Button role="primary" icon="play" onClick={() => p.onActivate(route.id)}>{T("route.activate")}</Button>
                    <span className="muted small">{T("route.previewNote")}</span>
                  </>
                )}
              </div>
              <label className="numfield">
                <span>{T("nav.name")}</span>
                <input
                  ref={nameRef}
                  className="field"
                  defaultValue={route.name}
                  key={route.id}
                  onBlur={(e) => e.target.value.trim() && edit((r) => ({ ...r, name: e.target.value.trim(), updatedAt: now() }))}
                />
              </label>
              <div className="choices">
                <Button icon="pencil" onClick={p.onDrawOnMap}>{T("nav.draw")}</Button>
                <Button icon="eye" disabled={route.points.length === 0} onClick={p.onShowRoute}>{T("nav.show")}</Button>
                <Button icon="arrow-left-right" onClick={() => edit((r) => reverseRoute(r, now()))}>{T("nav.reverse")}</Button>
              </div>

              <h3>{T("nav.points")} <span className="muted small">· {T("nav.point.alt")} ({altUnit})</span></h3>
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
                  <div className="pt-alt">
                    <MiniNum
                      label={`${T("nav.point.alt")} (${altUnit})`}
                      value={pt.altitude === null ? null : fromSI("altitude", prefs, pt.altitude)}
                      onCommit={(v) => edit((r) => setPointAltitude(r, i, v === null ? null : meters(toSI("altitude", prefs, v)), now()))}
                    />
                  </div>
                  <div className="pt-actions">
                    <Button size="touch" icon="chevron-up" aria-label={T("nav.point.up")} disabled={i === 0} onClick={() => edit((r) => swapPoints(r, i, i - 1, now()))} />
                    <Button size="touch" icon="chevron-down" aria-label={T("nav.point.down")} disabled={i === route.points.length - 1} onClick={() => edit((r) => swapPoints(r, i, i + 1, now()))} />
                    <Button size="touch" icon="navigation" onClick={() => p.onDirect(i)}>{T("nav.point.direct")}</Button>
                    <Button size="touch" icon="trash-2" aria-label={T("nav.delete")} onClick={() => { const before = route; edit((r) => removePoint(r, i, now())); p.onUndoable(T("nav.point.deleted"), () => p.onRoute(before)); }} />
                  </div>
                </div>
              ))}

              </div>
              <div className="col">
              <h3>{T("nav.wind")}</h3>
              <div className="wd-grid">
                <label className="wd-field">
                  <span>{T("nav.dep.short")}{detected ? <em> · {T("nav.dep.badge")}</em> : null}</span>
                  <input
                    className="mini mono"
                    type="datetime-local"
                    min={toLocalInput(nowMin)}
                    max={toLocalInput(maxDep)}
                    value={route.departureMs === null ? "" : toLocalInput(route.departureMs)}
                    onChange={(e) => changeDeparture(e.target.value)}
                  />
                </label>
                <label className="wd-field">
                  <span>{T("nav.aw.alt.short")} ({altUnit})</span>
                  <MiniNum label={T("nav.aw.alt")} value={fromSI("altitude", prefs, cruiseM)} onCommit={(v) => v !== null && v > 0 && setCruise(toSI("altitude", prefs, v))} />
                </label>
              </div>
              {depStale && <p className="error" role="alert">{T("nav.dep.stale")}</p>}
              <p className={awFailed ? "error small" : "muted small"} role="status">
                {!autoOn ? T("nav.aw.manual") : !canAuto ? T("nav.aw.needAircraft") : p.autoWindBusy ? T("nav.aw.busy") : (awMsg ?? "")}
                {awFailed && autoOn && canAuto && !p.autoWindBusy && <> <Button size="compact" onClick={() => setAwRetry((n) => n + 1)}>{T("nav.aw.retry")}</Button></>}
              </p>
              <details className="windbox">
                <summary>{T("nav.legwind")}</summary>
                <button className="tgl" aria-pressed={autoOn} onClick={() => setAuto(!autoOn)}>{T("nav.aw.auto")}</button>
                <div className="wind-grid">
                  <span /><span className="wg-h">{T("nav.wind.dirShort")}</span><span className="wg-h">{T("nav.wind.speedShort")} ({speedUnit})</span><span />
                  <span className="wg-n">{T("nav.wind.default")}</span>
                  <MiniNum label={T("nav.wind.dir")} value={route.windDefault?.directionDeg ?? null} onCommit={(d) => applyDefaultWind(d, windSpeedShown(route.windDefault))} />
                  <MiniNum label={T("nav.wind.speed")} value={windSpeedShown(route.windDefault)} onCommit={(sp) => applyDefaultWind(route.windDefault?.directionDeg ?? null, sp)} />
                  <span />
                  {route.points.slice(1).map((pt, k) => {
                    const own = k in route.windByLeg;
                    const w = own ? (route.windByLeg[k] ?? null) : route.windDefault;
                    return (
                      <div className="wg-row" key={pt.id}>
                        <span className="wg-n" title={`${route.points[k]?.name ?? ""} → ${pt.name}`}>{T("nav.wind.leg")} {k + 1}</span>
                        <MiniNum label={`${T("nav.wind.dir")} ${k + 1}`} value={w?.directionDeg ?? null} onCommit={(d) => { setAutoOff(); commitWind(d, windSpeedShown(w), (x) => edit((r) => setLegWind(r, k, x, now()))); }} />
                        <MiniNum label={`${T("nav.wind.speed")} ${k + 1}`} value={windSpeedShown(w)} onCommit={(sp) => { setAutoOff(); commitWind(w?.directionDeg ?? null, sp, (x) => edit((r) => setLegWind(r, k, x, now()))); }} />
                        <Button size="compact" className="wg-reset" aria-label={T("nav.legwind.reset")} title={T("nav.legwind.reset")} icon="rotate-ccw" disabled={!own} onClick={() => edit((r) => setLegWind(r, k, undefined, now()))} />
                      </div>
                    );
                  })}
                </div>
              </details>

              <h3>{T("nav.exportTitle")}</h3>
              <div className="choices export-row">
                {(["gpx", "kml", "fpl", "pln"] as RouteFormat[]).map((f) => (
                  <Button key={f} size="compact" disabled={route.points.length === 0} onClick={() => download(`${route.name.replace(/[\\/:*?"<>|]/g, "_")}.${f}`, exportRoute(f, toRouteFile(route)))}>{f.toUpperCase()}</Button>
                ))}
                <Button {...(isActiveRoute ? { role: "primary" as const } : {})} icon="file-down" disabled={route.points.length < 2} onClick={p.onDossier}>{T("nav.dossier")}</Button>
              </div>
              </div>
            </div>
          )}
        </>
      )}

      {p.tab === 1 && !route && (
        <>
          <p className="muted">{T("nav.needRoute")}</p>
          <div className="choices"><Button role="primary" onClick={p.onGoRoutes}>{T("nav.goRoutes")}</Button></div>
        </>
      )}

      {p.tab === 1 && route && (
        <div className="vfrlog cols log">
          <div className="col">
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
                  defaults={autoFields}
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

          </div>
          <div className="col">
          <h3>{T("navasp.title")}</h3>
          {!p.hasAero && <p className="muted small">{T("navasp.needData")}</p>}
          {p.hasAero && route.points.length >= 2 && crossed.length === 0 && <p className="muted small">{T("navasp.none")}</p>}
          {(() => {
            const card = (h: (typeof crossed)[number]) => (
              <div className={`crossed ${h.vertical}`} key={h.airspace.id}>
                <div className="crossed-head">
                  <b>{h.airspace.name}</b>
                  <span className="badge">{h.vertical !== "outside" && <Icon name={h.vertical === "inside" ? "triangle-alert" : "diamond-alert"} size={16} />}{T(h.vertical === "inside" ? "navasp.inside" : h.vertical === "outside" ? "navasp.outside" : "navasp.unknown")}</span>
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
            );
            const rel = crossed.filter((h) => h.vertical !== "outside");
            const out = crossed.filter((h) => h.vertical === "outside");
            return (
              <>
                {rel.map(card)}
                {out.length > 0 && (
                  <details className="foldsec rawbox">
                    <summary>{out.length} {T("navasp.outsideGroup")}</summary>
                    {out.map(card)}
                  </details>
                )}
              </>
            );
          })()}
          {p.hasAero && crossed.length > 0 && <p className="muted small">{T("navasp.legend")}</p>}
          </div>
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
  onUndoable: (text: string, restore: () => void) => void;
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
        <div className="adhead-actions">
          <Button role="primary" icon="navigation" onClick={() => { p.onDirect(p.index); p.onClose(); }}>{T("nav.point.direct")}</Button>
          <Button size="compact" icon="x" aria-label={T("close")} onClick={p.onClose} />
        </div>
      </header>
      <div className="ptsheet-fields">
        <label className="numfield">
          <span>{T("nav.name")}</span>
          <input className="field" defaultValue={pt.name} key={pt.id} onBlur={(e) => p.onRoute(renamePoint(p.route, p.index, e.target.value, now))} />
        </label>
        <NumField
          label={`${T("nav.point.alt")} (${unitLabel("altitude", p.prefs)})`}
          value={pt.altitude === null ? null : fromSI("altitude", p.prefs, pt.altitude)}
          onCommit={(v) => p.onRoute(setPointAltitude(p.route, p.index, v === null ? null : meters(toSI("altitude", p.prefs, v)), now))}
        />
      </div>
      <p className="muted small mono">{pt.position.lat.toFixed(5)}, {pt.position.lon.toFixed(5)}</p>
      <div className="choices">
        <button
          disabled={p.index === p.route.points.length - 1}
          onClick={() => {
            const pt = p.route.points[p.index];
            if (!pt) return;
            const n = Date.now();
            const withCopy = addPoint(p.route, pt.position.lat, pt.position.lon, `${pt.id}-arr-${n}`, n);
            p.onRoute(renamePoint(withCopy, withCopy.points.length - 1, pt.name, n));
            p.onClose();
          }}
        >{T("nav.point.arrival")}</button>
        <Button onClick={() => { const before = p.route; p.onRoute(removePoint(p.route, p.index, now)); p.onUndoable(T("nav.point.deleted"), () => p.onRoute(before)); p.onClose(); }} role="danger" className="end">{T("nav.delete")}</Button>
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
    () => {
      if (!p.position || p.airfields.length === 0) return [];
      // Types openAIP : 4 et 7 = héliports, 8 = terrain fermé, 12 = piste agricole. Ils passent après les terrains utilisables.
      const unusable = (a: Airfield) => a.type === 4 || a.type === 7 || a.type === 8 || a.type === 12;
      const first = nearestAirfields(p.position, p.airfields, 6, (a) => !a.private && !unusable(a));
      if (first.length >= 6) return first;
      const rest = nearestAirfields(p.position, p.airfields, 6 - first.length, (a) => !a.private && unusable(a));
      return [...first, ...rest];
    },
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
        <Button size="compact" icon="x" aria-label={T("close")} onClick={p.onClose} />
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
