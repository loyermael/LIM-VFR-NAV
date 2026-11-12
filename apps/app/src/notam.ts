/**
 * NOTAM : analyse du format OACI (Q, A à G), pertinence pour un vol (terrains, couloir de route, fenêtre de temps) et récupération par API.
 * Les NOTAM de l'application ne remplacent JAMAIS le briefing officiel (SIA : NOTAMWEB, SOFIA) : source, date de réception et avertissement sont toujours affichés.
 */
import { distance, type Airfield, type LatLon } from "@lim/core";
import { tx } from "./db";

export interface Notam {
  /** Numéro OACI, ex. « A1234/26 ». */
  readonly id: string;
  readonly kind: "N" | "R" | "C";
  /** NOTAM remplacé ou annulé (NOTAMR / NOTAMC). */
  readonly replaces: string | null;
  readonly fir: string;
  /** Code Q complet, ex. « QMRLC » (sujet puis état). */
  readonly qcode: string;
  readonly lowerFl: number | null;
  readonly upperFl: number | null;
  /** Centre et rayon de la zone concernée (ligne Q), sinon null. */
  readonly lat: number | null;
  readonly lon: number | null;
  readonly radiusNm: number | null;
  /** Lieux du champ A (terrains ou FIR). */
  readonly locations: readonly string[];
  readonly fromMs: number | null;
  /** Fin de validité (ms UTC), null si permanent. */
  readonly toMs: number | null;
  readonly estimated: boolean;
  readonly schedule: string;
  readonly text: string;
  readonly lowerText: string;
  readonly upperText: string;
  readonly raw: string;
}

export interface NotamSet {
  readonly id: "notam";
  readonly importedAtMs: number;
  /** D'où viennent les NOTAM : « texte » (importé par l'utilisateur) ou le nom du service interrogé. */
  readonly source: string;
  readonly items: Notam[];
}

const yymmdd = (s: string): number | null => {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, yy, mo, dd, hh, mi] = m;
  const t = Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi));
  return Number.isFinite(t) ? t : null;
};

/** Ligne Q : « LFFF/QMRLC/IV/NBO/A/000/999/4509N00623E005 ». */
function parseQ(q: string): { fir: string; qcode: string; lowerFl: number | null; upperFl: number | null; lat: number | null; lon: number | null; radiusNm: number | null } {
  const p = q.split("/").map((x) => x.trim());
  const coord = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})?$/.exec(p[7] ?? "");
  const fl = (v: string | undefined) => (v !== undefined && /^\d{3}$/.test(v) ? Number(v) : null);
  return {
    fir: p[0] ?? "",
    qcode: p[1] ?? "",
    lowerFl: fl(p[5]),
    upperFl: fl(p[6]),
    lat: coord ? (Number(coord[1]) + Number(coord[2]) / 60) * (coord[3] === "S" ? -1 : 1) : null,
    lon: coord ? (Number(coord[4]) + Number(coord[5]) / 60) * (coord[6] === "W" ? -1 : 1) : null,
    radiusNm: coord && coord[7] ? Number(coord[7]) : null,
  };
}

/** Découpe un texte contenant un ou plusieurs NOTAM (format OACI, avec ou sans parenthèses) et les analyse. Les blocs illisibles sont ignorés. */
export function parseNotams(text: string): Notam[] {
  const src = text.replace(/\r/g, "");
  const head = /\(?\s*([A-Z]\d{4}\/\d{2})\s+NOTAM([NRC])(?:\s+([A-Z]\d{4}\/\d{2}))?/g;
  const starts: { at: number; id: string; kind: "N" | "R" | "C"; replaces: string | null; end: number }[] = [];
  for (let m = head.exec(src); m; m = head.exec(src)) starts.push({ at: m.index, id: m[1]!, kind: m[2] as "N" | "R" | "C", replaces: m[3] ?? null, end: m.index + m[0].length });
  const out: Notam[] = [];
  starts.forEach((s, i) => {
    const raw = src.slice(s.at, starts[i + 1]?.at ?? src.length).trim().replace(/^\(\s*/, "").replace(/\)\s*$/, "");
    const body = src.slice(s.end, starts[i + 1]?.at ?? src.length);
    const marks = [...body.matchAll(/(?:^|\s)([QABCDEFG])\)\s*/g)];
    const fields: Record<string, string> = {};
    let last = -1;
    const kept: { k: string; at: number; end: number }[] = [];
    for (const mk of marks) {
      const idx = "QABCDEFG".indexOf(mk[1]!);
      if (idx <= last) continue; // une lettre déjà passée appartient au texte
      last = idx;
      kept.push({ k: mk[1]!, at: mk.index!, end: mk.index! + mk[0].length });
    }
    kept.forEach((k, j) => { fields[k.k] = body.slice(k.end, kept[j + 1]?.at ?? body.length).replace(/\)\s*$/, "").trim(); });
    if (!fields["Q"] || !fields["A"]) return;
    const q = parseQ(fields["Q"]);
    const b = fields["B"] ? yymmdd(fields["B"].split(/\s+/)[0] ?? "") : null;
    const cRaw = fields["C"] ?? "";
    const permanent = /^PERM/i.test(cRaw);
    const c = permanent ? null : yymmdd(cRaw.split(/\s+/)[0] ?? "");
    out.push({
      id: s.id, kind: s.kind, replaces: s.replaces, fir: q.fir, qcode: q.qcode, lowerFl: q.lowerFl, upperFl: q.upperFl, lat: q.lat, lon: q.lon, radiusNm: q.radiusNm,
      locations: fields["A"].split(/\s+/).filter((x) => /^[A-Z]{4}$/.test(x)),
      fromMs: b, toMs: c, estimated: /EST\s*$/i.test(cRaw), schedule: fields["D"] ?? "", text: (fields["E"] ?? "").replace(/\s+/g, " ").trim(),
      lowerText: fields["F"] ?? "", upperText: fields["G"] ?? "", raw,
    });
  });
  return out;
}

/** Réunit des NOTAM par numéro (le plus récent écrase) et retire ceux annulés ou remplacés par un NOTAMC / NOTAMR présent. */
export function mergeNotams(existing: readonly Notam[], incoming: readonly Notam[]): Notam[] {
  const byId = new Map<string, Notam>();
  for (const n of [...existing, ...incoming]) byId.set(n.id, n);
  const gone = new Set<string>();
  for (const n of byId.values()) if ((n.kind === "C" || n.kind === "R") && n.replaces) gone.add(n.replaces);
  return [...byId.values()].filter((n) => !gone.has(n.id) && n.kind !== "C");
}

/** Sujet du code Q (2e et 3e lettres) en clair, pour les cas courants ; sinon le code brut. */
const SUBJECTS: Record<string, string> = {
  MR: "Piste", MX: "Voie de circulation", MA: "Aire de mouvement", MN: "Aire de manœuvre", MS: "Aire de stationnement", MK: "Aire d'atterrissage",
  FA: "Aérodrome", FF: "Sauvetage et incendie", FU: "Carburant", FC: "Service de la circulation", LA: "Balisage lumineux d'approche", LP: "Balisage PAPI/VASI",
  LR: "Balisage de piste", LX: "Balisage de voie de circulation", OB: "Obstacle", OL: "Balisage d'obstacle", IC: "ILS", ID: "DME", NB: "NDB", NV: "VOR",
  RD: "Zone dangereuse", RP: "Zone interdite", RR: "Zone réglementée", RT: "Zone réglementée temporaire", RA: "Réservation d'espace", RM: "Zone militaire",
  WP: "Parachutage", WU: "Aéronefs sans pilote", WE: "Exercice", WF: "Feux d'artifice", WG: "Tir", WM: "Mise à feu", WD: "Démonstration", WA: "Meeting aérien",
  WV: "Vol en formation", WL: "Activité aérienne", WB: "Vol acrobatique", WH: "Vol de ballon", AA: "Espace aérien", AC: "Zone de contrôle", AT: "Classe", CA: "Radio",
  SA: "ATIS", SE: "Information de vol", SP: "Contrôle d'approche", SV: "VOLMET", GA: "GNSS", PA: "Procédure d'approche", PD: "Départ normalisé", PI: "Approche aux instruments",
  XX: "Divers", GW: "Brouillage GNSS",
};
export function notamSubject(qcode: string): string {
  const k = qcode.slice(1, 3);
  return SUBJECTS[k] ?? qcode;
}

export type NotamRole = "dep" | "arr" | "via" | "alt" | "route" | "other";
export interface RelevantNotam { readonly notam: Notam; readonly role: NotamRole; readonly during: boolean }

/** Distance (m) d'un point à une route (polyligne échantillonnée tous les 4 km). */
function distanceToRoute(p: LatLon, pts: readonly LatLon[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = distance(a, b);
    const n = Math.max(1, Math.ceil(len / 4000));
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const q = { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
      best = Math.min(best, distance(p, q));
    }
  }
  if (pts.length === 1) best = distance(p, pts[0]!);
  return best;
}

/** Terrains (codes OACI) proches d'un point : ceux du lieu même, à 3 km. */
export function icaoAt(p: LatLon, airfields: readonly Airfield[], maxM = 3000): string | null {
  let best: { icao: string; d: number } | null = null;
  for (const a of airfields) {
    if (!a.icao) continue;
    const d = distance(p, a.position);
    if (d <= maxM && (!best || d < best.d)) best = { icao: a.icao, d };
  }
  return best?.icao ?? null;
}

/**
 * Terrains de dégagement probables : terrains publics (piste de 500 m ou plus, en dur ou en herbe) hors terrains du vol, choisis
 * (1) à moins de 12 NM de la route, les plus proches d'abord (les pistes en dur gagnent 3 NM), et (2) parmi les 3 plus proches de l'arrivée (30 NM).
 * Rend des codes OACI, au plus `max`.
 */
export function likelyAlternates(route: readonly { position: LatLon }[], airfields: readonly Airfield[], max = 6): string[] {
  const pts = route.map((p) => p.position);
  if (pts.length === 0) return [];
  const used = new Set(pts.map((p) => icaoAt(p, airfields)).filter((x): x is string => x !== null));
  const ok = (a: Airfield) => !!a.icao && !a.private && !used.has(a.icao) && a.runways.some((r) => (r.lengthM ?? 0) >= 500);
  const paved = (a: Airfield) => a.runways.some((r) => r.paved === true);
  const cand = airfields.filter(ok);
  const arrival = pts[pts.length - 1]!;
  const nearArrival = cand.map((a) => ({ a, d: distance(arrival, a.position) })).filter((x) => x.d <= 30 * 1852).sort((x, y) => x.d - y.d).slice(0, 3).map((x) => x.a.icao!);
  const nearRoute = cand
    .map((a) => ({ a, d: distanceToRoute(a.position, pts) - (paved(a) ? 3 * 1852 : 0) }))
    .filter((x) => x.d <= 12 * 1852)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.a.icao!);
  return [...new Set([...nearArrival, ...nearRoute])].slice(0, max);
}

/**
 * NOTAM utiles pour un vol, classés : terrain de départ, d'arrivée, autres points de la route posés sur un terrain, terrains de dégagement
 * probables, puis dangers sur la route (grue, zone temporaire, drones, parachutage…) dont la zone (ligne Q) touche un couloir de 10 NM.
 * Seuls les NOTAM valides pendant la fenêtre [startMs, endMs] sont gardés.
 */
export function notamsForFlight(
  notams: readonly Notam[],
  route: readonly { position: LatLon }[],
  airfields: readonly Airfield[],
  win: { startMs: number; endMs: number },
  corridorNm = 10,
): RelevantNotam[] {
  const pts = route.map((p) => p.position);
  const dep = pts[0] ? icaoAt(pts[0], airfields) : null;
  const arr = pts.length > 1 ? icaoAt(pts[pts.length - 1]!, airfields) : null;
  const via = new Set(pts.slice(1, -1).map((p) => icaoAt(p, airfields)).filter((x): x is string => x !== null));
  const alts = new Set(likelyAlternates(route, airfields));
  const out: RelevantNotam[] = [];
  for (const n of notams) {
    const during = (n.fromMs === null || n.fromMs <= win.endMs) && (n.toMs === null || n.toMs >= win.startMs);
    if (!during) continue;
    let role: NotamRole | null = null;
    if (dep && n.locations.includes(dep)) role = "dep";
    else if (arr && n.locations.includes(arr)) role = "arr";
    else if (n.locations.some((l) => via.has(l))) role = "via";
    else if (n.locations.some((l) => alts.has(l))) role = "alt";
    else if (n.lat !== null && n.lon !== null && pts.length > 0) {
      const radiusM = (n.radiusNm ?? 0) * 1852;
      // zone très étendue (rayon 999 NM = toute la FIR) : on ne la rattache pas à la route par la géométrie
      if (radiusM < 300 * 1852 && distanceToRoute({ lat: n.lat, lon: n.lon }, pts) <= radiusM + corridorNm * 1852) role = "route";
    }
    if (role) out.push({ notam: n, role, during });
  }
  const order: Record<NotamRole, number> = { dep: 0, arr: 1, via: 2, alt: 3, route: 4, other: 5 };
  return out.sort((a, b) => order[a.role] - order[b.role] || a.notam.locations.join().localeCompare(b.notam.locations.join()) || a.notam.id.localeCompare(b.notam.id));
}

/** NOTAM encore en vigueur (ou à venir) sur un terrain, pour sa fiche. */
export function notamsAtAirfield(notams: readonly Notam[], icao: string | null, nowMs: number): Notam[] {
  if (!icao) return [];
  return notams.filter((n) => n.locations.includes(icao) && (n.toMs === null || n.toMs >= nowMs));
}

// ---- stockage (hors-ligne)
export const loadNotams = (): Promise<NotamSet | null> =>
  tx("weather", "readonly", (s) => s.get("notam") as IDBRequest<NotamSet | undefined>).then((x) => x ?? null);
export const saveNotams = (set: NotamSet): Promise<IDBValidKey> => tx("weather", "readwrite", (s) => s.put(set));
export const deleteNotams = (): Promise<undefined> => tx("weather", "readwrite", (s) => s.delete("notam"));

// ---- API (clé personnelle) — service ICAO « API Data Service » (non testé avec une vraie clé)
export const ICAO_NOTAM_URL = "https://applications.icao.int/dataservices/api/notams-realtime-list";
/** Les cinq FIR métropolitaines (NOTAM valables sur toute une région). */
export const FRENCH_FIRS = ["LFFF", "LFEE", "LFBB", "LFMM", "LFRR"] as const;

/** Réponse de l'API : un tableau d'objets dont le champ `all` (ou `message`) contient le NOTAM complet au format OACI. */
export function notamsFromApi(json: unknown): Notam[] {
  if (!Array.isArray(json)) throw new Error("réponse inattendue du service");
  const texts: string[] = [];
  for (const o of json) {
    if (typeof o !== "object" || o === null) continue;
    const r = o as Record<string, unknown>;
    const full = typeof r["all"] === "string" ? r["all"] : typeof r["message"] === "string" ? r["message"] : "";
    if (full) texts.push(full);
  }
  return parseNotams(texts.join("\n\n"));
}

export async function fetchIcaoNotams(locations: readonly string[], apiKey: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<Notam[]> {
  const url = `${ICAO_NOTAM_URL}?api_key=${encodeURIComponent(apiKey)}&format=json&criticality=&locations=${locations.join(",")}`;
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Service injoignable : réseau coupé, ou service qui refuse les appels depuis l'application.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Clé refusée par le service (vérifie-la).");
  if (!res.ok) throw new Error(`Service indisponible (HTTP ${res.status}).`);
  return notamsFromApi(await res.json());
}
