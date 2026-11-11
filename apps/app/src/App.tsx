import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALTITUDE_UNITS, DISTANCE_UNITS, Geoid, PRESSURE_UNITS, SPEED_UNITS, SPEED_VECTOR_MINUTES, UNIT_CHOICES,
  PressureFilter, VERTICAL_SPEED_UNITS, altitudeResult, directTo, distance, flightLevelOf, flightValues, formatAngle, formatDuration,
  airacCycleAt, datasetFreshness, formatQuantity, type LegWindEstimate, type WindForecast, gpsStatus, hasReachedPoint, speedVector, unitLabel,
  type Airfield, type AltitudeSettings, type GpsFix, type LatLon, type Pascals, type UnitPrefs,
} from "@lim/core";
import { AltitudeSheet, UnitSheet, type CellId } from "./CellSheets";
import { MAX_ZOOM, getLostCharts, importMbtiles, loadCharts, pickMbtiles, removeChart, restoreChart, saveChart, type ChartRecord } from "./charts";
import { CEILING_FILTER } from "./config";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Orientation, type TappedFeature, type Theme } from "./MapView";
import { airfieldDetails, airfieldsToGeoJSON, airspaceDetails, navToGeoJSON, airspacesToGeoJSON, freshnessWarnings } from "./aeroGeo";
import { deleteDataset, importAeroFiles, loadDatasets, saveDataset, type AirfieldDataset, type AirspaceDataset } from "./datasets";
import { addPoint, fromRouteFile, movePoint, newRoute, renamePoint, setLegWind, toWindPlan, type RouteRecord } from "./routeEdit";
import { deleteRoute, loadActiveRouteId, loadRoutes, saveActiveRouteId, saveRoute } from "./routeStore";
import { FormatError, airspacesAlongRoute, computeNavLog, importRoute, litersPerHour, meters, stationsNearRoute, type Aircraft } from "@lim/core";
import { buildDossier } from "./dossierPdf";
import { DocsTab } from "./DocsScreen";
import { AdInfo, AdMenu } from "./AdMenu";
import { LinkPanel } from "./LinkPanel";
import { BackupPanel } from "./BackupPanel";
import { BaseMapPanel } from "./BaseMapPanel";
import { importNavFiles, type NavDataset } from "./navData";
import { loadBasePrefs, saveBasePrefs, type BaseMapPrefs } from "./baseMaps";
import { DataPanel } from "./DataPanel";
import { usePackData } from "./dataPack";
import { useLink } from "./useLink";
import { streamState } from "@lim/core";
import { blobUrl, useDocs } from "./docStore";
import { downloadVac, loadVacIndex, vacFor } from "./vacAuto";
import { imageCorners, pixelToLatLon } from "@lim/core";
import { ReplayBar, TimersTab, TracesTab, type ReplayState } from "./TracesScreens";
import { useRecorder } from "./trackStore";
import { STOPWATCH_ZERO, advanceReplay, alarm, cdDue, type Countdown, type Stopwatch } from "./timers";
import { pointAt, type TrackPoint } from "@lim/core";
import { AircraftTab, BalanceTab, FuelTab } from "./AircraftScreens";
import { useAircraft } from "./aircraftStore";

import { deleteOverlay, loadOverlays, readOverlayFile, saveOverlay, type Overlay } from "./overlays";
import { DeviceGpsSource, SimulatedSource, type PositionSource } from "./positionSource";
import { DirectSheet, NavScreen, PointSheet } from "./NavScreen";
import { WindsTab } from "./WxScreen";
import { BriefingTab, MetarTab, SigmetTab, TafTab, type WxCommon } from "./WxTabs";
import { importWxFiles, loadWx, saveWx, type MetarSet, type SigmetSet, type TafSet } from "./wxData";
import { fetchWinds, loadWindCache, windKey } from "./windClient";
import { DeviceBarometer, SimulatedBarometer, type PressureSource } from "./pressureSource";
import { loadAltitude, loadGpsAltitudeRef, loadPerf, savePerf, loadUnitPrefs, loadVisibleGroups, saveVisibleGroups, saveAltitude, saveGpsAltitudeRef, saveUnitPrefs, loadFiguresColor, saveFiguresColor, type GpsAltitudeRef } from "./prefs";

type Screen = "map" | "nav" | "aircraft" | "wx" | "docs" | "traces" | "data" | "settings" | "soon";

const NAV_TABS: Key[] = ["nav.tabRoutes", "nav.tabPoints", "nav.log", "nav.profile"];
const AIRCRAFT_TABS: Key[] = ["ac.tabSheet", "nav.wb", "nav.fuel"];
const SETTINGS_TABS: Key[] = ["set.tabDisplay", "set.tabUnits", "set.tabLinks", "set.tabBackup"];
/** Onglets annoncés mais pas encore construits : affichés grisés. */
const DISABLED_TABS: ReadonlySet<Key> = new Set<Key>(["nav.profile"]);
const SCREEN_TITLE: Record<string, Key> = { nav: "tb.route", aircraft: "tb.aircraft", wx: "tb.weather", traces: "tb.timer", data: "tb.data", docs: "tb.docs", settings: "set.title" };
const WX_TABS: Key[] = ["wx.briefing", "wx.metar", "wx.taf", "wx.sigmet", "wx.winds"];
const TRACES_TABS: Key[] = ["tm.tabTimers", "tm.tabTraces"];
const DOCS_TABS: Key[] = ["docs.documents"];

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
/** Phrase d'alerte trafic : « Trafic FGABC 0.8 NM, 12 h, +200 ft ». */
function trafficText(x: { label: string; distanceM: number; bearing: number; relAltM: number | null }, track: number | null, prefs: UnitPrefs, lead: string): string {
  const rel = track === null ? null : (((x.bearing - track) % 360) + 360) % 360;
  const clock = rel === null ? "" : `, ${Math.round(rel / 30) || 12} h`;
  const alt = x.relAltM === null ? "" : `, ${x.relAltM >= 0 ? "+" : "−"}${Math.round(Math.abs(x.relAltM) / 0.3048 / 100) * 100} ft`;
  return `${lead} ${x.label} ${formatQuantity("distance", prefs, x.distanceM)} ${unitLabel("distance", prefs)}${clock}${alt}`;
}

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
  // Données aéronautiques importées (openAIP) et leur affichage.
  const [aspSet, setAspSet] = useState<AirspaceDataset | null>(null);
  const [navSet, setNavSet] = useState<NavDataset | null>(null);
  const [aptSet, setAptSet] = useState<AirfieldDataset | null>(null);
  const [aeroBusy, setAeroBusy] = useState(false);
  const [aeroProblems, setAeroProblems] = useState<string[]>([]);
  const [visibleGroups, setVisibleGroups] = useState<string[]>(loadVisibleGroups);
  const [showAsp, setShowAsp] = useState(true);
  const [showApt, setShowApt] = useState(true);
  const [showNav, setShowNav] = useState(true);
  const [adhoc, setAdhoc] = useState<{ name: string; position: LatLon } | null>(null);
  const aeroInput = useRef<HTMLInputElement>(null);
  // Météo : prévisions de vent (réseau pour les charger, cache sur l'appareil pour l'ensuite).
  const [windForecasts, setWindForecasts] = useState<Map<string, WindForecast>>(new Map());
  const [windBusy, setWindBusy] = useState(false);
  const [metarSet, setMetarSet] = useState<MetarSet | null>(null);
  const [tafSet, setTafSet] = useState<TafSet | null>(null);
  const [sigmetSet, setSigmetSet] = useState<SigmetSet | null>(null);
  const [wxProblems, setWxProblems] = useState<string[]>([]);
  const [wxBusy, setWxBusy] = useState(false);
  const [radar, setRadar] = useState<{ time: number; template: string } | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [windError, setWindError] = useState<string | null>(null);
  // Baromètre de l'appareil (coque Android) : mesures brutes filtrées, relues chaque seconde pour l'affichage.
  const baroFilter = useRef(new PressureFilter(1.0));
  const [baroAvailable, setBaroAvailable] = useState(false);
  const [baroLast, setBaroLast] = useState<{ pressure: Pascals; ageMs: number } | null>(null);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const fixRef = useRef<GpsFix | null>(null);
  fixRef.current = fix;
  const link = useLink(() => fixRef.current?.position ?? null, (f) => { setFix(f); setGpsError(null); });
  const extOwn = link.config.enabled && link.config.useOwnship;
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
  const [lostCharts, setLostCharts] = useState<ChartRecord[]>([]);
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
    setAdhoc(null);
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
  const loadWinds = async (points: LatLon[]) => {
    setWindBusy(true);
    setWindError(null);
    try {
      const results = await Promise.all(points.map((p) => fetchWinds(p.lat, p.lon)));
      setWindForecasts((prev) => {
        const next = new Map(prev);
        for (const f of results) next.set(windKey(f.lat, f.lon), f);
        return next;
      });
    } catch (e) {
      setWindError(e instanceof Error ? e.message : String(e));
    }
    setWindBusy(false);
  };
  /** Radar de pluie : image la plus récente (RainViewer, tuiles distantes). Nécessite le réseau ; ne sert qu'à préparer le vol. */
  const toggleRadar = async () => {
    if (radar) {
      setRadar(null);
      return;
    }
    setRadarError(null);
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { host?: string; radar?: { past?: { time?: number; path?: string }[] } };
      const last = j.radar?.past?.[j.radar.past.length - 1];
      if (!j.host || !last?.path || typeof last.time !== "number") throw new Error("réponse inattendue");
      setRadar({ time: last.time * 1000, template: `${j.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png` });
    } catch (e) {
      setRadarError(e instanceof Error ? e.message : String(e));
    }
  };
  const importWx = async (files: File[]) => {
    setWxBusy(true);
    const out = await importWxFiles(files);
    for (const d of out.sets) {
      await saveWx(d).catch(() => undefined);
      if (d.id === "metar") setMetarSet(d);
      else if (d.id === "taf") setTafSet(d);
      else setSigmetSet(d);
    }
    setWxProblems(out.problems);
    setWxBusy(false);
  };
  const applyRouteWinds = (estimates: LegWindEstimate[]) => {
    if (!route) return;
    let next = route;
    for (const e of estimates) {
      if (e.wind) next = setLegWind(next, e.leg, { directionDeg: e.wind.direction, speedMps: e.wind.speed }, Date.now());
    }
    putRoute(next);
  };
  const pickRoutePoint = (i: number) => {
    setAdhoc(null);
    setTargetIndex(i);
  };
  const pickAirfield = (a: Airfield) => setAdhoc({ name: a.icao ?? a.name, position: a.position });
  // Menu rond autour d'un terrain touché sur la carte.
  const [adMenu, setAdMenu] = useState<{ airfield: Airfield; x: number; y: number } | null>(null);
  const [adInfo, setAdInfo] = useState<Airfield | null>(null);
  const onAirfieldTap = (h: { id: string; x: number; y: number } | null) => {
    if (!h) return setAdMenu(null);
    const af = aptById.get(h.id);
    if (!af) return;
    setFollow(false); // la carte ne bouge plus : le menu reste accroché au terrain
    setDetails(null);
    setCellSheet(null);
    setAdMenu({ airfield: af, x: h.x, y: h.y });
  };
  const addAirfieldToRoute = (af: Airfield) => {
    const r = route ?? createRoute();
    const withPoint = addPoint(r, af.position.lat, af.position.lon, uid(), Date.now());
    putRoute(renamePoint(withPoint, withPoint.points.length - 1, af.icao ?? af.name, Date.now()));
    if (targetIndex === null) setTargetIndex(0);
  };
  /** Double-tap : les espaces et terrains sont remplacés par leur fiche complète. */
  const onDoubleTap = (found: TappedFeature[]) => {
    setCellSheet(null);
    setDetails(
      found.map((f) => {
        const id = String((f.properties as { id?: unknown }).id ?? "");
        if (f.layerName === "asp") {
          const a = aspById.get(id);
          if (a) return { layerName: "Espace aérien", properties: airspaceDetails(a, aspSet?.meta.exportedAtMs ?? null) };
        }
        if (f.layerName === "apt") {
          const a = aptById.get(id);
          if (a) return { layerName: "Terrain", properties: airfieldDetails(a, prefs, aptSet?.meta.exportedAtMs ?? null) };
        }
        return f;
      }),
    );
  };
  const importAero = async (files: ArrayLike<File> | null) => {
    if (!files) return;
    setAeroBusy(true);
    const out = await importAeroFiles(Array.from(files), Date.now());
    for (const d of out.datasets) {
      await saveDataset(d).catch(() => undefined);
      if (d.id === "airspaces") setAspSet(d);
      else if (d.id === "airfields") setAptSet(d);
    }
    setAeroProblems(out.problems);
    setAeroBusy(false);
    if (aeroInput.current) aeroInput.current.value = "";
  };
  const importNav = async (files: ArrayLike<File>) => {
    const { dataset, problems } = await importNavFiles(Array.from(files), Date.now());
    if (dataset.navaids.length + dataset.reporting.length + dataset.obstacles.length > 0) {
      await saveDataset(dataset).catch(() => undefined);
      setNavSet(dataset);
    }
    if (problems.length > 0) setAeroProblems((p) => [...p, ...problems]);
  };
  const removeAero = () => {
    void deleteDataset("airspaces");
    void deleteDataset("airfields");
    void deleteDataset("navdata");
    setAspSet(null);
    setAptSet(null);
    setNavSet(null);
  };
  const toggleGroup = (g: string) => {
    const next = visibleGroups.includes(g) ? visibleGroups.filter((x) => x !== g) : [...visibleGroups, g];
    setVisibleGroups(next);
    saveVisibleGroups(next);
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
    loadCharts().then((c) => { setCharts(c); setLostCharts([...getLostCharts()]); }).catch(() => setCharts([]));
    loadRoutes().then(setRoutes).catch(() => setRoutes([]));
    loadWx()
      .then((all) => {
        for (const d of all) {
          if (d.id === "metar") setMetarSet(d);
          else if (d.id === "taf") setTafSet(d);
          else setSigmetSet(d);
        }
      })
      .catch(() => undefined);
    loadWindCache().then((all) => setWindForecasts(new Map(all.map((f) => [windKey(f.lat, f.lon), f])))).catch(() => undefined);
    loadDatasets()
      .then((ds) => {
        for (const d of ds) {
          if (d.id === "airspaces") setAspSet(d);
          else if (d.id === "airfields") setAptSet(d);
          else setNavSet(d);
        }
      })
      .catch(() => undefined);
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
    // Position externe (récepteur, simulateur) : le GPS de l'appareil n'est pas lancé.
    const source: PositionSource | null = extOwn
      ? null
      : mode === null ? new DeviceGpsSource(gpsAltRef) : new SimulatedSource(undefined, mode === "loss");
    source?.start(
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
      source?.stop();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [accepted, gpsAltRef, extOwn]);

  const status = gpsStatus(fix, now);
  const targetPoint = adhoc ? { name: adhoc.name, position: adhoc.position } : route && targetIndex !== null ? (route.points[targetIndex] ?? null) : null;
  const fv = useMemo(() => (fix ? flightValues(fix, geoid, new Date(fix.timeMs)) : null), [fix, geoid]);
  const airspaceGeo = useMemo(() => (aspSet ? airspacesToGeoJSON(aspSet.items) : null), [aspSet]);
  const navGeo = useMemo(() => (navSet ? navToGeoJSON(navSet) : null), [navSet]);
  const airfieldGeo = useMemo(() => (aptSet ? airfieldsToGeoJSON(aptSet.items) : null), [aptSet]);
  const aspById = useMemo(() => new Map((aspSet?.items ?? []).map((a) => [a.id, a])), [aspSet]);
  const aptById = useMemo(() => new Map((aptSet?.items ?? []).map((a) => [a.id, a])), [aptSet]);
  // Espaces pris en compte pour la liste des espaces traversés : ceux des groupes affichés.
  const ac = useAircraft();
  const trafficView = useMemo(
    () => (link.config.enabled ? link.decoder.table.snapshot(now, fix?.position ?? null) : []),
    [now, fix, link.config.enabled, link.decoder],
  );
  const linkStream = streamState(link.decoder.lastMsgMs, now);
  const trafficAlert = trafficView.find((x) => x.level >= 2 && !x.stale) ?? null;
  const docs = useDocs();
  const [vacMsg, setBanner] = useState<{ text: string; alert: boolean } | null>(null);
  const fetchVac = async (af: { icao?: string | null }) => {
    const icao = af.icao ?? "";
    try {
      setBanner({ text: `VAC ${icao} : 0 %`, alert: false });
      const e = vacFor(await loadVacIndex(), icao);
      if (!e) { setBanner({ text: `VAC ${icao} : ${T("ad.vacNone")}`, alert: true }); open("docs"); return; }
      const d = await downloadVac(e, (done, total) => setBanner({ text: `VAC ${icao} : ${Math.floor((done / Math.max(1, total)) * 100)} %`, alert: false }));
      docs.put({ ...d, show: "on" });
      setBanner({ text: `VAC ${icao} : ${d.sourceDate}${d.georef ? "" : ` — ${T("ad.vacUncal")}`}`, alert: false });
      const g = d.georef;
      if (g) setDocFocus((f) => ({ nonce: (f?.nonce ?? 0) + 1, corners: imageCorners(g.georef, g.width, g.height) }));
    } catch (err) {
      setBanner({ text: `VAC ${icao} : ${err instanceof Error ? err.message : String(err)}`, alert: true });
    }
  };
  const [basePrefs, setBasePrefsState] = useState<BaseMapPrefs>(loadBasePrefs);
  const setBasePrefs = (p: BaseMapPrefs) => { setBasePrefsState(p); saveBasePrefs(p); };
  const mapApi = useRef<{ getBounds: () => { west: number; south: number; east: number; north: number } } | null>(null);
  /** Données extérieures (espaces, terrains, météo) : téléchargées et mises à jour toutes seules une fois le pays choisi. */
  const pack = usePackData(null, async (id, files) => {
    if (id === "navdata") await importNav(files);
    else if (id === "aero" || id === "airspaces" || id === "airfields") await importAero(files);
    else if (id === "weather") await importWx(files);
  });
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [docFocus, setDocFocus] = useState<{ nonce: number; corners: [number, number][] } | null>(null);
  const seenDocs = useRef(new Set<string>());
  /** Cartes calées visibles : « toujours », ou « à l'approche » = GPS à moins de 10 NM du centre de la carte (seuil jugé). */
  const docCharts = useMemo(() => {
    const out: { id: string; url: string; corners: ReturnType<typeof imageCorners>; auto: boolean }[] = [];
    for (const d of docs.list) {
      const g = d.georef;
      if (!g || d.show === "off") continue;
      const corners = imageCorners(g.georef, g.width, g.height);
      if (d.show === "auto") {
        if (!fix || status === "lost") continue;
        const c = pixelToLatLon(g.georef, g.width / 2, g.height / 2);
        if (distance(fix.position, c) > 10 * 1852) continue;
      }
      out.push({ id: d.id, url: blobUrl(g.image), corners, auto: d.show === "auto" });
    }
    return out;
  }, [docs.list, fix, status]);
  useEffect(() => {
    const now2 = new Set(docCharts.filter((c) => c.auto).map((c) => c.id));
    const fresh = docCharts.find((c) => c.auto && !seenDocs.current.has(c.id));
    seenDocs.current = now2;
    if (fresh && follow) setDocFocus((f) => ({ nonce: (f?.nonce ?? 0) + 1, corners: fresh.corners }));
  }, [docCharts, follow]);
  const recorder = useRecorder(fix, fv?.altitudeMsl ?? null);
  const [sw, setSw] = useState<Stopwatch>(STOPWATCH_ZERO);
  const [cd, setCd] = useState<Countdown>({ durationMs: 0, endsAt: null, fired: false });
  const [cdFired, setCdFired] = useState(false);
  useEffect(() => {
    if (cdDue(cd, now)) {
      alarm();
      setCd({ ...cd, fired: true, endsAt: null });
      setCdFired(true);
      setTimeout(() => setCdFired(false), 30_000);
    }
  }, [now, cd]);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const replayTrack = replay ? recorder.tracks.find((x) => x.id === replay.id) ?? null : null;
  useEffect(() => {
    if (!replay?.playing || !replayTrack) return;
    const first = (replayTrack.points[0] as TrackPoint).t, last = (replayTrack.points[replayTrack.points.length - 1] as TrackPoint).t;
    const id = setInterval(() => {
      setReplay((r) => {
        if (!r || !r.playing) return r;
        const n = advanceReplay(r.t, 200, r.speed, first, last);
        return { ...r, t: n.t, playing: !n.ended };
      });
    }, 200);
    return () => clearInterval(id);
  }, [replay?.playing, replayTrack]);
  const replayMap = useMemo(() => {
    if (!replay || !replayTrack || replayTrack.points.length < 2) return null;
    const step = Math.max(1, Math.floor(replayTrack.points.length / 2000));
    const line = replayTrack.points.filter((_, i) => i % step === 0).map((p) => [p.lon, p.lat] as [number, number]);
    const q = pointAt(replayTrack.points, replay.t);
    return { line, pos: q ? { lat: q.lat, lon: q.lon, trk: q.trk } : null, key: replay.id };
  }, [replay, replayTrack]);
  /** Quand l'avion actif change ou est modifié, sa vitesse propre et sa consommation alimentent le log de nav. */
  const pushAircraftPerf = (a: Aircraft | null) => {
    if (!a || (a.tasMps === null && a.fuelFlowLph === null)) return;
    const p2 = { tasMps: a.tasMps ?? perf.tasMps, fuelFlowLph: a.fuelFlowLph ?? perf.fuelFlowLph };
    setPerf(p2);
    savePerf(p2);
  };
  const navLog = useMemo(
    () => (route && route.points.length >= 2 && perf.tasMps !== null
      ? computeNavLog(route, { tas: perf.tasMps as never, fuelFlow: litersPerHour(perf.fuelFlowLph ?? 0) }, toWindPlan(route), new Date(now), route.departureMs)
      : null),
    [route, perf.tasMps, perf.fuelFlowLph, now],
  );
  const makeDossier = async () => {
    if (!route) return;
    try {
      const corridor = meters(25 * 1852);
      const crossed = aspSet ? airspacesAlongRoute(route, visibleAirspaces) : [];
      const metars = stationsNearRoute(route, metarSet?.items ?? [], corridor, 10).map((s) => s.station);
      const tafs = stationsNearRoute(route, tafSet?.items ?? [], corridor, 10).map((s) => s.station);
      const bytes = await buildDossier({
        lang, prefs, nowMs: Date.now(), route, navLog, aircraft: ac.active, loads: ac.loads, fuelPlan: ac.plan, tripLiters,
        crossed, hasAeroData: aspSet !== null, metars, tafs,
      });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${route.name.replace(/[\/:*?"<>|]/g, "_")}-dossier.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setRouteImportError(e instanceof Error ? e.message : String(e));
    }
  };
  const tripLiters = navLog && perf.fuelFlowLph !== null ? navLog.totals.fuel : null;
  const visibleAirspaces = useMemo(() => (aspSet?.items ?? []).filter((a) => visibleGroups.includes(a.group)), [aspSet, visibleGroups]);
  // Avancer au point suivant dès qu'on atteint le point visé.
  useEffect(() => {
    if (!fix || !route || targetIndex === null || adhoc !== null || status === "lost") return;
    const tp = route.points[targetIndex];
    if (!tp) return;
    if (hasReachedPoint(distance(fix.position, tp.position), fix.groundSpeed)) {
      setTargetIndex(targetIndex + 1 < route.points.length ? targetIndex + 1 : null);
    }
  }, [fix, route, targetIndex, status, adhoc]);
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
  const restoreLost = async (r: ChartRecord) => {
    setChartError(null);
    try {
      const rec = await restoreChart(r, (phase, v) => setChartBusy(phase === "copy" ? `${T("chart.copying")} ${Math.round(v * 100)} %` : `${T("chart.indexing")} ${v}`));
      setCharts((prev) => [...prev, rec]);
      setLostCharts((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      setChartError(`${r.name} : ${e instanceof Error ? e.message : String(e)}`);
    }
    setChartBusy(null);
  };
  /** Choix du fichier : le sélecteur Chromium retient le fichier (restauration possible), sinon le sélecteur classique. */
  const chooseCharts = async () => {
    const picked = await pickMbtiles();
    if (picked) await importCharts(picked.map((p) => p.file), picked.map((p) => p.handle));
    else chartInput.current?.click();
  };
  const importCharts = async (files: FileList | File[] | null, handles?: FileSystemFileHandle[]) => {
    if (!files) return;
    setChartError(null);
    for (const [i, f] of Array.from(files).entries()) {
      try {
        const { record, persisted } = await importMbtiles(f, (phase, v) =>
          setChartBusy(phase === "copy" ? `${T("chart.copying")} ${Math.round(v * 100)} %` : `${T("chart.indexing")} ${v}`),
          handles?.[i] ? { handle: handles[i] } : {},
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

  const tabs = screen === "nav" ? NAV_TABS : screen === "aircraft" ? AIRCRAFT_TABS : screen === "wx" ? WX_TABS : screen === "docs" ? DOCS_TABS : screen === "traces" ? TRACES_TABS : screen === "settings" ? SETTINGS_TABS : null;
  // Écran large : l'écran Route s'affiche à droite de la carte, qui reste utilisable (tracé, Direct).
  const split = wide && screen === "nav";
  const mapActive = screen === "map" || split;
  const toggle = (sc: Screen) => open(screen === sc ? "map" : sc);
  /** Barre d'outils : actions sur la carte | préparer et voler | bibliothèque | réglages (`sep` = séparateur visuel avant). */
  const toolbar: { label: Key; action: () => void; pressed?: boolean; sep?: boolean }[] = [
    { label: "tb.center", action: () => { open("map"); setFollow(true); }, pressed: follow && mapActive },
    { label: "tb.direct", action: () => { open("map"); setCellSheet(null); setDetails(null); setDirectOpen((v) => !v); } },
    { label: "tb.maps", action: () => { if (screen !== "map") open("map"); setDrawer(!drawer); }, pressed: drawer },
    { label: "tb.route", action: () => toggle("nav"), pressed: screen === "nav", sep: true },
    { label: "tb.aircraft", action: () => toggle("aircraft"), pressed: screen === "aircraft" },
    { label: "tb.weather", action: () => toggle("wx"), pressed: screen === "wx" },
    { label: "tb.timer", action: () => toggle("traces"), pressed: screen === "traces" },
    { label: "tb.docs", action: () => toggle("docs"), pressed: screen === "docs", sep: true },
    { label: "tb.data", action: () => toggle("data"), pressed: screen === "data" },
    { label: "tb.settings", action: () => toggle("settings"), pressed: screen === "settings", sep: true },
  ];

  const banner: { text: string; alert: boolean; onClick?: () => void } | null =
    cdFired ? { text: T("tm.done"), alert: true }
    : vacMsg ? { ...vacMsg, onClick: () => setBanner(null) }
    : trafficAlert ? { text: trafficText(trafficAlert, fv?.trackTrue ?? null, prefs, T("lk.trafficAlert")), alert: true }
    : status === "lost" ? { text: T("gps.lost"), alert: true }
    : link.config.enabled && link.decoder.messages > 0 && linkStream === "lost" ? { text: T("lk.lostBanner"), alert: true }
    : gpsError && !fix ? { text: T("gps.error"), alert: false }
    : status === "stale" || status === "poor" ? { text: T("gps.stale"), alert: false }
    : status === "none" ? { text: T("gps.waiting"), alert: false }
    : pack.baseUrl && !pack.installed.country ? { text: T("dp.choose"), alert: false, onClick: () => open("data") }
    : fv?.variationOutOfRange ? { text: T("mag.expired"), alert: true }
    : null;

  return (
    <div className="app">
      <nav className="toolbar" aria-label="outils">
        {toolbar.map((b) => (
          <button key={b.label} className={b.sep ? "sep" : undefined} aria-pressed={b.pressed} onClick={b.action}>
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
          radarTemplate={radar?.template ?? null}
          airspaceData={airspaceGeo}
          airfieldData={airfieldGeo}
          navData={navGeo}
          showNav={showNav}
          showAirspaces={showAsp}
          showAirfields={showApt}
          visibleGroups={visibleGroups}
          adhocTarget={adhoc?.position ?? null}
          route={route}
          targetIndex={targetIndex}
          selectedIndex={selectedPoint}
          editMode={editMode}
          fitRequest={fit}
          onMapTap={onMapTap}
          onPointTap={(i) => { setDirectOpen(false); setCellSheet(null); setDetails(null); setSelectedPoint(i); }}
          onPointMove={(i, lat, lon) => route && putRoute(movePoint(route, i, lat, lon, Date.now()))}
          ceilingFL={ceiling}
          onDoubleTap={onDoubleTap}
          onAirfieldTap={onAirfieldTap}
          zoomCommand={zoomCommand}
          replay={replayMap}
          docCharts={docCharts}
          traffic={trafficView}
          baseMap={basePrefs.base}
          relief={basePrefs.relief}
          onMapApi={(api) => { mapApi.current = api; }}
          docFocus={docFocus}
        />

        {mapActive && (
          <div className={`gps-chip gps-${status === "ok" ? "ok" : status === "lost" ? "lost" : status === "none" ? "none" : "weak"}`}>
            <span className="dot" aria-hidden="true" />
            {T(status === "ok" ? "gps.chip.ok" : status === "lost" ? "gps.chip.lost" : status === "none" ? "gps.chip.none" : "gps.chip.weak")}
          </div>
        )}

        {adMenu && mapActive && (() => {
          const af = adMenu.airfield;
          const doc = docs.list.find((x) => af.icao && x.icao === af.icao && x.georef) ?? null;
          const anyDoc = docs.list.find((x) => af.icao && x.icao === af.icao) ?? null;
          const shown = !!doc && docCharts.some((c) => c.id === doc.id);
          const vacState = doc ? (shown ? "shown" : "hidden") : anyDoc ? "uncalibrated" : "none";
          return (
            <AdMenu
              lang={lang}
              airfield={af}
              x={adMenu.x}
              y={adMenu.y}
              vacState={vacState}
              onClose={() => setAdMenu(null)}
              onDirect={() => { pickAirfield(af); setAdMenu(null); }}
              onInfo={() => { setAdInfo(af); setAdMenu(null); }}
              onAddToRoute={() => { addAirfieldToRoute(af); setAdMenu(null); }}
              onVac={() => {
                setAdMenu(null);
                if (!anyDoc) { void fetchVac(af); return; }
                if (!doc) { setOpenDocId(anyDoc.id); open("docs"); return; }
                if (shown) { docs.put({ ...doc, show: "off" }); return; }
                docs.put({ ...doc, show: "on" });
                const g = doc.georef;
                if (g) setDocFocus((f) => ({ nonce: (f?.nonce ?? 0) + 1, corners: imageCorners(g.georef, g.width, g.height) }));
              }}
            />
          );
        })()}
        {adInfo && mapActive && (
          <AdInfo
            lang={lang}
            prefs={prefs}
            airfield={adInfo}
            exportedAtMs={aptSet?.meta.exportedAtMs ?? null}
            nowMs={now}
            metars={metarSet?.items ?? []}
            tafs={tafSet?.items ?? []}
            docs={docs.list}
            onDirect={() => { pickAirfield(adInfo); setAdInfo(null); }}
            onOpenDoc={(id) => { setOpenDocId(id); setAdInfo(null); open("docs"); }}
            onClose={() => setAdInfo(null)}
          />
        )}
        {replay && replayTrack && mapActive && (
          <div className="replaydock">
            <ReplayBar lang={lang} track={replayTrack} replay={replay} onChange={setReplay} onClose={() => setReplay(null)} />
          </div>
        )}
        {banner && (
          <div className={banner.alert ? "banner alert" : "banner"} role={banner.onClick ? "button" : banner.alert ? "alert" : "status"} tabIndex={banner.onClick ? 0 : undefined} onClick={banner.onClick} onKeyDown={(e) => e.key === "Enter" && banner.onClick?.()} style={banner.onClick ? { cursor: "pointer" } : undefined}>
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
                  {d.layerName === "Terrain" && !!d.properties["Code OACI"] && docs.list.some((x) => x.icao === String(d.properties["Code OACI"])) && (
                    <div className="choices">
                      {docs.list.filter((x) => x.icao === String(d.properties["Code OACI"])).map((x) => (
                        <button key={x.id} onClick={() => { setOpenDocId(x.id); open("docs"); }}>{T("details.docs")} : {x.name}</button>
                      ))}
                    </div>
                  )}
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
            onDirect={pickRoutePoint}
            onClose={() => setSelectedPoint(null)}
          />
        )}
        {directOpen && mapActive && (
          <DirectSheet
            lang={lang}
            prefs={prefs}
            route={route}
            targetIndex={adhoc ? null : targetIndex}
            airfields={aptSet?.items ?? []}
            position={fix && status !== "lost" ? fix.position : null}
            onPick={pickRoutePoint}
            onPickAirfield={pickAirfield}
            onClose={() => setDirectOpen(false)}
          />
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
            <h3>{T("lay.base")}</h3>
            <div className="choices" role="group" aria-label={T("lay.base")}>
              {(["aero", "plan", "ortho", "none"] as const).map((b) => (
                <button key={b} aria-pressed={basePrefs.base === b} onClick={() => setBasePrefs({ ...basePrefs, base: b })}>{T(`bm.${b}` as Key)}</button>
              ))}
            </div>
            {charts.length === 0 && <p className="muted small">{T("lay.noBase")}</p>}
            {charts.map((c) => (
              <button className="row" key={c.id} aria-pressed={c.visible} onClick={() => updateChart(c.id, { visible: !c.visible })}>{c.name} — {c.visible ? T("chart.shown") : T("chart.hidden")}</button>
            ))}
            <h3>{T("lay.aero")}</h3>
            {!aspSet && !aptSet && <p className="muted small">{T("lay.noAero")}</p>}
            {(aspSet || aptSet) && (
              <>
                <div className="choices">
                  <button aria-pressed={showAsp} onClick={() => setShowAsp(!showAsp)}>{T("aero.airspaces")}</button>
                  <button aria-pressed={showApt} onClick={() => setShowApt(!showApt)}>{T("aero.airfields")}</button>
                  <button aria-pressed={showNav} disabled={!navSet} onClick={() => setShowNav(!showNav)}>{T("aero.nav")}</button>
                </div>
                <div className="choices">
                  {(["controlled", "restricted", "radio", "activity", "glider", "other"] as const).map((g) => (
                    <button key={g} aria-pressed={visibleGroups.includes(g)} onClick={() => toggleGroup(g)}>
                      {T(`aero.group.${g}` as Key)}
                    </button>
                  ))}
                </div>
              </>
            )}
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
            <h3>{T("lay.weather")}</h3>
            <button className="row" aria-pressed={radar !== null} onClick={() => void toggleRadar()}>{radar ? T("wxr.off") : T("wx.radar")}</button>
            {radar && (
              <p className="muted small">
                {T("wxr.info")} {new Date(radar.time).toISOString().slice(11, 16)}Z · {T("wxr.note")}
              </p>
            )}
            {radarError && <p className="error" role="alert">{T("wxr.error")} — {radarError}</p>}
            <h3>{T("lay.relief")}</h3>
            <button className="row" aria-pressed={basePrefs.relief} onClick={() => setBasePrefs({ ...basePrefs, relief: !basePrefs.relief })}>{basePrefs.relief ? T("bm.reliefOn") : T("bm.reliefOff")}</button>
            <h3>{T("lay.docs")}</h3>
            <p className="muted small">{T("lay.docsHelp")}</p>
            <button className="row" onClick={() => open("docs")}>{T("lay.docsOpen")}</button>
            <button className="row" onClick={() => open("data")}>{T("lay.manage")}</button>
          </aside>
        )}

        {screen !== "map" && (
          <section className="screen">
            <header className="screen-head">
              <button onClick={() => open("map")}>← {T("back")}</button>
              <h2>
                {screen === "soon" ? T(soonTitle) : T(SCREEN_TITLE[screen] ?? "soon")}
              </h2>
            </header>
            {screen === "settings" ? (
              <div className="settings">
                {tab === 0 && (
                  <>
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
                  </>
                )}
                {tab === 1 && (
                  <>
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
                  </>
                )}
                {tab === 2 && (
                  <>
                <LinkPanel
                  lang={lang}
                  config={link.config}
                  onConfig={link.setConfig}
                  conn={link.conn}
                  nowMs={now}
                  stats={{ lastMsgMs: link.decoder.lastMsgMs, messages: link.decoder.messages, badCrc: link.decoder.badCrc, flarmRx: link.decoder.flarmRx, targets: trafficView.length }}
                />
                  </>
                )}
                {tab === 3 && <BackupPanel lang={lang} />}
              </div>
            ) : screen === "data" ? (
              <div className="settings">
                <DataPanel lang={lang} pack={pack} nowMs={now} onRemovePackage={() => { removeAero(); pack.removePackage(); }} />
                <BaseMapPanel lang={lang} getViewBounds={() => mapApi.current?.getBounds() ?? null} routePoints={route?.points.map((x) => x.position) ?? []} position={fix?.position ?? null} />
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
            <button className="row" disabled={chartBusy !== null} onClick={() => void chooseCharts()}>{T("chart.import")}</button>
            {lostCharts.map((r) => <button className="row" key={r.id} disabled={chartBusy !== null} onClick={() => void restoreLost(r)}>{T("chart.restore")} : {r.name}</button>)}
            <p className="muted small">{T("chart.formats")}</p>
            {chartBusy && <p className="muted small" role="status">{chartBusy}</p>}
            {chartNotice && <p className="error" role="alert">{T("chart.notPersisted")}</p>}
            {chartError && <p className="error" role="alert">{T("chart.error")} — {chartError}</p>}
                <details className="rawbox">
                  <summary>{T("dp.files")}</summary>
            <h3>{T("aero.title")}</h3>
            {!aspSet && !aptSet && <p className="muted small">{T("aero.none")}</p>}
            {([[T("aero.airspaces"), aspSet], [T("aero.airfields"), aptSet]] as const).map(([label, set]) =>
              set ? (
                <p className="muted small" key={label}>
                  {label} : {set.meta.count} · {T("aero.exported")} {new Date(set.meta.exportedAtMs).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB")}
                  {set.meta.exactDate ? "" : ` ${T("aero.approx")}`}
                  {set.meta.skipped > 0 ? ` · ${set.meta.skipped} ${T("aero.skipped")}` : ""}
                </p>
              ) : null,
            )}
            {aspSet && (
              <>
                <p className="muted small">
                  {T("aero.airac")} : {airacCycleAt(new Date(now)).id}
                </p>
                {freshnessWarnings(datasetFreshness(new Date(aspSet.meta.exportedAtMs), new Date(now))).map((w, i) => (
                  <p className={i === 0 ? "muted small" : "error"} key={i}>{w}</p>
                ))}
              </>
            )}
            <input ref={aeroInput} type="file" hidden multiple accept=".json" onChange={(e) => void importAero(e.target.files)} />
            <button className="row" disabled={aeroBusy} onClick={() => aeroInput.current?.click()}>{T("aero.import")}</button>
            <p className="muted small">{T("aero.help")}</p>
            {aeroProblems.map((m, i) => (
              <p className="error" role="alert" key={i}>{T("aero.problem")} — {m}</p>
            ))}
                    {(aspSet || aptSet) && <button onClick={removeAero}>{T("aero.remove")}</button>}
            <p className="muted small">{T("aero.licence")}</p>
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
                </details>
              </div>
            ) : screen === "wx" && tab !== 4 ? (
              (() => {
                const startMs = route?.departureMs ?? now;
                const km = route && perf.tasMps ? Math.max(1, route.points.reduce((acc, pt, i, a) => (i === 0 ? 0 : acc + distance((a[i - 1] as typeof pt).position, pt.position)), 0)) / perf.tasMps : 3 * 3600;
                const common: WxCommon = {
                  lang, prefs, route, gps: fix && status !== "lost" ? fix.position : null, nowMs: now,
                  metars: metarSet, tafs: tafSet, sigmets: sigmetSet, window: { startMs, endMs: startMs + km * 1000 },
                  problems: wxProblems, busy: wxBusy, onImport: (f) => void importWx(f),
                  onRefresh: pack.refresh, refreshing: pack.checking, onOpenData: () => open("data"),
                };
                return tab === 0 ? <BriefingTab {...common} /> : tab === 1 ? <MetarTab {...common} /> : tab === 2 ? <TafTab {...common} /> : <SigmetTab {...common} />;
              })()
            ) : screen === "wx" && tab === 4 ? (
              <WindsTab
                lang={lang}
                prefs={prefs}
                route={route}
                gps={fix && status !== "lost" ? fix.position : null}
                tasMps={perf.tasMps}
                nowMs={now}
                forecasts={windForecasts}
                busy={windBusy}
                error={windError}
                onLoad={(pts) => void loadWinds(pts)}
                onApply={applyRouteWinds}
              />
            ) : screen === "nav" && tab <= 2 ? (
              <NavScreen
                tab={tab}
                onGoRoutes={() => setTab(0)}
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
                onDirect={(i) => { pickRoutePoint(i); if (!wide) open("map"); }}
                airspaces={visibleAirspaces}
                hasAero={aspSet !== null}
                onDrawOnMap={() => { if (!wide) open("map"); setEditMode(true); }}
                onDossier={() => void makeDossier()}
                onShowRoute={() => { setFollow(false); setFit((f) => ({ nonce: f.nonce + 1, force: true })); if (!wide) open("map"); }}
              />
            ) : screen === "aircraft" && tab === 0 ? (
              <AircraftTab
                lang={lang}
                prefs={prefs}
                aircraft={ac.list}
                active={ac.active}
                onSelect={(id) => { ac.select(id); pushAircraftPerf(ac.list.find((x) => x.id === id) ?? null); }}
                onPut={(a) => { ac.put(a); if (a.id === ac.activeId) pushAircraftPerf(a); }}
                onRemove={ac.remove}
              />
            ) : screen === "aircraft" && tab === 1 ? (
              <BalanceTab
                lang={lang}
                prefs={prefs}
                active={ac.active}
                loads={ac.loads}
                burnLiters={tripLiters}
                onLoads={(l) => ac.active && ac.setLoads(ac.active.id, l)}
                onOpenSheet={() => setTab(0)}
              />
            ) : screen === "aircraft" && tab === 2 ? (
              <FuelTab
                lang={lang}
                prefs={prefs}
                active={ac.active}
                loads={ac.loads}
                tripLiters={tripLiters}
                plan={ac.plan}
                onPlan={ac.updatePlan}
                onLoads={(l) => ac.active && ac.setLoads(ac.active.id, l)}
                onOpenSheet={() => setTab(0)}
              />
            ) : screen === "docs" ? (
              <DocsTab lang={lang} docs={docs.list} airfields={aptSet?.items ?? []} openId={openDocId} onOpen={setOpenDocId} onPut={docs.put} onRemove={docs.remove} />
            ) : screen === "traces" && tab === 0 ? (
              <TimersTab
                lang={lang}
                nowMs={now}
                recording={recorder.recording}
                pointCount={recorder.count}
                takeoffMs={recorder.takeoffMs}
                onStartRec={recorder.start}
                onStopRec={recorder.stop}
                sw={sw}
                onSw={setSw}
                cd={cd}
                onCd={setCd}
              />
            ) : screen === "traces" && tab === 1 ? (
              <TracesTab
                lang={lang}
                prefs={prefs}
                tracks={recorder.tracks}
                activeId={recorder.activeId}
                replay={replay}
                registration={ac.active?.registration ?? ""}
                aircraftName={ac.active?.name ?? ""}
                onReplay={setReplay}
                onShowOnMap={() => { open("map"); setFollow(false); }}
                onRemove={recorder.remove}
                onRename={recorder.rename}
              />
            ) : (
              <p className="muted">{T("soon")}</p>
            )}
            {tabs && (
              <nav className="tabs">
                {tabs.map((k, i) => (
                  <button key={k} aria-current={tab === i ? "page" : undefined} disabled={DISABLED_TABS.has(k)} title={DISABLED_TABS.has(k) ? T("soon") : undefined} onClick={() => setTab(i)}>
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
