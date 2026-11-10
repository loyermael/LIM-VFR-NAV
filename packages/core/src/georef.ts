/**
 * Géoréférencement d'une image (VAC scannée ou PDF rendu) à partir de points de calage.
 *
 * Modèle : similitude (échelle, rotation, translation, sans cisaillement) dans le plan Web Mercator. C'est le modèle d'une
 * carte imprimée à l'échelle, orientée librement, sur une zone de quelques dizaines de kilomètres. Deux points suffisent ;
 * à partir de trois, l'ajustement est aux moindres carrés et les résidus (en mètres) disent la qualité du calage.
 * Limite : une carte à échelle non uniforme ou en projection très différente (grande zone) n'est pas bien modélisée.
 */
import type { LatLon } from "./geodesy";

const R = 6378137; // rayon de la sphère Web Mercator (m), le même que MapLibre
const MAX_LAT = 85.0511287798;

export interface Mercator { readonly x: number; readonly y: number }

export function toMercator(p: LatLon): Mercator {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  return { x: (R * p.lon * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) };
}
export function fromMercator(m: Mercator): LatLon {
  return { lat: ((2 * Math.atan(Math.exp(m.y / R)) - Math.PI / 2) * 180) / Math.PI, lon: (m.x / R) * (180 / Math.PI) } as LatLon;
}

/** Point de calage : pixel de l'image (origine en haut à gauche, y vers le bas) et position réelle. */
export interface ControlPoint {
  readonly px: number;
  readonly py: number;
  readonly lat: number;
  readonly lon: number;
}

/** Transformation pixel → Mercator : X = ar·px + ai·py + tx ; Y = ai·px − ar·py + ty (ar + i·ai = échelle complexe). */
export interface Georef {
  readonly ar: number;
  readonly ai: number;
  readonly tx: number;
  readonly ty: number;
}

export interface GeorefFit {
  readonly georef: Georef;
  /** Écart de chaque point de calage après ajustement (m sur le terrain) ; ~0 avec deux points (ajustement exact). */
  readonly residuals: readonly number[];
  readonly rmsError: number;
}

/**
 * Ajuste la similitude sur les points de calage. Retourne null si le calage est impossible : moins de deux points,
 * ou tous les pixels confondus.
 */
export function fitGeoref(points: readonly ControlPoint[]): GeorefFit | null {
  const n = points.length;
  if (n < 2) return null;
  // Image : w = px − i·py (y vers le haut) ; terrain : z = X + iY. On cherche z = s·w + t.
  const w = points.map((p) => ({ re: p.px, im: -p.py }));
  const z = points.map((p) => { const m = toMercator({ lat: p.lat, lon: p.lon } as LatLon); return { re: m.x, im: m.y }; });
  const mean = (a: { re: number; im: number }[]) => ({ re: a.reduce((s, v) => s + v.re, 0) / n, im: a.reduce((s, v) => s + v.im, 0) / n });
  const mw = mean(w), mz = mean(z);
  let num = { re: 0, im: 0 }, den = 0;
  for (let i = 0; i < n; i++) {
    const a = { re: (w[i] as { re: number }).re - mw.re, im: (w[i] as { im: number }).im - mw.im };
    const b = { re: (z[i] as { re: number }).re - mz.re, im: (z[i] as { im: number }).im - mz.im };
    // conj(a) · b
    num = { re: num.re + a.re * b.re + a.im * b.im, im: num.im + a.re * b.im - a.im * b.re };
    den += a.re * a.re + a.im * a.im;
  }
  if (den < 1e-9) return null;
  const sr = num.re / den, si = num.im / den;
  // z = s·w + t, t = mz − s·mw
  const tx = mz.re - (sr * mw.re - si * mw.im);
  const ty = mz.im - (sr * mw.im + si * mw.re);
  // Avec w = px − i·py : X = sr·px + si·py + tx ; Y = si·px − sr·py + ty.
  const georef: Georef = { ar: sr, ai: si, tx, ty };
  const residuals = points.map((p) => {
    const q = pixelToLatLon(georef, p.px, p.py);
    return groundDistance({ lat: p.lat, lon: p.lon } as LatLon, q);
  });
  const rmsError = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  return { georef, residuals, rmsError };
}

/** Distance sur le terrain entre deux points proches, par la projection (corrigée de l'échelle Mercator) : suffisant pour un écart de calage. */
function groundDistance(a: LatLon, b: LatLon): number {
  const ma = toMercator(a), mb = toMercator(b);
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot(ma.x - mb.x, ma.y - mb.y) * k;
}

export function pixelToMercator(g: Georef, px: number, py: number): Mercator {
  return { x: g.ar * px + g.ai * py + g.tx, y: g.ai * px - g.ar * py + g.ty };
}
export function pixelToLatLon(g: Georef, px: number, py: number): LatLon {
  return fromMercator(pixelToMercator(g, px, py));
}
/** Pixel de l'image correspondant à une position (inverse de la similitude). */
export function latLonToPixel(g: Georef, p: LatLon): { px: number; py: number } {
  const m = toMercator(p);
  const d = g.ar * g.ar + g.ai * g.ai;
  const dx = m.x - g.tx, dy = m.y - g.ty;
  // [dx, dy] = [[ar, ai], [ai, −ar]] · [px, py]  → matrice symétrique, son inverse est elle-même / d
  return { px: (g.ar * dx + g.ai * dy) / d, py: (g.ai * dx - g.ar * dy) / d };
}

/** Coins de l'image (haut-gauche, haut-droit, bas-droit, bas-gauche) en [lon, lat] : le format d'une source image MapLibre. */
export function imageCorners(g: Georef, width: number, height: number): [[number, number], [number, number], [number, number], [number, number]] {
  const c = (px: number, py: number): [number, number] => { const p = pixelToLatLon(g, px, py); return [p.lon, p.lat]; };
  return [c(0, 0), c(width, 0), c(width, height), c(0, height)];
}

/** Mètres sur le terrain par pixel au centre de l'image, et rotation du haut de l'image par rapport au nord vrai (° dans le sens horaire). */
export function georefMetrics(g: Georef, width: number, height: number): { metersPerPixel: number; rotationDeg: number } {
  const center = pixelToLatLon(g, width / 2, height / 2);
  const k = Math.cos((center.lat * Math.PI) / 180);
  const mercPerPx = Math.hypot(g.ar, g.ai);
  // Le haut de l'image est la direction −py : (X, Y) = (−ai, ar) par pixel.
  const rotation = (Math.atan2(-g.ai, g.ar) * 180) / Math.PI; // angle du haut de l'image mesuré depuis le nord, sens horaire
  return { metersPerPixel: mercPerPx * k, rotationDeg: ((rotation % 360) + 360) % 360 };
}

/**
 * Lit une latitude ou une longitude saisie à la main : « 47.3083 », « 47.3083 N », « -1.5 », « 47°18'30"N », « 47 18 30.5 N »,
 * « 471830N », « 0022015E ». Retourne des degrés décimaux, ou null si illisible ou hors limites.
 */
export function parseCoordinate(text: string, axis: "lat" | "lon"): number | null {
  const s = text.trim().toUpperCase().replace(/,/g, ".");
  if (s === "") return null;
  const hemi = /[NSEW]/.exec(s)?.[0] ?? null;
  if (hemi !== null && (axis === "lat" ? !"NS".includes(hemi) : !"EW".includes(hemi))) return null;
  const body = s.replace(/[NSEW]/g, "").trim();
  let value: number | null = null;
  const compact = /^([+-]?)(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(body);
  if (compact && (compact[2] as string).length === (axis === "lat" ? 2 : 3)) {
    const [, sign, d, m, sec] = compact as unknown as [string, string, string, string, string];
    value = (Number(d) + Number(m) / 60 + Number(sec) / 3600) * (sign === "-" ? -1 : 1);
    if (Number(m) >= 60 || Number(sec) >= 60) return null;
  } else {
    const parts = body.replace(/[°'"′″]/g, " ").trim().split(/\s+/);
    if (parts.length < 1 || parts.length > 3 || parts.some((x) => !/^[+-]?\d+(\.\d+)?$/.test(x))) return null;
    const d = Number(parts[0]);
    const m = parts[1] === undefined ? 0 : Number(parts[1]);
    const sec = parts[2] === undefined ? 0 : Number(parts[2]);
    if (m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
    if (parts.length > 1 && (!Number.isInteger(d) || (parts.length === 3 && !Number.isInteger(m)))) return null;
    const neg = parts[0]!.startsWith("-");
    value = (Math.abs(d) + m / 60 + sec / 3600) * (neg ? -1 : 1);
  }
  if (hemi === "S" || hemi === "W") value = -Math.abs(value);
  const limit = axis === "lat" ? 90 : 180;
  return Math.abs(value) <= limit ? value : null;
}
