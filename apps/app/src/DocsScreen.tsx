import { useEffect, useMemo, useRef, useState } from "react";
import { fitGeoref, georefMetrics, parseCoordinate, type ControlPoint } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import { DOC_KINDS, isPdf, newDoc, type DocKind, type DocRecord } from "./docStore";
import { imageSize, renderPdfPage } from "./pdfRender";

const KIND_KEYS: Record<DocKind, Key> = { vac: "dc.kind.vac", aip: "dc.kind.aip", sup: "dc.kind.sup", other: "dc.kind.other" };

interface Rendered { readonly url: string; readonly blob: Blob; readonly width: number; readonly height: number; readonly pages: number }

/** Rend la page demandée d'un document (PDF via pdf.js, image telle quelle). */
function useRendered(doc: DocRecord, page: number) {
  const [r, setR] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setR(null);
    setError(null);
    (async () => {
      try {
        if (isPdf(doc)) {
          const p = await renderPdfPage(doc.data, page);
          url = URL.createObjectURL(p.blob);
          if (alive) setR({ url, blob: p.blob, width: p.width, height: p.height, pages: p.pages });
        } else {
          const s = await imageSize(doc.data);
          url = URL.createObjectURL(doc.data);
          if (alive) setR({ url, blob: doc.data, width: s.width, height: s.height, pages: 1 });
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, doc.data, page]); // eslint-disable-line react-hooks/exhaustive-deps
  return { r, error };
}

interface Mark { readonly px: number; readonly py: number; readonly label: string; readonly pending?: boolean }

/** Image de carte dans un cadre défilant, avec zoom et repères ; un appui renvoie le pixel de l'image. */
function ChartImage(p: { r: Rendered; zoom: number; marks?: readonly Mark[]; onPick?: (px: number, py: number) => void; alt: string }) {
  const img = useRef<HTMLImageElement>(null);
  return (
    <div className="chartview">
      <div className="chartinner" style={{ width: `${p.zoom * 100}%` }}>
        <img
          ref={img}
          src={p.r.url}
          alt={p.alt}
          draggable={false}
          onClick={(e) => {
            if (!p.onPick || !img.current) return;
            const b = img.current.getBoundingClientRect();
            p.onPick(((e.clientX - b.left) / b.width) * p.r.width, ((e.clientY - b.top) / b.height) * p.r.height);
          }}
        />
        {(p.marks ?? []).map((m, i) => (
          <span key={i} className={m.pending ? "mark pending" : "mark"} style={{ left: `${(m.px / p.r.width) * 100}%`, top: `${(m.py / p.r.height) * 100}%` }}>
            <b>{m.label}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function ZoomBar(p: { zoom: number; onZoom: (z: number) => void }) {
  return (
    <div className="choices">
      <button aria-label="zoom −" onClick={() => p.onZoom(Math.max(1, p.zoom / 1.5))}>−</button>
      <button aria-label="zoom +" onClick={() => p.onZoom(Math.min(6, p.zoom * 1.5))}>+</button>
      <button onClick={() => p.onZoom(1)}>1:1</button>
    </div>
  );
}

function Calibrator(p: { lang: Lang; doc: DocRecord; r: Rendered; page: number; onSave: (d: DocRecord) => void; onCancel: () => void }) {
  const T = (k: Key) => t(p.lang, k);
  const [pts, setPts] = useState<ControlPoint[]>([...(p.doc.georef?.points ?? [])]);
  const [pending, setPending] = useState<{ px: number; py: number } | null>(null);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const fit = useMemo(() => fitGeoref(pts), [pts]);
  const add = () => {
    if (!pending) return setErr(T("dc.cal.needPixel"));
    const la = parseCoordinate(lat, "lat"), lo = parseCoordinate(lon, "lon");
    if (la === null || lo === null) return setErr(T("dc.cal.badCoord"));
    setPts([...pts, { px: pending.px, py: pending.py, lat: la, lon: lo }]);
    setPending(null);
    setLat("");
    setLon("");
    setErr(null);
  };
  const marks: Mark[] = [...pts.map((q, i) => ({ px: q.px, py: q.py, label: String(i + 1) })), ...(pending ? [{ px: pending.px, py: pending.py, label: "+", pending: true }] : [])];
  return (
    <div>
      <h3>{T("dc.cal.title")}</h3>
      <p className="muted small">{T("dc.cal.help")}</p>
      <ZoomBar zoom={zoom} onZoom={setZoom} />
      <ChartImage r={p.r} zoom={zoom} marks={marks} onPick={(px, py) => { setPending({ px, py }); setErr(null); }} alt={p.doc.name} />
      <div className="params">
        <label className="numfield"><span>{T("dc.cal.lat")}</span><input className="field" value={lat} placeholder="47°18'30&quot;N" onChange={(e) => setLat(e.target.value)} /></label>
        <label className="numfield"><span>{T("dc.cal.lon")}</span><input className="field" value={lon} placeholder="002°20'15&quot;E" onChange={(e) => setLon(e.target.value)} /></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="choices">
        <button disabled={!pending} onClick={add}>{T("dc.cal.add")}</button>
      </div>
      {pts.map((q, i) => (
        <div className="point-row" key={i} style={{ gridTemplateColumns: "28px 1fr auto auto" }}>
          <b className="mono">{i + 1}</b>
          <span className="mono small">{q.lat.toFixed(5)}, {q.lon.toFixed(5)}</span>
          <span className="mono small">{fit && pts.length >= 3 ? `±${Math.round(fit.residuals[i] as number)} m` : ""}</span>
          <button aria-label={T("nav.delete")} onClick={() => setPts(pts.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {pts.length < 2 && <p className="muted small">{T("dc.cal.min")}</p>}
      {fit && pts.length === 2 && <p className="muted small">{T("dc.cal.two")}</p>}
      {fit && pts.length >= 3 && (
        <p className={fit.rmsError > 150 ? "error" : "muted small"}>{T("dc.cal.rms")} : {Math.round(fit.rmsError)} m{fit.rmsError > 150 ? ` — ${T("dc.cal.bad")}` : ""}</p>
      )}
      <div className="choices">
        <button
          className="brand"
          disabled={!fit}
          onClick={() => fit && p.onSave({ ...p.doc, georef: { points: pts, georef: fit.georef, width: p.r.width, height: p.r.height, rmsError: fit.rmsError, page: p.page, image: p.r.blob } })}
        >
          {T("dc.cal.save")}
        </button>
        <button onClick={p.onCancel}>{T("dc.cal.cancel")}</button>
      </div>
    </div>
  );
}

function DocDetail(p: { lang: Lang; doc: DocRecord; onPut: (d: DocRecord) => void; onRemove: (id: string) => void; onBack: () => void }) {
  const T = (k: Key) => t(p.lang, k);
  const d = p.doc;
  const [page, setPage] = useState(d.georef?.page ?? 1);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"view" | "calibrate">("view");
  const [confirm, setConfirm] = useState(false);
  const { r, error } = useRendered(d, page);
  const g = d.georef;
  const metrics = g ? georefMetrics(g.georef, g.width, g.height) : null;
  return (
    <div className="navscreen">
      <div className="choices"><button onClick={p.onBack}>← {T("dc.back")}</button></div>
      <label className="numfield"><span>{T("nav.name")}</span><input className="field" defaultValue={d.name} key={`${d.id}-n`} onBlur={(e) => e.target.value.trim() && p.onPut({ ...d, name: e.target.value.trim() })} /></label>
      <div className="choices">
        {DOC_KINDS.map((k) => <button key={k} aria-pressed={d.kind === k} onClick={() => p.onPut({ ...d, kind: k })}>{T(KIND_KEYS[k])}</button>)}
      </div>
      <div className="params">
        <label className="numfield"><span>{T("dc.icao")}</span><input className="field" defaultValue={d.icao} key={`${d.id}-i`} maxLength={4} onBlur={(e) => p.onPut({ ...d, icao: e.target.value.trim().toUpperCase() })} /></label>
        <label className="numfield"><span>{T("dc.sourceDate")}</span><input className="field" defaultValue={d.sourceDate} key={`${d.id}-s`} placeholder="AIRAC 13/2026" onBlur={(e) => p.onPut({ ...d, sourceDate: e.target.value.trim() })} /></label>
      </div>
      <p className="muted small">{T("dc.stale")}</p>

      {error && <p className="error" role="alert">{T("dc.renderError")} : {error}</p>}
      {!r && !error && <p className="muted">{T("dc.rendering")}</p>}
      {r && mode === "view" && (
        <>
          {r.pages > 1 && (
            <div className="choices">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              <span className="mono">{page} / {r.pages}</span>
              <button disabled={page >= r.pages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
          <ZoomBar zoom={zoom} onZoom={setZoom} />
          <ChartImage r={r} zoom={zoom} alt={d.name} />
          <h3>{T("dc.geo")}</h3>
          {g && metrics ? (
            <>
              <p className="muted small">{T("dc.geo.done")} · {g.points.length} {T("dc.geo.points")} · {T("dc.cal.rms")} {Math.round(g.rmsError)} m · {metrics.metersPerPixel.toFixed(1)} m/px · {T("dc.geo.rotation")} {Math.round(metrics.rotationDeg)}°{g.page !== page ? ` · ${T("dc.geo.otherPage")} ${g.page}` : ""}</p>
              <div className="choices">
                {(["auto", "on", "off"] as const).map((s) => <button key={s} aria-pressed={d.show === s} onClick={() => p.onPut({ ...d, show: s })}>{T(`dc.show.${s}` as Key)}</button>)}
              </div>
              <p className="muted small">{T("dc.show.note")}</p>
            </>
          ) : <p className="muted small">{T("dc.geo.none")}</p>}
          <div className="choices">
            <button onClick={() => setMode("calibrate")}>{g ? T("dc.geo.redo") : T("dc.geo.start")}</button>
            {g && <button onClick={() => p.onPut({ ...d, georef: null })}>{T("dc.geo.remove")}</button>}
          </div>
        </>
      )}
      {r && mode === "calibrate" && (
        <Calibrator lang={p.lang} doc={d} r={r} page={page} onCancel={() => setMode("view")} onSave={(nd) => { p.onPut(nd); setMode("view"); }} />
      )}
      <div className="choices">
        {confirm
          ? <button className="brand" onClick={() => { p.onRemove(d.id); p.onBack(); }}>{T("tr.confirmDelete")}</button>
          : <button onClick={() => setConfirm(true)}>{T("nav.delete")}</button>}
      </div>
    </div>
  );
}

interface DocsProps {
  lang: Lang;
  docs: readonly DocRecord[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onPut: (d: DocRecord) => void;
  onRemove: (id: string) => void;
}

/** Onglet « Documents » : bibliothèque (VAC, AIP, SUP AIP, autres), lecteur et calage des cartes. */
export function DocsTab(p: DocsProps) {
  const T = (k: Key) => t(p.lang, k);
  const [filter, setFilter] = useState<DocKind | "all">("all");
  const [q, setQ] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const doc = p.openId ? p.docs.find((x) => x.id === p.openId) ?? null : null;
  if (doc) return <DocDetail lang={p.lang} doc={doc} onPut={p.onPut} onRemove={p.onRemove} onBack={() => p.onOpen(null)} />;

  const shown = [...p.docs]
    .filter((d) => (filter === "all" || d.kind === filter) && (q === "" || `${d.name} ${d.icao}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.icao || "~").localeCompare(b.icao || "~") || a.name.localeCompare(b.name));
  const onFiles = (files: FileList | null) => {
    setImportError(null);
    for (const f of Array.from(files ?? [])) {
      if (!isPdf({ mime: f.type, name: f.name }) && !f.type.startsWith("image/")) { setImportError(`${f.name} : ${T("dc.badType")}`); continue; }
      p.onPut(newDoc(f, Date.now(), crypto.randomUUID()));
    }
  };
  return (
    <div className="navscreen">
      <label className="choices filebtn">
        <span className="button">{T("dc.import")}</span>
        <input type="file" accept=".pdf,application/pdf,image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      </label>
      {importError && <p className="error" role="alert">{importError}</p>}
      <div className="choices">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{T("dc.all")}</button>
        {DOC_KINDS.map((k) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{T(KIND_KEYS[k])}</button>)}
      </div>
      <label className="numfield"><span>{T("dc.search")}</span><input className="field" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {shown.length === 0 && <p className="muted">{T("dc.none")}</p>}
      <div className="route-list">
        {shown.map((d) => (
          <div className="route-item" key={d.id}>
            <button className="row" onClick={() => p.onOpen(d.id)}>
              {d.icao ? `${d.icao} · ` : ""}{d.name} · {T(KIND_KEYS[d.kind])}{d.georef ? ` · ${T("dc.geo.badge")}` : ""} · {(d.size / 1048576).toFixed(1)} Mo
            </button>
          </div>
        ))}
      </div>
      <p className="muted small">{T("dc.note")}</p>
    </div>
  );
}
