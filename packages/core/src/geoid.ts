/**
 * Ondulation du géoïde EGM96 : N = hauteur du géoïde (niveau moyen de la mer) au-dessus de l'ellipsoïde WGS84.
 * Altitude AMSL = hauteur ellipsoïdale (GPS) − N.
 *
 * Données : grille NGA « WW15MGH.DAC » (domaine public), 721 lignes (90° N → 90° S) × 1440 colonnes
 * (0° → 359,75° E), pas de 15', entiers 16 bits big-endian en centimètres. Chargée par l'application
 * (le moteur ne lit aucun fichier lui-même).
 */
import type { LatLon } from "./geodesy";
import { meters, type Meters } from "./units";

const ROWS = 721;
const COLS = 1440;
const STEP_DEG = 0.25;
export const EGM96_GRID_BYTES = ROWS * COLS * 2;

export class Geoid {
  private readonly view: DataView;

  constructor(buffer: ArrayBuffer) {
    if (buffer.byteLength !== EGM96_GRID_BYTES) {
      throw new Error(`Grille EGM96 invalide : ${buffer.byteLength} octets au lieu de ${EGM96_GRID_BYTES}`);
    }
    this.view = new DataView(buffer);
  }

  private at(row: number, col: number): number {
    return this.view.getInt16((row * COLS + (col % COLS)) * 2, false) / 100;
  }

  /** Ondulation en mètres, interpolation bilinéaire. */
  undulation(p: LatLon): Meters {
    const lat = Math.max(-90, Math.min(90, p.lat));
    const lon = ((p.lon % 360) + 360) % 360;
    const rowF = (90 - lat) / STEP_DEG;
    const colF = lon / STEP_DEG;
    const r0 = Math.min(Math.floor(rowF), ROWS - 2);
    const c0 = Math.floor(colF);
    const fr = rowF - r0;
    const fc = colF - c0;
    const v00 = this.at(r0, c0);
    const v01 = this.at(r0, c0 + 1);
    const v10 = this.at(r0 + 1, c0);
    const v11 = this.at(r0 + 1, c0 + 1);
    const top = v00 + (v01 - v00) * fc;
    const bottom = v10 + (v11 - v10) * fc;
    return meters(top + (bottom - top) * fr);
  }

  /** Hauteur ellipsoïdale (sortie GPS) → altitude AMSL. */
  ellipsoidalToMsl(p: LatLon, ellipsoidalHeight: Meters): Meters {
    return meters(ellipsoidalHeight - this.undulation(p));
  }
}
