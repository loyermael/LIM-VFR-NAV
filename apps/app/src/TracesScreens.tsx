import { useState } from "react";
import {
  exportTrackGPX, exportTrackIGC, exportTrackKML, formatQuantity, fromSI, pointAt, trackStats, unitLabel, type TrackPoint, type UnitPrefs,
} from "@lim/core";
import { NumField } from "./NavScreen";
import { Section } from "./Section";
import { t, type Key, type Lang } from "./i18n";
import { downloadFile, safeName } from "./download";
import { cdCancel, cdRemaining, cdStart, hms, swElapsed, swStart, swStop, STOPWATCH_ZERO, type Countdown, type Stopwatch } from "./timers";
import type { TrackRecord } from "./trackStore";

export interface ReplayState {
  readonly id: string;
  readonly t: number;
  readonly playing: boolean;
  readonly speed: number;
}
export const REPLAY_SPEEDS = [1, 2, 4, 8, 16, 32] as const;

interface TimersProps {
  lang: Lang;
  nowMs: number;
  recording: boolean;
  pointCount: number;
  takeoffMs: number | null;
  onStartRec: () => void;
  onStopRec: () => void;
  sw: Stopwatch;
  onSw: (s: Stopwatch) => void;
  cd: Countdown;
  onCd: (c: Countdown) => void;
}

/** Onglet « Chrono » : temps de vol, enregistrement, chronomètre et compte à rebours avec alarme. */
export function TimersTab(p: TimersProps) {
  const T = (k: Key) => t(p.lang, k);
  const [minutes, setMinutes] = useState<number | null>(p.cd.durationMs > 0 ? p.cd.durationMs / 60000 : null);
  const flightMs = p.takeoffMs !== null && p.recording ? p.nowMs - p.takeoffMs : null;
  const running = p.cd.endsAt !== null;
  return (
    <div className="navscreen">
      <h3>{T("tm.flight")}</h3>
      <div className="bigtime" aria-live="off">{hms(flightMs)}</div>
      <p className="muted small">{p.recording ? `${T("tm.recording")} · ${p.pointCount} ${T("tm.points")}` : T("tm.idle")}</p>
      <div className="choices">
        {p.recording
          ? <button className="brand" onClick={p.onStopRec}>{T("tm.stopRec")}</button>
          : <button onClick={p.onStartRec}>{T("tm.startRec")}</button>}
      </div>
      <p className="muted small">{T("tm.autoNote")}</p>

      <h3>{T("tm.stopwatch")}</h3>
      <div className="bigtime">{hms(swElapsed(p.sw, p.nowMs))}</div>
      <div className="choices">
        {p.sw.startedAt === null
          ? <button onClick={() => p.onSw(swStart(p.sw, p.nowMs))}>{T("tm.start")}</button>
          : <button className="brand" onClick={() => p.onSw(swStop(p.sw, p.nowMs))}>{T("tm.stop")}</button>}
        <button onClick={() => p.onSw(STOPWATCH_ZERO)}>{T("tm.reset")}</button>
      </div>

      <h3>{T("tm.countdown")}</h3>
      <div className="bigtime" role="timer">{hms(cdRemaining(p.cd, p.nowMs))}</div>
      {!running && (
        <div className="params">
          <NumField label={`${T("tm.minutes")}`} decimals={0} value={minutes} onCommit={(v) => { setMinutes(v); p.onCd({ ...p.cd, durationMs: v !== null && v > 0 ? Math.round(v * 60000) : 0 }); }} />
        </div>
      )}
      <div className="choices">
        {running
          ? <button className="brand" onClick={() => p.onCd(cdCancel(p.cd))}>{T("tm.cancel")}</button>
          : <button disabled={p.cd.durationMs <= 0} onClick={() => p.onCd(cdStart(p.cd, p.nowMs))}>{T("tm.start")}</button>}
      </div>
      <p className="muted small">{T("tm.alarmNote")}</p>
    </div>
  );
}

function Profile(p: { points: readonly TrackPoint[]; pick: (pt: TrackPoint) => number | null; unit: string; conv: (v: number) => number; cursorT: number | null; label: string }) {
  const W = 360, H = 90, L = 40, B = 14, T0 = 6, R = 6;
  const vals = p.points.map((pt) => p.pick(pt));
  const nums = vals.filter((v): v is number => v !== null).map(p.conv);
  if (p.points.length < 2 || nums.length < 2) return <p className="muted small">{p.label} : ---</p>;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1;
  const t0 = (p.points[0] as TrackPoint).t, t1 = (p.points[p.points.length - 1] as TrackPoint).t;
  const sx = (tm: number) => L + ((tm - t0) / (t1 - t0 || 1)) * (W - L - R);
  const sy = (v: number) => H - B - ((v - lo) / span) * (H - B - T0);
  const step = Math.max(1, Math.floor(p.points.length / 400));
  const d = p.points
    .map((pt, i) => ({ pt, v: vals[i] as number | null, i }))
    .filter((o) => o.v !== null && o.i % step === 0)
    .map((o, k) => `${k === 0 ? "M" : "L"}${sx(o.pt.t).toFixed(1)} ${sy(p.conv(o.v as number)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="balchart" role="img" aria-label={`${p.label} (${p.unit})`}>
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      {p.cursorT !== null && <line x1={sx(p.cursorT)} y1={T0} x2={sx(p.cursorT)} y2={H - B} stroke="var(--signal)" strokeWidth="1.5" />}
      <text x={L - 4} y={T0 + 8} fontSize="10" fontFamily="var(--font-mono)" textAnchor="end" fill="var(--ink-muted)">{Math.round(hi)}</text>
      <text x={L - 4} y={H - B} fontSize="10" fontFamily="var(--font-mono)" textAnchor="end" fill="var(--ink-muted)">{Math.round(lo)}</text>
      <text x={L} y={H - 2} fontSize="10" fontFamily="var(--font-mono)" fill="var(--ink-muted)">{p.label} ({p.unit})</text>
    </svg>
  );
}

/** Barre de rejeu : lecture / pause, vitesse, curseur de temps. Utilisée dans le détail d'une trace et sur la carte. */
export function ReplayBar(p: { lang: Lang; track: TrackRecord; replay: ReplayState; onChange: (r: ReplayState) => void; onClose?: () => void }) {
  const T = (k: Key) => t(p.lang, k);
  const first = (p.track.points[0] as TrackPoint | undefined)?.t ?? p.track.startMs;
  const last = (p.track.points[p.track.points.length - 1] as TrackPoint | undefined)?.t ?? first;
  const r = p.replay;
  return (
    <div className="replaybar">
      <div className="choices">
        <button className={r.playing ? "brand" : undefined} onClick={() => p.onChange({ ...r, playing: !r.playing, t: r.t >= last ? first : r.t })}>{r.playing ? T("tr.pause") : T("tr.play")}</button>
        {REPLAY_SPEEDS.map((s) => (
          <button key={s} aria-pressed={r.speed === s} onClick={() => p.onChange({ ...r, speed: s })}>×{s}</button>
        ))}
        {p.onClose && <button onClick={p.onClose}>{T("tr.closeReplay")}</button>}
      </div>
      <input type="range" min={first} max={last} step={1000} value={Math.min(Math.max(r.t, first), last)} aria-label={T("tr.cursor")} onChange={(e) => p.onChange({ ...r, t: Number(e.target.value), playing: false })} />
      <div className="mono small">{hms(r.t - first)} / {hms(last - first)}</div>
    </div>
  );
}

interface TracesProps {
  lang: Lang;
  prefs: UnitPrefs;
  tracks: readonly TrackRecord[];
  activeId: string | null;
  replay: ReplayState | null;
  registration: string;
  aircraftName: string;
  onReplay: (r: ReplayState | null) => void;
  onShowOnMap: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

/** Onglet « Traces » : liste, détail, export GPX / KML / IGC, profils et rejeu. */
export function TracesTab(p: TracesProps) {
  const T = (k: Key) => t(p.lang, k);
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirmClean, setConfirmClean] = useState(false);
  const toggle = (id: string) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sorted = [...p.tracks].sort((a, b) => b.startMs - a.startMs);
  const track = sel ? p.tracks.find((x) => x.id === sel) ?? null : null;
  const dist = (v: number) => `${formatQuantity("distance", p.prefs, v)} ${unitLabel("distance", p.prefs)}`;

  if (track) {
    const st = trackStats(track.points);
    const first = (track.points[0] as TrackPoint | undefined)?.t ?? track.startMs;
    const flying = track.takeoffMs !== null && track.landingMs !== null ? track.landingMs - track.takeoffMs : null;
    const base = safeName(track.name);
    const alt = (v: number) => fromSI("altitude", p.prefs, v);
    const spd = (v: number) => fromSI("groundSpeed", p.prefs, v);
    const rp = p.replay && p.replay.id === track.id ? p.replay : null;
    const isOpen = (id: string) => open.has(id) || (id === "replay" && rp !== null);
    return (
      <div className="navscreen">
        <div className="choices"><button onClick={() => { setSel(null); setConfirm(null); }}>← {T("tr.back")}</button></div>
        <h3 className="doctitle">{track.name}</h3>
        {track.id === p.activeId && <p className="muted small">{T("tr.inProgress")}</p>}
        {track.interrupted && <p className="error" role="alert">{T("tr.interrupted")}</p>}
        <table className="navlog"><tbody>
          <tr><td className="legname">{T("tr.date")}</td><td>{new Date(first).toISOString().replace("T", " ").slice(0, 16)} UTC</td></tr>
          <tr><td className="legname">{T("tr.flightTime")}</td><td>{flying === null ? "---" : hms(flying)}</td></tr>
          <tr><td className="legname">{T("tr.duration")}</td><td>{hms(st.duration * 1000)}</td></tr>
          <tr><td className="legname">{T("tr.distance")}</td><td>{dist(st.distance)}</td></tr>
          <tr><td className="legname">{T("tr.maxAlt")}</td><td>{st.maxAltitude === null ? "---" : `${formatQuantity("altitude", p.prefs, st.maxAltitude)} ${unitLabel("altitude", p.prefs)}`}</td></tr>
          <tr><td className="legname">{T("tr.maxGs")}</td><td>{st.maxGroundSpeed === null ? "---" : `${formatQuantity("groundSpeed", p.prefs, st.maxGroundSpeed)} ${unitLabel("groundSpeed", p.prefs)}`}</td></tr>
        </tbody></table>
        <div className="choices">
          <button className="brand" disabled={track.points.length < 2} onClick={() => { p.onReplay({ id: track.id, t: first, playing: true, speed: 4 }); p.onShowOnMap(); }}>{T("tr.replayMap")}</button>
        </div>

        {rp && (
          <Section plain id="replay" title={T("tr.replay")} ok open={isOpen("replay")} onToggle={toggle}>
            <ReplayBar lang={p.lang} track={track} replay={rp} onChange={p.onReplay} onClose={() => p.onReplay(null)} />
            {(() => { const q = pointAt(track.points, rp.t); return q ? <p className="mono small">{q.alt === null ? "---" : `${formatQuantity("altitude", p.prefs, q.alt)} ${unitLabel("altitude", p.prefs)}`} · {q.gs === null ? "---" : `${formatQuantity("groundSpeed", p.prefs, q.gs)} ${unitLabel("groundSpeed", p.prefs)}`}</p> : null; })()}
          </Section>
        )}
        <Section plain id="profiles" title={T("tr.profiles")} ok open={isOpen("profiles")} onToggle={toggle}>
          <Profile points={track.points} pick={(pt) => pt.alt} unit={unitLabel("altitude", p.prefs)} conv={alt} cursorT={rp?.t ?? null} label={T("tr.altitude")} />
          <Profile points={track.points} pick={(pt) => pt.gs} unit={unitLabel("groundSpeed", p.prefs)} conv={spd} cursorT={rp?.t ?? null} label={T("tr.speed")} />
        </Section>
        <Section plain id="export" title={T("tr.export")} ok open={isOpen("export")} onToggle={toggle}>
          <div className="choices">
            <button onClick={() => downloadFile(`${base}.gpx`, exportTrackGPX(track.name, track.points), "application/gpx+xml")}>GPX</button>
            <button onClick={() => downloadFile(`${base}.kml`, exportTrackKML(track.name, track.points), "application/vnd.google-earth.kml+xml")}>KML</button>
            <button onClick={() => downloadFile(`${base}.igc`, exportTrackIGC(track.points, { aircraftType: p.aircraftName, registration: p.registration }), "text/plain")}>IGC</button>
          </div>
          <p className="muted small">{T("tr.igcNote")}</p>
        </Section>
        <Section plain id="rename" title={T("tr.rename")} ok open={isOpen("rename")} onToggle={toggle}>
          <label className="numfield">
            <span>{T("nav.name")}</span>
            <input className="field" defaultValue={track.name} key={track.id} onBlur={(e) => e.target.value.trim() && p.onRename(track.id, e.target.value.trim())} />
          </label>
          <p className="muted small">{track.points.length} {T("tr.points")}</p>
        </Section>
        <div className="choices">
          {confirm === track.id
            ? <button className="brand" onClick={() => { p.onRemove(track.id); setSel(null); setConfirm(null); if (rp) p.onReplay(null); }}>{T("tr.confirmDelete")}</button>
            : <button onClick={() => setConfirm(track.id)}>{T("nav.delete")}</button>}
        </div>
      </div>
    );
  }

  // Liste : regroupée par mois, la plus récente d'abord.
  const month = (ms: number) => new Date(ms).toLocaleDateString(p.lang === "fr" ? "fr-FR" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  // Traces de moins de 2 minutes (essais, redémarrages) : proposées au nettoyage, jamais supprimées d'office.
  const short = sorted.filter((x) => x.id !== p.activeId && trackStats(x.points).duration < 120);
  const groups = new Map<string, TrackRecord[]>();
  for (const x of sorted) groups.set(month(x.startMs), [...(groups.get(month(x.startMs)) ?? []), x]);
  return (
    <div className="navscreen">
      {sorted.length === 0 && <p className="muted">{T("tr.none")}</p>}
      {short.length > 0 && (
        <div className="choices">
          {confirmClean
            ? <button className="brand" onClick={() => { short.forEach((x) => p.onRemove(x.id)); setConfirmClean(false); }}>{T("tr.cleanConfirm")} ({short.length})</button>
            : <button onClick={() => setConfirmClean(true)}>{T("tr.clean")} ({short.length})</button>}
        </div>
      )}
      {[...groups.entries()].map(([m, list]) => (
        <div key={m}>
          <h3>{m}</h3>
          {list.map((x) => {
            const s = trackStats(x.points);
            return (
              <button className="trackcard" key={x.id} onClick={() => setSel(x.id)}>
                <b>{x.name}</b>
                <span className="muted small">
                  {hms(s.duration * 1000)} · {dist(s.distance)}{x.interrupted ? ` · ${T("tr.interruptedShort")}` : ""}{x.id === p.activeId ? ` · ${T("tr.inProgressShort")}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <p className="muted small">{T("tr.note")}</p>
    </div>
  );
}
