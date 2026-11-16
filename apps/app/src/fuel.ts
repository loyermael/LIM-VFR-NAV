import { formatQuantity, planFuel, unitLabel, type Aircraft, type Loads, type NavLog, type UnitPrefs } from "@lim/core";
import type { FuelPlanParams } from "./aircraftStore";

/**
 * Source unique des chiffres carburant : le log de nav, l'avion, ses charges et les réglages donnent UNE fiche (`FuelSheet`, en litres),
 * puis `formatFuel` en tire les textes affichés. Le log, la page Carburant, le Centrage et les PDF lisent tous cette fiche et ne recalculent rien.
 */

/** Temps de vol retenu pour le trajet : avec vent s'il est calculable sur toute la route, sinon sans vent. */
export type TripBasis = "wind" | "nowind";

export interface FuelSheet {
  /** Réglages utilisés (roulage, aléas, déroutement, réserve). */
  readonly plan: FuelPlanParams;
  /** Consommation de croisière (L/h), null si inconnue. */
  readonly flow: number | null;
  /** Vrai si l'avion a un réservoir (poste carburant) où saisir l'embarqué. */
  readonly hasTank: boolean;
  readonly tripBasis: TripBasis | null;
  readonly tripSec: number | null;
  /** Consommation du trajet (L). */
  readonly trip: number | null;
  readonly taxi: number;
  readonly contingency: number | null;
  readonly alternate: number | null;
  readonly reserve: number | null;
  /** Total nécessaire (L). */
  readonly required: number | null;
  /** Embarqué (L), 0 si non renseigné. */
  readonly onboard: number;
  /** Capacité utilisable (L) : capacité moins l'inutilisable. */
  readonly capacity: number;
  /** Embarqué − nécessaire (L). */
  readonly surplus: number | null;
  /** À l'arrivée : embarqué − roulage − trajet (L, jamais négatif) ; null si rien d'embarqué ou trajet inconnu. */
  readonly arrival: number | null;
  /** Carburant brûlé du roulage à l'atterrissage (L) : sert au centrage à l'atterrissage. */
  readonly burnToLanding: number | null;
  /** Autonomie totale (s) : embarqué ÷ consommation. */
  readonly enduranceTotalSec: number | null;
  /** Autonomie utilisable (s) : hors roulage et réserve finale. */
  readonly enduranceUsableSec: number | null;
  readonly sufficient: boolean | null;
  readonly overCapacity: boolean;
}

export interface FuelInput {
  readonly log: NavLog | null;
  readonly aircraft: Aircraft | null;
  readonly loads: Loads;
  readonly plan: FuelPlanParams;
}

export function computeFuelSheet(i: FuelInput): FuelSheet {
  const a = i.aircraft;
  const flow = a && a.fuelFlowLph !== null && a.fuelFlowLph > 0 ? a.fuelFlowLph : null;
  const tank = a?.stations.find((s) => s.kind === "fuel") ?? null;
  const onboard = a && tank ? (i.loads[tank.id] ?? 0) : 0;
  const withWind = i.log?.totals.timeWithWind ?? null;
  const tripBasis: TripBasis | null = !i.log || flow === null ? null : withWind !== null ? "wind" : "nowind";
  const tripSec = tripBasis === null || !i.log ? null : tripBasis === "wind" ? (withWind as number) : (i.log.totals.timeNoWind as number);
  const trip = flow === null || tripSec === null ? null : (flow * tripSec) / 3600;
  const capacity = a ? Math.max(0, a.fuel.capacity - a.fuel.unusable) : 0;
  const p = planFuel({
    tripLiters: trip, taxiLiters: i.plan.taxiLiters, contingencyPercent: i.plan.contingencyPercent, alternateMinutes: i.plan.alternateMinutes,
    reserveMinutes: i.plan.reserveMinutes, fuelFlowLph: flow, onboardLiters: onboard, usableCapacityLiters: capacity,
  });
  const usable = flow === null || p.reserve === null ? null : (Math.max(0, onboard - p.taxi - p.reserve) / flow) * 3600;
  return {
    plan: i.plan,
    flow,
    hasTank: tank !== null,
    tripBasis,
    tripSec,
    trip,
    taxi: p.taxi,
    contingency: p.contingency,
    alternate: p.alternate,
    reserve: p.reserve,
    required: p.required,
    onboard,
    capacity,
    surplus: p.surplus,
    arrival: onboard > 0 && trip !== null ? Math.max(0, onboard - p.taxi - trip) : null,
    burnToLanding: trip === null ? null : p.taxi + trip,
    enduranceTotalSec: p.endurance === null ? null : p.endurance * 3600,
    enduranceUsableSec: usable,
    sufficient: p.sufficient,
    overCapacity: p.overCapacity,
  };
}

/** Durée en h:mm (minute la plus proche) ; « — » si inconnue. */
export function formatHm(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return "—";
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Textes affichés partout (litres avec unité, 1 décimale ; durées en h:mm). */
export interface FuelView {
  readonly unit: string;
  readonly onboard: string;
  readonly capacity: string;
  readonly trip: string;
  readonly taxi: string;
  readonly contingency: string;
  readonly alternate: string;
  readonly reserve: string;
  readonly required: string;
  readonly surplus: string;
  readonly arrival: string;
  readonly enduranceTotal: string;
  readonly enduranceUsable: string;
  readonly flow: string;
  /** Formate un volume quelconque (litres SI) comme les autres. */
  readonly fmt: (liters: number | null) => string;
}

export function formatFuel(s: FuelSheet, prefs: UnitPrefs): FuelView {
  const unit = unitLabel("fuel", prefs);
  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${formatQuantity("fuel", prefs, v)} ${unit}`);
  return {
    unit,
    onboard: fmt(s.onboard),
    capacity: fmt(s.capacity),
    trip: fmt(s.trip),
    taxi: fmt(s.taxi),
    contingency: fmt(s.contingency),
    alternate: fmt(s.alternate),
    reserve: fmt(s.reserve),
    required: fmt(s.required),
    surplus: fmt(s.surplus),
    arrival: fmt(s.arrival),
    enduranceTotal: formatHm(s.enduranceTotalSec),
    enduranceUsable: formatHm(s.enduranceUsableSec),
    flow: s.flow === null ? "—" : `${formatQuantity("fuel", prefs, s.flow)} ${unit}/h`,
    fmt,
  };
}
