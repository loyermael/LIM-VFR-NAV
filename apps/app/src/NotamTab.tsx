import { useMemo, useState } from "react";
import type { Airfield } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import { notamSubject, notamsForFlight, type Notam, type NotamRole, type NotamSet } from "./notam";
import type { RouteRecord } from "./routeEdit";

const KEY_STORAGE = "lim.notam.apiKey";
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
const ageText = (ms: number, now: number) => {
  const h = Math.max(0, Math.round((now - ms) / 3_600_000));
  return h < 1 ? "< 1 h" : h < 48 ? `${h} h` : `${Math.round(h / 24)} j`;
};

/** Onglet NOTAM (Météo) : import d'un texte NOTAM, récupération par API avec sa propre clé, liste triée par pertinence pour le vol. */
export function NotamTab(p: {
  lang: Lang;
  route: RouteRecord | null;
  airfields: readonly Airfield[];
  set: NotamSet | null;
  nowMs: number;
  window: { startMs: number; endMs: number };
  /** Analyse un texte et l'ajoute ; rend un message d'erreur ou null. */
  onImportText: (text: string, source: string) => Promise<string | null>;
  /** Interroge le service avec la clé ; rend un message d'erreur ou null. */
  onFetchApi: (key: string) => Promise<string | null>;
  onClear: () => void;
}) {
  const T = (k: Key) => t(p.lang, k);
  const [text, setText] = useState("");
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORAGE) ?? ""; } catch { return ""; } });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const items = p.set?.items ?? [];
  const relevant = useMemo(
    () => (p.route && p.route.points.length > 0 ? notamsForFlight(items, p.route.points, p.airfields, p.window) : []),
    [items, p.route, p.airfields, p.window],
  );
  const others = useMemo(() => {
    const ids = new Set(relevant.map((r) => r.notam.id));
    return items.filter((n) => !ids.has(n.id) && (n.toMs === null || n.toMs >= p.nowMs));
  }, [items, relevant, p.nowMs]);

  const run = async (fn: () => Promise<string | null>, okText: string) => {
    setBusy(true);
    setMsg(null);
    const err = await fn();
    setMsg(err ? { ok: false, text: err } : { ok: true, text: okText });
    setBusy(false);
  };
  const saveKey = (v: string) => { setKey(v); try { localStorage.setItem(KEY_STORAGE, v); } catch { /* stockage bloqué */ } };
  const roleLabel: Record<NotamRole, Key> = { dep: "notam.role.dep", arr: "notam.role.arr", route: "notam.role.route", other: "notam.role.other" };

  const Card = ({ n, role }: { n: Notam; role: NotamRole | null }) => (
    <div className={`wx-card${role === "dep" || role === "arr" ? " onroute" : ""}`}>
      <div className="wx-head">
        <b>{n.id}</b> <span className="muted small">{n.locations.join(" ") || n.fir}</span>
        {role && <span className="badge">{T(roleLabel[role])}</span>}
      </div>
      <div className="small"><b>{notamSubject(n.qcode)}</b></div>
      <p className="notam-text">{n.text}</p>
      <div className="muted small">
        {n.fromMs !== null ? utc(n.fromMs) : "---"} → {n.toMs === null ? T("notam.perm") : utc(n.toMs)}{n.estimated ? " (EST)" : ""}
        {n.schedule ? ` · ${n.schedule}` : ""}
        {n.lowerText || n.upperText ? ` · ${n.lowerText || "SFC"} → ${n.upperText || "UNL"}` : ""}
      </div>
      <details className="rawbox"><summary>{T("wx.raw")}</summary><pre className="wx-raw">{n.raw}</pre></details>
    </div>
  );

  return (
    <div className="navscreen">
      <p className="error notam-warn" role="note">{T("notam.warning")}</p>

      <h3>{T("notam.import")}</h3>
      <textarea className="notam-paste" rows={5} value={text} placeholder={T("notam.paste")} aria-label={T("notam.paste")} onChange={(e) => setText(e.target.value)} />
      <div className="choices">
        <button className="brand" disabled={busy || text.trim() === ""} onClick={() => void run(async () => { const r = await p.onImportText(text, "texte"); if (!r) setText(""); return r; }, T("notam.imported"))}>{T("notam.analyse")}</button>
        <label className="filebtn">
          {T("notam.file")}
          <input type="file" hidden accept=".txt,.text,.notam" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(async () => p.onImportText(await f.text(), f.name), T("notam.imported")); }} />
        </label>
      </div>

      <details className="perfbox">
        <summary>{T("notam.api")}</summary>
        <p className="muted small">{T("notam.apiHelp")}</p>
        <label className="numfield">
          <span>{T("notam.apiKey")}</span>
          <input className="field mono" type="password" autoComplete="off" value={key} onChange={(e) => saveKey(e.target.value)} />
        </label>
        <button disabled={busy || key.trim() === "" || !p.route || p.route.points.length === 0} onClick={() => void run(() => p.onFetchApi(key.trim()), T("notam.imported"))}>{busy ? T("notam.fetching") : T("notam.fetch")}</button>
        {!p.route && <p className="muted small">{T("notam.needRoute")}</p>}
      </details>
      {msg && <p className={msg.ok ? "muted small" : "error"} role="status">{msg.text}</p>}

      {p.set && (
        <p className="muted small">
          {items.length} NOTAM · {T("notam.source")} : {p.set.source} · {T("notam.received")} {utc(p.set.importedAtMs)} ({ageText(p.set.importedAtMs, p.nowMs)})
          {p.nowMs - p.set.importedAtMs > 24 * 3_600_000 ? ` — ${T("notam.stale")}` : ""}
          {" "}<button className="btn-inline" onClick={p.onClear}>{T("notam.clear")}</button>
        </p>
      )}
      {!p.set && <p className="muted">{T("notam.empty")}</p>}

      {p.set && p.route && p.route.points.length > 0 && (
        <>
          <h3>{T("notam.forFlight")} ({relevant.length})</h3>
          {relevant.length === 0 && <p className="muted small">{T("notam.noneFlight")}</p>}
          {relevant.map((r) => <Card key={r.notam.id} n={r.notam} role={r.role} />)}
        </>
      )}
      {p.set && others.length > 0 && (
        <>
          <div className="choices">
            <button onClick={() => setShowAll(!showAll)}>{showAll ? T("notam.hideOthers") : `${T("notam.showOthers")} (${others.length})`}</button>
          </div>
          {showAll && others.map((n) => <Card key={n.id} n={n} role={null} />)}
        </>
      )}
    </div>
  );
}
