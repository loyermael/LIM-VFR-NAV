import { describe, expect, it } from "vitest";
import { gpsStatus, speedVector, usableTrack, type GpsFix } from "./gps";
import { distance, initialBearing } from "./geodesy";
import { isAirspaceVisible, flightLevelToMeters } from "./ceiling";
import { meters, metersPerSecond } from "./units";
import { trueDeg } from "./angles";

const fix = (over: Partial<GpsFix> = {}): GpsFix => ({
  timeMs: 1_000_000,
  position: { lat: 46, lon: 2 },
  altitude: meters(1000),
  altitudeReference: "ellipsoid",
  groundSpeed: metersPerSecond(50),
  track: trueDeg(90),
  accuracy: meters(10),
  ...over,
});

describe("état du GPS", () => {
  it("aucune position → none", () => expect(gpsStatus(null, 0)).toBe("none"));
  it("position récente → ok", () => expect(gpsStatus(fix(), 1_000_000 + 1000)).toBe("ok"));
  it("4,9 s : encore ok ; 5 s : périmée ; 14,9 s : périmée ; 15 s : perdue", () => {
    expect(gpsStatus(fix(), 1_000_000 + 4900)).toBe("ok");
    expect(gpsStatus(fix(), 1_000_000 + 5000)).toBe("stale");
    expect(gpsStatus(fix(), 1_000_000 + 14_900)).toBe("stale");
    expect(gpsStatus(fix(), 1_000_000 + 15_000)).toBe("lost");
  });
  it("précision mauvaise → poor", () => {
    expect(gpsStatus(fix({ accuracy: meters(500) }), 1_000_000)).toBe("poor");
  });
  it("précision inconnue n'est pas une mauvaise précision", () => {
    expect(gpsStatus(fix({ accuracy: null }), 1_000_000)).toBe("ok");
  });
});

describe("route et vecteur vitesse", () => {
  it("route inutilisable à très basse vitesse ou inconnue", () => {
    expect(usableTrack(fix({ groundSpeed: metersPerSecond(0.3) }))).toBeNull();
    expect(usableTrack(fix({ track: null }))).toBeNull();
    expect(usableTrack(fix())).toBe(90);
  });
  it("bulles à 1, 2 et 5 min : distance = vitesse × temps, dans la direction de la route", () => {
    const f = fix({ groundSpeed: metersPerSecond(50), track: trueDeg(90) });
    const v = speedVector(f, [1, 2, 5]);
    expect(v.map((p) => p.minutes)).toEqual([1, 2, 5]);
    expect(distance(f.position, v[0]!.position)).toBeCloseTo(3000, 2);
    expect(distance(f.position, v[1]!.position)).toBeCloseTo(6000, 2);
    expect(distance(f.position, v[2]!.position)).toBeCloseTo(15000, 2);
    expect(initialBearing(f.position, v[0]!.position)).toBeCloseTo(90, 1);
  });
  it("pas de vecteur sans route exploitable", () => {
    expect(speedVector(fix({ track: null }), [1, 2])).toEqual([]);
    expect(speedVector(fix({ groundSpeed: null }), [1])).toEqual([]);
  });
});

describe("filtre de plafond", () => {
  it("FL100 = 3048 m", () => expect(flightLevelToMeters(100)).toBeCloseTo(3048, 6));
  it("plancher sous le filtre : visible ; au-dessus ou égal : masqué", () => {
    expect(isAirspaceVisible({ reference: "FL", value: 65 }, 115)).toBe(true);
    expect(isAirspaceVisible({ reference: "FL", value: 115 }, 115)).toBe(false);
    expect(isAirspaceVisible({ reference: "FL", value: 195 }, 115)).toBe(false);
    expect(isAirspaceVisible({ reference: "AMSL", value: 1000 }, 115)).toBe(true);
    expect(isAirspaceVisible({ reference: "AMSL", value: 4000 }, 100)).toBe(false);
  });
  it("plancher AGL ou inconnu : toujours visible", () => {
    expect(isAirspaceVisible({ reference: "AGL", value: 9000 }, 10)).toBe(true);
    expect(isAirspaceVisible(null, 10)).toBe(true);
  });
});
