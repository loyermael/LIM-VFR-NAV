import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  Gdl90Deframer, crc16, decodeGdl90, encodeReport, frameGdl90, nmeaChecksum, nmeaChecksumOk, parsePflaa, parsePflau, parseXGps,
  TrafficTable, proximityLevel, streamState, TRAFFIC_DROP_S, TRAFFIC_STALE_S, type Gdl90Report,
} from "./index";

const rep = (over: Partial<Gdl90Report> = {}): Gdl90Report => ({
  address: "3944EF", addressType: 0, alert: false, lat: 46.6, lon: 2.35, pressureAltitudeM: 1000, groundSpeedMps: 50, verticalSpeedMps: 2,
  track: 90, airborne: true, callsign: "FGABC", emitterCategory: 1, ...over,
});

describe("CRC-16 GDL90", () => {
  it("valeur de contrôle publique de CRC-16/XMODEM (poly 0x1021, init 0) sur « 123456789 » = 0x31C3", () => {
    expect(crc16(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });
});

describe("GDL90 : trames et messages", () => {
  it("trame → messages : aller-retour d'un rapport de trafic", () => {
    const d = new Gdl90Deframer();
    const [msg] = d.push(frameGdl90(encodeReport(20, rep())));
    const m = decodeGdl90(msg as Uint8Array);
    expect(m.type).toBe("traffic");
    if (m.type !== "traffic") return;
    expect(m.report.address).toBe("3944EF");
    expect(m.report.callsign).toBe("FGABC");
    expect(m.report.lat).toBeCloseTo(46.6, 4);
    expect(m.report.lon).toBeCloseTo(2.35, 4);
    expect(m.report.pressureAltitudeM).toBeCloseTo(1000, -1); // pas de 25 ft = 7,6 m
    expect(Math.abs((m.report.pressureAltitudeM as number) - 1000)).toBeLessThan(4);
    expect(m.report.groundSpeedMps).toBeCloseTo(50, 0);
    expect(m.report.track).toBeCloseTo(90, 0);
    expect(m.report.airborne).toBe(true);
    expect(m.report.verticalSpeedMps).toBeCloseTo(2, 0);
  });
  it("propriété : position, y compris hémisphères sud et ouest, retrouvée à 2,2e-5° près", () => {
    fc.assert(fc.property(fc.double({ min: -89, max: 89, noNaN: true }), fc.double({ min: -179, max: 179, noNaN: true }), (lat, lon) => {
      const m = decodeGdl90(new Gdl90Deframer().push(frameGdl90(encodeReport(10, rep({ lat, lon }))))[0] as Uint8Array);
      expect(m.type).toBe("ownship");
      if (m.type !== "ownship") return;
      expect(Math.abs(m.report.lat - lat)).toBeLessThan(2.2e-5);
      expect(Math.abs(m.report.lon - lon)).toBeLessThan(2.2e-5);
    }), { numRuns: 300 });
  });
  it("valeurs invalides : altitude, vitesse, taux vertical, route → null", () => {
    const m = decodeGdl90(new Gdl90Deframer().push(frameGdl90(encodeReport(20, rep({ pressureAltitudeM: null, groundSpeedMps: null, verticalSpeedMps: null, track: null }))))[0] as Uint8Array);
    if (m.type !== "traffic") throw new Error("type");
    expect(m.report.pressureAltitudeM).toBeNull();
    expect(m.report.groundSpeedMps).toBeNull();
    expect(m.report.verticalSpeedMps).toBeNull();
    expect(m.report.track).toBeNull();
  });
  it("taux vertical négatif (descente) conservé", () => {
    const m = decodeGdl90(new Gdl90Deframer().push(frameGdl90(encodeReport(20, rep({ verticalSpeedMps: -3 }))))[0] as Uint8Array);
    if (m.type !== "traffic") throw new Error("type");
    expect(m.report.verticalSpeedMps).toBeLessThan(-2.5);
    expect(m.report.verticalSpeedMps).toBeGreaterThan(-3.5);
  });
  it("échappement : octets 0x7E et 0x7D dans les données ; trame coupée en deux paquets ; plusieurs trames dans un paquet", () => {
    const body = Uint8Array.from([0x07, 0x7e, 0x7d, 0x00, 0x7e, 0x7d, 0x55]);
    const f = frameGdl90(body);
    expect(f.filter((b) => b === 0x7e)).toHaveLength(2); // seuls les fanions : les 0x7E des données sont échappés
    const d = new Gdl90Deframer();
    expect(d.push(f.slice(0, 4))).toHaveLength(0);
    const out = d.push(f.slice(4));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0] as Uint8Array)).toEqual(Array.from(body));
    const two = new Uint8Array([...frameGdl90(Uint8Array.from([1, 2])), ...frameGdl90(Uint8Array.from([3, 4, 5]))]);
    expect(new Gdl90Deframer().push(two).map((m) => Array.from(m))).toEqual([[1, 2], [3, 4, 5]]);
  });
  it("CRC faux : trame écartée et comptée, la suivante est lue normalement", () => {
    const bad = frameGdl90(Uint8Array.from([1, 2, 3]));
    bad[2] = (bad[2] as number) ^ 0xff;
    const d = new Gdl90Deframer();
    const out = d.push(new Uint8Array([...bad, ...frameGdl90(Uint8Array.from([9, 9]))]));
    expect(out.map((m) => Array.from(m))).toEqual([[9, 9]]);
    expect(d.badCrc).toBe(1);
  });
  it("heartbeat et altitude géométrique", () => {
    const hb = decodeGdl90(Uint8Array.from([0, 0x81, 0x01, 0x10, 0x0e, 0, 0]));
    expect(hb).toMatchObject({ type: "heartbeat", gpsValid: true, utcOk: true, secondsSinceMidnight: 0x0e10 });
    expect(decodeGdl90(Uint8Array.from([11, 0x01, 0x90, 0, 0]))).toEqual({ type: "ownshipGeoAltitude", altitudeM: 400 * 5 * 0.3048 });
    expect(decodeGdl90(Uint8Array.from([11, 0xff, 0xfe, 0, 0]))).toEqual({ type: "ownshipGeoAltitude", altitudeM: -2 * 5 * 0.3048 });
  });
  it("message inconnu ou trop court : pas d'erreur", () => {
    expect(decodeGdl90(Uint8Array.from([99, 1]))).toEqual({ type: "unknown", id: 99 });
    expect(decodeGdl90(Uint8Array.from([20, 1, 2]))).toEqual({ type: "unknown", id: 20 });
  });
});

describe("NMEA / FLARM", () => {
  it("checksum : exemple NMEA publié $GPGGA…*47", () => {
    const body = "GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    expect(nmeaChecksum(body)).toBe("47");
    expect(nmeaChecksumOk(`$${body}*47`)).toBe(true);
    expect(nmeaChecksumOk(`$${body}*48`)).toBe(false);
    expect(nmeaChecksumOk(`$${body}`)).toBe(false);
  });
  const mk = (body: string) => `$${body}*${nmeaChecksum(body)}`;
  it("PFLAA : trafic relatif lu", () => {
    const p = parsePflaa(mk("PFLAA,0,-1234,2345,150,2,DD8F12,180,,30,-1.4,1"))!;
    expect(p).toMatchObject({ alarmLevel: 0, relNorthM: -1234, relEastM: 2345, relVerticalM: 150, idType: 2, id: "DD8F12", track: 180, groundSpeedMps: 30, climbRateMps: -1.4, aircraftType: 1 });
  });
  it("PFLAA : checksum faux, champs manquants, mauvaise sentence → null", () => {
    expect(parsePflaa("$PFLAA,0,-1234,2345,150,2,DD8F12,180,,30,-1.4,1*00")).toBeNull();
    expect(parsePflaa(mk("PFLAA,0,x,2345,150,2,DD8F12,180,,30,-1.4,1"))).toBeNull();
    expect(parsePflaa(mk("PFLAA,0,1,2"))).toBeNull();
    expect(parsePflaa(mk("GPGGA,1,2,3,4,5,6,7,8,9,10,11,12"))).toBeNull();
  });
  it("PFLAU : état", () => {
    expect(parsePflau(mk("PFLAU,3,1,2,1,0"))).toEqual({ rx: 3, tx: true, gps: 2, alarmLevel: 0 });
    expect(parsePflau(mk("PFLAU,3,1,2,1,2"))?.alarmLevel).toBe(2);
    expect(parsePflau(mk("PFLAU,x"))).toBeNull();
  });
});

describe("X-Plane XGPS", () => {
  it("datagramme publié lu ; route normalisée", () => {
    expect(parseXGps("XGPSMy Sim,-122.3,47.9,1000.5,370.0,45.2")).toEqual({ name: "My Sim", lon: -122.3, lat: 47.9, altitudeMslM: 1000.5, trackTrue: 10, groundSpeedMps: 45.2 });
  });
  it("refuse : autre datagramme, champ non numérique, latitude folle", () => {
    expect(parseXGps("XATT1,1,2,3")).toBeNull();
    expect(parseXGps("XGPSsim,a,1,2,3,4")).toBeNull();
    expect(parseXGps("XGPSsim,10,95,2,3,4")).toBeNull();
    expect(parseXGps("XGPSsim,10,40,2")).toBeNull();
  });
});

describe("table de trafic", () => {
  const own = { lat: 46.6, lon: 2.35 } as never;
  it("GDL90 : altitude relative d'après l'altitude pression de l'avion ; distance et relèvement", () => {
    const t = new TrafficTable();
    t.setOwnship({ lat: 46.6, lon: 2.35, pressureAltM: 1000 });
    t.ingestGdl90(rep({ lat: 46.7, lon: 2.35, pressureAltitudeM: 1300 }), 1000);
    const [v] = t.snapshot(1000, own);
    expect(v!.relAltM).toBeCloseTo(300, 0);
    expect(v!.distanceM).toBeGreaterThan(11000);
    expect(v!.distanceM).toBeLessThan(11200);
    expect(v!.bearing).toBeCloseTo(0, 1);
    expect(v!.label).toBe("FGABC");
  });
  it("sans altitude de l'avion : altitude relative inconnue, jamais zéro", () => {
    const t = new TrafficTable();
    t.ingestGdl90(rep(), 0);
    expect(t.snapshot(0, own)[0]!.relAltM).toBeNull();
  });
  it("FLARM : position relative (nord 1000 m, est 0) → 1 km au nord, altitude relative reprise", () => {
    const t = new TrafficTable();
    t.ingestFlarm(parsePflaa(`$PFLAA,0,1000,0,-50,2,AB12CD,90,,30,0,1*${nmeaChecksum("PFLAA,0,1000,0,-50,2,AB12CD,90,,30,0,1")}`)!, own, 0);
    const v = t.snapshot(0, own)[0]!;
    expect(v.distanceM).toBeCloseTo(1000, 0);
    expect(v.bearing).toBeCloseTo(0, 3);
    expect(v.relAltM).toBe(-50);
  });
  it("péremption : grisée après 10 s, supprimée après 30 s ; tri par distance", () => {
    const t = new TrafficTable();
    t.setOwnship({ lat: 46.6, lon: 2.35, pressureAltM: 0 });
    t.ingestGdl90(rep({ address: "000001", callsign: "LOIN", lat: 47.2 }), 0);
    t.ingestGdl90(rep({ address: "000002", callsign: "PROCHE", lat: 46.65 }), 0);
    expect(t.snapshot(0, own).map((x) => x.label)).toEqual(["PROCHE", "LOIN"]);
    expect(t.snapshot((TRAFFIC_STALE_S + 1) * 1000, own).every((x) => x.stale)).toBe(true);
    expect(t.snapshot((TRAFFIC_DROP_S + 1) * 1000, own)).toHaveLength(0);
  });
  it("une cible mise à jour remplace l'ancienne (même adresse)", () => {
    const t = new TrafficTable();
    t.ingestGdl90(rep({ lat: 46.7 }), 0);
    t.ingestGdl90(rep({ lat: 46.8 }), 1000);
    const s = t.snapshot(1000, own);
    expect(s).toHaveLength(1);
    expect(s[0]!.lat).toBeCloseTo(46.8, 4);
  });
  it("niveau : alerte de l'émetteur reprise, proximité jugée sur position instantanée", () => {
    expect(proximityLevel(1000, 100)).toBe(2);
    expect(proximityLevel(2500, 100)).toBe(1);
    expect(proximityLevel(1000, 200)).toBe(1); // 200 m d'écart > 500 ft : plus « alerte », reste « attention »
    expect(proximityLevel(1000, 400)).toBe(0); // > 1 000 ft : rien
    expect(proximityLevel(8000, 50)).toBe(0);
    expect(proximityLevel(500, null)).toBe(0); // altitude inconnue : pas d'alerte inventée
    expect(proximityLevel(Number.NaN, 0)).toBe(0);
    const t = new TrafficTable();
    t.ingestFlarm(parsePflaa(`$PFLAA,3,5000,0,0,2,AB12CD,90,,30,0,1*${nmeaChecksum("PFLAA,3,5000,0,0,2,AB12CD,90,,30,0,1")}`)!, own, 0);
    expect(t.snapshot(0, own)[0]!.level).toBe(3);
  });
});

describe("état d'un flux", () => {
  it("aucun / ok / périmé / perdu (même logique que le GPS)", () => {
    expect(streamState(null, 1000)).toBe("none");
    expect(streamState(1000, 2000)).toBe("ok");
    expect(streamState(0, 6000)).toBe("stale");
    expect(streamState(0, 16000)).toBe("lost");
  });
});
