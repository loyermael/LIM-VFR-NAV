/**
 * Géodésie sur l'ellipsoïde WGS84 (algorithmes de Karney via geographiclib-geodesic).
 * Entrées/sorties : degrés décimaux, mètres, angles par rapport au nord VRAI.
 */
import { Geodesic } from "geographiclib-geodesic";
import { trueDeg, type TrueDeg } from "./angles";
import { meters, type Meters } from "./units";

export interface LatLon {
  /** Latitude en degrés, [-90, 90], Nord positif. */
  readonly lat: number;
  /** Longitude en degrés, ]-180, 180], Est positif. */
  readonly lon: number;
}

const wgs84 = Geodesic.WGS84;

/** geographiclib type ses sorties comme optionnelles ; un résultat absent est une erreur, pas un zéro. */
function need(v: number | undefined): number {
  if (v === undefined || Number.isNaN(v)) throw new Error("Calcul géodésique sans résultat");
  return v;
}

/** Distance géodésique la plus courte entre deux points. */
export function distance(a: LatLon, b: LatLon): Meters {
  return meters(need(wgs84.Inverse(a.lat, a.lon, b.lat, b.lon).s12));
}

/** Cap vrai initial de a vers b (route à suivre en partant de a, sur l'orthodromie). */
export function initialBearing(a: LatLon, b: LatLon): TrueDeg {
  return trueDeg(need(wgs84.Inverse(a.lat, a.lon, b.lat, b.lon).azi1));
}

/** Cap vrai à l'arrivée en b (utile pour la route en fin de branche). */
export function finalBearing(a: LatLon, b: LatLon): TrueDeg {
  return trueDeg(need(wgs84.Inverse(a.lat, a.lon, b.lat, b.lon).azi2));
}

/** Point atteint en partant de `from` sur la route vraie `bearing` pendant `dist`. */
export function destination(from: LatLon, bearing: TrueDeg, dist: Meters): LatLon {
  const r = wgs84.Direct(from.lat, from.lon, bearing, dist);
  return { lat: need(r.lat2), lon: normalizeLon(need(r.lon2)) };
}

/** Longitude ramenée dans ]-180, 180]. */
export function normalizeLon(lon: number): number {
  const r = ((((lon + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}
