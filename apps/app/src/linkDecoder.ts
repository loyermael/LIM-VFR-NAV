import {
  Gdl90Deframer, TrafficTable, decodeGdl90, meters, metersPerSecond, parsePflaa, parsePflau, parseXGps, trueDeg,
  type GpsFix, type LatLon,
} from "@lim/core";

export type LinkKind = "gdl90" | "xplane" | "nmea";

/** Décode les datagrammes retransmis par le pont (GDL90, X-Plane, NMEA FLARM) : trafic, position de l'avion, état du flux. */
export class LinkDecoder {
  readonly table = new TrafficTable();
  lastMsgMs: number | null = null;
  messages = 0;
  /** Nombre d'aéronefs FLARM reçus selon le boîtier (PFLAU), ou null. */
  flarmRx: number | null = null;
  private readonly deframer = new Gdl90Deframer();
  private geoAltitudeM: number | null = null;
  private ownPos: LatLon | null = null;
  private nmeaBuf = "";

  /**
   * @param deviceOwnPos position de l'avion donnée par l'appareil (repli pour placer les cibles FLARM, qui sont relatives)
   * @param onFix appelé avec la position de l'avion fournie par la source externe (ownship GDL90, XGPS X-Plane)
   */
  constructor(private readonly deviceOwnPos: () => LatLon | null, private readonly onFix: (f: GpsFix) => void) {}

  get badCrc(): number {
    return this.deframer.badCrc;
  }

  handle(kind: LinkKind, data: Uint8Array, nowMs: number): void {
    this.lastMsgMs = nowMs;
    this.messages++;
    if (kind === "gdl90") this.gdl90(data, nowMs);
    else if (kind === "xplane") this.xplane(data, nowMs);
    else this.nmea(data, nowMs);
  }

  private gdl90(data: Uint8Array, nowMs: number): void {
    for (const body of this.deframer.push(data)) {
      const m = decodeGdl90(body);
      if (m.type === "ownshipGeoAltitude") this.geoAltitudeM = m.altitudeM;
      else if (m.type === "ownship") {
        const r = m.report;
        this.ownPos = { lat: r.lat, lon: r.lon } as LatLon;
        this.table.setOwnship({ lat: r.lat, lon: r.lon, pressureAltM: r.pressureAltitudeM });
        // L'altitude pression n'est pas une altitude AMSL : on ne fournit une altitude que si l'altitude géométrique (ellipsoïde) a été reçue.
        this.onFix({
          timeMs: nowMs, position: this.ownPos, altitude: this.geoAltitudeM === null ? null : meters(this.geoAltitudeM), altitudeReference: "ellipsoid",
          groundSpeed: r.groundSpeedMps === null ? null : metersPerSecond(r.groundSpeedMps), track: r.track === null ? null : trueDeg(r.track), accuracy: null,
        });
      } else if (m.type === "traffic") this.table.ingestGdl90(m.report, nowMs);
    }
  }

  private xplane(data: Uint8Array, nowMs: number): void {
    const g = parseXGps(new TextDecoder().decode(data));
    if (!g) return;
    this.ownPos = { lat: g.lat, lon: g.lon } as LatLon;
    this.table.setOwnship({ lat: g.lat, lon: g.lon, pressureAltM: null });
    this.onFix({
      timeMs: nowMs, position: this.ownPos, altitude: meters(g.altitudeMslM), altitudeReference: "msl",
      groundSpeed: metersPerSecond(g.groundSpeedMps), track: trueDeg(g.trackTrue), accuracy: null,
    });
  }

  private nmea(data: Uint8Array, nowMs: number): void {
    this.nmeaBuf += new TextDecoder().decode(data);
    const lines = this.nmeaBuf.split(/\r?\n/);
    this.nmeaBuf = lines.pop() ?? "";
    if (this.nmeaBuf.length > 2000) this.nmeaBuf = "";
    for (const line of lines) {
      const a = parsePflaa(line);
      if (a) {
        const own = this.ownPos ?? this.deviceOwnPos();
        if (own) this.table.ingestFlarm(a, own, nowMs);
        continue;
      }
      const u = parsePflau(line);
      if (u) this.flarmRx = u.rx;
    }
  }
}
