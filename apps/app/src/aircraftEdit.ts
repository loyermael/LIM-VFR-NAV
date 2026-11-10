/**
 * Édition d'une fiche avion : fonctions pures (testées) qui retournent une nouvelle fiche.
 * Une fiche neuve est VIDE (aucune valeur d'avion par défaut) : l'utilisateur la remplit depuis le manuel de vol
 * et la fiche de pesée de son appareil.
 */
import type { Aircraft, LoadStation, StationKind } from "@lim/core";

export function newAircraft(id: string, name: string, now: number): Aircraft {
  const st = (sid: string, n: string, kind: StationKind): LoadStation => ({ id: `${id}-${sid}`, name: n, kind, arm: 0, maxMass: null });
  return {
    id,
    name,
    registration: "",
    tasMps: null,
    fuelFlowLph: null,
    fuel: { capacity: 0, unusable: 0, density: 0.72 },
    emptyMass: 0,
    emptyArm: 0,
    stations: [st("pilot", "Pilote", "occupant"), st("pax", "Passager", "occupant"), st("bag", "Bagages", "baggage"), st("fuel", "Carburant", "fuel")],
    envelope: [],
    maxTakeoffMass: 0,
    maxLandingMass: null,
    updatedAt: now,
  };
}

const touch = (a: Aircraft, patch: Partial<Aircraft>, now: number): Aircraft => ({ ...a, ...patch, updatedAt: now });

export const patchAircraft = (a: Aircraft, patch: Partial<Aircraft>, now: number): Aircraft => touch(a, patch, now);

export function patchFuel(a: Aircraft, patch: Partial<Aircraft["fuel"]>, now: number): Aircraft {
  return touch(a, { fuel: { ...a.fuel, ...patch } }, now);
}

export function addStation(a: Aircraft, id: string, now: number): Aircraft {
  return touch(a, { stations: [...a.stations, { id, name: "Poste", kind: "other", arm: 0, maxMass: null }] }, now);
}

export function patchStation(a: Aircraft, index: number, patch: Partial<LoadStation>, now: number): Aircraft {
  if (index < 0 || index >= a.stations.length) return a;
  return touch(a, { stations: a.stations.map((s, i) => (i === index ? { ...s, ...patch } : s)) }, now);
}

export function removeStation(a: Aircraft, index: number, now: number): Aircraft {
  if (index < 0 || index >= a.stations.length) return a;
  return touch(a, { stations: a.stations.filter((_, i) => i !== index) }, now);
}

export function addVertex(a: Aircraft, arm: number, mass: number, now: number): Aircraft {
  return touch(a, { envelope: [...a.envelope, [arm, mass]] }, now);
}

export function patchVertex(a: Aircraft, index: number, arm: number, mass: number, now: number): Aircraft {
  if (index < 0 || index >= a.envelope.length) return a;
  return touch(a, { envelope: a.envelope.map((v, i) => (i === index ? ([arm, mass] as const) : v)) }, now);
}

export function removeVertex(a: Aircraft, index: number, now: number): Aircraft {
  if (index < 0 || index >= a.envelope.length) return a;
  return touch(a, { envelope: a.envelope.filter((_, i) => i !== index) }, now);
}

/**
 * Range les sommets de l'enveloppe en polygone (tri par angle autour du centre) : l'utilisateur peut les saisir dans
 * n'importe quel ordre. Valable pour une enveloppe convexe ou « en étoile » (cas habituel) ; à vérifier sur le graphique.
 */
export function orderEnvelope(a: Aircraft, now: number): Aircraft {
  const n = a.envelope.length;
  if (n < 3) return a;
  const cx = a.envelope.reduce((s, v) => s + v[0], 0) / n;
  // Échelle : le bras (m) et la masse (kg) n'ont pas la même unité, on normalise par l'étendue de chaque axe.
  const spanX = Math.max(...a.envelope.map((v) => v[0])) - Math.min(...a.envelope.map((v) => v[0])) || 1;
  const spanY = Math.max(...a.envelope.map((v) => v[1])) - Math.min(...a.envelope.map((v) => v[1])) || 1;
  const cy = a.envelope.reduce((s, v) => s + v[1], 0) / n;
  const ang = (v: readonly [number, number]) => Math.atan2((v[1] - cy) / spanY, (v[0] - cx) / spanX);
  return touch(a, { envelope: [...a.envelope].sort((p, q) => ang(p) - ang(q)) }, now);
}

export function duplicateAircraft(a: Aircraft, newId: string, now: number): Aircraft {
  // Les identifiants de postes sont propres à la fiche : on les renouvelle pour ne pas mélanger les charges mémorisées.
  return { ...a, id: newId, name: `${a.name} (copie)`, stations: a.stations.map((s) => ({ ...s, id: `${newId}-${s.id.split("-").pop()}` })), updatedAt: now };
}

/** Surface d'un polygone (m·kg), pour vérifier qu'il n'est pas dégénéré ; formule des lacets. */
export function envelopeArea(a: Pick<Aircraft, "envelope">): number {
  const e = a.envelope;
  let s = 0;
  for (let i = 0; i < e.length; i++) {
    const [x1, y1] = e[i] as readonly [number, number];
    const [x2, y2] = e[(i + 1) % e.length] as readonly [number, number];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
