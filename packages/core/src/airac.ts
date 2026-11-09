/**
 * Cycles AIRAC : l'information aéronautique est publiée tous les 28 jours, à date fixe.
 * Référence : le cycle 2001 est entré en vigueur le jeudi 2 janvier 2020 ; tous les autres s'en déduisent (28 j × n).
 * Identifiant « AAnn » : année de la date d'entrée en vigueur et rang du cycle dans cette année (2611 = 11e cycle de 2026).
 */

const DAY_MS = 86_400_000;
const CYCLE_MS = 28 * DAY_MS;
/** 2 janvier 2020, 00:00 UTC. */
const REFERENCE_MS = Date.UTC(2020, 0, 2);

export interface AiracCycle {
  /** « AAnn », ex. « 2611 ». */
  readonly id: string;
  /** Entrée en vigueur (00:00 UTC). */
  readonly start: Date;
  /** Cycle suivant (00:00 UTC) : le cycle courant se termine la veille. */
  readonly next: Date;
}

/** Cycle AIRAC en vigueur à la date donnée. */
export function airacCycleAt(date: Date): AiracCycle {
  const k = Math.floor((date.getTime() - REFERENCE_MS) / CYCLE_MS);
  const startMs = REFERENCE_MS + k * CYCLE_MS;
  const year = new Date(startMs).getUTCFullYear();
  // Rang : on remonte au premier cycle de la même année civile.
  let firstMs = startMs;
  while (new Date(firstMs - CYCLE_MS).getUTCFullYear() === year) firstMs -= CYCLE_MS;
  const rank = Math.round((startMs - firstMs) / CYCLE_MS) + 1;
  return {
    id: `${String(year % 100).padStart(2, "0")}${String(rank).padStart(2, "0")}`,
    start: new Date(startMs),
    next: new Date(startMs + CYCLE_MS),
  };
}

export interface DatasetFreshness {
  /** Âge de l'export en jours entiers. */
  readonly ageDays: number;
  /** Plus de 28 jours : au moins un cycle AIRAC a changé depuis. */
  readonly stale: boolean;
  /** L'export date d'avant l'entrée en vigueur du cycle courant. */
  readonly beforeCurrentCycle: boolean;
}

/** Fraîcheur d'un jeu de données daté (date d'export) par rapport à aujourd'hui et au cycle AIRAC courant. */
export function datasetFreshness(exportedAt: Date, now: Date): DatasetFreshness {
  const ageDays = Math.max(0, Math.floor((now.getTime() - exportedAt.getTime()) / DAY_MS));
  return {
    ageDays,
    stale: ageDays > 28,
    beforeCurrentCycle: exportedAt.getTime() < airacCycleAt(now).start.getTime(),
  };
}
