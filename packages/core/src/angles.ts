/**
 * Angles en degrés, avec distinction vrai / magnétique / relatif.
 * Convention : variation magnétique Est positive, MAG = TRUE − VAR.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Relatif au vrai (nord géographique), [0, 360[. */
export type TrueDeg = Brand<number, "true°">;
/** Relatif au nord magnétique, [0, 360[. */
export type MagDeg = Brand<number, "mag°">;
/** Angle relatif (ex. relèvement par rapport au cap), ]−180, 180]. */
export type RelDeg = Brand<number, "rel°">;
/** Variation magnétique, Est positive. */
export type VariationDeg = Brand<number, "var°">;

/** Ramène un angle dans [0, 360[. */
export function normalize360(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r === 0 ? 0 : r;
}

/** Ramène un angle dans ]−180, 180]. */
export function normalize180(deg: number): number {
  const r = normalize360(deg);
  return r > 180 ? r - 360 : r;
}

export const trueDeg = (v: number) => normalize360(v) as TrueDeg;
export const magDeg = (v: number) => normalize360(v) as MagDeg;
export const relDeg = (v: number) => normalize180(v) as RelDeg;
export const variationDeg = (v: number) => v as VariationDeg;

export const trueToMag = (t: TrueDeg, variation: VariationDeg): MagDeg =>
  magDeg(t - variation);
export const magToTrue = (m: MagDeg, variation: VariationDeg): TrueDeg =>
  trueDeg(m + variation);

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;
