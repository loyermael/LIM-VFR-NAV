/** Chronomètres : fonctions pures (testées), l'horloge est toujours donnée en paramètre. */

export interface Stopwatch {
  /** Instant de démarrage (ms) si en marche, sinon null. */
  readonly startedAt: number | null;
  /** Temps accumulé avant le dernier démarrage (ms). */
  readonly accMs: number;
}
export const STOPWATCH_ZERO: Stopwatch = { startedAt: null, accMs: 0 };
export const swElapsed = (s: Stopwatch, now: number): number => s.accMs + (s.startedAt === null ? 0 : Math.max(0, now - s.startedAt));
export const swStart = (s: Stopwatch, now: number): Stopwatch => (s.startedAt === null ? { ...s, startedAt: now } : s);
export const swStop = (s: Stopwatch, now: number): Stopwatch => (s.startedAt === null ? s : { startedAt: null, accMs: swElapsed(s, now) });

export interface Countdown {
  /** Durée choisie (ms). */
  readonly durationMs: number;
  /** Instant de fin (ms) si en marche, sinon null. */
  readonly endsAt: number | null;
  /** Vrai une fois l'alarme déclenchée. */
  readonly fired: boolean;
}
export const cdRemaining = (c: Countdown, now: number): number => (c.endsAt === null ? c.durationMs : Math.max(0, c.endsAt - now));
export const cdStart = (c: Countdown, now: number): Countdown => (c.durationMs > 0 ? { ...c, endsAt: now + c.durationMs, fired: false } : c);
export const cdCancel = (c: Countdown): Countdown => ({ ...c, endsAt: null, fired: false });
/** Vrai à l'instant où l'alarme doit sonner (une seule fois). */
export const cdDue = (c: Countdown, now: number): boolean => c.endsAt !== null && !c.fired && now >= c.endsAt;

/** « 1:05:09 » ou « 05:09 » ; « --:-- » si la valeur est invalide. */
export function hms(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "--:--";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Avance l'instant de rejeu de `dtMs` réels à la vitesse `speed`, borné à la trace ; `ended` vrai en bout de trace. */
export function advanceReplay(t: number, dtMs: number, speed: number, startMs: number, endMs: number): { t: number; ended: boolean } {
  const next = t + dtMs * speed;
  return next >= endMs ? { t: endMs, ended: true } : { t: Math.max(startMs, next), ended: false };
}

/** Bip d'alarme (WebAudio) et vibration : sans effet, sans erreur, là où ce n'est pas disponible. */
export function alarm(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.3;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.4);
        o.stop(ctx.currentTime + i * 0.4 + 0.2);
      }
      setTimeout(() => void ctx.close(), 2500);
    }
    navigator.vibrate?.([300, 150, 300, 150, 300]);
  } catch {
    /* pas d'audio : la bannière reste visible */
  }
}
