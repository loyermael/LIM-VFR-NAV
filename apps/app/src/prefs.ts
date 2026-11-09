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

export function saveUnitPrefs(prefs: UnitPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* navigation privée ou stockage bloqué : le choix vaut pour la session seulement */
  }
}
