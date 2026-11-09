import { meters, metersPerSecond, trueDeg, destination, type GpsFix, type LatLon } from "@lim/core";

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
