import { useCallback, useEffect, useRef, useState } from "react";
import { FlightRecorder, GPS_MAX_USABLE_ACCURACY_M, canResume, type GpsFix, type TrackPoint } from "@lim/core";
import { tx } from "./db";

/** Une trace enregistrée sur l'appareil (IndexedDB, hors-ligne). */
export interface TrackRecord {
  readonly id: string;
  readonly name: string;
  readonly startMs: number;
  /** null tant que l'enregistrement est en cours. */
  readonly endMs: number | null;
  readonly takeoffMs: number | null;
  readonly landingMs: number | null;
  /** Enregistrement coupé sans fin normale (appli fermée, batterie…) : récupéré depuis la boîte noire. */
  readonly interrupted: boolean;
  /** Nombre de reprises après une coupure (appli relancée en vol), et secondes sans enregistrement au total. */
  readonly resumes?: number;
  readonly gapSeconds?: number;
  readonly points: readonly TrackPoint[];
}

export const loadTracks = (): Promise<TrackRecord[]> => tx("tracks", "readonly", (s) => s.getAll() as IDBRequest<TrackRecord[]>);
export const saveTrack = (t: TrackRecord): Promise<IDBValidKey> => tx("tracks", "readwrite", (s) => s.put(t));
export const deleteTrack = (id: string): Promise<undefined> => tx("tracks", "readwrite", (s) => s.delete(id));

const defaultName = (ms: number) => `Vol ${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Convertit une mesure GPS en point de trace ; null si inutilisable (imprécise). */
export function fixToPoint(fix: GpsFix, altitudeMsl: number | null): TrackPoint | null {
  if (fix.accuracy !== null && fix.accuracy > GPS_MAX_USABLE_ACCURACY_M) return null;
  return {
    t: fix.timeMs, lat: fix.position.lat, lon: fix.position.lon, alt: altitudeMsl,
    gs: fix.groundSpeed, trk: fix.track,
  };
}

/** Une trace qui était « ouverte » au dernier arrêt de l'appli : fermée et marquée interrompue (boîte noire). */
export function closeInterrupted(t: TrackRecord): TrackRecord {
  if (t.endMs !== null) return t;
  const last = t.points[t.points.length - 1];
  return { ...t, endMs: last ? last.t : t.startMs, interrupted: true };
}

/** Trace interrompue que ce premier point prolonge (la plus récente), ou null. */
export function findResumable(tracks: readonly TrackRecord[], first: TrackPoint): TrackRecord | null {
  let best: TrackRecord | null = null;
  for (const t of tracks) {
    const last = t.points[t.points.length - 1];
    if (!t.interrupted || !last || !canResume(last, first)) continue;
    if (!best || (t.endMs ?? 0) > (best.endMs ?? 0)) best = t;
  }
  return best;
}

/** Recolle les points d'un nouvel enregistrement à la trace interrompue : points, décollage d'origine, trous cumulés. */
export function mergeResumed(old: TrackRecord, newPoints: readonly TrackPoint[], newTakeoffMs: number | null): { points: TrackPoint[]; takeoffMs: number | null; resumes: number; gapSeconds: number } {
  const lastOld = old.points[old.points.length - 1] as TrackPoint;
  const firstNew = newPoints[0] as TrackPoint;
  return {
    points: [...old.points, ...newPoints],
    takeoffMs: old.takeoffMs ?? newTakeoffMs,
    resumes: (old.resumes ?? 0) + 1,
    gapSeconds: (old.gapSeconds ?? 0) + Math.round((firstNew.t - lastOld.t) / 1000),
  };
}

const SAVE_EVERY_MS = 15_000;

/**
 * Enregistrement automatique des traces : détecte décollage et atterrissage, écrit la trace sur l'appareil toutes les
 * 15 s (boîte noire : après une coupure, la trace est récupérée jusqu'à 15 s près), démarrage et arrêt manuels possibles.
 */
export function useRecorder(fix: GpsFix | null, altitudeMsl: number | null) {
  const rec = useRef(new FlightRecorder());
  const current = useRef<{ id: string; startMs: number; name: string } | null>(null);
  const dirty = useRef(false);
  const resumeInfo = useRef<{ resumes: number; gapSeconds: number } | null>(null);
  const tracksRef = useRef<TrackRecord[]>([]);
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [recording, setRecording] = useState(false);
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  tracksRef.current = tracks;

  const snapshot = (open: boolean): TrackRecord | null => {
    const c = current.current;
    if (!c) return null;
    const pts = rec.current.points;
    return {
      id: c.id, name: c.name, startMs: c.startMs, endMs: open ? null : ((pts[pts.length - 1] as TrackPoint | undefined)?.t ?? c.startMs),
      takeoffMs: rec.current.takeoffMs, landingMs: rec.current.landingMs, interrupted: false, points: pts,
      ...(resumeInfo.current ?? {}),
    };
  };
  const persist = (open: boolean) => {
    const s = snapshot(open);
    if (!s) return;
    dirty.current = false;
    setTracks((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]));
    void saveTrack(s).catch(() => undefined);
  };

  useEffect(() => {
    loadTracks()
      .then((all) => {
        const fixed = all.map(closeInterrupted);
        fixed.forEach((t, i) => t !== all[i] && void saveTrack(t).catch(() => undefined));
        setTracks(fixed);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const begin = () => {
    const startMs = Date.now();
    current.current = { id: crypto.randomUUID(), startMs, name: defaultName(startMs) };
  };

  useEffect(() => {
    if (!fix || !loaded) return;
    const p = fixToPoint(fix, altitudeMsl);
    if (!p) return;
    const ev = rec.current.push(p);
    if (ev === "started") {
      // Appli relancée en vol peu après une coupure : on prolonge la trace interrompue au lieu d'en ouvrir une nouvelle.
      const prev = findResumable(tracksRef.current, rec.current.points[0] as TrackPoint);
      if (prev) {
        const m = mergeResumed(prev, rec.current.points, rec.current.takeoffMs);
        current.current = { id: prev.id, startMs: prev.startMs, name: prev.name };
        rec.current.points = m.points;
        rec.current.takeoffMs = m.takeoffMs;
        resumeInfo.current = { resumes: m.resumes, gapSeconds: m.gapSeconds };
      } else {
        begin();
        resumeInfo.current = null;
        (current.current as { startMs: number }).startMs = (rec.current.points[0] as TrackPoint).t;
      }
      setRecording(true);
      persist(true);
    } else if (ev === "ended") {
      persist(false);
      setRecording(false);
      current.current = null;
      resumeInfo.current = null;
    } else if (rec.current.state === "recording") dirty.current = true;
    setCount(rec.current.points.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, loaded]);

  useEffect(() => {
    const id = setInterval(() => dirty.current && rec.current.state === "recording" && persist(true), SAVE_EVERY_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    if (rec.current.state === "recording") return;
    rec.current.startManual();
    begin();
    setRecording(true);
    persist(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const stop = useCallback(() => {
    if (rec.current.state !== "recording") return;
    rec.current.stop();
    persist(false);
    setRecording(false);
    current.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = useCallback((id: string) => {
    void deleteTrack(id).catch(() => undefined);
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const rename = useCallback((id: string, name: string) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? (() => { const n = { ...t, name }; void saveTrack(n).catch(() => undefined); return n; })() : t)));
  }, []);

  const activeId = current.current?.id ?? null;
  return { tracks, recording, count, activeId, takeoffMs: rec.current.takeoffMs, start, stop, remove, rename };
}
