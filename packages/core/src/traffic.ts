/**
 * Table du trafic reçu (GDL90, FLARM) : mise à jour, péremption, distance/relèvement/altitude relative, niveau d'alerte.
 *
 * Ce n'est PAS un système anticollision : la proximité est jugée sur la position instantanée (pas de trajectoire projetée),
 * seuls les avions émettant (ADS-B / FLARM) sont vus, et l'alerte de l'émetteur est reprise telle quelle. Seuils JUGÉS.
 */
import { distance, initialBearing, destination, type LatLon } from "./geodesy";
import { trueDeg } from "./angles";
import { meters } from "./units";
import type { Gdl90Report } from "./gdl90";
import type { Pflaa } from "./flarm";

/** Au-delà de cette ancienneté la cible est grisée ; au-delà de DROP_S elle disparaît (JUGÉ). */
export const TRAFFIC_STALE_S = 10;
export const TRAFFIC_DROP_S = 30;
/** Proximité (JUGÉ) : « attention » sous 3 NM et 1 000 ft d'écart ; « alerte » sous 1 NM et 500 ft. */
export const PROX_CAUTION_M = 3 * 1852;
export const PROX_CAUTION_VERT_M = 1000 * 0.3048;
export const PROX_ALERT_M = 1852;
export const PROX_ALERT_VERT_M = 500 * 0.3048;

export interface TrafficTarget {
  readonly key: string;
  readonly label: string;
  readonly lat: number;
  readonly lon: number;
  /** Altitude relative à l'avion (m, positive = au-dessus), ou null si inconnue. */
  readonly relAltM: number | null;
  readonly track: number | null;
  readonly groundSpeedMps: number | null;
  readonly verticalSpeedMps: number | null;
  readonly seenMs: number;
  readonly source: "gdl90" | "flarm";
  /** Niveau d'alerte donné par l'émetteur (0 à 3). */
  readonly sourceAlarm: number;
}

export interface TrafficView extends TrafficTarget {
  readonly distanceM: number;
  readonly bearing: number;
  readonly stale: boolean;
  /** 0 = rien, 1 = attention, 2 = alerte, 3 = urgent (alerte de l'émetteur). */
  readonly level: number;
}

export interface OwnshipRef {
  readonly lat: number;
  readonly lon: number;
  /** Altitude pression de l'avion (m) dans la même référence que celle des rapports GDL90, ou null. */
  readonly pressureAltM: number | null;
}

export class TrafficTable {
  private readonly targets = new Map<string, TrafficTarget>();
  private own: OwnshipRef | null = null;

  setOwnship(o: OwnshipRef): void {
    this.own = o;
  }

  ingestGdl90(r: Gdl90Report, nowMs: number): void {
    const rel = r.pressureAltitudeM !== null && this.own?.pressureAltM != null ? r.pressureAltitudeM - this.own.pressureAltM : null;
    const key = `g:${r.address}`;
    this.targets.set(key, {
      key, label: r.callsign || r.address, lat: r.lat, lon: r.lon, relAltM: rel, track: r.track, groundSpeedMps: r.groundSpeedMps,
      verticalSpeedMps: r.verticalSpeedMps, seenMs: nowMs, source: "gdl90", sourceAlarm: r.alert ? 1 : 0,
    });
  }

  /** Une cible FLARM : sa position est relative à l'avion (nord/est en mètres), il faut donc la position de l'avion. */
  ingestFlarm(p: Pflaa, ownPos: LatLon, nowMs: number): void {
    const d = Math.hypot(p.relNorthM, p.relEastM);
    const pos = d === 0 ? ownPos : destination(ownPos, trueDeg((Math.atan2(p.relEastM, p.relNorthM) * 180) / Math.PI), meters(d));
    const key = `f:${p.id}`;
    this.targets.set(key, {
      key, label: p.id, lat: pos.lat, lon: pos.lon, relAltM: p.relVerticalM, track: p.track, groundSpeedMps: p.groundSpeedMps,
      verticalSpeedMps: p.climbRateMps, seenMs: nowMs, source: "flarm", sourceAlarm: p.alarmLevel,
    });
  }

  /** Cibles à l'instant donné, triées de la plus proche à la plus lointaine ; les périmées sont supprimées. */
  snapshot(nowMs: number, ownPos: LatLon | null): TrafficView[] {
    const out: TrafficView[] = [];
    for (const [k, t] of this.targets) {
      const age = (nowMs - t.seenMs) / 1000;
      if (age > TRAFFIC_DROP_S) { this.targets.delete(k); continue; }
      const here: LatLon = { lat: t.lat, lon: t.lon } as LatLon;
      const dist = ownPos ? distance(ownPos, here) : Number.NaN;
      out.push({
        ...t, distanceM: dist, bearing: ownPos ? initialBearing(ownPos, here) : Number.NaN, stale: age > TRAFFIC_STALE_S,
        level: Math.max(t.sourceAlarm, ownPos ? proximityLevel(dist, t.relAltM) : 0),
      });
    }
    return out.sort((a, b) => (Number.isNaN(a.distanceM) ? 1 : Number.isNaN(b.distanceM) ? -1 : a.distanceM - b.distanceM));
  }

  clear(): void {
    this.targets.clear();
  }
}

/** Niveau 0, 1 (attention) ou 2 (alerte) d'après la position instantanée ; altitude relative inconnue → pas de niveau. */
export function proximityLevel(distanceM: number, relAltM: number | null): number {
  if (!Number.isFinite(distanceM) || relAltM === null) return 0;
  const v = Math.abs(relAltM);
  if (distanceM < PROX_ALERT_M && v < PROX_ALERT_VERT_M) return 2;
  if (distanceM < PROX_CAUTION_M && v < PROX_CAUTION_VERT_M) return 1;
  return 0;
}

export type StreamState = "none" | "ok" | "stale" | "lost";

/** État d'un flux de données (récepteur, simulateur) d'après l'âge du dernier message : même logique que le GPS. */
export function streamState(lastMs: number | null, nowMs: number, staleS = 5, lostS = 15): StreamState {
  if (lastMs === null) return "none";
  const age = (nowMs - lastMs) / 1000;
  return age >= lostS ? "lost" : age >= staleS ? "stale" : "ok";
}
