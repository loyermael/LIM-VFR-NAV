import { DEFAULT_UNIT_PREFS, parseUnitPrefs, type UnitPrefs } from "@lim/core";

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
