/** Tuiles Web Mercator (schéma XYZ / WMTS « PM ») : conversion, plages d'une zone, comptage pour le téléchargement hors-ligne. */

export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export const MAX_MERCATOR_LAT = 85.0511287798;

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const l = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * (Math.PI / 180);
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n)));
}

/** Plage de tuiles couvrant une zone à un niveau de zoom (x et y inclus). */
export function tileRange(b: BBox, z: number): { x0: number; x1: number; y0: number; y1: number } {
  return { x0: lonToTileX(b.west, z), x1: lonToTileX(b.east, z), y0: latToTileY(b.north, z), y1: latToTileY(b.south, z) };
}

/** Nombre de tuiles d'une zone pour tous les niveaux de zmin à zmax. */
export function countTiles(b: BBox, zmin: number, zmax: number): number {
  let n = 0;
  for (let z = zmin; z <= zmax; z++) {
    const r = tileRange(b, z);
    n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return n;
}

/** Toutes les tuiles de la zone, des grands niveaux de zoom (vue d'ensemble) vers les petits (détail) : l'essentiel arrive d'abord. */
export function* tilesOf(b: BBox, zmin: number, zmax: number): Generator<{ z: number; x: number; y: number }> {
  for (let z = zmin; z <= zmax; z++) {
    const r = tileRange(b, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}

/** Zone englobant des points, agrandie d'une marge en mètres (approximation locale : 1° de latitude = 111,32 km). */
export function bboxAround(points: readonly { lat: number; lon: number }[], marginM: number): BBox | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const south = Math.min(...lats), north = Math.max(...lats), west = Math.min(...lons), east = Math.max(...lons);
  const dLat = marginM / 111320;
  const dLon = marginM / (111320 * Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180)));
  return {
    west: Math.max(-180, west - dLon), east: Math.min(180, east + dLon),
    south: Math.max(-MAX_MERCATOR_LAT, south - dLat), north: Math.min(MAX_MERCATOR_LAT, north + dLat),
  };
}
