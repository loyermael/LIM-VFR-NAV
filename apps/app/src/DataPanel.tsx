import { useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import { applyBaseUrl, type PackCountry, type PackDataset, type PackHook } from "./dataPack";

const mo = (n: number) => (n / 1048576).toFixed(1);
const sizeOf = (d: PackDataset) => d.files.reduce((a, f) => a + f.bytes, 0);
const ageText = (iso: string, nowMs: number, lang: Lang): string => {
  const min = Math.max(0, (nowMs - Date.parse(iso)) / 60000);
  if (min < 2) return lang === "fr" ? "à l'instant" : "just now";
  if (min < 60) return lang === "fr" ? `il y a ${Math.round(min)} min` : `${Math.round(min)} min ago`;
  const h = min / 60;
  if (h < 48) return lang === "fr" ? `il y a ${Math.round(h)} h` : `${Math.round(h)} h ago`;
  return lang === "fr" ? `il y a ${Math.round(h / 24)} jours` : `${Math.round(h / 24)} days ago`;
};

/** Une ligne de données : titre, taille, et soit la progression, soit l'état. */
function Row(p: { lang: Lang; pack: PackHook; ds: PackDataset; nowMs: number }) {
  const T = (k: Key) => t(p.lang, k);
  const have = p.pack.installed.datasets[p.ds.id];
  const st = p.pack.status[p.ds.id];
  const pct = st?.state === "downloading" ? Math.min(100, Math.floor((st.loaded / Math.max(1, st.total)) * 100)) : null;
  return (
    <div className="datarow">
      <div className="datahead">
        <b>{p.ds.title}</b>
        <span className="mono small">{mo(sizeOf(p.ds))} {T("dp.mb")}</span>
      </div>
      {st?.state === "downloading" && (
        <>
          <progress max={100} value={pct ?? 0} aria-label={`${p.ds.title} ${pct} %`} />
          <div className="mono small">{pct} % · {mo(st.loaded)} / {mo(st.total)} {T("dp.mb")}</div>
        </>
      )}
      {st?.state === "installing" && (<><progress aria-label={T("dp.installing")} /><div className="mono small">{T("dp.installing")}</div></>)}
      {st?.state === "error" && <div className="error" role="alert">{T("dp.error")} : {st.message}</div>}
      {st?.state !== "downloading" && st?.state !== "installing" && st?.state !== "error" && (
        <div className="muted small">{have ? `✓ ${ageText(have.updatedAt, p.nowMs, p.lang)}` : p.pack.checking ? T("dp.waiting") : T("dp.missing")}</div>
      )}
    </div>
  );
}

/** Données : des packages à installer (France…), des données qui se mettent à jour seules (météo), et c'est tout. */
export function DataPanel(p: { lang: Lang; pack: PackHook; nowMs: number; onRemovePackage: () => void }) {
  const T = (k: Key) => t(p.lang, k);
  const k = p.pack;
  const [confirm, setConfirm] = useState(false);
  const countries: readonly PackCountry[] = k.manifest?.countries ?? [];
  const live = countries.flatMap((c) => c.datasets).filter((d) => d.live).slice(0, 1);
  const busy = Object.values(k.status).some((s) => s.state === "downloading" || s.state === "installing");
  return (
    <div>
      {!k.baseUrl && <p className="error" role="alert">{T("dp.noServer")}</p>}

      <h3>{T("dp.packages")}</h3>
      {k.baseUrl && countries.length === 0 && <p className="muted">{k.checking ? T("dp.checking") : `${T("dp.noList")}${k.lastError ? ` (${k.lastError})` : ""}`}</p>}
      {countries.map((c) => {
        const installed = k.installed.country === c.code;
        const items = c.datasets.filter((d) => !d.live);
        const total = items.reduce((a, d) => a + sizeOf(d), 0);
        return (
          <section className={installed ? "pkg installed" : "pkg"} key={c.code}>
            <div className="datahead">
              <b className="pkgname">{c.name}</b>
              <span className="mono small">{mo(total)} {T("dp.mb")}</span>
            </div>
            {!installed ? (
              <>
                <p className="muted small">{items.map((d) => d.title).join(" · ")}</p>
                <div className="choices"><button className="brand" onClick={() => k.chooseCountry(c.code)}>{T("dp.install")}</button></div>
              </>
            ) : (
              <>
                <div className="datalist">{items.map((d) => <Row key={d.id} lang={p.lang} pack={k} ds={d} nowMs={p.nowMs} />)}</div>
                <div className="datarow soon"><b>{T("dp.soonMaps")}</b><span className="muted small">{T("dp.soon")}</span></div>
                <div className="datarow soon"><b>{T("dp.soonVac")}</b><span className="muted small">{T("dp.soon")}</span></div>
                <div className="choices">
                  {k.checking
                    ? <button className="brand" onClick={k.cancel}>{T("dp.cancel")}</button>
                    : <button onClick={k.refresh}>{Object.values(k.status).some((s) => s.state === "error") ? T("dp.retry") : T("dp.refresh")}</button>}
                  {!busy && (confirm
                    ? <button className="brand" onClick={() => { p.onRemovePackage(); setConfirm(false); }}>{T("dp.removeConfirm")}</button>
                    : <button onClick={() => setConfirm(true)}>{T("dp.remove")}</button>)}
                </div>
              </>
            )}
          </section>
        );
      })}

      <h3>{T("dp.auto")}</h3>
      {live.map((d) => <Row key={d.id} lang={p.lang} pack={k} ds={d} nowMs={p.nowMs} />)}
      <div className="datarow soon"><b>NOTAM</b><span className="muted small">{T("dp.notamSoon")}</span></div>
      {live.length > 0 && !k.checking && <div className="choices"><button onClick={k.refresh}>{T("wxd.refresh")}</button></div>}
      {k.lastError && <p className="muted small" role="status">{T("dp.offline")}</p>}

      <details className="rawbox">
        <summary>{T("dp.about")}</summary>
        {countries.flatMap((c) => c.datasets).map((d) => <p className="muted small" key={d.id}>{d.title} : {d.source} — {d.licence}</p>)}
        <p className="muted small">{T("dp.note")}</p>
      </details>
      <details className="rawbox">
        <summary>{T("dp.advanced")}</summary>
        <label className="numfield">
          <span>{T("dp.url")}</span>
          <input className="field" defaultValue={k.baseUrl} spellCheck={false} placeholder="https://…" onBlur={(e) => { const v = e.target.value.trim(); if (v !== k.baseUrl && (v === "" || /^https?:\/\//i.test(v))) applyBaseUrl(v); }} />
        </label>
      </details>
    </div>
  );
}
