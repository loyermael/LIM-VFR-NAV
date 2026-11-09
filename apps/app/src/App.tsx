import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALTITUDE_UNITS, DISTANCE_UNITS, Geoid, PRESSURE_UNITS, SPEED_UNITS, SPEED_VECTOR_MINUTES, UNIT_CHOICES,
  VERTICAL_SPEED_UNITS, flightValues, formatAngle, formatQuantity, gpsStatus, speedVector, unitLabel,
  type GpsFix, type UnitPrefs,
} from "@lim/core";
import { CEILING_FILTER } from "./config";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Orientation, type TappedFeature, type Theme } from "./MapView";
import { deleteOverlay, loadOverlays, readOverlayFile, saveOverlay, type Overlay } from "./overlays";
import { DeviceGpsSource, SimulatedSource, type PositionSource } from "./positionSource";
import { loadGpsAltitudeRef, loadUnitPrefs, saveGpsAltitudeRef, saveUnitPrefs, type GpsAltitudeRef } from "./prefs";

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

  const setUnit = <K extends keyof UnitPrefs>(field: K, value: UnitPrefs[K]) => {
    const next = { ...prefs, [field]: value };
    setPrefs(next);
    saveUnitPrefs(next);
  };
  const chooseGpsAlt = (v: GpsAltitudeRef) => {
    setGpsAltRef(v);
    saveGpsAltitudeRef(v);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "night" ? "dark" : "light";
    document.documentElement.lang = lang;
  }, [theme, lang]);

  // Grille du géoïde EGM96 et couches importées : disponibles hors-ligne (cache du service worker, IndexedDB).
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/egm96.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setGeoid(new Geoid(b)))
      .catch(() => setGeoid(null));
    loadOverlays().then(setOverlays).catch(() => setOverlays([]));
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
  const cells: { label: Key; value: string; unit?: string }[] = [
    { label: "data.gs", value: live ? formatQuantity("groundSpeed", prefs, fv.groundSpeed ?? NaN) : "---", unit: unitLabel("groundSpeed", prefs) },
    { label: "data.trk", value: formatAngle(trackShown), unit: unitLabel("track", prefs, lang) },
    { label: "data.wpt", value: "---" },
    { label: "data.alt", value: live ? formatQuantity("altitude", prefs, fv.altitudeMsl ?? NaN) : "---", unit: unitLabel("altitude", prefs) },
    { label: "data.brg", value: "---", unit: unitLabel("bearing", prefs, lang) },
    { label: "data.dist", value: "---", unit: unitLabel("distance", prefs) },
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
          ceilingFL={ceiling}
          onDoubleTap={setDetails}
          zoomCommand={zoomCommand}
        />

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
            <p className="muted">{T("layers.none")}</p>
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
                <h3>{T("set.gpsalt")}</h3>
                <div className="choices">
                  <button aria-pressed={gpsAltRef === "msl"} onClick={() => chooseGpsAlt("msl")}>{T("set.gpsalt.msl")}</button>
                  <button aria-pressed={gpsAltRef === "ellipsoid"} onClick={() => chooseGpsAlt("ellipsoid")}>{T("set.gpsalt.ellipsoid")}</button>
                </div>
                <p className="muted small">{T("set.gpsalt.help")}</p>
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
        {cells.map((c) => (
          <div className="cell" key={c.label}>
            <div className="label">
              <span>{T(c.label)}</span>
              {c.unit && <span>{c.unit}</span>}
            </div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </footer>
    </div>
  );
}
