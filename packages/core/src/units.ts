/**
 * Grandeurs physiques à types « brandés ».
 * Interne : SI (m, m/s, s, Pa). Affichage : ft, kt, NM, hPa — conversion uniquement aux frontières.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type Meters = Brand<number, "m">;
export type Feet = Brand<number, "ft">;
export type NauticalMiles = Brand<number, "NM">;
export type MetersPerSecond = Brand<number, "m/s">;
export type Knots = Brand<number, "kt">;
export type Pascals = Brand<number, "Pa">;
export type Hectopascals = Brand<number, "hPa">;

// Facteurs exacts par définition.
export const METERS_PER_FOOT = 0.3048;
export const METERS_PER_NM = 1852;
export const MPS_PER_KNOT = METERS_PER_NM / 3600;
export const PA_PER_HPA = 100;

export const meters = (v: number) => v as Meters;
export const feet = (v: number) => v as Feet;
export const nauticalMiles = (v: number) => v as NauticalMiles;
export const metersPerSecond = (v: number) => v as MetersPerSecond;
export const knots = (v: number) => v as Knots;
export const pascals = (v: number) => v as Pascals;
export const hectopascals = (v: number) => v as Hectopascals;

export const feetToMeters = (v: Feet): Meters => meters(v * METERS_PER_FOOT);
export const metersToFeet = (v: Meters): Feet => feet(v / METERS_PER_FOOT);
export const nmToMeters = (v: NauticalMiles): Meters => meters(v * METERS_PER_NM);
export const metersToNm = (v: Meters): NauticalMiles => nauticalMiles(v / METERS_PER_NM);
export const knotsToMps = (v: Knots): MetersPerSecond => metersPerSecond(v * MPS_PER_KNOT);
export const mpsToKnots = (v: MetersPerSecond): Knots => knots(v / MPS_PER_KNOT);
export const hpaToPa = (v: Hectopascals): Pascals => pascals(v * PA_PER_HPA);
export const paToHpa = (v: Pascals): Hectopascals => hectopascals(v / PA_PER_HPA);
