import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { hectopascals, hpaToPa, meters, pressureAltitudeOf, pressureAtAltitude } from "@lim/core";

/**
 * Une mesure de pression brute, en pascals.
 * Source réelle : baromètre de l'appareil via la coque Android (un navigateur n'y a pas accès).
 */
export interface PressureSample {
  readonly pressure: number;
  readonly timeMs: number;
}

export interface PressureSource {
  /** Nom court pour l'affichage (« capteur de l'appareil », « simulateur »). */
  readonly kind: "device" | "simulated";
  start(onSample: (s: PressureSample) => void, onError: (message: string) => void): Promise<void>;
  stop(): Promise<void>;
}

interface BarometerPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(event: "pressure", cb: (e: { hPa: number; timeMs: number }) => void): Promise<PluginListenerHandle>;
}

const Barometer = registerPlugin<BarometerPlugin>("Barometer");

/** Baromètre de l'appareil, disponible uniquement dans la coque Android native. */
export class DeviceBarometer implements PressureSource {
  readonly kind = "device" as const;
  private handle: PluginListenerHandle | null = null;

  /** Vrai si on tourne dans la coque native ET que l'appareil a un capteur de pression. */
  static async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Barometer")) return false;
    try {
      return (await Barometer.isAvailable()).available;
    } catch {
      return false;
    }
  }

  async start(onSample: (s: PressureSample) => void, onError: (message: string) => void): Promise<void> {
    try {
      this.handle = await Barometer.addListener("pressure", (e) => onSample({ pressure: e.hPa * 100, timeMs: e.timeMs }));
      await Barometer.start();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async stop(): Promise<void> {
    await this.handle?.remove();
    this.handle = null;
    await Barometer.stop().catch(() => undefined);
  }
}

/**
 * Baromètre simulé pour la démonstration (`?sim`) : une atmosphère standard dont le QNH réel du jour est 1018 hPa,
 * à l'altitude du vol simulé (1000 m AMSL). Régler le QNH de l'application sur 1018 fait donc afficher 1000 m ;
 * avec 1013 l'écart est visible (~ +40 m), comme dans la vraie vie.
 */
export class SimulatedBarometer implements PressureSource {
  readonly kind = "simulated" as const;
  static readonly TRUE_QNH_HPA = 1018;
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(onSample: (s: PressureSample) => void): Promise<void> {
    const trueQnh = hpaToPa(hectopascals(SimulatedBarometer.TRUE_QNH_HPA));
    const p = pressureAtAltitude(meters(1000 + pressureAltitudeOf(trueQnh)));
    this.timer = setInterval(() => {
      // Bruit de capteur réaliste : ± 0,05 hPa.
      onSample({ pressure: p + (Math.random() - 0.5) * 10, timeMs: Date.now() });
    }, 200);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
