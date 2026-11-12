import { ConfirmButton } from "./ui/ConfirmButton";
import { useRef, useState } from "react";
import { bboxAround, type BBox, type LatLon } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import { BASE_MAPS, deleteArea, downloadArea, estimateArea, loadAreas, saveAreas, type AreaRecord, type BaseMapId } from "./baseMaps";

const mo = (n: number) => (n / 1048576).toFixed(n < 1048576 * 10 ? 1 : 0);
const ZOOMS = [10, 12, 13, 14] as const;
const LAYER_KEYS: Record<BaseMapId, Key> = { plan: "bm.plan", ortho: "bm.ortho", relief: "bm.relief" as Key, aero: "bm.aero" };

/** Données → fonds de carte IGN : choisir une zone, voir le poids estimé, télécharger avec pourcentage, retirer. */
export function BaseMapPanel(p: {
  lang: Lang;
  getViewBounds: () => BBox | null;
  routePoints: readonly LatLon[];
  position: LatLon | null;
}) {
  const T = (k: Key) => t(p.lang, k);
  const [areas, setAreas] = useState<AreaRecord[]>(loadAreas);
  const [map, setMap] = useState<BaseMapId>("plan");
  const [zone, setZone] = useState<"view" | "route" | "pos">("view");
  const [zmax, setZmax] = useState<number>(12);
  const [busy, setBusy] = useState<{ done: number; total: number; bytes: number; failed: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const bbox: BBox | null =
    zone === "view" ? p.getViewBounds()
    : zone === "route" ? bboxAround(p.routePoints, 10 * 1852)
    : p.position ? bboxAround([p.position], 30 * 1852) : null;
  const zmin = 6;
  const est = bbox ? estimateArea(map, bbox, zmin, Math.min(zmax, BASE_MAPS[map].maxZoom)) : null;

  const start = async () => {
    if (!bbox || !est || est.tooBig) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy({ done: 0, total: est.tiles, bytes: 0, failed: 0 });
    setMsg(null);
    try {
      const z1 = Math.min(zmax, BASE_MAPS[map].maxZoom);
      const res = await downloadArea(map, bbox, zmin, z1, setBusy, ctl.signal);
      const rec: AreaRecord = {
        id: crypto.randomUUID(), name: `${T(LAYER_KEYS[map])} · ${T(zone === "view" ? "bm.zoneView" : zone === "route" ? "bm.zoneRoute" : "bm.zonePos")}`, map, bbox, zmin, zmax: z1,
        tiles: res.total - res.failed, bytes: res.bytes, at: Date.now(),
      };
      const next = [...areas, rec];
      setAreas(next);
      saveAreas(next);
      setMsg({ text: res.failed > 0 ? `${T("bm.done")} ${res.failed} ${T("bm.failed")}.` : T("bm.done"), error: res.failed > 0 });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const remove = async (a: AreaRecord) => {
    await deleteArea(a);
    const next = areas.filter((x) => x.id !== a.id);
    setAreas(next);
    saveAreas(next);
  };

  return (
    <div>
      <h3>{T("bm.title")}</h3>
      <p className="muted small">{T("bm.help")}</p>

      <div className="pkg">
        <div className="choices" role="group" aria-label={T("bm.layer")}>
          {(["aero", "plan", "ortho", "relief"] as const).map((b) => (
            <button key={b} aria-pressed={map === b} onClick={() => setMap(b)}>{T(b === "relief" ? "lay.relief" : LAYER_KEYS[b])}</button>
          ))}
        </div>
        <div className="choices" role="group" aria-label={T("bm.zone")}>
          {(["view", "route", "pos"] as const).map((z) => (
            <button key={z} aria-pressed={zone === z} onClick={() => setZone(z)}>{T(z === "view" ? "bm.zoneView" : z === "route" ? "bm.zoneRoute" : "bm.zonePos")}</button>
          ))}
        </div>
        <div className="choices" role="group" aria-label={T("bm.detail")}>
          <span className="muted small">{T("bm.detail")} :</span>
          {ZOOMS.map((z) => <button key={z} aria-pressed={zmax === z} onClick={() => setZmax(z)}>z{z}</button>)}
        </div>
        {!bbox && <p className="muted small">{T("bm.noZone")}</p>}
        {est && (
          <p className={est.tooBig ? "error" : "muted small"} role={est.tooBig ? "alert" : undefined}>
            {T("bm.estimate")} : ≈ {est.tiles.toLocaleString(p.lang === "fr" ? "fr-FR" : "en-GB")} {T("bm.tiles")} · ≈ {mo(est.bytes)} {T("dp.mb")}{est.tooBig ? ` — ${T("bm.tooBig")}` : ""}
          </p>
        )}
        {busy ? (
          <>
            <progress max={100} value={Math.floor((busy.done / Math.max(1, busy.total)) * 100)} aria-label="téléchargement" />
            <div className="mono small">{Math.floor((busy.done / Math.max(1, busy.total)) * 100)} % · {mo(busy.bytes)} {T("dp.mb")}{busy.failed > 0 ? ` · ${busy.failed} ${T("bm.failed")}` : ""}</div>
            <div className="choices"><button className="brand" onClick={() => abort.current?.abort()}>{T("bm.cancel")}</button></div>
          </>
        ) : (
          <div className="choices"><button className="brand" disabled={!bbox || !est || est.tooBig} onClick={() => void start()}>{T("bm.download")}</button></div>
        )}
        {msg && <p className={msg.error ? "error" : "muted small"} role={msg.error ? "alert" : "status"}>{msg.text}</p>}
      </div>

      <h3>{T("bm.areas")}</h3>
      {areas.length === 0 && <p className="muted small">{T("bm.noAreas")}</p>}
      {areas.map((a) => (
        <div className="datarow" key={a.id}>
          <div className="datahead"><b>{a.name}</b><span className="mono small">{mo(a.bytes)} {T("dp.mb")}</span></div>
          <div className="muted small">z{a.zmin}–z{a.zmax} · {a.tiles} {T("bm.tiles")} · {new Date(a.at).toISOString().slice(0, 10)}</div>
          <div className="choices">
            <ConfirmButton label={T("bm.remove")} confirmLabel={T("bm.removeConfirm")} onConfirm={() => void remove(a)} />
          </div>
        </div>
      ))}
      <p className="muted small">{T("bm.attr")}</p>
      <p className="muted small">{T("bm.oaci")}</p>
    </div>
  );
}
