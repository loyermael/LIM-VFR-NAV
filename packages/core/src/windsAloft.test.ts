import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PRESSURE_LEVELS_HPA, averageWinds, legWindsFromForecasts, openMeteoWindUrl, parseOpenMeteoWinds, windAt, type WindForecast,
} from "./windsAloft";
import { knots, knotsToMps, meters, mpsToKnots } from "./units";
import { trueDeg } from "./angles";
import type { RoutePoint } from "./navlog";
import type { Wind } from "./wind";

const real = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/weather/openmeteo.json", import.meta.url)), "utf8")); // Open-Meteo.com, CC BY 4.0
const H = 3_600_000;
const T0 = Date.parse("2026-11-10T06:00:00Z");

/** Prévision synthétique : sol à 100 m ; vent de surface 5 m/s d'ouest ; niveaux à 1000, 2000, 4000 m. */
function synthetic(over: Partial<WindForecast> = {}): WindForecast {
  const lv = (hpa: number, z: number, speed: number, dir: number) => ({ hpa, height: [z, z], speed: [speed, speed], direction: [dir, dir] });
  return {
    lat: 46, lon: 2, elevation: 100, times: [T0, T0 + H], fetchedAt: T0,
    surface: { speed: [5, 5], direction: [270, 270] },
    levels: [lv(900, 1000, 10, 270), lv(800, 2000, 20, 270), lv(600, 4000, 30, 270)],
    ...over,
  };
}
const w = (dir: number, ms: number): Wind => ({ direction: trueDeg(dir), speed: ms as never });

describe("interpolation en altitude", () => {
  it("exactement sur un niveau : la valeur du niveau", () => {
    const r = windAt(synthetic(), meters(2000), T0)!;
    expect(r.speed).toBeCloseTo(20, 9);
    expect(r.direction).toBeCloseTo(270, 6);
  });
  it("entre deux niveaux : interpolation linéaire (1500 m entre 10 et 20 m/s = 15 m/s)", () => {
    expect(windAt(synthetic(), meters(1500), T0)!.speed).toBeCloseTo(15, 9);
  });
  it("sous le premier niveau (près du sol) : vent de surface ; au niveau 10 m : le vent de surface", () => {
    expect(windAt(synthetic(), meters(105), T0)!.speed).toBeCloseTo(5, 9);
    expect(windAt(synthetic(), meters(110), T0)!.speed).toBeCloseTo(5, 9);
    expect(windAt(synthetic(), meters(555), T0)!.speed).toBeCloseTo(7.5, 9); // entre 5 (110 m) et 10 (1000 m) : 445/890 = 0,5
  });
  it("au-dessus du plus haut niveau : pas de donnée plutôt qu'une extrapolation", () => {
    expect(windAt(synthetic(), meters(4001), T0)).toBeNull();
    expect(windAt(synthetic(), meters(4000), T0)).not.toBeNull();
  });
  it("une direction qui tourne passe par le chemin le plus court (interpolation des composantes, pas des angles)", () => {
    const lv = (hpa: number, z: number, dir: number) => ({ hpa, height: [z, z], speed: [10, 10], direction: [dir, dir] });
    const f = synthetic({ surface: { speed: [10, 10], direction: [350, 350] }, levels: [lv(900, 1000, 10)] });
    const r = windAt(f, meters(555), T0)!; // à mi-chemin entre 350° et 10° → près de 0°, jamais 180°
    const d = r.direction > 180 ? r.direction - 360 : r.direction;
    expect(Math.abs(d)).toBeLessThan(2);
  });
});

describe("interpolation dans le temps", () => {
  it("entre deux heures : interpolation linéaire des composantes", () => {
    const f = synthetic({
      levels: [{ hpa: 900, height: [1000, 1000], speed: [10, 20], direction: [270, 270] }],
      surface: { speed: [10, 20], direction: [270, 270] },
    });
    expect(windAt(f, meters(1000), T0 + H / 2)!.speed).toBeCloseTo(15, 9);
    expect(windAt(f, meters(1000), T0)!.speed).toBeCloseTo(10, 9);
    expect(windAt(f, meters(1000), T0 + H)!.speed).toBeCloseTo(20, 9);
  });
  it("hors de la prévision : null", () => {
    expect(windAt(synthetic(), meters(1000), T0 - 1)).toBeNull();
    expect(windAt(synthetic(), meters(1000), T0 + H + 1)).toBeNull();
  });
});

describe("données manquantes et niveaux sous le sol", () => {
  it("un niveau sous le sol (altitude ≤ sol + 10 m) est écarté, jamais utilisé", () => {
    const f = synthetic({ levels: [{ hpa: 1000, height: [67, 67], speed: [99, 99], direction: [90, 90] }, ...synthetic().levels] });
    // le niveau « souterrain » à 99 m/s d'est ne doit pas apparaître
    expect(windAt(f, meters(150), T0)!.speed).toBeLessThan(10);
  });
  it("valeurs manquantes (null) : le niveau est ignoré à cette heure", () => {
    const f = synthetic({ levels: [{ hpa: 800, height: [2000, null], speed: [20, null], direction: [270, null] }, { hpa: 600, height: [4000, 4000], speed: [30, 30], direction: [270, 270] }] });
    expect(windAt(f, meters(3000), T0)!.speed).toBeCloseTo(25, 9);
    expect(windAt(f, meters(3000), T0 + H)!.speed).toBeGreaterThan(5); // seul le niveau 4000 m reste : interpolation avec la surface
  });
  it("aucune donnée à cette heure : null", () => {
    const f = synthetic({ levels: [], surface: { speed: [null, null], direction: [null, null] } });
    expect(windAt(f, meters(1000), T0)).toBeNull();
  });
});

describe("moyenne de vents", () => {
  it("vectorielle : 10 m/s de 270° et 10 m/s de 90° s'annulent ; jamais une moyenne d'angles", () => {
    expect(averageWinds([w(270, 10), w(90, 10)])!.speed).toBeLessThan(1e-9);
    const m = averageWinds([w(350, 10), w(10, 10)])!;
    expect(Math.min(m.direction, 360 - m.direction)).toBeLessThan(1e-6);
    expect(m.speed).toBeGreaterThan(9.8);
    expect(averageWinds([])).toBeNull();
  });
});

describe("vraie réponse Open-Meteo", () => {
  const f = parseOpenMeteoWinds(real, T0);
  it("18 niveaux, 6 heures, vent de surface", () => {
    expect(f.levels).toHaveLength(18);
    expect(f.levels.map((l) => l.hpa)).toEqual([...PRESSURE_LEVELS_HPA]);
    expect(f.times).toHaveLength(6);
    expect(f.times[0]).toBe(Date.parse("2026-11-10T06:00:00Z"));
    expect(f.elevation).toBe(97);
  });
  it("le niveau 1000 hPa est sous le sol à cet endroit (67 m pour un sol à 97 m) et n'est pas utilisé", () => {
    const l1000 = f.levels.find((l) => l.hpa === 1000)!;
    expect(l1000.height[0]).toBeLessThan(f.elevation);
    const near = windAt(f, meters(f.elevation + 20), f.times[0] as number)!;
    const surface = f.surface.speed[0] as number;
    // à 20 m au-dessus du sol : entre le vent de surface et le premier vrai niveau, pas la valeur extrapolée de 1000 hPa
    expect(near.speed).toBeGreaterThan(0);
    expect(near.speed).toBeLessThan(Math.max(surface, (f.levels.find((l) => l.hpa === 975)!.speed[0] as number)) + 3);
  });
  it("vents plausibles : de 0 à 100 m/s à toutes les altitudes jusqu'à 20 km", () => {
    for (let z = 200; z <= 20000; z += 800) {
      const r = windAt(f, meters(z), f.times[2] as number)!;
      expect(r, `z=${z}`).not.toBeNull();
      expect(r.speed).toBeGreaterThanOrEqual(0);
      expect(r.speed).toBeLessThan(100);
      expect(r.direction).toBeGreaterThanOrEqual(0);
      expect(r.direction).toBeLessThan(360);
    }
  });
  it("au-dessus du niveau 50 hPa : pas de donnée", () => {
    expect(windAt(f, meters(30000), f.times[0] as number)).toBeNull();
  });
  it("réponses invalides refusées avec un message clair", () => {
    expect(() => parseOpenMeteoWinds(null, 0)).toThrow(/invalide/);
    expect(() => parseOpenMeteoWinds({ error: true, reason: "quota" }, 0)).toThrow(/quota/);
    expect(() => parseOpenMeteoWinds({ latitude: 1, longitude: 1, hourly: { time: ["pas une date"] } }, 0)).toThrow(/illisibles/);
    expect(() => parseOpenMeteoWinds({ latitude: 1, longitude: 1, hourly: { time: ["2026-11-10T06:00"] } }, 0)).toThrow(/Aucun niveau/);
  });
  it("l'URL demande les 18 niveaux, les vitesses en m/s et l'heure UTC", () => {
    const url = openMeteoWindUrl(46.6, 1.0, 24);
    expect(url).toContain("wind_speed_unit=ms");
    expect(url).toContain("timezone=UTC");
    expect(url).toContain("forecast_hours=24");
    for (const l of PRESSURE_LEVELS_HPA) expect(url).toContain(`geopotential_height_${l}hPa`);
    expect(url).toContain("wind_speed_10m");
  });
});

describe("vent de chaque branche d'une route", () => {
  const pt = (id: string, lat: number, lon: number, alt: number | null): RoutePoint => ({ id, name: id, position: { lat, lon }, altitude: alt === null ? null : meters(alt) });
  const f = synthetic();
  const tas = knotsToMps(knots(100));
  it("altitude = moyenne des extrémités ; instant = départ + temps sans vent jusqu'au milieu de la branche", () => {
    const pts = [pt("a", 46, 2, 1000), pt("b", 46, 3, 3000), pt("c", 47, 3, 3000)];
    const r = legWindsFromForecasts(pts, [f, f, f], T0, tas);
    expect(r).toHaveLength(2);
    expect(r[0]!.reason).toBe("ok");
    expect(r[0]!.altitude).toBe(2000);
    expect(r[0]!.wind!.speed).toBeCloseTo(20, 6);
    expect(r[1]!.altitude).toBe(3000);
    expect(r[1]!.timeMs).toBeGreaterThan(r[0]!.timeMs);
  });
  it("sans altitude sur la branche : pas de vent estimé, raison donnée (on n'invente pas une altitude)", () => {
    const r = legWindsFromForecasts([pt("a", 46, 2, null), pt("b", 46, 3, null)], [f, f], T0, tas);
    expect(r[0]).toMatchObject({ wind: null, reason: "no-altitude" });
  });
  it("sans prévision : « no-forecast » ; instant hors prévision : « out-of-range »", () => {
    expect(legWindsFromForecasts([pt("a", 46, 2, 1000), pt("b", 46, 3, 1000)], [null, null], T0, tas)[0]!.reason).toBe("no-forecast");
    expect(legWindsFromForecasts([pt("a", 46, 2, 1000), pt("b", 46, 3, 1000)], [f, f], T0 + 5 * H, tas)[0]!.reason).toBe("out-of-range");
  });
  it("une seule prévision disponible sur deux : elle suffit", () => {
    const r = legWindsFromForecasts([pt("a", 46, 2, 1000), pt("b", 46, 3, 1000)], [f, null], T0, tas);
    expect(r[0]!.reason).toBe("ok");
    expect(mpsToKnots(r[0]!.wind!.speed)).toBeGreaterThan(0);
  });
  it("route à un seul point : aucune branche", () => {
    expect(legWindsFromForecasts([pt("a", 46, 2, 1000)], [f], T0, tas)).toEqual([]);
  });
});
