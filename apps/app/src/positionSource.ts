import { meters, metersPerSecond, trueDeg, destination, distance, initialBearing, type GpsFix, type LatLon } from "@lim/core";

/** Une source de position : GPS de l'appareil, simulateur, plus tard GDL90 ou simulateur de vol. */
export interface PositionSource {
  start(onFix: (fix: GpsFix) => void, onError: (message: string) => void): void;
  stop(): void;
}

/** GPS de l'appareil via l'API de géolocalisation du navigateur (premier plan uniquement sur iOS). */
export class DeviceGpsSource implements PositionSource {
  private watchId: number | null = null;

  constructor(private readonly altitudeReference: "ellipsoid" | "msl") {}

  start(onFix: (fix: GpsFix) => void, onError: (message: string) => void): void {
    if (!("geolocation" in navigator)) {
      onError("geolocation indisponible");
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords;
        onFix({
          timeMs: p.timestamp,
          position: { lat: c.latitude, lon: c.longitude },
          altitude: c.altitude === null ? null : meters(c.altitude),
          altitudeReference: this.altitudeReference,
          groundSpeed: c.speed === null || Number.isNaN(c.speed) ? null : metersPerSecond(c.speed),
          track: c.heading === null || Number.isNaN(c.heading) ? null : trueDeg(c.heading),
          accuracy: Number.isFinite(c.accuracy) ? meters(c.accuracy) : null,
        });
      },
      (e) => onError(e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

/**
 * Simulateur de position (démonstration et tests, activé par `?sim` dans l'adresse).
 * Vol en cercle de 3 NM de rayon, 90 kt, ce qui exerce le vecteur vitesse, le centrage et la rotation de la carte.
 * Avec `?sim=loss`, le signal est coupé 30 s sur chaque cycle de 40 s pour exercer l'alerte de perte GPS.
 */
/**
 * Vol simulé le long d'une route : roulage au sol 6 s, accélération jusqu'à 65 kt, décollage, montée à 1000 ft/min
 * jusqu'à 1000 m AMSL, croisière à 90 kt sur chaque branche, descente sur les 4 derniers km, atterrissage puis arrêt.
 * Exerce l'enregistrement automatique (seuils de décollage), le suivi de route, la bascule de branche et les alertes.
 * `speedFactor` accélère le temps (1, 4, 8) ; la vitesse sol affichée est multipliée d'autant pour rester cohérente.
 */
export class RouteFlightSource implements PositionSource {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly points: LatLon[],
    private readonly speedFactor: () => number = () => 1,
    private readonly withLoss = false,
  ) {}

  start(onFix: (fix: GpsFix) => void): void {
    const pts = this.points;
    const legs: number[] = [];
    for (let i = 1; i < pts.length; i++) legs.push(distance(pts[i - 1] as LatLon, pts[i] as LatLon));
    const total = legs.reduce((a, b) => a + b, 0);
    const groundAlt = 200;
    const cruiseAlt = 1000;
    const rotate = 65 * (1852 / 3600);
    const cruise = 90 * (1852 / 3600);
    const accel = 1.5; // m/s²
    let s = 0; // distance parcourue sur la route (m)
    let v = 0; // vitesse sol de base (m/s)
    let alt = groundAlt;
    let simT = 0; // temps simulé (s)
    let last = Date.now();
    const t0 = last;
    this.timer = setInterval(() => {
      const nowMs = Date.now();
      const f = this.speedFactor();
      const dt = ((nowMs - last) / 1000) * f;
      last = nowMs;
      simT += dt;
      const realT = (nowMs - t0) / 1000;
      const remaining = total - s;
      const landing = remaining < 4000;
      if (simT > 6 && s < total) {
        const target = landing && v > 0 ? Math.max(rotate * 0.8, 0) : alt > groundAlt + 30 ? cruise : rotate;
        if (v < target) v = Math.min(target, v + accel * dt);
        else if (v > target) v = Math.max(target, v - accel * dt);
        if (v >= rotate * 0.98 && !landing) alt = Math.min(cruiseAlt, alt + 5.08 * dt);
        if (landing) alt = Math.max(groundAlt, alt - Math.max(0, alt - groundAlt) / Math.max(remaining, 1) * v * dt);
        s = Math.min(total, s + v * dt);
      }
      if (s >= total) { v = 0; alt = groundAlt; }
      if (this.withLoss && realT % 40 > 10) return;
      // Branche courante et position sur cette branche.
      let acc = 0;
      let leg = 0;
      while (leg < legs.length - 1 && acc + (legs[leg] as number) < s) { acc += legs[leg] as number; leg++; }
      const a = pts[leg] as LatLon;
      const b = pts[leg + 1] as LatLon;
      const brg = initialBearing(a, b);
      const pos = destination(a, brg, meters(Math.min(s - acc, legs[leg] as number)));
      onFix({
        timeMs: nowMs,
        position: pos,
        altitude: meters(alt),
        altitudeReference: "msl",
        groundSpeed: metersPerSecond(v * f),
        track: brg,
        accuracy: meters(5),
      });
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class SimulatedSource implements PositionSource {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly centre: LatLon = { lat: 46.6, lon: 2.35 },
    private readonly withLoss = false,
  ) {}

  start(onFix: (fix: GpsFix) => void): void {
    const radiusM = 3 * 1852;
    const speed = 90 * (1852 / 3600);
    const omega = speed / radiusM; // rad/s
    const t0 = Date.now();
    this.timer = setInterval(() => {
      const t = (Date.now() - t0) / 1000;
      if (this.withLoss && t % 40 > 10) return;
      const theta = omega * t;
      // Position sur le cercle ; route = tangente (sens horaire).
      const bearingFromCentre = (theta * 180) / Math.PI;
      const pos = destination(this.centre, trueDeg(bearingFromCentre), meters(radiusM));
      onFix({
        timeMs: Date.now(),
        position: pos,
        altitude: meters(1000),
        altitudeReference: "msl",
        groundSpeed: metersPerSecond(speed),
        track: trueDeg(bearingFromCentre + 90),
        accuracy: meters(5),
      });
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
