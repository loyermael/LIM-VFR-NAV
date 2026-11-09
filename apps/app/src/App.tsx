import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALTITUDE_UNITS, DISTANCE_UNITS, Geoid, PRESSURE_UNITS, SPEED_UNITS, SPEED_VECTOR_MINUTES, UNIT_CHOICES,
  VERTICAL_SPEED_UNITS, altitudeForDisplay, flightLevelOf, flightValues, formatAngle, formatQuantity, gpsStatus,
  speedVector, unitLabel,
  type AltitudeSettings, type GpsFix, type UnitPrefs,
} from "@lim/core";
import { AltitudeSheet, UnitSheet, type CellId } from "./CellSheets";
import { MAX_ZOOM, importMbtiles, loadCharts, removeChart, saveChart, type ChartRecord } from "./charts";
import { CEILING_FILTER } from "./config";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Orientation, type TappedFeature, type Theme } from "./MapView";
import { deleteOverlay, loadOverlays, readOverlayFile, saveOverlay, type Overlay } from "./overlays";
import { DeviceGpsSource, SimulatedSource, type PositionSource } from "./positionSource";
import { loadAltitude, loadGpsAltitudeRef, loadUnitPrefs, saveAltitude, saveGpsAltitudeRef, saveUnitPrefs, loadFiguresColor, saveFiguresColor, type GpsAltitudeRef } from "./prefs";

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

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
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
  }, []);

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
  const fv = useMemo(() => (fix ? flightValues(fix, geoid, new Date(fix.timeMs)) : null), [fix, geoid]);
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
  const altM = live ? altitudeForDisplay(fv.altitudeMsl, altSettings) : null;
  const qnhText = formatQuantity("pressure", prefs, altSettings.qnh);
  const calibrated = altSettings.offset !== 0 && altSettings.mode !== "gps";
  const altLabel =
    altSettings.mode === "gps"
      ? T("alt.short.gps")
      : `${T(altSettings.mode === "fl" ? "alt.short.fl" : "alt.short.qnh")} ${qnhText}${calibrated ? "*" : ""}`;
  const altValue =
    altM === null
      ? "---"
      : altSettings.mode === "fl"
        ? String(Math.max(0, flightLevelOf(altM))).padStart(3, "0")
        : formatQuantity("altitude", prefs, altM);
  const altUnit = altSettings.mode === "fl" ? "FL" : unitLabel("altitude", prefs);

  const cells: { id: CellId | null; label: string; value: string; unit?: string }[] = [
    { id: "gs", label: T("data.gs"), value: live ? formatQuantity("groundSpeed", prefs, fv.groundSpeed ?? NaN) : "---", unit: unitLabel("groundSpeed", prefs) },
    { id: "trk", label: T("data.trk"), value: formatAngle(trackShown), unit: unitLabel("track", prefs, lang) },
    { id: null, label: T("data.wpt"), value: "---" },
    { id: "alt", label: altLabel, value: altValue, unit: altUnit },
    { id: "brg", label: T("data.brg"), value: "---", unit: unitLabel("bearing", prefs, lang) },
    { id: "dist", label: T("data.dist"), value: "---", unit: unitLabel("distance", prefs) },
  ];

  const tabs = screen === "nav" ? NAV_TABS : screen === "docs" ? DOCS_TABS : null;
  const toolbar: { label: Key; action: () => void; pressed?: boolean }[] = [
    { label: "tb.route", action: () => open("nav") },
    { label: "tb.direct", action: () => soon("tb.direct") },
    { label: "tb.settings", action: () => open("settings") },
    { label: "tb.center", action: () => { open("map"); setFollow(true); }, pressed: follow && screen === "map" },
    { label: "tb.maps", action: () => setDrawer(!drawer), pressed: drawer },
    { label: "tb.relief", action: () => soon("tb.relief") },
    { label: "tb.profile", action: () => soon("tb.profile") },
    { label: "tb.timer", action: () => soon("tb.timer") },
    { label: "tb.docs", action: () => open("docs") },
  ];

  const banner: { text: string; alert: boolean } | null =
    status === "lost" ? { text: T("gps.lost"), alert: true }
    : gpsError && !fix ? { text: T("gps.error"), alert: true }
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

      <div className="stage">
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
          ceilingFL={ceiling}
          onDoubleTap={(f) => { setCellSheet(null); setDetails(f); }}
          zoomCommand={zoomCommand}
        />

        {screen === "map" && (
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

        {screen === "map" && (
          <>
            <div className="mapctl">
              <button aria-label="zoom +" onClick={() => setZoomCommand((z) => ({ delta: 1, nonce: z.nonce + 1 }))}>+</button>
              <button aria-label="zoom −" onClick={() => setZoomCommand((z) => ({ delta: -1, nonce: z.nonce + 1 }))}>−</button>
              <button aria-pressed={orientation === "track"} onClick={() => setOrientation(orientation === "north" ? "track" : "north")}>
                {orientation === "north" ? "N" : "↑"}
              </button>
            </div>
            <button className="fab" aria-label={T("layers.title")} aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
              ≡
            </button>
          </>
        )}

        {details && screen === "map" && (
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

        {cellSheet === "alt" && screen === "map" && (
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
          />
        )}
        {cellSheet !== null && cellSheet !== "alt" && screen === "map" && (
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
