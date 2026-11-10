/**
 * Traces de vol : détection décollage/atterrissage, enregistrement, statistiques, export GPX / KML / IGC.
 *
 * Seuils : JUGÉS (pas tirés d'une réglementation), réglables ici ; une vitesse sol seule ne distingue pas un roulage rapide
 * d'un décollage, d'où une confirmation sur plusieurs secondes. Un enregistrement peut aussi être lancé et arrêté à la main.
 */
import { distance, type LatLon } from "./geodesy";
import { knotsToMps } from "./units";

/** Vitesse sol à partir de laquelle on considère qu'on décolle (JUGÉ). */
export const TAKEOFF_SPEED_MPS = knotsToMps(25);
/** Durée pendant laquelle la vitesse doit rester au-dessus avant de lancer l'enregistrement (JUGÉ). */
export const TAKEOFF_CONFIRM_S = 3;
/** Vitesse sol sous laquelle on considère qu'on est posé (JUGÉ). */
export const LANDING_SPEED_MPS = knotsToMps(15);
/** Durée sous ce seuil avant de clore l'enregistrement (JUGÉ). */
export const LANDING_CONFIRM_S = 30;
/** Historique gardé avant la détection du décollage, pour ne pas perdre le début du roulage (JUGÉ). */
export const PREROLL_S = 30;
/** Un point par seconde au plus. */
export const MIN_POINT_INTERVAL_MS = 1000;

export interface TrackPoint {
  /** Horodatage UTC (ms). */
  readonly t: number;
  readonly lat: number;
  readonly lon: number;
  /** Altitude AMSL (m), ou null si inconnue. */
  readonly alt: number | null;
  /** Vitesse sol (m/s), ou null. */
  readonly gs: number | null;
  /** Route sol vraie (°), ou null. */
  readonly trk: number | null;
}

export type RecorderState = "idle" | "recording";
export type RecorderEvent = "started" | "ended" | null;

/**
 * Enregistreur à état, sans horloge ni stockage : on lui donne les points un à un.
 * Les points avec une vitesse inconnue ne déclenchent ni le décollage ni l'atterrissage.
 */
export class FlightRecorder {
  state: RecorderState = "idle";
  points: TrackPoint[] = [];
  /** Heure du décollage détecté (ms), ou null. */
  takeoffMs: number | null = null;
  /** Heure à laquelle la vitesse est passée sous le seuil d'atterrissage pour de bon (ms), ou null. */
  landingMs: number | null = null;
  manual = false;
  private preroll: TrackPoint[] = [];
  private fastSince: number | null = null;
  private slowSince: number | null = null;

  push(p: TrackPoint): RecorderEvent {
    const last = this.state === "recording" ? this.points[this.points.length - 1] : this.preroll[this.preroll.length - 1];
    if (last && p.t - last.t < MIN_POINT_INTERVAL_MS) return null;

    if (this.state === "idle") {
      this.preroll.push(p);
      while (this.preroll.length > 0 && p.t - (this.preroll[0] as TrackPoint).t > PREROLL_S * 1000) this.preroll.shift();
      if (p.gs !== null && p.gs >= TAKEOFF_SPEED_MPS) {
        this.fastSince ??= p.t;
        if (p.t - this.fastSince >= TAKEOFF_CONFIRM_S * 1000) {
          const first = this.fastSince;
          this.begin(false);
          this.takeoffMs = first;
          return "started";
        }
      } else this.fastSince = null;
      return null;
    }

    this.points.push(p);
    if (this.manual) return null;
    if (p.gs !== null && p.gs < LANDING_SPEED_MPS) {
      this.slowSince ??= p.t;
      if (p.t - this.slowSince >= LANDING_CONFIRM_S * 1000) {
        this.landingMs = this.slowSince;
        this.state = "idle";
        this.preroll = [];
        this.fastSince = null;
        return "ended";
      }
    } else this.slowSince = null;
    return null;
  }

  private begin(manual: boolean): void {
    this.state = "recording";
    this.manual = manual;
    this.points = [...this.preroll];
    this.preroll = [];
    this.fastSince = null;
    this.slowSince = null;
    this.takeoffMs = null;
    this.landingMs = null;
  }

  /** Démarrage manuel : ne s'arrête pas tout seul à l'atterrissage. */
  startManual(): void {
    if (this.state === "recording") return;
    this.begin(true);
  }

  /** Arrêt manuel. */
  stop(): void {
    this.state = "idle";
    this.fastSince = null;
    this.slowSince = null;
    this.preroll = [];
  }

  /** Reprend un enregistrement interrompu (boîte noire) : on continue d'y ajouter les points. */
  resume(points: readonly TrackPoint[], takeoffMs: number | null): void {
    this.state = "recording";
    this.manual = true;
    this.points = [...points];
    this.takeoffMs = takeoffMs;
  }
}

export interface TrackStats {
  readonly points: number;
  /** Distance cumulée (m). */
  readonly distance: number;
  /** Durée entre le premier et le dernier point (s). */
  readonly duration: number;
  readonly maxAltitude: number | null;
  readonly maxGroundSpeed: number | null;
}

export function trackStats(points: readonly TrackPoint[]): TrackStats {
  let d = 0;
  let maxAlt: number | null = null;
  let maxGs: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as TrackPoint;
    if (i > 0) {
      const q = points[i - 1] as TrackPoint;
      d += distance({ lat: q.lat, lon: q.lon } as LatLon, { lat: p.lat, lon: p.lon } as LatLon);
    }
    if (p.alt !== null && (maxAlt === null || p.alt > maxAlt)) maxAlt = p.alt;
    if (p.gs !== null && (maxGs === null || p.gs > maxGs)) maxGs = p.gs;
  }
  const duration = points.length > 1 ? ((points[points.length - 1] as TrackPoint).t - (points[0] as TrackPoint).t) / 1000 : 0;
  return { points: points.length, distance: d, duration, maxAltitude: maxAlt, maxGroundSpeed: maxGs };
}

/** Point de la trace à l'instant t (interpolation linéaire en position et altitude), ou null hors de la trace. */
export function pointAt(points: readonly TrackPoint[], t: number): TrackPoint | null {
  if (points.length === 0) return null;
  const first = points[0] as TrackPoint, last = points[points.length - 1] as TrackPoint;
  if (t < first.t || t > last.t) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((points[mid] as TrackPoint).t <= t) lo = mid; else hi = mid;
  }
  const a = points[lo] as TrackPoint, b = points[hi] as TrackPoint;
  if (b.t === a.t) return a;
  const f = (t - a.t) / (b.t - a.t);
  const mix = (x: number | null, y: number | null) => (x === null || y === null ? x : x + (y - x) * f);
  return { t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, alt: mix(a.alt, b.alt), gs: mix(a.gs, b.gs), trk: a.trk };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function exportTrackGPX(name: string, points: readonly TrackPoint[]): string {
  const pts = points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.alt === null ? "" : `<ele>${p.alt.toFixed(1)}</ele>`}<time>${iso(p.t)}</time></trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="L!M VFR Nav" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** KML 2.2 avec gx:Track (horodaté, lisible par Google Earth) ; l'altitude est AMSL (absolute), 0 si inconnue. */
export function exportTrackKML(name: string, points: readonly TrackPoint[]): string {
  const when = points.map((p) => `        <when>${iso(p.t)}</when>`).join("\n");
  const coord = points.map((p) => `        <gx:coord>${p.lon.toFixed(6)} ${p.lat.toFixed(6)} ${(p.alt ?? 0).toFixed(1)}</gx:coord>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${esc(name)}</name>
    <Placemark>
      <name>${esc(name)}</name>
      <gx:Track>
        <altitudeMode>absolute</altitudeMode>
${when}
${coord}
      </gx:Track>
    </Placemark>
  </Document>
</kml>
`;
}

export interface IgcMeta {
  readonly pilot?: string;
  readonly aircraftType?: string;
  readonly registration?: string;
}

const pad = (n: number, w: number) => String(Math.trunc(n)).padStart(w, "0");
function igcLat(lat: number): string {
  const a = Math.abs(lat), deg = Math.floor(a), min = Math.round((a - deg) * 60 * 1000);
  const [d, m] = min === 60000 ? [deg + 1, 0] : [deg, min];
  return `${pad(d, 2)}${pad(m, 5)}${lat < 0 ? "S" : "N"}`;
}
function igcLon(lon: number): string {
  const a = Math.abs(lon), deg = Math.floor(a), min = Math.round((a - deg) * 60 * 1000);
  const [d, m] = min === 60000 ? [deg + 1, 0] : [deg, min];
  return `${pad(d, 3)}${pad(m, 5)}${lon < 0 ? "W" : "E"}`;
}
const igcAlt = (m: number | null) => (m === null ? "00000" : m < 0 ? `-${pad(Math.min(-m, 9999), 4)}` : pad(Math.min(m, 99999), 5));

/**
 * IGC (FAI, annexe A) : enregistrements A, H, B. Pas de signature (enregistrement G) : le fichier n'est donc PAS
 * homologable (records, compétitions). Altitude pression non enregistrée : champ à 00000 avec la
 * mention NIL dans l'en-tête (L!M Debrief la lit comme « absente ») ; fixes marqués « A » car un « V » est ignoré par les lecteurs
 * (vérifié avec L!M Debrief). Altitude GNSS = AMSL EGM96 calculée par l'appli, 00000 si inconnue.
 */
export function exportTrackIGC(points: readonly TrackPoint[], meta: IgcMeta = {}): string {
  const first = points[0];
  const d = new Date(first ? first.t : 0);
  const ddmmyy = `${pad(d.getUTCDate(), 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCFullYear() % 100, 2)}`;
  const clean = (s: string | undefined) => (s ?? "").replace(/[\r\n]/g, " ");
  const lines = [
    "AXXXLIM L!M VFR Nav",
    `HFDTE${ddmmyy}`,
    `HFPLTPILOTINCHARGE:${clean(meta.pilot)}`,
    `HFGTYGLIDERTYPE:${clean(meta.aircraftType)}`,
    `HFGIDGLIDERID:${clean(meta.registration)}`,
    "HFDTM100GPSDATUM:WGS-84",
    "HFFTYFRTYPE:L!M VFR Nav",
    "HFALGALTGPS:GEO",
    "HFALPALTPRESSURE:NIL",
  ];
  for (const p of points) {
    const t = new Date(p.t);
    lines.push(`B${pad(t.getUTCHours(), 2)}${pad(t.getUTCMinutes(), 2)}${pad(t.getUTCSeconds(), 2)}${igcLat(p.lat)}${igcLon(p.lon)}A00000${igcAlt(p.alt)}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}
