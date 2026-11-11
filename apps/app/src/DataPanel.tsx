import { t, type Key, type Lang } from "./i18n";
import { applyBaseUrl, type PackHook } from "./dataPack";

const ageText = (iso: string, nowMs: number, lang: Lang): string => {
  const h = Math.max(0, (nowMs - Date.parse(iso)) / 3.6e6);
  if (h < 1) return lang === "fr" ? "il y a moins d'une heure" : "less than an hour ago";
  if (h < 48) return lang === "fr" ? `il y a ${Math.round(h)} h` : `${Math.round(h)} h ago`;
  return lang === "fr" ? `il y a ${Math.round(h / 24)} jours` : `${Math.round(h / 24)} days ago`;
};

/** Réglages « Données » : choisir le pays, tout le reste (téléchargement, mises à jour) est automatique. */
export function DataPanel(p: { lang: Lang; pack: PackHook; nowMs: number }) {
  const T = (k: Key) => t(p.lang, k);
  const k = p.pack;
  const country = k.manifest?.countries.find((c) => c.code === k.installed.country) ?? null;
  return (
    <div>
      <h3>{T("dp.title")}</h3>
      {!k.baseUrl && <p className="error" role="alert">{T("dp.noServer")}</p>}
      {k.baseUrl && (
        <>
          <p className="muted small">{T("dp.help")}</p>
          <div className="choices" role="group" aria-label={T("dp.country")}>
            {k.countries.map((c) => (
              <button key={c.code} aria-pressed={k.installed.country === c.code} onClick={() => k.chooseCountry(c.code)}>{c.name}</button>
            ))}
            {k.countries.length === 0 && <span className="muted small">{k.checking ? T("dp.checking") : T("dp.noList")}</span>}
          </div>
          {k.installed.country && (
            <div className="datalist">
              {(country?.datasets ?? []).map((d) => {
                const have = k.installed.datasets[d.id];
                const st = k.status[d.id];
                const mo = (n: number) => (n / 1048576).toFixed(1);
                const size = d.files.reduce((a, f) => a + f.bytes, 0);
                const busy = st?.state === "downloading" || st?.state === "installing";
                const pct = st?.state === "downloading" ? Math.min(100, Math.floor((st.loaded / Math.max(1, st.total)) * 100)) : null;
                return (
                  <div className="datarow" key={d.id}>
                    <div className="datahead">
                      <b>{d.title}</b>
                      <span className="mono small">{mo(size)} {T("dp.mb")}</span>
                    </div>
                    {st?.state === "downloading" && (
                      <>
                        <progress max={100} value={pct ?? 0} aria-label={`${d.title} ${pct} %`} />
                        <div className="mono small">{pct} % · {mo(st.loaded)} / {mo(st.total)} {T("dp.mb")}</div>
                      </>
                    )}
                    {st?.state === "installing" && (
                      <>
                        <progress aria-label={T("dp.installing")} />
                        <div className="mono small">{T("dp.installing")}</div>
                      </>
                    )}
                    {st?.state === "error" && <div className="error" role="alert">{T("dp.error")} : {st.message}</div>}
                    {!busy && st?.state !== "error" && (
                      <div className="muted small">{have ? `${T("dp.upToDate")} · ${T("dp.version")} ${ageText(have.updatedAt, p.nowMs, p.lang)}` : k.checking ? T("dp.waiting") : T("dp.missing")}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {k.lastError && <p className="muted small" role="status">{T("dp.offline")} ({k.lastError})</p>}
          <div className="choices">
            {k.checking
              ? <button className="brand" onClick={k.cancel}>{T("dp.cancel")}</button>
              : <button disabled={!k.installed.country} onClick={k.refresh}>{Object.values(k.status).some((v) => v.state === "error") ? T("dp.retry") : T("dp.refresh")}</button>}
          </div>
          {country && country.datasets.map((d) => <p className="muted small" key={d.id}>{d.title} : {d.source} — {d.licence}</p>)}
          <p className="muted small">{T("dp.note")}</p>
        </>
      )}
      <details>
        <summary>{T("dp.advanced")}</summary>
        <label className="numfield">
          <span>{T("dp.url")}</span>
          <input className="field" defaultValue={k.baseUrl} spellCheck={false} placeholder="https://…" onBlur={(e) => { const v = e.target.value.trim(); if (v !== k.baseUrl && (v === "" || /^https?:\/\//i.test(v))) applyBaseUrl(v); }} />
        </label>
      </details>
    </div>
  );
}
