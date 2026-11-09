import { DEFAULT_ALTITUDE_SETTINGS, DEFAULT_UNIT_PREFS, parseStoredAltitude, parseUnitPrefs, type AltitudeSettings, type StoredAltitude, type UnitPrefs } from "@lim/core";

const KEY = "lim.unitPrefs.v1";

/** Lit les unités choisies. Stockage absent ou corrompu → défauts (l'app marche sans). */
export function loadUnitPrefs(): UnitPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseUnitPrefs(JSON.parse(raw)) : { ...DEFAULT_UNIT_PREFS };
  } catch {
    return { ...DEFAULT_UNIT_PREFS };
  }
}

export type GpsAltitudeRef = "msl" | "ellipsoid";
const ALT_KEY = "lim.gpsAltitudeRef.v1";

/** Référence de l'altitude renvoyée par le GPS de l'appareil (varie selon le modèle ; réglable). Défaut : niveau de la mer. */
export function loadGpsAltitudeRef(): GpsAltitudeRef {
  try {
    return localStorage.getItem(ALT_KEY) === "ellipsoid" ? "ellipsoid" : "msl";
  } catch {
    return "msl";
  }
}

export function saveGpsAltitudeRef(v: GpsAltitudeRef): void {
  try {
    localStorage.setItem(ALT_KEY, v);
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}

export function saveUnitPrefs(prefs: UnitPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* navigation privée ou stockage bloqué : le choix vaut pour la session seulement */
  }
}

const ALTITUDE_KEY = "lim.altitude.v1";

export interface AltitudeMemory extends StoredAltitude {
  /** Instants auxquels le QNH et le calage ont été réglés (pour les faire expirer). */
  readonly qnhSetAtMs: number;
  readonly offsetSetAtMs: number;
}

/** Relit mode, QNH et calage. Un QNH ou un calage de plus de 6 h est abandonné (voir core/altitude.ts). */
export function loadAltitude(nowMs: number): AltitudeMemory {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ALTITUDE_KEY) ?? "null");
    const parsed = parseStoredAltitude(raw, nowMs);
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      ...parsed,
      qnhSetAtMs: typeof o["qnhSetAtMs"] === "number" ? o["qnhSetAtMs"] : nowMs,
      offsetSetAtMs: typeof o["offsetSetAtMs"] === "number" ? o["offsetSetAtMs"] : nowMs,
    };
  } catch {
    return { settings: DEFAULT_ALTITUDE_SETTINGS, qnhExpired: false, qnhSetAtMs: nowMs, offsetSetAtMs: nowMs };
  }
}

export function saveAltitude(s: AltitudeSettings, qnhSetAtMs: number, offsetSetAtMs: number): void {
  try {
    localStorage.setItem(
      ALTITUDE_KEY,
      JSON.stringify({ mode: s.mode, source: s.source, qnhHpa: s.qnh / 100, qnhSetAtMs, offsetM: s.offset, offsetSetAtMs }),
    );
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}

const FIGURES_KEY = "lim.figuresColor.v1";

/** Chiffres de vol en couleur (défaut) ou tout en noir. */
export function loadFiguresColor(): boolean {
  try {
    return localStorage.getItem(FIGURES_KEY) !== "mono";
  } catch {
    return true;
  }
}

export function saveFiguresColor(color: boolean): void {
  try {
    localStorage.setItem(FIGURES_KEY, color ? "color" : "mono");
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}

const PERF_KEY = "lim.perf.v1";

/** Performances de croisière saisies par l'utilisateur. Aucune valeur par défaut : ce sont des données d'avion, pas des constantes. */
export interface StoredPerf {
  /** Vitesse propre, m/s. */
  readonly tasMps: number | null;
  /** Consommation, litres par heure. */
  readonly fuelFlowLph: number | null;
}

export function loadPerf(): StoredPerf {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PERF_KEY) ?? "null");
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    return { tasMps: pos(o["tasMps"]), fuelFlowLph: pos(o["fuelFlowLph"]) };
  } catch {
    return { tasMps: null, fuelFlowLph: null };
  }
}

export function savePerf(p: StoredPerf): void {
  try {
    localStorage.setItem(PERF_KEY, JSON.stringify(p));
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}
