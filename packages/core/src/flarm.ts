/**
 * FLARM / PowerFLARM et compatibles : sentences NMEA propriétaires $PFLAA (trafic) et $PFLAU (état).
 * Écrit d'après la spécification « FLARM Data Port » telle que je la connais ; testé avec des sentences construites,
 * PAS validé contre un vrai boîtier. Positions relatives en mètres (nord, est), altitude relative en mètres.
 */
export function nmeaChecksum(body: string): string {
  let c = 0;
  for (const ch of body) c ^= ch.charCodeAt(0);
  return c.toString(16).toUpperCase().padStart(2, "0");
}

/** Vrai si la sentence « $...*HH » a un checksum correct ; une sentence sans checksum est refusée. */
export function nmeaChecksumOk(line: string): boolean {
  const m = /^\$([^*]+)\*([0-9A-Fa-f]{2})\s*$/.exec(line.trim());
  return m !== null && nmeaChecksum(m[1] as string) === (m[2] as string).toUpperCase();
}

export interface Pflaa {
  /** 0 = aucune, 1 = alerte basse, 2 = alerte importante, 3 = alerte urgente. */
  readonly alarmLevel: number;
  readonly relNorthM: number;
  readonly relEastM: number;
  readonly relVerticalM: number;
  /** 1 = adresse OACI, 2 = adresse FLARM, 0 = aléatoire. */
  readonly idType: number;
  readonly id: string;
  readonly track: number | null;
  readonly groundSpeedMps: number | null;
  readonly climbRateMps: number | null;
  readonly aircraftType: number;
}

const num = (s: string | undefined): number | null => (s === undefined || s === "" || !/^[-+]?\d+(\.\d+)?$/.test(s) ? null : Number(s));
const fields = (line: string): string[] => line.trim().slice(1, line.trim().indexOf("*")).split(",");

export function parsePflaa(line: string): Pflaa | null {
  if (!nmeaChecksumOk(line)) return null;
  const f = fields(line);
  if (f[0] !== "PFLAA" || f.length < 12) return null;
  const n = num(f[2]), e = num(f[3]), v = num(f[4]);
  if (n === null || e === null || v === null) return null;
  return {
    alarmLevel: num(f[1]) ?? 0, relNorthM: n, relEastM: e, relVerticalM: v, idType: num(f[5]) ?? 0, id: (f[6] ?? "").toUpperCase(),
    track: num(f[7]), groundSpeedMps: num(f[9]), climbRateMps: num(f[10]), aircraftType: parseInt(f[11] ?? "0", 16) || 0,
  };
}

export interface Pflau {
  /** Nombre d'aéronefs FLARM reçus. */
  readonly rx: number;
  readonly tx: boolean;
  /** 0 = pas de GPS, 1 = 3D sans mouvement, 2 = 3D en mouvement. */
  readonly gps: number;
  readonly alarmLevel: number;
}

export function parsePflau(line: string): Pflau | null {
  if (!nmeaChecksumOk(line)) return null;
  const f = fields(line);
  if (f[0] !== "PFLAU" || f.length < 6) return null;
  const rx = num(f[1]), gps = num(f[3]);
  if (rx === null || gps === null) return null;
  return { rx, tx: f[2] === "1", gps, alarmLevel: num(f[5]) ?? 0 };
}
