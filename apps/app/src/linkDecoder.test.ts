import { describe, expect, it } from "vitest";
import { encodeReport, frameGdl90, nmeaChecksum, type Gdl90Report, type GpsFix, type LatLon } from "@lim/core";
import { LinkDecoder } from "./linkDecoder";
import { parseBridgeMessage } from "./linkClient";

const rep = (over: Partial<Gdl90Report> = {}): Gdl90Report => ({
  address: "ABCDEF", addressType: 0, alert: false, lat: 46.6, lon: 2.35, pressureAltitudeM: 1000, groundSpeedMps: 46, verticalSpeedMps: 0,
  track: 90, airborne: true, callsign: "OWN", emitterCategory: 1, ...over,
});
const cat = (...a: Uint8Array[]) => Uint8Array.from(a.flatMap((x) => [...x]));
const own = { lat: 46.6, lon: 2.35 } as LatLon;

function setup() {
  const fixes: GpsFix[] = [];
  const d = new LinkDecoder(() => own, (f) => fixes.push(f));
  return { d, fixes };
}

describe("décodeur de flux (GDL90 / X-Plane / FLARM)", () => {
  it("GDL90 : l'ownship donne la position de l'avion, sans altitude tant que l'altitude géométrique n'est pas reçue", () => {
    const { d, fixes } = setup();
    d.handle("gdl90", frameGdl90(encodeReport(10, rep())), 5000);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]!.position.lat).toBeCloseTo(46.6, 4);
    expect(fixes[0]!.altitude).toBeNull(); // l'altitude pression n'est pas de l'AMSL : jamais présentée comme telle
    expect(fixes[0]!.groundSpeed).toBeCloseTo(46, 0);
    expect(d.lastMsgMs).toBe(5000);
  });
  it("GDL90 : l'altitude géométrique reçue avant l'ownship devient l'altitude ellipsoïdale du fix", () => {
    const { d, fixes } = setup();
    d.handle("gdl90", cat(frameGdl90(Uint8Array.from([11, 0x01, 0x90, 0, 0])), frameGdl90(encodeReport(10, rep()))), 1000);
    expect(fixes[0]!.altitudeReference).toBe("ellipsoid");
    expect(fixes[0]!.altitude).toBeCloseTo(400 * 5 * 0.3048, 6);
  });
  it("GDL90 : trafic avec altitude relative calculée à partir de l'altitude pression de l'ownship", () => {
    const { d } = setup();
    d.handle("gdl90", cat(frameGdl90(encodeReport(10, rep())), frameGdl90(encodeReport(20, rep({ address: "111111", callsign: "AUTRE", lat: 46.62, pressureAltitudeM: 1300 })))), 1000);
    const [t] = d.table.snapshot(1000, own);
    expect(t!.label).toBe("AUTRE");
    expect(Math.abs((t!.relAltM as number) - 300)).toBeLessThan(8);
  });
  it("GDL90 : une trame au CRC faux est comptée et n'entre pas dans la table", () => {
    const { d } = setup();
    const f = frameGdl90(encodeReport(20, rep({ address: "222222" })));
    f[6] = (f[6] as number) ^ 0x55;
    d.handle("gdl90", f, 1000);
    expect(d.badCrc).toBe(1);
    expect(d.table.snapshot(1000, own)).toHaveLength(0);
  });
  it("X-Plane : XGPS devient un fix avec altitude AMSL", () => {
    const { d, fixes } = setup();
    d.handle("xplane", new TextEncoder().encode("XGPSsim,2.35,46.6,1000,90,45"), 1000);
    expect(fixes[0]).toMatchObject({ altitudeReference: "msl", altitude: 1000 });
    expect(fixes[0]!.position.lon).toBeCloseTo(2.35, 6);
  });
  it("FLARM : sentence coupée entre deux paquets recomposée ; cible placée par rapport à la position de l'avion", () => {
    const { d } = setup();
    const body = "PFLAA,0,1000,0,-50,2,AB12CD,90,,30,0,1";
    const line = `$${body}*${nmeaChecksum(body)}\r\n`;
    d.handle("nmea", new TextEncoder().encode(line.slice(0, 15)), 1000);
    expect(d.table.snapshot(1000, own)).toHaveLength(0);
    d.handle("nmea", new TextEncoder().encode(line.slice(15)), 1001);
    const [t] = d.table.snapshot(1001, own);
    expect(t!.distanceM).toBeCloseTo(1000, 0);
  });
  it("FLARM : PFLAU met à jour le nombre d'aéronefs reçus ; sentence au checksum faux ignorée", () => {
    const { d } = setup();
    const body = "PFLAU,3,1,2,1,0";
    d.handle("nmea", new TextEncoder().encode(`$${body}*${nmeaChecksum(body)}\n$PFLAA,0,1,1,1,2,AAAAAA,0,,0,0,1*00\n`), 1000);
    expect(d.flarmRx).toBe(3);
    expect(d.table.snapshot(1000, own)).toHaveLength(0);
  });
  it("messages du pont : base64 décodé, types inconnus et JSON cassé refusés", () => {
    const ok = parseBridgeMessage(JSON.stringify({ k: "gdl90", d: btoa("\x7e\x01\x02") }));
    expect(ok?.kind).toBe("gdl90");
    expect(Array.from(ok!.data)).toEqual([0x7e, 1, 2]);
    expect(parseBridgeMessage(JSON.stringify({ k: "autre", d: "AA==" }))).toBeNull();
    expect(parseBridgeMessage("pas du json")).toBeNull();
    expect(parseBridgeMessage(JSON.stringify({ k: "nmea", d: 5 }))).toBeNull();
    expect(parseBridgeMessage(JSON.stringify({ k: "nmea", d: "***" }))).toBeNull();
  });
});
