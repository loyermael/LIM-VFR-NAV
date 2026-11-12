import { NotamCard } from "./NotamTab";
import type { Notam } from "./notam";
import { distance, formatQuantity, latestMetarByStation, latestTafByStation, unitLabel, type Airfield, type LatLon, type Metar, type Taf, type UnitPrefs } from "@lim/core";
import { airfieldDetails } from "./aeroGeo";
import { t, type Key, type Lang } from "./i18n";
import type { DocRecord } from "./docStore";
import { ageText, cloudsText, temperatureText, utcTime, visibilityText, windText } from "./wxFormat";

/** Menu rond autour d'un terrain touché sur la carte : Direct, Infos, VAC, Route. */
export function AdMenu(p: {
  lang: Lang;
  airfield: Airfield;
  x: number;
  y: number;
  vacState: "shown" | "hidden" | "uncalibrated" | "none";
  onDirect: () => void;
  onInfo: () => void;
  onVac: () => void;
  onAddToRoute: () => void;
  onClose: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const items: { key: string; label: string; icon: string; action: () => void; on?: boolean; off?: boolean }[] = [
    { key: "direct", label: T("ad.direct"), icon: "➤", action: p.onDirect },
    { key: "info", label: T("ad.info"), icon: "i", action: p.onInfo },
    { key: "vac", label: p.vacState === "shown" ? T("ad.vacHide") : T("ad.vac"), icon: "VAC", action: p.onVac, on: p.vacState === "shown", off: p.vacState === "none" },
    { key: "route", label: T("ad.route"), icon: "+", action: p.onAddToRoute },
  ];
  return (
    <div className="admenu" style={{ left: p.x, top: p.y }} role="menu" aria-label={`${p.airfield.icao ?? p.airfield.name}`}>
      <button className="adcenter" onClick={p.onClose} aria-label={T("close")}>{p.airfield.icao ?? "AD"}</button>
      {items.map((it, i) => (
        <button
          key={it.key}
          role="menuitem"
          className={`adbtn adpos${i}${it.on ? " on" : ""}${it.off ? " dim" : ""}`}
          onClick={it.action}
        >
          <span className="adicon">{it.icon}</span>
          <span className="adlabel">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

const nearest = <S extends { lat: number; lon: number }>(list: readonly S[], at: LatLon, maxM: number): { s: S; d: number } | null => {
  let best: { s: S; d: number } | null = null;
  for (const s of list) {
    const d = distance(at, { lat: s.lat, lon: s.lon } as LatLon);
    if (d <= maxM && (!best || d < best.d)) best = { s, d };
  }
  return best;
};

/** Fiche d'un terrain : essentiel d'abord (piste, fréquences), puis météo, NOTAM (non disponible) et VAC. */
export function AdInfo(p: {
  lang: Lang;
  prefs: UnitPrefs;
  airfield: Airfield;
  exportedAtMs: number | null;
  nowMs: number;
  metars: readonly Metar[];
  tafs: readonly Taf[];
  docs: readonly DocRecord[];
  /** NOTAM en vigueur sur ce terrain (déjà filtrés), et date de réception du dernier jeu de NOTAM (null = aucun reçu). */
  notams: readonly Notam[];
  notamReceivedMs: number | null;
  onDirect: () => void;
  onOpenDoc: (id: string) => void;
  onClose: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const a = p.airfield;
  const d = airfieldDetails(a, p.prefs, p.exportedAtMs);
  const at = a.position;
  const metarMap = latestMetarByStation(p.metars);
  const exact = a.icao ? metarMap.get(a.icao) : undefined;
  const near = exact ? { s: exact, d: 0 } : nearest([...metarMap.values()], at, 40 * 1852);
  const taf = a.icao ? latestTafByStation(p.tafs).get(a.icao) : undefined;
  const docs = p.docs.filter((x) => a.icao && x.icao === a.icao);
  const keys = ["Altitude", "Pistes", "Fréquences", "Accès"].filter((k) => d[k] !== undefined);
  return (
    <aside className="sheet adinfo" aria-label={a.icao ?? a.name}>
      <header>
        <h2>{a.icao ? `${a.icao} · ` : ""}{a.name}</h2>
        <button className="btn-inline" aria-label={T("close")} onClick={p.onClose}>✕</button>
      </header>
      <div className="choices"><button className="brand" onClick={p.onDirect}>{T("ad.direct")}</button></div>
      <dl>
        {keys.map((k) => (
          <div key={k}><dt>{k}</dt><dd>{d[k]}</dd></div>
        ))}
      </dl>

      <h3>{T("ad.weather")}</h3>
      {near ? (
        <>
          <p className="muted small">
            {near.s.station}{near.d > 0 ? ` · ${formatQuantity("distance", p.prefs, near.d)} ${unitLabel("distance", p.prefs)}` : ""} · {utcTime(near.s.observedAt)} · {ageText(Math.max(0, Math.round((p.nowMs - near.s.observedAt) / 60000)))}
          </p>
          <div className="mono small">
            {windText(near.s.conditions, p.prefs)} · {visibilityText(near.s.conditions.visibility)} · {cloudsText(near.s.conditions.clouds)} · {temperatureText(near.s.temperature, near.s.dewpoint)}
          </div>
          <span className={`cat cat-${near.s.conditions.category ?? "none"}`}>{near.s.conditions.category ?? "?"}</span>
          <details className="rawbox"><summary>{T("wx.raw")}</summary><pre className="wx-raw">{near.s.raw}</pre></details>
        </>
      ) : (
        <p className="muted small">{T("ad.noMetar")}</p>
      )}
      {taf && <details className="rawbox"><summary>TAF</summary><pre className="wx-raw">{taf.raw}</pre></details>}

      <h3>NOTAM{p.notams.length > 0 ? ` (${p.notams.length})` : ""}</h3>
      {p.notams.map((n) => <NotamCard key={n.id} lang={p.lang} n={n} role={null} />)}
      {p.notams.length === 0 && (
        <p className="muted small">
          {p.notamReceivedMs === null ? T("ad.notamNone") : `${T("notam.noneAd")} (${T("notam.received")} ${new Date(p.notamReceivedMs).toISOString().slice(0, 16).replace("T", " ")}Z)`}
        </p>
      )}

      <h3>{T("ad.vacTitle")}</h3>
      {docs.length === 0 && <p className="muted small">{T("ad.noVac")}</p>}
      {docs.map((x) => (
        <button className="row" key={x.id} onClick={() => p.onOpenDoc(x.id)}>
          {x.name}{x.georef ? ` · ${T("dc.geo.badge")}` : ""}
        </button>
      ))}
    </aside>
  );
}
