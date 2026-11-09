import { useState } from "react";
import { detectLang, t, type Lang } from "./i18n";
import { MapView, type Theme } from "./MapView";

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  // L'avertissement est volontairement redemandé à chaque lancement (jamais mémorisé).
  const [accepted, setAccepted] = useState(false);
  const [theme, setTheme] = useState<Theme>("day");

  if (!accepted) {
    return (
      <main className="warning" data-theme={theme}>
        <h1>{t(lang, "warning.title")}</h1>
        <p>{t(lang, "warning.body")}</p>
        <button className="big primary" onClick={() => setAccepted(true)}>
          {t(lang, "warning.accept")}
        </button>
        <button className="big" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
          {t(lang, "lang.switch")}
        </button>
      </main>
    );
  }

  return (
    <div className="app" data-theme={theme}>
      <MapView theme={theme} emptyLabel={t(lang, "map.empty")} />
      <div className="toolbar">
        <button className="big" onClick={() => setTheme(theme === "day" ? "night" : "day")}>
          {theme === "day" ? t(lang, "map.night") : t(lang, "map.day")}
        </button>
        <button className="big" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
          {t(lang, "lang.switch")}
        </button>
      </div>
    </div>
  );
}
