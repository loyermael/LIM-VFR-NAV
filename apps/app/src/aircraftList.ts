import type { Aircraft } from "@lim/core";

/** Tri de la liste d'avions : immatriculation A→Z, nom A→Z, ou dernière modification. */
export type AircraftSort = "reg" | "name" | "recent";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Un avion correspond si chaque mot de la recherche figure dans l'immatriculation ou le nom (sans accents ni casse). */
export function matchesAircraft(a: Pick<Aircraft, "registration" | "name">, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = fold(`${a.registration ?? ""} ${a.name}`);
  return words.every((w) => hay.includes(w));
}

/**
 * Liste affichée : l'avion choisi toujours en tête (même s'il ne correspond pas à la recherche),
 * puis les autres, filtrés par la recherche et triés.
 */
export function listAircraft(list: readonly Aircraft[], activeId: string | null, query: string, sort: AircraftSort): Aircraft[] {
  const cmp = (x: string, y: string) => x.localeCompare(y, "fr", { numeric: true, sensitivity: "base" });
  const key = (a: Aircraft) => (sort === "name" ? a.name : (a.registration ?? "") || a.name);
  const rest = list
    .filter((a) => a.id !== activeId && matchesAircraft(a, query))
    .sort((a, b) => (sort === "recent" ? b.updatedAt - a.updatedAt || cmp(key(a), key(b)) : cmp(key(a), key(b)) || cmp(a.name, b.name)));
  const active = list.find((a) => a.id === activeId);
  return active ? [active, ...rest] : rest;
}
