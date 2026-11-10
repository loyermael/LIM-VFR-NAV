import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ageMinutes, flightCategory, latestMetarByStation, latestTafByStation, parseAwcMetars, parseAwcSigmets, parseAwcTafs,
  tafPeriodsAt, tafStatus, type Metar, type Taf,
} from "./weather";
import { pointInRings } from "./airspaceQuery";
import { feet, feetToMeters, meters, mpsToKnots } from "./units";

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/weather/${name}.json`, import.meta.url)), "utf8"));
const SM = 1609.344;
const ft = (v: number) => feetToMeters(feet(v));

describe("catégorie de vol (définitions FAA)", () => {
  it("VFR : plafond > 3000 ft et visibilité > 5 miles, ou pas de plafond", () => {
    expect(flightCategory(10 * SM, ft(5000))).toBe("VFR");
    expect(flightCategory(10 * SM, null)).toBe("VFR");
  });
  it("MVFR : plafond 1000 à 3000 ft inclus, ou visibilité 3 à 5 miles inclus", () => {
    expect(flightCategory(10 * SM, ft(3000))).toBe("MVFR");
    expect(flightCategory(5 * SM, null)).toBe("MVFR");
    expect(flightCategory(10 * SM, ft(1000))).toBe("MVFR");
  });
  it("IFR : plafond 500 à moins de 1000 ft, ou visibilité 1 à moins de 3 miles", () => {
    expect(flightCategory(10 * SM, ft(999))).toBe("IFR");
    expect(flightCategory(10 * SM, ft(500))).toBe("IFR");
    expect(flightCategory(2.9 * SM, null)).toBe("IFR");
    expect(flightCategory(3 * SM, null)).toBe("MVFR");
  });
  it("LIFR : plafond sous 500 ft ou visibilité sous 1 mile", () => {
    expect(flightCategory(10 * SM, ft(499))).toBe("LIFR");
    expect(flightCategory(0.9 * SM, null)).toBe("LIFR");
    expect(flightCategory(1 * SM, null)).toBe("IFR");
  });
  it("la pire des deux conditions l'emporte ; visibilité inconnue : pas de catégorie", () => {
    expect(flightCategory(0.5 * SM, ft(5000))).toBe("LIFR");
    expect(flightCategory(null, ft(100))).toBeNull();
  });
});

describe("METAR (messages réels)", () => {
  const raw = fixture("metar") as { icaoId: string; rawOb: string; fltCat: string | null; wdir: unknown; visib: unknown; wgst: unknown; altim: number }[];
  const { items, skipped } = parseAwcMetars(raw);
  it("tous les messages réels se décodent", () => {
    expect(skipped).toBe(0);
    expect(items).toHaveLength(raw.length);
  });
  it("le texte brut est conservé tel quel", () => {
    for (const [i, m] of items.entries()) expect(m.raw).toBe(raw[i]!.rawOb);
  });
  it("QNH : « Q1009 » du message brut = pression décodée", () => {
    for (const [i, m] of items.entries()) {
      const q = /\bQ(\d{4})\b/.exec(raw[i]!.rawOb);
      if (q) expect(m.qnh).toBe(Number(q[1]) * 100);
    }
  });
  it("vent variable : direction « VRB » ; vitesse convertie en m/s (nœuds → m/s)", () => {
    const vrb = items.find((m) => m.conditions.windDirection === "VRB");
    expect(vrb).toBeDefined();
    const r = raw.find((x) => x.icaoId === vrb!.station)!;
    const kt = /VRB(\d{2})KT/.exec(r.rawOb)?.[1];
    if (kt) expect(mpsToKnots(vrb!.conditions.windSpeed as never)).toBeCloseTo(Number(kt), 6);
  });
  it("« 6+ » : visibilité plancher de 6 miles, marquée « ou plus »", () => {
    const m = items.find((_, i) => raw[i]!.visib === "6+");
    expect(m).toBeDefined();
    expect(m!.conditions.visibility).toEqual({ meters: 6 * SM, orMore: true });
  });
  it("rafales décodées en m/s (cas construit : aucun METAR réel avec rafales dans l'échantillon du jour)", () => {
    const g = parseAwcMetars([{ icaoId: "LFXX", obsTime: 1_794_000_000, rawOb: "METAR LFXX 100600Z 24015G27KT 9999 FEW040 10/05 Q1015", lat: 46, lon: 2, visib: "6+", wdir: 240, wspd: 15, wgst: 27, altim: 1015 }]).items[0]!;
    expect(mpsToKnots(g.conditions.windSpeed as never)).toBeCloseTo(15, 6);
    expect(mpsToKnots(g.conditions.windGust as never)).toBeCloseTo(27, 6);
    expect(g.conditions.windDirection).toBe(240);
  });
  it("plafond = base de la plus basse couche BKN / OVC, en mètres", () => {
    const m = items.find((x) => x.conditions.clouds.some((c) => c.cover === "BKN" || c.cover === "OVC"))!;
    const lowest = Math.min(...m.conditions.clouds.filter((c) => c.cover === "BKN" || c.cover === "OVC").map((c) => c.base as number));
    expect(m.conditions.ceiling).toBe(lowest);
  });
  it("catégorie recalculée = catégorie du service quand elle est fournie (pas de divergence)", () => {
    for (const [i, m] of items.entries()) {
      if (raw[i]!.fltCat) expect(m.conditions.category, raw[i]!.icaoId).toBe(raw[i]!.fltCat);
    }
  });
  it("heure d'observation en millisecondes UTC ; SPECI reconnu", () => {
    for (const m of items) expect(m.observedAt).toBeGreaterThan(1.7e12);
    expect(items.some((m) => m.special)).toBe(true);
  });
});

describe("METAR invalides", () => {
  const ok = { icaoId: "LFXX", obsTime: 1_794_000_000, rawOb: "METAR LFXX 100600Z 00000KT CAVOK 10/05 Q1015", lat: 46, lon: 2, visib: "6+", wdir: 0, wspd: 0, altim: 1015 };
  it("écarte et compte : station absente, heure absente, texte brut absent, position folle", () => {
    const r = parseAwcMetars([ok, { ...ok, icaoId: "" }, { ...ok, obsTime: undefined }, { ...ok, rawOb: "" }, { ...ok, lat: 95 }, null]);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(5);
  });
  it("champs facultatifs absents : null, jamais zéro inventé", () => {
    const m = parseAwcMetars([{ ...ok, temp: undefined, dewp: undefined, altim: undefined, visib: undefined, wdir: undefined, wspd: undefined }]).items[0]!;
    expect(m.temperature).toBeNull();
    expect(m.qnh).toBeNull();
    expect(m.conditions.windSpeed).toBeNull();
    expect(m.conditions.windDirection).toBeNull();
    expect(m.conditions.visibility).toBeNull();
    expect(m.conditions.category).toBeNull();
  });
  it("QNH aberrant refusé", () => {
    expect(parseAwcMetars([{ ...ok, altim: 29 }]).items[0]!.qnh).toBeNull();
  });
  it("visibilité verticale tient lieu de plafond (ciel obscurci)", () => {
    const c = parseAwcMetars([{ ...ok, visib: 0.1, vertVis: 2, clouds: [{ cover: "OVX", base: null }] }]).items[0]!.conditions;
    expect(c.ceiling).toBeCloseTo(ft(200), 6);
    expect(c.category).toBe("LIFR");
  });
  it("un export qui n'est pas un tableau est refusé", () => {
    expect(() => parseAwcMetars({})).toThrow(/tableau/);
    expect(() => parseAwcTafs("x")).toThrow(/tableau/);
    expect(() => parseAwcSigmets(null)).toThrow(/tableau/);
  });
});

describe("TAF (messages réels)", () => {
  const raw = fixture("taf") as { icaoId: string; rawTAF: string; fcsts: { fcstChange: string | null }[] }[];
  const { items, skipped } = parseAwcTafs(raw);
  it("décodage complet, texte brut conservé", () => {
    expect(skipped).toBe(0);
    expect(items).toHaveLength(raw.length);
    for (const [i, t] of items.entries()) expect(t.raw).toBe(raw[i]!.rawTAF);
  });
  it("types d'évolution reconnus (BECMG, TEMPO, PROB) et période de base", () => {
    const changes = new Set(items.flatMap((t) => t.periods.map((p) => p.change)));
    expect(changes.has("BECMG")).toBe(true);
    expect(changes.has("TEMPO")).toBe(true);
    expect(changes.has(null)).toBe(true);
    expect(items.some((t) => t.periods.some((p) => p.change === "PROB" && p.probability !== null))).toBe(true);
  });
  it("périodes dans l'ordre et bornes cohérentes", () => {
    for (const t of items) {
      for (const p of t.periods) expect(p.to).toBeGreaterThan(p.from);
      expect(t.validTo).toBeGreaterThan(t.validFrom);
    }
  });
  it("statut du TAF : à venir, valide, expiré", () => {
    const t = items[0]!;
    expect(tafStatus(t, t.validFrom - 1)).toBe("future");
    expect(tafStatus(t, t.validFrom + 1)).toBe("valid");
    expect(tafStatus(t, t.validTo + 1)).toBe("expired");
  });
  it("période en cours : base + évolutions TEMPO / PROB qui la recouvrent", () => {
    const t = items.find((x) => x.periods.some((p) => p.change === "TEMPO"))!;
    const tempo = t.periods.find((p) => p.change === "TEMPO")!;
    const r = tafPeriodsAt(t, tempo.from + 1000);
    expect(r.base).not.toBeNull();
    expect(r.overlays.some((p) => p === tempo)).toBe(true);
    expect(tafPeriodsAt(t, t.validTo + 10_000_000)).toEqual({ base: null, overlays: [] });
  });
  it("TAF sans période décodable : écarté", () => {
    const r = parseAwcTafs([{ icaoId: "LFXX", validTimeFrom: 1, validTimeTo: 2, rawTAF: "TAF LFXX", lat: 1, lon: 1, fcsts: [] }]);
    expect(r.items).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe("SIGMET (messages réels)", () => {
  const raw = fixture("isigmet") as unknown[];
  const { items, skipped } = parseAwcSigmets(raw);
  it("AREA (un polygone) et AREAS (plusieurs) décodés", () => {
    expect(skipped).toBe(0);
    expect(items.length).toBe(raw.length);
    expect(items.some((s) => s.areas.length === 1)).toBe(true);
    expect(items.some((s) => s.areas.length > 1)).toBe(true);
  });
  it("limites verticales en mètres, validité en millisecondes, texte brut conservé", () => {
    for (const s of items) {
      expect(s.validTo).toBeGreaterThan(s.validFrom);
      if (s.top !== null) expect(s.top).toBeGreaterThan(1000);
      expect(s.raw.length).toBeGreaterThan(10);
    }
    expect(parseAwcSigmets([{ validTimeFrom: 1, validTimeTo: 2, hazard: "TS", base: 1000, top: 30000, coords: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] }]).items[0]!.top).toBeCloseTo(9144, 3);
  });
  it("les polygones se testent avec pointInRings (centre dedans, loin dehors)", () => {
    const s = parseAwcSigmets([{ validTimeFrom: 1, validTimeTo: 2, hazard: "TS", coords: [{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, { lon: 2, lat: 2 }, { lon: 0, lat: 2 }, { lon: 0, lat: 0 }] }]).items[0]!;
    expect(pointInRings({ lat: 1, lon: 1 }, s.areas[0] ? [s.areas[0]] : [])).toBe(true);
    expect(pointInRings({ lat: 5, lon: 1 }, [s.areas[0]!])).toBe(false);
  });
  it("sans polygone, sans danger ou sans validité : écarté", () => {
    const r = parseAwcSigmets([{ validTimeFrom: 1, validTimeTo: 2, hazard: "TS", coords: [] }, { validTimeFrom: 1, hazard: "TS", coords: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] }, { validTimeFrom: 1, validTimeTo: 2, hazard: "", coords: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] }]);
    expect(r.items).toEqual([]);
    expect(r.skipped).toBe(3);
  });
});

describe("âge et dernière observation", () => {
  it("âge en minutes entières, jamais négatif", () => {
    expect(ageMinutes(0, 29 * 60_000 + 59_000)).toBe(29);
    expect(ageMinutes(10_000, 0)).toBe(0);
  });
  it("le METAR le plus récent de chaque station l'emporte ; idem TAF", () => {
    const base = { name: "", lat: 0, lon: 0, raw: "x", special: false, temperature: null, dewpoint: null, qnh: null } as const;
    const cond = parseAwcMetars([{ icaoId: "A", obsTime: 1, rawOb: "x", lat: 0, lon: 0 }]).items[0]!.conditions;
    const m = (station: string, t: number): Metar => ({ ...base, station, observedAt: t, conditions: cond });
    const map = latestMetarByStation([m("A", 1), m("A", 5), m("B", 3), m("A", 2)]);
    expect(map.get("A")!.observedAt).toBe(5);
    expect(map.size).toBe(2);
    const tafOf = (station: string, issuedAt: number): Taf => ({ station, name: "", lat: 0, lon: 0, issuedAt, validFrom: 0, validTo: 1, raw: "x", periods: [] });
    expect(latestTafByStation([tafOf("A", 1), tafOf("A", 9)]).get("A")!.issuedAt).toBe(9);
    void meters;
  });
});

// Vérification sur les VRAIS fichiers complets (si présents : `npm run data:weather`).
const dir = fileURLToPath(new URL("../../../data/weather/", import.meta.url));
describe.skipIf(!existsSync(dir + "metar.json") || !existsSync(dir + "taf.json") || !existsSync(dir + "isigmet.json"))("export réel complet", () => {
  it("presque tout se décode, et la catégorie de vol recalculée concorde avec celle du service", () => {
    const rawM = JSON.parse(readFileSync(dir + "metar.json", "utf8")) as { fltCat: string | null; icaoId: string }[];
    const metars = parseAwcMetars(rawM);
    expect(metars.items.length).toBeGreaterThan(rawM.length * 0.95);
    // Plusieurs observations par station : on compare chaque message avec lui-même (station + heure).
    const svc = new Map(rawM.map((x) => [`${x.icaoId}@${(x as unknown as { obsTime: number }).obsTime * 1000}`, x.fltCat]));
    let compared = 0, agree = 0;
    for (const m of metars.items) {
      const s2 = svc.get(`${m.station}@${m.observedAt}`);
      if (s2 && m.conditions.category) { compared++; if (s2 === m.conditions.category) agree++; }
    }
    expect(compared).toBeGreaterThan(100);
    expect(agree / compared).toBeGreaterThan(0.97);
    const tafs = parseAwcTafs(JSON.parse(readFileSync(dir + "taf.json", "utf8")));
    expect(tafs.items.length).toBeGreaterThan(50);
    const sig = parseAwcSigmets(JSON.parse(readFileSync(dir + "isigmet.json", "utf8")));
    expect(sig.items.length + sig.skipped).toBeGreaterThan(50);
  });
});
