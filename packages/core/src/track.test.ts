import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import {
  FlightRecorder, LANDING_CONFIRM_S, RESUME_WINDOW_S, canResume, PREROLL_S, TAKEOFF_CONFIRM_S, exportTrackGPX, exportTrackIGC, exportTrackKML, pointAt, trackStats,
  type TrackPoint,
} from "./track";

const T0 = Date.UTC(2026, 5, 1, 9, 0, 0);
const pt = (sec: number, gs: number | null, over: Partial<TrackPoint> = {}): TrackPoint => ({
  t: T0 + sec * 1000, lat: 47 + sec * 1e-4, lon: 2 + sec * 1e-4, alt: 100 + sec, gs, trk: 45, ...over,
});

/** Roulage lent, course au décollage, vol, atterrissage, roulage lent. */
function flight(): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let s = 0; s < 60; s++) out.push(pt(s, 3)); // roulage (60 s)
  for (let s = 60; s < 660; s++) out.push(pt(s, 40)); // vol (600 s)
  for (let s = 660; s < 720; s++) out.push(pt(s, 4)); // retour au parking
  return out;
}

describe("détection décollage / atterrissage", () => {
  it("démarre après la confirmation, garde le pré-enregistrement, termine après l'atterrissage confirmé", () => {
    const r = new FlightRecorder();
    const events: [number, string][] = [];
    for (const p of flight()) {
      const e = r.push(p);
      if (e) events.push([(p.t - T0) / 1000, e]);
    }
    expect(events).toEqual([[60 + TAKEOFF_CONFIRM_S, "started"], [660 + LANDING_CONFIRM_S, "ended"]]);
    expect(r.takeoffMs).toBe(T0 + 60_000); // le décollage est daté au premier point rapide, pas à la confirmation
    expect(r.landingMs).toBe(T0 + 660_000);
    // pré-enregistrement : 30 s de roulage avant le décollage, soit à partir de t = 60 - PREROLL_S… (fenêtre glissante)
    expect(((r.points[0] as TrackPoint).t - T0) / 1000).toBeGreaterThanOrEqual(63 - PREROLL_S - 1);
    expect(r.state).toBe("idle");
  });
  it("un simple roulage rapide plus court que la confirmation ne déclenche rien", () => {
    const r = new FlightRecorder();
    for (let s = 0; s < 120; s++) r.push(pt(s, s >= 50 && s < 52 ? 40 : 3));
    expect(r.state).toBe("idle");
    expect(r.points).toHaveLength(0);
  });
  it("vitesse inconnue : jamais de décollage", () => {
    const r = new FlightRecorder();
    for (let s = 0; s < 120; s++) r.push(pt(s, null));
    expect(r.state).toBe("idle");
  });
  it("un passage lent bref en vol (< confirmation) ne coupe pas l'enregistrement", () => {
    const r = new FlightRecorder();
    for (let s = 0; s < 100; s++) r.push(pt(s, 40));
    expect(r.state).toBe("recording");
    for (let s = 100; s < 110; s++) r.push(pt(s, 5));
    for (let s = 110; s < 200; s++) r.push(pt(s, 40));
    expect(r.state).toBe("recording");
  });
  it("un point par seconde au plus", () => {
    const r = new FlightRecorder();
    r.startManual();
    r.push(pt(0, 40));
    r.push({ ...pt(0, 40), t: T0 + 400 });
    r.push(pt(1, 40));
    expect(r.points).toHaveLength(2);
  });
  it("mode manuel : ne s'arrête pas à l'atterrissage, s'arrête sur demande", () => {
    const r = new FlightRecorder();
    r.startManual();
    for (let s = 0; s < 200; s++) r.push(pt(s, 0));
    expect(r.state).toBe("recording");
    r.stop();
    expect(r.state).toBe("idle");
  });
  it("reprise d'un enregistrement interrompu (boîte noire) : les points sont conservés et la suite s'ajoute", () => {
    const r = new FlightRecorder();
    r.resume([pt(0, 40), pt(1, 40)], T0);
    r.push(pt(2, 40));
    expect(r.points).toHaveLength(3);
    expect(r.takeoffMs).toBe(T0);
  });
});

describe("statistiques et interpolation", () => {
  it("distance, durée, maximums (1 point par seconde sur 1 km à peu près)", () => {
    const pts = [pt(0, 10, { lat: 47, lon: 2, alt: 100 }), pt(60, 50, { lat: 47.01, lon: 2, alt: 900 })];
    const s = trackStats(pts);
    expect(s.distance).toBeGreaterThan(1100);
    expect(s.distance).toBeLessThan(1120); // 0,01° de latitude = 1 111 m
    expect(s.duration).toBe(60);
    expect(s.maxAltitude).toBe(900);
    expect(s.maxGroundSpeed).toBe(50);
  });
  it("trace vide : zéros et null, jamais NaN", () => {
    expect(trackStats([])).toEqual({ points: 0, distance: 0, duration: 0, maxAltitude: null, maxGroundSpeed: null });
  });
  it("pointAt : milieu exact, bornes, hors trace", () => {
    const pts = [pt(0, 10, { lat: 47, lon: 2, alt: 100 }), pt(10, 30, { lat: 48, lon: 4, alt: 200 })];
    const m = pointAt(pts, T0 + 5000) as TrackPoint;
    expect(m.lat).toBeCloseTo(47.5, 9);
    expect(m.lon).toBeCloseTo(3, 9);
    expect(m.alt).toBeCloseTo(150, 9);
    expect(m.gs).toBeCloseTo(20, 9);
    expect(pointAt(pts, T0 - 1)).toBeNull();
    expect(pointAt(pts, T0 + 10_001)).toBeNull();
    expect((pointAt(pts, T0 + 10_000) as TrackPoint).lat).toBe(48);
  });
});

describe("export", () => {
  const pts = [pt(0, 40, { lat: 47.123456, lon: -1.5, alt: 250.4 }), pt(1, 40, { lat: -33.9, lon: 151.2, alt: null })];
  const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

  it("GPX : XML valide, coordonnées et heures relues", () => {
    const g = xml.parse(exportTrackGPX("Vol <test> & co", pts));
    expect(g.gpx.trk.name).toBe("Vol <test> & co");
    const seg = g.gpx.trk.trkseg.trkpt;
    expect(seg).toHaveLength(2);
    expect(Number(seg[0]["@_lat"])).toBeCloseTo(47.123456, 6);
    expect(Number(seg[0]["@_lon"])).toBeCloseTo(-1.5, 6);
    expect(seg[0].ele).toBeCloseTo(250.4, 1);
    expect(seg[0].time).toBe("2026-06-01T09:00:00Z");
    expect(seg[1].ele).toBeUndefined(); // altitude inconnue : pas d'élévation inventée
  });
  it("KML : XML valide, autant d'heures que de coordonnées, lon lat alt", () => {
    const k = xml.parse(exportTrackKML("Vol", pts));
    const tr = k.kml.Document.Placemark["gx:Track"];
    expect(tr.when).toHaveLength(2);
    expect(tr["gx:coord"][0]).toBe("-1.500000 47.123456 250.4");
  });
  it("IGC : en-têtes, date, enregistrements B de 35 caractères relus à l'identique", () => {
    const igc = exportTrackIGC(pts, { pilot: "A", aircraftType: "T", registration: "F-TEST" });
    const lines = igc.split("\r\n").filter(Boolean);
    expect(lines).toContain("HFDTE010626");
    expect(lines).toContain("HFGIDGLIDERID:F-TEST");
    const b = lines.filter((l) => l.startsWith("B"));
    expect(b).toHaveLength(2);
    expect(b.every((l) => l.length === 35)).toBe(true);
    const dec = (l: string) => {
      const lat = (Number(l.slice(7, 9)) + Number(l.slice(9, 14)) / 60000) * (l[14] === "S" ? -1 : 1);
      const lon = (Number(l.slice(15, 18)) + Number(l.slice(18, 23)) / 60000) * (l[23] === "W" ? -1 : 1);
      return { lat, lon, gnss: Number(l.slice(30, 35)) };
    };
    const a = dec(b[0] as string), c = dec(b[1] as string);
    expect(a.lat).toBeCloseTo(47.123456, 4);
    expect(a.lon).toBeCloseTo(-1.5, 4);
    expect(a.gnss).toBe(250);
    expect(c.lat).toBeCloseTo(-33.9, 4);
    expect(c.lon).toBeCloseTo(151.2, 4);
    expect((b[0] as string).slice(0, 7)).toBe("B090000");
    expect((b[0] as string)[24]).toBe("A"); // « V » serait ignoré par les lecteurs (L!M Debrief)
    expect((b[0] as string).slice(25, 30)).toBe("00000"); // altitude pression non enregistrée
  });
  it("IGC : minutes arrondies à 60 → report sur les degrés (pas de « 60000 »)", () => {
    const l = exportTrackIGC([pt(0, 1, { lat: 47.9999999, lon: 2.9999999 })]).split("\r\n").find((x) => x.startsWith("B")) as string;
    expect(l.slice(7, 14)).toBe("4800000");
    expect(l.slice(15, 23)).toBe("00300000");
  });
});

describe("reprise d'une trace interrompue", () => {
  const last = pt(0, 40, { lat: 47, lon: 2 });
  it("relance en vol 60 s plus tard à 2 km : même vol", () => {
    expect(canResume(last, pt(60, 40, { lat: 47.018, lon: 2 }))).toBe(true);
  });
  it("coupure trop longue : nouvelle trace", () => {
    expect(canResume(last, pt(RESUME_WINDOW_S + 1, 40, { lat: 47, lon: 2 }))).toBe(false);
    expect(canResume(last, pt(RESUME_WINDOW_S, 40, { lat: 47, lon: 2 }))).toBe(true);
  });
  it("trop loin pour la durée (autre vol) : nouvelle trace", () => {
    expect(canResume(last, pt(60, 40, { lat: 48, lon: 2 }))).toBe(false); // 111 km en 60 s
  });
  it("ordre des temps invalide (même instant ou passé) : refusé", () => {
    expect(canResume(last, pt(0, 40, { lat: 47, lon: 2 }))).toBe(false);
    expect(canResume(pt(100, 40), pt(50, 40))).toBe(false);
  });
});
