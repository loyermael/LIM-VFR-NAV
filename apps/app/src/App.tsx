import { useEffect, useState } from "react";
import { detectLang, t, type Key, type Lang } from "./i18n";
import { MapView, type Theme } from "./MapView";

type Tab = "map" | "nav" | "wx" | "docs" | "more";
const TABS: { id: Tab; label: Key }[] = [
  { id: "map", label: "tab.map" },
  { id: "nav", label: "tab.nav" },
  { id: "wx", label: "tab.wx" },
  { id: "docs", label: "tab.docs" },
  { id: "more", label: "tab.more" },
];

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  // L'avertissement est volontairement redemandé à chaque lancement (jamais mémorisé).
  const [accepted, setAccepted] = useState(false);
  const [theme, setTheme] = useState<Theme>("day");
  const [tab, setTab] = useState<Tab>("map");

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "night" ? "dark" : "light";
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const toggleLang = () => setLang(lang === "fr" ? "en" : "fr");
  const toggleTheme = () => setTheme(theme === "day" ? "night" : "day");

  if (!accepted) {
    return (
      <main className="warning">
        <div className="kicker">{t(lang, "warning.kicker")}</div>
        <h1>{t(lang, "warning.title")}</h1>
        <p>{t(lang, "warning.body")}</p>
        <button className="brand" onClick={() => setAccepted(true)}>
          {t(lang, "warning.accept")}
        </button>
        <button onClick={toggleLang}>{t(lang, "lang.switch")}</button>
      </main>
    );
  }

  // Pas de GPS branché avant J1 : on affiche « --- », jamais une valeur inventée.
  const cells: { label: Key; value: string; unit: string }[] = [
    { label: "strip.gs", value: "---", unit: "kt" },
    { label: "strip.trk", value: "---", unit: "°M" },
    { label: "strip.alt", value: "---", unit: "ft" },
  ];

  return (
    <div className="app">
      <header className="strip">
        {cells.map((c) => (
          <div className="cell" key={c.label}>
            <div className="label">
              <span>{t(lang, c.label)}</span>
              <span>{c.unit}</span>
            </div>
            <div className="value">{c.value}</div>
          </div>
        ))}
        <div className="cell">
          <div className="label">
            <span>{t(lang, "strip.gps")}</span>
          </div>
          <div className="value">{t(lang, "gps.none")}</div>
        </div>
      </header>

      <div className="stage">
        <MapView theme={theme} emptyLabel={t(lang, "map.empty")} />
        <div className="tools">
          <button aria-label={t(lang, "tool.center")} title={t(lang, "tool.center")}>⌖</button>
          <button onClick={toggleTheme} aria-pressed={theme === "night"}>
            {theme === "day" ? t(lang, "map.night") : t(lang, "map.day")}
          </button>
          <button onClick={toggleLang}>{lang === "fr" ? "EN" : "FR"}</button>
        </div>
        {tab !== "map" && (
          <section className="panel">
            <h2>{t(lang, TABS.find((x) => x.id === tab)?.label ?? "tab.map")}</h2>
            <p>{t(lang, "soon")}</p>
          </section>
        )}
      </div>

      <nav className="tabs">
        {TABS.map((x) => (
          <button key={x.id} aria-current={tab === x.id ? "page" : undefined} onClick={() => setTab(x.id)}>
            {t(lang, x.label)}
          </button>
        ))}
      </nav>
    </div>
  );
}
