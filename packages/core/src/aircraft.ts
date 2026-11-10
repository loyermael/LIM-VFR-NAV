/**
 * Fiche avion, masse et centrage, planification du carburant.
 *
 * AUCUNE donnée d'avion n'est fournie par l'application : masse à vide, bras, enveloppe, consommation viennent de la fiche
 * saisie par l'utilisateur (manuel de vol et fiche de pesée de SON appareil). Un calcul n'a de valeur que si la fiche est exacte.
 *
 * Unités internes : masses en kg, bras de levier en mètres depuis le plan de référence, moments en kg·m, carburant en litres.
 * Le centre de gravité (CG) est exprimé par son bras en mètres.
 */

export type StationKind = "occupant" | "baggage" | "fuel" | "other";

export interface LoadStation {
  readonly id: string;
  readonly name: string;
  readonly kind: StationKind;
  /** Bras de levier (m). */
  readonly arm: number;
  /** Charge maximale (kg) ; pour un réservoir : ignorée (la limite est la capacité en litres). */
  readonly maxMass: number | null;
}

export interface Aircraft {
  readonly id: string;
  readonly name: string;
  readonly registration: string;
  /** Vitesse propre de croisière (m/s) et consommation de croisière (L/h) : alimentent le log de nav. */
  readonly tasMps: number | null;
  readonly fuelFlowLph: number | null;
  readonly fuel: {
    /** Capacité totale (L) et part inutilisable (L). */
    readonly capacity: number;
    readonly unusable: number;
    /** Masse volumique (kg/L). */
    readonly density: number;
  };
  readonly emptyMass: number;
  /** Bras du CG à vide (m). */
  readonly emptyArm: number;
  readonly stations: readonly LoadStation[];
  /** Enveloppe : sommets [bras (m), masse (kg)], polygone fermé ou non. */
  readonly envelope: readonly (readonly [number, number])[];
  readonly maxTakeoffMass: number;
  readonly maxLandingMass: number | null;
  readonly updatedAt: number;
}

/** Charges saisies : kg par poste ; pour un poste carburant : LITRES. */
export type Loads = Readonly<Record<string, number>>;

export type BalanceIssue =
  | "overweight"
  | "overweight-landing"
  | "cg-forward"
  | "cg-aft"
  | "outside-envelope"
  | "station-overload"
  | "fuel-over-capacity"
  | "negative-load";

export interface BalanceState {
  /** Masse totale (kg). */
  readonly mass: number;
  /** Moment total (kg·m). */
  readonly moment: number;
  /** Bras du CG (m). */
  readonly cg: number;
  readonly inEnvelope: boolean;
  /** Limites avant et arrière de l'enveloppe à cette masse (m), null si la masse sort de la plage de l'enveloppe. */
  readonly limits: { readonly forward: number; readonly aft: number } | null;
  /** Marge au plus proche des deux limites (m), négative si dehors ; null si la masse sort de la plage. */
  readonly cgMargin: number | null;
  readonly issues: readonly BalanceIssue[];
}

export interface BalanceResult {
  readonly zeroFuel: BalanceState;
  readonly takeoff: BalanceState;
  readonly landing: BalanceState;
  /** Détail par poste au décollage. */
  readonly lines: readonly { readonly station: LoadStation; readonly mass: number; readonly moment: number }[];
  readonly emptyMoment: number;
  readonly fuelLiters: { readonly takeoff: number; readonly landing: number };
}

const fuelStations = (a: Aircraft) => a.stations.filter((s) => s.kind === "fuel");

/** Bras minimal et maximal de l'enveloppe à la masse donnée (intersection d'une droite horizontale avec le polygone). */
export function envelopeLimitsAt(envelope: readonly (readonly [number, number])[], mass: number): { forward: number; aft: number } | null {
  const xs: number[] = [];
  const n = envelope.length;
  for (let i = 0; i < n; i++) {
    const [x1, m1] = envelope[i] as readonly [number, number];
    const [x2, m2] = envelope[(i + 1) % n] as readonly [number, number];
    if (m1 === m2) {
      if (m1 === mass) xs.push(x1, x2); // segment horizontal exactement à cette masse
      continue;
    }
    if ((m1 <= mass && mass <= m2) || (m2 <= mass && mass <= m1)) xs.push(x1 + ((mass - m1) / (m2 - m1)) * (x2 - x1));
  }
  return xs.length === 0 ? null : { forward: Math.min(...xs), aft: Math.max(...xs) };
}

/** Un point (bras, masse) est-il dans l'enveloppe (bord compris, à la tolérance numérique près) ? */
export function insideEnvelope(envelope: readonly (readonly [number, number])[], arm: number, mass: number): boolean {
  const lim = envelopeLimitsAt(envelope, mass);
  if (lim) return arm >= lim.forward - 1e-9 && arm <= lim.aft + 1e-9;
  return false;
}

function stateOf(a: Aircraft, mass: number, moment: number, extra: BalanceIssue[], landing: boolean): BalanceState {
  const cg = mass > 0 ? moment / mass : NaN;
  const limits = Number.isFinite(cg) ? envelopeLimitsAt(a.envelope, mass) : null;
  const inside = Number.isFinite(cg) && insideEnvelope(a.envelope, cg, mass);
  const issues: BalanceIssue[] = [...extra];
  const limit = landing && a.maxLandingMass !== null ? a.maxLandingMass : a.maxTakeoffMass;
  if (mass > limit + 1e-9) issues.push(landing && a.maxLandingMass !== null ? "overweight-landing" : "overweight");
  if (!inside) {
    if (limits && cg < limits.forward) issues.push("cg-forward");
    else if (limits && cg > limits.aft) issues.push("cg-aft");
    else issues.push("outside-envelope");
  }
  return {
    mass,
    moment,
    cg,
    inEnvelope: inside,
    limits,
    cgMargin: limits && Number.isFinite(cg) ? Math.min(cg - limits.forward, limits.aft - cg) : null,
    issues,
  };
}

/**
 * Masse et centrage au point zéro carburant, au décollage et à l'atterrissage.
 * `fuelBurnL` : carburant consommé pendant le vol (L), retiré des réservoirs dans l'ordre de la fiche.
 * Un poste dont la charge dépasse sa limite, un réservoir au-delà de sa capacité ou une charge négative sont signalés.
 */
export function computeBalance(a: Aircraft, loads: Loads, fuelBurnL = 0): BalanceResult {
  const issues: BalanceIssue[] = [];
  const lines: { station: LoadStation; mass: number; moment: number }[] = [];
  let zfMass = a.emptyMass;
  let zfMoment = a.emptyMass * a.emptyArm;
  let fuelL = 0;
  const fuelSt = fuelStations(a);

  for (const s of a.stations) {
    const v = loads[s.id] ?? 0;
    if (!Number.isFinite(v) || v < 0) { issues.push("negative-load"); continue; }
    if (s.kind === "fuel") {
      const mass = v * a.fuel.density;
      fuelL += v;
      lines.push({ station: s, mass, moment: mass * s.arm });
    } else {
      if (s.maxMass !== null && v > s.maxMass + 1e-9) issues.push("station-overload");
      zfMass += v;
      zfMoment += v * s.arm;
      lines.push({ station: s, mass: v, moment: v * s.arm });
    }
  }
  if (fuelL > a.fuel.capacity + 1e-9) issues.push("fuel-over-capacity");

  // Carburant : masse et moment par réservoir.
  let toMass = zfMass, toMoment = zfMoment;
  for (const s of fuelSt) {
    const m = (loads[s.id] ?? 0) * a.fuel.density;
    toMass += m;
    toMoment += m * s.arm;
  }
  // Atterrissage : on retire la consommation des réservoirs dans l'ordre.
  let burn = Math.max(0, fuelBurnL);
  let ldMass = zfMass, ldMoment = zfMoment;
  const landingFuel: number[] = [];
  for (const s of fuelSt) {
    const have = loads[s.id] ?? 0;
    const used = Math.min(have, burn);
    burn -= used;
    const left = have - used;
    landingFuel.push(left);
    const m = left * a.fuel.density;
    ldMass += m;
    ldMoment += m * s.arm;
  }
  const landingL = landingFuel.reduce((x, y) => x + y, 0);

  return {
    zeroFuel: stateOf(a, zfMass, zfMoment, [], false),
    takeoff: stateOf(a, toMass, toMoment, issues, false),
    landing: stateOf(a, ldMass, ldMoment, [], true),
    lines,
    emptyMoment: a.emptyMass * a.emptyArm,
    fuelLiters: { takeoff: fuelL, landing: landingL },
  };
}

/** Vérifie qu'une fiche est utilisable pour un calcul ; retourne la liste des défauts (vide si elle l'est). */
export function validateAircraft(a: Aircraft): string[] {
  const p: string[] = [];
  if (!(a.emptyMass > 0)) p.push("masse à vide");
  if (!Number.isFinite(a.emptyArm)) p.push("bras à vide");
  if (!(a.maxTakeoffMass > a.emptyMass)) p.push("masse maximale au décollage (doit dépasser la masse à vide)");
  if (a.envelope.length < 3) p.push("enveloppe (au moins 3 sommets)");
  else if (a.envelope.some((v) => !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[1] <= 0)) p.push("enveloppe (sommets illisibles)");
  if (!(a.fuel.capacity >= 0) || !(a.fuel.density > 0)) p.push("carburant (capacité, masse volumique)");
  if (a.stations.length === 0) p.push("postes de chargement");
  return p;
}

/* ------------------------------------------------------------------ Carburant */

export interface FuelPlanInput {
  /** Carburant du trajet d'après le log de nav (L), ou null si le log n'est pas calculable. */
  readonly tripLiters: number | null;
  /** Roulage au départ (L). */
  readonly taxiLiters: number;
  /** Marge pour aléas, en % du carburant du trajet. */
  readonly contingencyPercent: number;
  /** Carburant pour le déroutement, en minutes de vol à la consommation de croisière. */
  readonly alternateMinutes: number;
  /** Réserve finale, en minutes de vol à la consommation de croisière. */
  readonly reserveMinutes: number;
  readonly fuelFlowLph: number | null;
  /** Carburant embarqué (L). */
  readonly onboardLiters: number;
  /** Carburant utilisable maximal (L) : capacité moins l'inutilisable. */
  readonly usableCapacityLiters: number;
}

export interface FuelPlan {
  readonly taxi: number;
  readonly trip: number | null;
  readonly contingency: number | null;
  readonly alternate: number | null;
  readonly reserve: number | null;
  /** Total nécessaire (L), null si le trajet ou la consommation sont inconnus. */
  readonly required: number | null;
  readonly onboard: number;
  /** Embarqué moins nécessaire (L) ; négatif = insuffisant. */
  readonly surplus: number | null;
  /** Autonomie avec le carburant embarqué (h), null si la consommation est inconnue. */
  readonly endurance: number | null;
  readonly sufficient: boolean | null;
  readonly overCapacity: boolean;
}

export function planFuel(i: FuelPlanInput): FuelPlan {
  const flow = i.fuelFlowLph !== null && i.fuelFlowLph > 0 ? i.fuelFlowLph : null;
  const trip = i.tripLiters;
  const contingency = trip === null ? null : (trip * Math.max(0, i.contingencyPercent)) / 100;
  const alternate = flow === null ? null : (flow * Math.max(0, i.alternateMinutes)) / 60;
  const reserve = flow === null ? null : (flow * Math.max(0, i.reserveMinutes)) / 60;
  const taxi = Math.max(0, i.taxiLiters);
  const required = trip === null || contingency === null || alternate === null || reserve === null ? null : taxi + trip + contingency + alternate + reserve;
  return {
    taxi,
    trip,
    contingency,
    alternate,
    reserve,
    required,
    onboard: i.onboardLiters,
    surplus: required === null ? null : i.onboardLiters - required,
    endurance: flow === null ? null : i.onboardLiters / flow,
    sufficient: required === null ? null : i.onboardLiters + 1e-9 >= required,
    overCapacity: i.onboardLiters > i.usableCapacityLiters + 1e-9,
  };
}
