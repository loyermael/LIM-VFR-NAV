/**
 * GDL90 (protocole de trafic/GPS des récepteurs ADS-B type Stratux, SkyEcho, PilotAware…), diffusé en UDP (port 4000 usuellement).
 * Écrit d'après la spécification publique FAA GDL 90 ; testé avec des trames construites par l'encodeur de ce même fichier
 * (donc cohérent avec lui-même, PAS validé contre un vrai récepteur).
 * Trames : 0x7E, message (ID + données), CRC-16 (CCITT, poids faible d'abord), 0x7E ; octets 0x7D/0x7E échappés (0x7D puis octet ^ 0x20).
 */

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    t.push(c);
  }
  return t;
})();

export function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((CRC_TABLE[(crc >> 8) ^ b] as number) ^ ((crc << 8) & 0xffff)) & 0xffff;
  return crc & 0xffff;
}

/** Encode un message (ID + données) en trame GDL90. Sert aux tests et aux simulateurs. */
export function frameGdl90(body: Uint8Array): Uint8Array {
  const crc = crc16(body);
  const raw = [...body, crc & 0xff, crc >> 8];
  const out: number[] = [0x7e];
  for (const b of raw) {
    if (b === 0x7e || b === 0x7d) out.push(0x7d, b ^ 0x20);
    else out.push(b);
  }
  out.push(0x7e);
  return Uint8Array.from(out);
}

/** Découpe un flux d'octets en messages valides (sans CRC) ; les trames au CRC faux sont comptées et écartées. */
export class Gdl90Deframer {
  badCrc = 0;
  private buf: number[] = [];
  private inFrame = false;
  private escape = false;

  push(chunk: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const b of chunk) {
      if (b === 0x7e) {
        if (this.inFrame && this.buf.length >= 3) {
          const body = Uint8Array.from(this.buf.slice(0, -2));
          const crc = (this.buf[this.buf.length - 2] as number) | ((this.buf[this.buf.length - 1] as number) << 8);
          if (crc16(body) === crc) out.push(body);
          else this.badCrc++;
        }
        this.buf = [];
        this.inFrame = true;
        this.escape = false;
        continue;
      }
      if (!this.inFrame) continue;
      if (this.escape) {
        this.buf.push(b ^ 0x20);
        this.escape = false;
      } else if (b === 0x7d) this.escape = true;
      else this.buf.push(b);
      if (this.buf.length > 600) {
        this.buf = [];
        this.inFrame = false; // trame absurde : on resynchronise
      }
    }
    return out;
  }
}

/** Rapport de position (ownship ou trafic). Unités SI ; null = information invalide dans le message. */
export interface Gdl90Report {
  /** Adresse 24 bits (hexadécimal, 6 caractères). */
  readonly address: string;
  readonly addressType: number;
  /** Alerte de trafic signalée par l'émetteur. */
  readonly alert: boolean;
  readonly lat: number;
  readonly lon: number;
  /** Altitude pression (m, référence 1013,25 hPa), ou null. */
  readonly pressureAltitudeM: number | null;
  readonly groundSpeedMps: number | null;
  /** Taux vertical (m/s), ou null. */
  readonly verticalSpeedMps: number | null;
  readonly track: number | null;
  readonly airborne: boolean;
  readonly callsign: string;
  readonly emitterCategory: number;
}

export type Gdl90Message =
  | { readonly type: "heartbeat"; readonly gpsValid: boolean; readonly utcOk: boolean; readonly secondsSinceMidnight: number }
  | { readonly type: "ownship"; readonly report: Gdl90Report }
  | { readonly type: "traffic"; readonly report: Gdl90Report }
  | { readonly type: "ownshipGeoAltitude"; readonly altitudeM: number }
  | { readonly type: "unknown"; readonly id: number };

const FT = 0.3048;
const KT = 1852 / 3600;
const FPM = 0.3048 / 60;
const s24 = (v: number) => (v & 0x800000 ? v - 0x1000000 : v);

function decodeReport(b: Uint8Array): Gdl90Report | null {
  if (b.length < 28) return null;
  const g = (i: number) => b[i] as number;
  const alt12 = (g(11) << 4) | (g(12) >> 4);
  const misc = g(12) & 0x0f;
  const hv = (g(14) << 4) | (g(15) >> 4);
  const vvRaw = ((g(15) & 0x0f) << 8) | g(16);
  const vv = vvRaw & 0x800 ? vvRaw - 0x1000 : vvRaw;
  return {
    address: ((g(2) << 16) | (g(3) << 8) | g(4)).toString(16).toUpperCase().padStart(6, "0"),
    addressType: g(1) & 0x0f,
    alert: g(1) >> 4 === 1,
    lat: (s24((g(5) << 16) | (g(6) << 8) | g(7)) * 180) / 0x800000,
    lon: (s24((g(8) << 16) | (g(9) << 8) | g(10)) * 180) / 0x800000,
    pressureAltitudeM: alt12 === 0xfff ? null : (alt12 * 25 - 1000) * FT,
    groundSpeedMps: hv === 0xfff ? null : hv * KT,
    verticalSpeedMps: vvRaw === 0x800 ? null : vv * 64 * FPM,
    track: (misc & 3) === 0 ? null : (g(17) * 360) / 256,
    airborne: (misc & 8) !== 0,
    callsign: String.fromCharCode(...b.slice(19, 27)).replace(/[^\x20-\x7e]/g, "").trim(),
    emitterCategory: g(18),
  };
}

export function decodeGdl90(b: Uint8Array): Gdl90Message {
  const id = b[0] as number;
  if (id === 0 && b.length >= 5) {
    return {
      type: "heartbeat",
      gpsValid: ((b[1] as number) & 0x80) !== 0,
      utcOk: ((b[2] as number) & 0x01) !== 0,
      secondsSinceMidnight: (((b[2] as number) & 0x80) << 9) | ((b[4] as number) << 8) | (b[3] as number),
    };
  }
  if (id === 10 || id === 20) {
    const r = decodeReport(b);
    if (r) return id === 10 ? { type: "ownship", report: r } : { type: "traffic", report: r };
  }
  if (id === 11 && b.length >= 3) {
    let a = ((b[1] as number) << 8) | (b[2] as number);
    if (a & 0x8000) a -= 0x10000;
    return { type: "ownshipGeoAltitude", altitudeM: a * 5 * FT };
  }
  return { type: "unknown", id };
}

/** Encode un rapport (ownship = 10, trafic = 20), pour les tests et les simulateurs. */
export function encodeReport(id: 10 | 20, r: Gdl90Report): Uint8Array {
  const b = new Uint8Array(28);
  b[0] = id;
  b[1] = ((r.alert ? 1 : 0) << 4) | (r.addressType & 0x0f);
  const a = parseInt(r.address, 16);
  b[2] = (a >> 16) & 255;
  b[3] = (a >> 8) & 255;
  b[4] = a & 255;
  const put24 = (i: number, deg: number) => {
    const v = Math.round((deg * 0x800000) / 180) & 0xffffff;
    b[i] = v >> 16;
    b[i + 1] = (v >> 8) & 255;
    b[i + 2] = v & 255;
  };
  put24(5, r.lat);
  put24(8, r.lon);
  const alt12 = r.pressureAltitudeM === null ? 0xfff : Math.max(0, Math.min(0xffe, Math.round((r.pressureAltitudeM / FT + 1000) / 25)));
  const misc = (r.track === null ? 0 : 1) | (r.airborne ? 8 : 0);
  b[11] = alt12 >> 4;
  b[12] = ((alt12 & 0x0f) << 4) | misc;
  b[13] = 0xbb;
  const hv = r.groundSpeedMps === null ? 0xfff : Math.min(0xffe, Math.round(r.groundSpeedMps / KT));
  const vv = r.verticalSpeedMps === null ? 0x800 : Math.round(r.verticalSpeedMps / FPM / 64) & 0xfff;
  b[14] = hv >> 4;
  b[15] = ((hv & 0x0f) << 4) | (vv >> 8);
  b[16] = vv & 255;
  b[17] = Math.round(((r.track ?? 0) / 360) * 256) & 255;
  b[18] = r.emitterCategory;
  for (let i = 0; i < 8; i++) b[19 + i] = r.callsign.charCodeAt(i) || 0x20;
  return b;
}
