import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALTITUDE_UNITS, DISTANCE_UNITS, Geoid, PRESSURE_UNITS, SPEED_UNITS, SPEED_VECTOR_MINUTES, UNIT_CHOICES,
  PressureFilter, VERTICAL_SPEED_UNITS, altitudeResult, directTo, distance, flightLevelOf, flightValues, formatAngle, formatDuration,
  formatQuantity, gpsStatus, hasReachedPoint, speedVector, unitLabel,
  type AltitudeSettings, type GpsFix, type Pascals, type UnitPrefs,
} from "@lim/core";
import { AltitudeSheet, UnitSheet, type CellId } from "./CellSheets";
import { MAX_ZOOM, importMbtiles, loadCharts, removeChart, saveChart, type ChartRecord } from "./charts";
import { CEILING_FILTER } from "./config";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Orientation, type TappedFeature, type Theme } from "./MapView";
import { addPoint, fromRouteFile, movePoint, newRoute, type RouteRecord } from "./routeEdit";
import { deleteRoute, loadActiveRouteId, loadRoutes, saveActiveRouteId, saveRoute } from "./routeStore";
import { FormatError, importRoute } from "@lim/core";
import { deleteOverlay, loadOverlays, readOverlayFile, saveOverlay, type Overlay } from "./overlays";
import { DeviceGpsSource, SimulatedSource, type PositionSource } from "./positionSource";
import { DirectSheet, NavScreen, PointSheet } from "./NavScreen";
import { DeviceBarometer, SimulatedBarometer, type PressureSource } from "./pressureSource";
import { loadAltitude, loadGpsAltitudeRef, loadPerf, savePerf, loadUnitPrefs, saveAltitude, saveGpsAltitudeRef, saveUnitPrefs, loadFiguresColor, saveFiguresColor, type GpsAltitudeRef } from "./prefs";

type Screen = "map" | "nav" | "docs" | "settings" | "soon";

const NAV_TABS: Key[] = ["nav.log", "nav.profile", "nav.fuel", "nav.wb"];
const DOCS_TABS: Key[] = ["docs.traces", "docs.documents", "docs.products", "docs.points"];
const WEATHER: Key[] = ["wx.metar", "wx.taf", "wx.sigmet", "wx.wintem", "wx.radar"];

/** Une ligne de réglage par information : libellé + choix d'unité. */
const UNIT_ROWS: { field: keyof UnitPrefs; label: Key }[] = [
  { field: "groundSpeed", label: "unit.groundSpeed" },
  { field: "altitude", label: "unit.altitude" },
  { field: "distance", label: "unit.distance" },
  { field: "verticalSpeed", label: "unit.verticalSpeed" },
  { field: "pressure", label: "unit.pressure" },
  { field: "track", label: "unit.track" },
  { field: "bearing", label: "unit.bearing" },
];

const UNIT_LABELS: Record<string, string> = Object.fromEntries(
  [SPEED_UNITS, ALTITUDE_UNITS, DISTANCE_UNITS, VERTICAL_SPEED_UNITS, PRESSURE_UNITS].flatMap((tbl) =>
    Object.entries(tbl).map(([k, v]) => [k, v.label]),
  ),
);

/** `?sim` ou `?sim=loss` dans l'adresse : simulateur de position (démonstration). */
function simMode(): null | "sim" | "loss" {
  const v = new URLSearchParams(location.search).get("sim");
  return v === null ? null : v === "loss" ? "loss" : "sim";
}

/** Écran large (ordinateur, tablette en paysage) : carte et panneau de route côte à côte. */
function useWide(): boolean {
  const query = "(min-width: 1100px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setWide(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const wide = useWide();
  // L'avertissement est volontairement redemandé à chaque lancement (jamais mémorisé).
  const [accepted, setAccepted] = useState(false);
  const [theme, setTheme] = useState<Theme>("day");
  const [screen, setScreen] = useState<Screen>("map");
  const [soonTitle, setSoonTitle] = useState<Key>("soon");
  const [tab, setTab] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [ceiling, setCeiling] = useState<number>(CEILING_FILTER.defaultFL);
  const [prefs, setPrefs] = useState<UnitPrefs>(loadUnitPrefs);
  const [gpsAltRef, setGpsAltRef] = useState<GpsAltitudeRef>(loadGpsAltitudeRef);
  const [altMem] = useState(() => loadAltitude(Date.now()));
  const [altSettings, setAltSettings] = useState<AltitudeSettings>(altMem.settings);
  const qnhSetAt = useRef(altMem.qnhSetAtMs);
  const offsetSetAt = useRef(altMem.offsetSetAtMs);
  const [qnhExpired, setQnhExpired] = useState(altMem.qnhExpired);
  const [cellSheet, setCellSheet] = useState<CellId | null>(null);
  const [figuresColor, setFiguresColor] = useState(loadFiguresColor);
  // Routes : mémorisées sur l'appareil ; une route active, un point visé (Direct), un mode tracé.
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(loadActiveRouteId);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [perf, setPerf] = useState(loadPerf);
  const [routeImportError, setRouteImportError] = useState<string | null>(null);
  const [fit, setFit] = useState({ nonce: 0, force: false });
  // Baromètre de l'appareil (coque Android) : mesures brutes filtrées, relues chaque seconde pour l'affichage.
  const baroFilter = useRef(new PressureFilter(1.0));
  const [baroAvailable, setBaroAvailable] = useState(false);
  const [baroLast, setBaroLast] = useState<{ pressure: Pascals; ageMs: number } | null>(null);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [geoid, setGeoid] = useState<Geoid | null>(null);
  const [follow, setFollow] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>("north");
  const [zoomCommand, setZoomCommand] = useState({ delta: 0, nonce: 0 });
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [details, setDetails] = useState<TappedFeature[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chartInput = useRef<HTMLInputElement>(null);
  const [charts, setCharts] = useState<ChartRecord[]>([]);
  const [chartBusy, setChartBusy] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartNotice, setChartNotice] = useState(false);

  const setUnit = <K extends keyof UnitPrefs>(field: K, value: UnitPrefs[K]) => {
    const next = { ...prefs, [field]: value };
    setPrefs(next);
    saveUnitPrefs(next);
  };
  // Le panneau Route réduit la carte : on recadre sur la route (seulement s'il n'y a pas d'avion à suivre).
  const splitNow = wide && screen === "nav";
  useEffect(() => {
    if (splitNow) setFit((f) => ({ nonce: f.nonce + 1, force: false }));
  }, [splitNow]);

  // Clavier (ordinateur) : Échap ferme les fiches, le tiroir et le mode tracé.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setCellSheet(null);
      setDetails(null);
      setDirectOpen(false);
      setSelectedPoint(null);
      setDrawer(false);
      setEditMode(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const route = routes.find((r) => r.id === activeRouteId) ?? null;
  const uid = () => crypto.randomUUID();
  const putRoute = (next: RouteRecord) => {
    setRoutes((prev) => (prev.some((r) => r.id === next.id) ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next]));
    void saveRoute(next).catch(() => undefined);
  };
  const selectRoute = (id: string | null) => {
    setActiveRouteId(id);
    saveActiveRouteId(id);
    setTargetIndex(null);
    setSelectedPoint(null);
    if (id !== null) {
      setFollow(false);
      setFit((f) => ({ nonce: f.nonce + 1, force: true }));
    }
  };
  const createRoute = () => {
    const r = newRoute(uid(), `${t(lang, "nav.new")} ${routes.length + 1}`, Date.now());
    putRoute(r);
    selectRoute(r.id);
    return r;
  };
  const onMapTap = (lat: number, lon: number) => {
    const r = route ?? createRoute();
    const next = addPoint(r, lat, lon, uid(), Date.now());
    putRoute(next);
    if (targetIndex === null) setTargetIndex(0);
  };
  const importRouteFile = async (file: File) => {
    setRouteImportError(null);
    try {
      const rf = importRoute(file.name, await file.text());
      const r = fromRouteFile(rf, uid, Date.now());
      putRoute(r);
      selectRoute(r.id);
      setTargetIndex(0);
    } catch (e) {
      setRouteImportError(`${file.name} : ${e instanceof FormatError || e instanceof Error ? e.message : String(e)}`);
    }
  };
  const removeRoute = (id: string) => {
    void deleteRoute(id);
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    if (id === activeRouteId) selectRoute(null);
  };
  const changeAltitude = (next: AltitudeSettings, changed: { qnh?: boolean; offset?: boolean }) => {
    const now = Date.now();
    if (changed.qnh) {
      qnhSetAt.current = now;
      setQnhExpired(false);
    }
    if (changed.offset) offsetSetAt.current = now;
    setAltSettings(next);
    saveAltitude(next, qnhSetAt.current, offsetSetAt.current);
  };
  const openCell = (id: CellId) => {
    setDetails(null);
    setDrawer(false);
    setCellSheet((cur) => (cur === id ? null : id));
  };
  const chooseGpsAlt = (v: GpsAltitudeRef) => {
    setGpsAltRef(v);
    saveGpsAltitudeRef(v);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "night" ? "dark" : "light";
    document.documentElement.lang = lang;
    document.documentElement.dataset.figures = figuresColor ? "color" : "mono";
  }, [theme, lang, figuresColor]);

  // Grille du géoïde EGM96 et couches importées : disponibles hors-ligne (cache du service worker, IndexedDB).
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/egm96.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setGeoid(new Geoid(b)))
      .catch(() => setGeoid(null));
    loadOverlays().then(setOverlays).catch(() => setOverlays([]));
    loadCharts().then(setCharts).catch(() => setCharts([]));
    loadRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, []);

  // Baromètre : démarre dès l'acceptation de l'avertissement ; absent dans un navigateur (sauf simulateur ?sim).
  useEffect(() => {
    if (!accepted) return;
    let cancelled = false;
    let source: PressureSource | null = null;
    void (async () => {
      const sim = simMode() !== null;
      const available = sim || (await DeviceBarometer.isAvailable());
      if (cancelled) return;
      setBaroAvailable(available);
      if (!available) return;
      source = sim ? new SimulatedBarometer() : new DeviceBarometer();
      await source.start(
        (s) => void baroFilter.current.update(s.pressure, s.timeMs),
        () => setBaroAvailable(false),
      );
    })();
    const tick = setInterval(() => setBaroLast(baroFilter.current.last(Date.now())), 1000);
    return () => {
      cancelled = true;
      clearInterval(tick);
      void source?.stop();
    };
  }, [accepted]);

  // Source de position + écran toujours allumé + horloge pour détecter la perte de signal.
  useEffect(() => {
    if (!accepted) return;
    const mode = simMode();
    const source: PositionSource =
      mode === null ? new DeviceGpsSource(gpsAltRef) : new SimulatedSource(undefined, mode === "loss");
    source.start(
      (f) => {
        setFix(f);
        setGpsError(null);
      },
      (m) => setGpsError(m),
    );
    const tick = setInterval(() => setNow(Date.now()), 1000);
    let lock: WakeLockSentinel | null = null;
    const requestLock = () => {
      navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    };
    requestLock();
    const onVisible = () => document.visibilityState === "visible" && requestLock();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      source.stop();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [accepted, gpsAltRef]);

  const status = gpsStatus(fix, now);
  const targetPoint = route && targetIndex !== null ? (route.points[targetIndex] ?? null) : null;
  const fv = useMemo(() => (fix ? flightValues(fix, geoid, new Date(fix.timeMs)) : null), [fix, geoid]);
  // Avancer au point suivant dès qu'on atteint le point visé.
  useEffect(() => {
    if (!fix || !route || targetIndex === null || status === "lost") return;
    const tp = route.points[targetIndex];
    if (!tp) return;
    if (hasReachedPoint(distance(fix.position, tp.position), fix.groundSpeed)) {
      setTargetIndex(targetIndex + 1 < route.points.length ? targetIndex + 1 : null);
    }
  }, [fix, route, targetIndex, status]);
  // Au lancement, on vise le premier point de la route active (une seule fois : après l'arrivée au dernier point, on ne revise pas le premier).
  const initialTargetDone = useRef(false);
  useEffect(() => {
    if (initialTargetDone.current || !route) return;
    initialTargetDone.current = true;
    if (route.points.length > 0) {
      setTargetIndex(0);
      setFit((f) => ({ nonce: f.nonce + 1, force: false }));
    }
  }, [route]);
  const direct = useMemo(
    () => (fix && targetPoint && status !== "lost" ? directTo(fix.position, targetPoint.position, fix.groundSpeed, new Date(fix.timeMs)) : null),
    [fix, targetPoint, status],
  );
  const vector = useMemo(() => (fix && status !== "lost" ? speedVector(fix, SPEED_VECTOR_MINUTES) : []), [fix, status]);

  const T = (k: Key) => t(lang, k);
  const toggleLang = () => setLang(lang === "fr" ? "en" : "fr");
  const toggleTheme = () => setTheme(theme === "day" ? "night" : "day");
  const open = (s: Screen) => {
    setScreen(s);
    setTab(0);
    setDrawer(false);
  };
  const soon = (title: Key) => {
    setSoonTitle(title);
    open("soon");
  };

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setOverlayError(null);
    for (const f of Array.from(files)) {
      try {
        const o = await readOverlayFile(f);
        await saveOverlay(o);
        setOverlays((prev) => [...prev, o]);
      } catch (e) {
        setOverlayError(`${f.name} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const importCharts = async (files: FileList | null) => {
    if (!files) return;
    setChartError(null);
    for (const f of Array.from(files)) {
      try {
        const { record, persisted } = await importMbtiles(f, (phase, v) =>
          setChartBusy(phase === "copy" ? `${T("chart.copying")} ${Math.round(v * 100)} %` : `${T("chart.indexing")} ${v}`),
        );
        setChartNotice(!persisted);
        setCharts((prev) => [...prev, record]);
      } catch (e) {
        setChartError(`${f.name} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setChartBusy(null);
    if (chartInput.current) chartInput.current.value = "";
  };
  const updateChart = (id: string, patch: Partial<Pick<ChartRecord, "visible" | "showFromZoom" | "showToZoom">>) => {
    setCharts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // La borne basse ne dépasse jamais la borne haute.
        if (next.showFromZoom > next.showToZoom) {
          if (patch.showFromZoom !== undefined) next.showToZoom = next.showFromZoom;
          else next.showFromZoom = next.showToZoom;
        }
        void saveChart(next).catch(() => undefined);
        return next;
      }),
    );
  };
  const dropChart = (id: string) => {
    void removeChart(id);
    setCharts((prev) => prev.filter((c) => c.id !== id));
  };
  const removeOverlay = (id: string) => {
    void deleteOverlay(id);
    setOverlays((prev) => prev.filter((o) => o.id !== id));
  };

  if (!accepted) {
    return (
      <main className="warning">
        <div className="kicker">{T("warning.kicker")}</div>
        <h1>{T("warning.title")}</h1>
        <p>{T("warning.body")}</p>
        <button className="brand" onClick={() => setAccepted(true)}>
          {T("warning.accept")}
        </button>
        <button onClick={toggleLang}>{T("lang.switch")}</button>
      </main>
    );
  }

  // Un signal perdu n'affiche plus de valeur (« --- ») : on ne montre jamais une vieille valeur comme si elle était actuelle.
  const live = fv !== null && status !== "lost";
  const stale = status === "stale" || status === "poor";
  const trackShown = live ? (prefs.track === "mag" ? fv.trackMagnetic : fv.trackTrue) : null;
  // Altitude : mode QNH / niveau de vol / GPS brute, tout estimé depuis le GPS (voir core/altitude.ts).
  // Un baromètre qui ne répond plus depuis 5 s est considéré muet (repli sur le GPS, signalé dans le label).
  const baroP: Pascals | null = baroAvailable && baroLast !== null && baroLast.ageMs < 5000 ? baroLast.pressure : null;
  const altRes = altitudeResult(live ? fv.altitudeMsl : null, baroP, altSettings);
  const altM = altRes.value;
  const fromBaro = altRes.origin === "baro";
  const qnhText = formatQuantity("pressure", prefs, altSettings.qnh);
  const calibrated = altSettings.offset !== 0 && altSettings.mode !== "gps" && !fromBaro;
  const baroFallback = altSettings.source === "baro" && !fromBaro && altSettings.mode !== "gps";
  const altLabel =
    altSettings.mode === "gps"
      ? T("alt.short.gps")
      : `${T(altSettings.mode === "fl" ? "alt.short.fl" : fromBaro ? "alt.short.baro" : "alt.short.qnh")} ${qnhText}${calibrated ? "*" : ""}${baroFallback ? " GPS" : ""}`;
  const altValue =
    altM === null
      ? "---"
      : altSettings.mode === "fl"
        ? String(Math.max(0, flightLevelOf(altM))).padStart(3, "0")
        : formatQuantity("altitude", prefs, altM);
  const altUnit = altSettings.mode === "fl" ? "FL" : unitLabel("altitude", prefs);

  const cells: { id: CellId | null; label: string; value: string; unit?: string; sub?: string | undefined }[] = [
    { id: "gs", label: T("data.gs"), value: live ? formatQuantity("groundSpeed", prefs, fv.groundSpeed ?? NaN) : "---", unit: unitLabel("groundSpeed", prefs) },
    { id: "trk", label: T("data.trk"), value: formatAngle(trackShown), unit: unitLabel("track", prefs, lang) },
    { id: null, label: T("data.wpt"), value: targetPoint?.name ?? "---" },
    { id: "alt", label: altLabel, value: altValue, unit: altUnit },
    { id: "brg", label: T("data.brg"), value: direct ? formatAngle(prefs.bearing === "mag" ? direct.magneticBearing : direct.trueBearing) : "---", unit: unitLabel("bearing", prefs, lang) },
    { id: "dist", label: T("data.dist"), value: direct ? formatQuantity("distance", prefs, direct.distance) : "---", sub: direct ? formatDuration(direct.timeToGo) : undefined, unit: unitLabel("distance", prefs) },
  ];

  const tabs = screen === "nav" ? NAV_TABS : screen === "docs" ? DOCS_TABS : null;
  // Écran large : l'écran Route s'affiche à droite de la carte, qui reste utilisable (tracé, Direct).
  const split = wide && screen === "nav";
  const mapActive = screen === "map" || split;
  const toolbar: { label: Key; action: () => void; pressed?: boolean }[] = [
    { label: "tb.route", action: () => open(screen === "nav" ? "map" : "nav"), pressed: screen === "nav" },
    { label: "tb.direct", action: () => { open("map"); setCellSheet(null); setDetails(null); setDirectOpen((v) => !v); } },
    { label: "tb.settings", action: () => open("settings") },
    { label: "tb.center", action: () => { open("map"); setFollow(true); }, pressed: follow && mapActive },
    { label: "tb.maps", action: () => setDrawer(!drawer), pressed: drawer },
    { label: "tb.relief", action: () => soon("tb.relief") },
    { label: "tb.profile", action: () => soon("tb.profile") },
    { label: "tb.timer", action: () => soon("tb.timer") },
    { label: "tb.docs", action: () => open("docs") },
  ];

  const banner: { text: string; alert: boolean } | null =
    status === "lost" ? { text: T("gps.lost"), alert: true }
    : gpsError && !fix ? { text: T("gps.error"), alert: false }
    : status === "stale" || status === "poor" ? { text: T("gps.stale"), alert: false }
    : status === "none" ? { text: T("gps.waiting"), alert: false }
    : fv?.variationOutOfRange ? { text: T("mag.expired"), alert: true }
    : null;

  return (
    <div className="app">
      <nav className="toolbar" aria-label="outils">
        {toolbar.map((b) => (
          <button key={b.label} aria-pressed={b.pressed} onClick={b.action}>
            {T(b.label)}
          </button>
        ))}
      </nav>

      <div className={split ? "stage split" : "stage"}>
        <MapView
          theme={theme}
          emptyLabel={T("map.empty")}
          fix={status === "lost" ? null : fix}
          trackTrue={fv?.trackTrue ?? null}
          vector={vector}
          follow={follow}
          orientation={orientation}
          onUserMove={() => setFollow(false)}
          overlays={overlays}
          charts={charts}
          route={route}
          targetIndex={targetIndex}
          selectedIndex={selectedPoint}
          editMode={editMode}
          fitRequest={fit}
          onMapTap={onMapTap}
          onPointTap={(i) => { setDirectOpen(false); setCellSheet(null); setDetails(null); setSelectedPoint(i); }}
          onPointMove={(i, lat, lon) => route && putRoute(movePoint(route, i, lat, lon, Date.now()))}
          ceilingFL={ceiling}
          onDoubleTap={(f) => { setCellSheet(null); setDetails(f); }}
          zoomCommand={zoomCommand}
        />

        {mapActive && (
          <div className={`gps-chip gps-${status === "ok" ? "ok" : status === "lost" ? "lost" : status === "none" ? "none" : "weak"}`}>
            <span className="dot" aria-hidden="true" />
            {T(status === "ok" ? "gps.chip.ok" : status === "lost" ? "gps.chip.lost" : status === "none" ? "gps.chip.none" : "gps.chip.weak")}
          </div>
        )}

        {banner && (
          <div className={banner.alert ? "banner alert" : "banner"} role={banner.alert ? "alert" : "status"}>
            {banner.text}
          </div>
        )}

        {mapActive && (
          <>
            <div className="mapctl">
              <button aria-label="zoom +" onClick={() => setZoomCommand((z) => ({ delta: 1, nonce: z.nonce + 1 }))}>+</button>
              <button aria-label="zoom −" onClick={() => setZoomCommand((z) => ({ delta: -1, nonce: z.nonce + 1 }))}>−</button>
              <button aria-pressed={editMode} aria-label={T("tool.draw")} onClick={() => setEditMode((v) => !v)}>✎</button>
              <button aria-pressed={orientation === "track"} onClick={() => setOrientation(orientation === "north" ? "track" : "north")}>
                {orientation === "north" ? "N" : "↑"}
              </button>
            </div>
            <button className="fab" aria-label={T("layers.title")} aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
              ≡
            </button>
          </>
        )}

        {details && mapActive && (
          <aside className="sheet" aria-label={T("details.title")}>
            <header>
              <h2>{T("details.title")}</h2>
              <button onClick={() => setDetails(null)}>{T("close")}</button>
            </header>
            {details.length === 0 ? (
              <p className="muted">{T("details.empty")}</p>
            ) : (
              details.map((d, i) => (
                <section key={i}>
                  <h3>{d.layerName}</h3>
                  <dl>
                    {Object.entries(d.properties).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))
            )}
          </aside>
        )}

        {selectedPoint !== null && route && mapActive && (
          <PointSheet
            lang={lang}
            prefs={prefs}
            route={route}
            index={selectedPoint}
            onRoute={putRoute}
            onDirect={setTargetIndex}
            onClose={() => setSelectedPoint(null)}
          />
        )}
        {directOpen && mapActive && (
          <DirectSheet lang={lang} route={route} targetIndex={targetIndex} onPick={setTargetIndex} onClose={() => setDirectOpen(false)} />
        )}
        {cellSheet === "alt" && mapActive && (
          <AltitudeSheet
            lang={lang}
            prefs={prefs}
            setUnit={setUnit}
            onClose={() => setCellSheet(null)}
            settings={altSettings}
            onSettings={changeAltitude}
            gpsAmsl={live ? fv.altitudeMsl : null}
            qnhExpired={qnhExpired}
            gpsAltRef={gpsAltRef}
            onGpsAltRef={chooseGpsAlt}
            baroAvailable={baroAvailable}
            baroPressure={baroP}
          />
        )}
        {cellSheet !== null && cellSheet !== "alt" && mapActive && (
          <UnitSheet cell={cellSheet} lang={lang} prefs={prefs} setUnit={setUnit} onClose={() => setCellSheet(null)} />
        )}

        {drawer && (
          <aside className="drawer">
            <h2>{T("layers.title")}</h2>
            <h3>{T("layers.weather")}</h3>
            <ul>
              {WEATHER.map((k) => (
                <li key={k}>
                  <button className="row" onClick={() => soon(k)}>{T(k)}</button>
                </li>
              ))}
            </ul>
            <h3>{T("layers.maps")}</h3>
            {charts.length === 0 && <p className="muted">{T("layers.none")}</p>}
            {charts.map((c) => (
              <div className="chart-item" key={c.id}>
                <div className="overlay-item">
                  <span>{c.name}</span>
                  <button onClick={() => dropChart(c.id)}>{T("overlay.remove")}</button>
                </div>
                <p className="muted small">
                  {c.info.tileCount} {T("chart.tiles")} · z{c.info.minZoom}–{c.info.maxZoom} · {(c.sizeBytes / 1048576).toFixed(0)} Mo
                </p>
                <button className="row" aria-pressed={c.visible} onClick={() => updateChart(c.id, { visible: !c.visible })}>
                  {c.visible ? T("chart.shown") : T("chart.hidden")}
                </button>
                <div className="stepper">
                  <span>{T("chart.zoomFrom")}</span>
                  <button aria-label="−" onClick={() => updateChart(c.id, { showFromZoom: Math.max(0, c.showFromZoom - 1) })}>−</button>
                  <b className="mono">{c.showFromZoom}</b>
                  <button aria-label="+" onClick={() => updateChart(c.id, { showFromZoom: Math.min(MAX_ZOOM, c.showFromZoom + 1) })}>+</button>
                </div>
                <div className="stepper">
                  <span>{T("chart.zoomTo")}</span>
                  <button aria-label="−" onClick={() => updateChart(c.id, { showToZoom: Math.max(0, c.showToZoom - 1) })}>−</button>
                  <b className="mono">{c.showToZoom}</b>
                  <button aria-label="+" onClick={() => updateChart(c.id, { showToZoom: Math.min(MAX_ZOOM, c.showToZoom + 1) })}>+</button>
                </div>
              </div>
            ))}
            <input ref={chartInput} type="file" hidden multiple accept=".mbtiles" onChange={(e) => void importCharts(e.target.files)} />
            <button className="row" disabled={chartBusy !== null} onClick={() => chartInput.current?.click()}>{T("chart.import")}</button>
            <p className="muted small">{T("chart.formats")}</p>
            {chartBusy && <p className="muted small" role="status">{chartBusy}</p>}
            {chartNotice && <p className="error" role="alert">{T("chart.notPersisted")}</p>}
            {chartError && <p className="error" role="alert">{T("chart.error")} — {chartError}</p>}
            <h3>{T("layers.overlays")}</h3>
            <ul>
              {overlays.map((o) => (
                <li key={o.id} className="overlay-item">
                  <span>{o.name}</span>
                  <button onClick={() => removeOverlay(o.id)}>{T("overlay.remove")}</button>
                </li>
              ))}
            </ul>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept=".geojson,.json,.kml,.zip"
              onChange={(e) => void importFiles(e.target.files)}
            />
            <button className="row" onClick={() => fileInput.current?.click()}>{T("overlay.import")}</button>
            <p className="muted small">{T("overlay.formats")}</p>
            {overlayError && <p className="error" role="alert">{T("overlay.error")} — {overlayError}</p>}
            <h3>
              {T("layers.ceiling")} <span className="mono">FL {ceiling}</span>
            </h3>
            <input
              type="range"
              min={CEILING_FILTER.minFL}
              max={CEILING_FILTER.maxFL}
              step={CEILING_FILTER.stepFL}
              value={ceiling}
              onChange={(e) => setCeiling(Number(e.target.value))}
            />
          </aside>
        )}

        {screen !== "map" && (
          <section className="screen">
            <header className="screen-head">
              <button onClick={() => open("map")}>← {T("back")}</button>
              <h2>
                {screen === "settings"
                  ? T("set.title")
                  : screen === "soon"
                    ? T(soonTitle)
                    : T(tabs?.[tab] ?? "soon")}
              </h2>
            </header>
            {screen === "settings" ? (
              <div className="settings">
                <h3>{T("set.display")}</h3>
                <div className="choices">
                  <button onClick={toggleLang}>{T("lang.switch")}</button>
                  <button onClick={toggleTheme} aria-pressed={theme === "night"}>
                    {theme === "day" ? T("theme.night") : T("theme.day")}
                  </button>
                </div>
                <h3>{T("set.figures")}</h3>
                <div className="choices">
                  <button aria-pressed={figuresColor} onClick={() => { setFiguresColor(true); saveFiguresColor(true); }}>{T("figures.color")}</button>
                  <button aria-pressed={!figuresColor} onClick={() => { setFiguresColor(false); saveFiguresColor(false); }}>{T("figures.mono")}</button>
                </div>
                <h3>{T("set.units")}</h3>
                {UNIT_ROWS.map(({ field, label }) => (
                  <div className="unit-row" key={field} role="group" aria-label={T(label)}>
                    <div className="unit-name">{T(label)}</div>
                    <div className="choices">
                      {UNIT_CHOICES[field].map((choice) => (
                        <button
                          key={choice}
                          aria-pressed={prefs[field] === choice}
                          onClick={() => setUnit(field, choice as UnitPrefs[typeof field])}
                        >
                          {choice === "mag" || choice === "true"
                            ? unitLabel(field as "track" | "bearing", { ...prefs, [field]: choice }, lang)
                            : (UNIT_LABELS[choice] ?? choice)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : screen === "nav" && tab === 0 ? (
              <NavScreen
                lang={lang}
                prefs={prefs}
                route={route}
                routes={routes}
                perf={perf}
                date={new Date(now)}
                importError={routeImportError}
                onPerf={(p2) => { setPerf(p2); savePerf(p2); }}
                onRoute={putRoute}
                onNewRoute={() => { createRoute(); }}
                onSelectRoute={(id) => { selectRoute(id); setTargetIndex(0); }}
                onDeleteRoute={removeRoute}
                onImportFile={(f) => void importRouteFile(f)}
                onDirect={(i) => { setTargetIndex(i); if (!wide) open("map"); }}
                onDrawOnMap={() => { if (!wide) open("map"); setEditMode(true); }}
                onShowRoute={() => { setFollow(false); setFit((f) => ({ nonce: f.nonce + 1, force: true })); if (!wide) open("map"); }}
              />
            ) : (
              <p className="muted">{T("soon")}</p>
            )}
            {tabs && (
              <nav className="tabs">
                {tabs.map((k, i) => (
                  <button key={k} aria-current={tab === i ? "page" : undefined} onClick={() => setTab(i)}>
                    {T(k)}
                  </button>
                ))}
              </nav>
            )}
          </section>
        )}
      </div>

      <footer className={stale ? "datagrid stale" : "datagrid"}>
        {cells.map((c, i) => {
          const body = (
            <>
              <div className="label">
                <span>{c.label}</span>
                {c.unit && <span>{c.unit}</span>}
              </div>
              <div className="value">{c.value}</div>
              {c.sub && <div className="sub">{c.sub}</div>}
            </>
          );
          return c.id ? (
            <button className="cell" key={i} aria-pressed={cellSheet === c.id} onClick={() => openCell(c.id as CellId)}>
              {body}
            </button>
          ) : (
            <div className="cell" key={i}>{body}</div>
          );
        })}
      </footer>
    </div>
  );
}
