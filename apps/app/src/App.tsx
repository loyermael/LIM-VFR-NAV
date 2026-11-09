import { useEffect, useState } from "react";
import { CEILING_FILTER } from "./config";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Theme } from "./MapView";

type Screen = "map" | "nav" | "docs" | "settings" | "soon";

const NAV_TABS: Key[] = ["nav.log", "nav.profile", "nav.fuel", "nav.wb"];
const DOCS_TABS: Key[] = ["docs.traces", "docs.documents", "docs.products", "docs.points"];
const WEATHER: Key[] = ["wx.metar", "wx.taf", "wx.sigmet", "wx.wintem", "wx.radar"];

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "night" ? "dark" : "light";
    document.documentElement.lang = lang;
  }, [theme, lang]);

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

  // Pas de GPS branché avant J1 : « --- », jamais une valeur inventée.
  const cells: { label: Key; value: string; unit?: string }[] = [
    { label: "data.gs", value: "---", unit: "kt" },
    { label: "data.trk", value: "---", unit: "°M" },
    { label: "data.wpt", value: "---" },
    { label: "data.alt", value: "---", unit: "ft" },
    { label: "data.brg", value: "---", unit: "°M" },
    { label: "data.dist", value: "---" },
  ];

  const tabs = screen === "nav" ? NAV_TABS : screen === "docs" ? DOCS_TABS : null;
  const toolbar: { label: Key; action: () => void; pressed?: boolean }[] = [
    { label: "tb.route", action: () => open("nav") },
    { label: "tb.direct", action: () => soon("tb.direct") },
    { label: "tb.settings", action: () => open("settings") },
    { label: "tb.center", action: () => open("map") },
    { label: "tb.maps", action: () => setDrawer(!drawer), pressed: drawer },
    { label: "tb.relief", action: () => soon("tb.relief") },
    { label: "tb.profile", action: () => soon("tb.profile") },
    { label: "tb.timer", action: () => soon("tb.timer") },
    { label: "tb.docs", action: () => open("docs") },
  ];

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
        <MapView theme={theme} emptyLabel={T("map.empty")} />

        {screen === "map" && (
          <button className="fab" aria-label={T("layers.title")} aria-pressed={drawer} onClick={() => setDrawer(!drawer)}>
            ≡
          </button>
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
            <p className="muted">{T("layers.none")}</p>
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
                <button onClick={toggleLang}>{T("lang.switch")}</button>
                <button onClick={toggleTheme} aria-pressed={theme === "night"}>
                  {theme === "day" ? T("theme.night") : T("theme.day")}
                </button>
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

      <footer className="datagrid">
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
