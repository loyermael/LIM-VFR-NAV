import { useCallback, useEffect, useState } from "react";
import type { Aircraft, Loads } from "@lim/core";
import { tx } from "./db";

/** Fiches avion mémorisées sur l'appareil (IndexedDB) : disponibles hors-ligne. */
export const loadAircraft = (): Promise<Aircraft[]> => tx("aircraft", "readonly", (s) => s.getAll() as IDBRequest<Aircraft[]>);
export const saveAircraft = (a: Aircraft): Promise<IDBValidKey> => tx("aircraft", "readwrite", (s) => s.put(a));
export const deleteAircraft = (id: string): Promise<undefined> => tx("aircraft", "readwrite", (s) => s.delete(id));

export interface FuelPlanParams {
  readonly taxiLiters: number;
  readonly contingencyPercent: number;
  readonly alternateMinutes: number;
  readonly reserveMinutes: number;
}

/**
 * Valeurs de départ du plan de carburant. Ce sont des réglages à CONFIRMER par le pilote selon sa réglementation
 * et sa politique de sécurité, pas des exigences : JUGÉ. Roulage 0 : à renseigner.
 */
export const DEFAULT_FUEL_PLAN: FuelPlanParams = { taxiLiters: 0, contingencyPercent: 10, alternateMinutes: 0, reserveMinutes: 30 };

const ACTIVE_KEY = "lim.aircraft.active.v1";
const LOADS_KEY = "lim.aircraft.loads.v1";
const PLAN_KEY = "lim.fuelplan.v1";

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}

export function parseLoads(raw: unknown): Record<string, Loads> {
  const out: Record<string, Loads> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [aid, l] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof l !== "object" || l === null) continue;
    const loads: Record<string, number> = {};
    for (const [sid, v] of Object.entries(l as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) loads[sid] = v;
    out[aid] = loads;
  }
  return out;
}

export function parseFuelPlan(raw: unknown): FuelPlanParams {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof FuelPlanParams) => (typeof o[k] === "number" && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : DEFAULT_FUEL_PLAN[k]);
  return { taxiLiters: n("taxiLiters"), contingencyPercent: n("contingencyPercent"), alternateMinutes: n("alternateMinutes"), reserveMinutes: n("reserveMinutes") };
}

/** État des fiches avion, des charges saisies par avion et des paramètres du plan de carburant. */
export function useAircraft() {
  const [list, setList] = useState<Aircraft[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [loadsByAircraft, setLoadsByAircraft] = useState<Record<string, Loads>>(() => parseLoads(readJson(LOADS_KEY)));
  const [plan, setPlan] = useState<FuelPlanParams>(() => parseFuelPlan(readJson(PLAN_KEY)));

  useEffect(() => {
    loadAircraft().then(setList).catch(() => setList([]));
  }, []);

  const put = useCallback((a: Aircraft) => {
    setList((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a]));
    void saveAircraft(a).catch(() => undefined);
  }, []);
  const remove = useCallback((id: string) => {
    void deleteAircraft(id).catch(() => undefined);
    setList((prev) => prev.filter((x) => x.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);
  const select = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id === null) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* stockage bloqué */
    }
  }, []);
  const setLoads = useCallback((aircraftId: string, loads: Loads) => {
    setLoadsByAircraft((prev) => {
      const next = { ...prev, [aircraftId]: loads };
      writeJson(LOADS_KEY, next);
      return next;
    });
  }, []);
  const updatePlan = useCallback((p: FuelPlanParams) => {
    setPlan(p);
    writeJson(PLAN_KEY, p);
  }, []);

  const active = list.find((a) => a.id === activeId) ?? null;
  return { list, active, activeId, put, remove, select, loads: active ? (loadsByAircraft[active.id] ?? {}) : {}, setLoads, plan, updatePlan };
}
