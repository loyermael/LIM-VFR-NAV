import { describe, expect, it } from "vitest";
import {
  FormatError, detectFormat, exportFPL, exportGPX, exportKML, exportPLN, exportRoute, importFPL, importGPX, importKML,
  importPLN, importRoute, type RouteFile, type RouteFormat,
} from "./formats";
import { feet, feetToMeters } from "./units";

const sample: RouteFile = {
  name: "Poitiers & Limoges <test>",
  points: [
    { name: "LFBI", lat: 46.5877, lon: 0.3066, altitude: feetToMeters(feet(423)) },
    { name: "Éolienne N°5", lat: 46.123456, lon: 0.987654, altitude: feetToMeters(feet(3000)) },
    { name: "LFBL", lat: 45.8628, lon: 1.1794, altitude: null },
  ],
};

const close = (a: number, b: number, tol = 1e-5) => Math.abs(a - b) <= tol;

function expectSameRoute(back: RouteFile, original: RouteFile, opts: { names: boolean; altitudes: boolean; tol?: number }) {
  expect(back.points).toHaveLength(original.points.length);
  original.points.forEach((p, i) => {
    const q = back.points[i]!;
    expect(close(q.lat, p.lat, opts.tol ?? 1e-5), `lat ${i}`).toBe(true);
    expect(close(q.lon, p.lon, opts.tol ?? 1e-5), `lon ${i}`).toBe(true);
    if (opts.names) expect(q.name).toBe(p.name);
    if (opts.altitudes) {
      if (p.altitude === null) expect(q.altitude).toBeNull();
      else expect(Math.abs(q.altitude! - p.altitude)).toBeLessThan(0.6);
    }
  });
}

describe("aller-retour sur nos propres exports", () => {
  it("GPX : noms, coordonnées, altitudes, caractères spéciaux", () => {
    const back = importGPX(exportGPX(sample));
    expect(back.name).toBe(sample.name);
    expectSameRoute(back, sample, { names: true, altitudes: true });
  });
  it("KML : noms, coordonnées, altitudes", () => {
    const back = importKML(exportKML(sample));
    expect(back.name).toBe(sample.name);
    expectSameRoute(back, sample, { names: true, altitudes: true });
  });
  it("FPL : coordonnées (noms normalisés en identifiants Garmin, pas d'altitude)", () => {
    const back = importFPL(exportFPL(sample));
    expectSameRoute(back, sample, { names: false, altitudes: false });
    expect(back.points[0]!.name).toBe("LFBI");
    expect(back.points[1]!.name).toBe("OLIENNEN5"); // É et espaces retirés
  });
  it("PLN : coordonnées à 0,3 m près (secondes à 2 décimales), altitudes en pieds", () => {
    const back = importPLN(exportPLN(sample));
    expectSameRoute(back, sample, { names: false, altitudes: true, tol: 1e-5 });
  });
  it("hémisphères Sud et Ouest, passage par zéro", () => {
    const south: RouteFile = { name: "S", points: [{ name: "A", lat: -33.8688, lon: -70.6483, altitude: null }, { name: "B", lat: -0.0001, lon: 0.0001, altitude: null }] };
    expectSameRoute(importPLN(exportPLN(south)), south, { names: false, altitudes: false });
    expectSameRoute(importGPX(exportGPX(south)), south, { names: true, altitudes: false });
    expectSameRoute(importFPL(exportFPL(south)), south, { names: false, altitudes: false });
  });
  it("identifiants FPL dupliqués rendus uniques", () => {
    const dup: RouteFile = { name: "D", points: [{ name: "AB", lat: 1, lon: 1, altitude: null }, { name: "AB", lat: 2, lon: 2, altitude: null }] };
    const back = importFPL(exportFPL(dup));
    expect(back.points[0]!.name).not.toBe(back.points[1]!.name);
    expect(back.points[1]!.lat).toBeCloseTo(2, 6);
  });
  it("export dispatché par format, détection par extension puis par contenu", () => {
    for (const f of ["gpx", "kml", "fpl", "pln"] as RouteFormat[]) {
      const content = exportRoute(f, sample);
      expect(detectFormat(`route.${f}`, "")).toBe(f);
      expect(detectFormat("sans-extension", content)).toBe(f);
      expect(importRoute(`x.${f.toUpperCase()}`, content).points).toHaveLength(3);
    }
  });
});

describe("fichiers d'autres logiciels (structure publique)", () => {
  it("GPX avec seulement des <wpt>", () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x"><wpt lat="45.0" lon="2.0"><name>A</name></wpt><wpt lat="46.0" lon="3.0"><ele>500</ele></wpt></gpx>`;
    const r = importGPX(gpx);
    expect(r.points.map((p) => p.name)).toEqual(["A", "WPT02"]);
    expect(r.points[1]!.altitude).toBe(500);
  });
  it("GPX : <rte> prioritaire sur les <wpt>, traces ignorées", () => {
    const gpx = `<gpx version="1.1"><wpt lat="1" lon="1"/><rte><name>R</name><rtept lat="45" lon="2"/><rtept lat="46" lon="3"/></rte><trk><trkseg><trkpt lat="9" lon="9"/></trkseg></trk></gpx>`;
    expect(importGPX(gpx).points).toHaveLength(2);
  });
  it("GPX avec un seul point : la route a un point (pas de plantage sur le tableau de taille 1)", () => {
    expect(importGPX(`<gpx><rte><rtept lat="45" lon="2"/></rte></gpx>`).points).toHaveLength(1);
  });
  it("KML : dossiers imbriqués, altitude 0 = inconnue, ordre du document", () => {
    const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>f</name>
      <Placemark><name>P1</name><Point><coordinates>2.0,45.0,0</coordinates></Point></Placemark>
      <Placemark><name>P2</name><Point><coordinates>3.5,46.5,600</coordinates></Point></Placemark></Folder></Document></kml>`;
    const r = importKML(kml);
    expect(r.points.map((p) => p.name)).toEqual(["P1", "P2"]);
    expect(r.points[0]!.altitude).toBeNull();
    expect(r.points[1]!.altitude).toBe(600);
    expect(r.points[1]!.lon).toBe(3.5);
  });
  it("KML avec seulement une ligne : un point par sommet", () => {
    const kml = `<kml><Document><Placemark><name>L</name><LineString><coordinates>2,45,0 3,46,0 4,47,0</coordinates></LineString></Placemark></Document></kml>`;
    expect(importKML(kml).points).toHaveLength(3);
  });
  it("PLN MSFS : position en degrés minutes secondes, altitude en pieds signée", () => {
    const pln = `<SimBase.Document Type="AceXML" version="1,0"><FlightPlan.FlightPlan><Title>T</Title>
      <ATCWaypoint id="LFBI"><ATCWaypointType>Airport</ATCWaypointType><WorldPosition>N46° 35' 15.72",E0° 18' 23.76",+000423.00</WorldPosition></ATCWaypoint>
      <ATCWaypoint id="MID"><ATCWaypointType>User</ATCWaypointType><WorldPosition>S33° 52' 7.68",W70° 38' 53.88",-000010.00</WorldPosition></ATCWaypoint>
    </FlightPlan.FlightPlan></SimBase.Document>`;
    const r = importPLN(pln);
    expect(r.points[0]!.name).toBe("LFBI");
    expect(r.points[0]!.lat).toBeCloseTo(46.5877, 4);
    expect(r.points[0]!.lon).toBeCloseTo(0.3066, 4);
    expect(r.points[0]!.altitude!).toBeCloseTo(feetToMeters(feet(423)), 1);
    expect(r.points[1]!.lat).toBeLessThan(0);
    expect(r.points[1]!.lon).toBeLessThan(0);
    expect(r.points[1]!.altitude!).toBeCloseTo(feetToMeters(feet(-10)), 1);
  });
  it("FPL Garmin : la route renvoie à la table des points", () => {
    const fpl = `<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1"><waypoint-table>
      <waypoint><identifier>AAA</identifier><type>USER WAYPOINT</type><country-code></country-code><lat>45.5</lat><lon>2.5</lon></waypoint>
      <waypoint><identifier>BBB</identifier><type>USER WAYPOINT</type><country-code></country-code><lat>46.5</lat><lon>3.5</lon></waypoint></waypoint-table>
      <route><route-name>MA ROUTE</route-name><flight-plan-index>1</flight-plan-index>
      <route-point><waypoint-identifier>BBB</waypoint-identifier><waypoint-type>USER WAYPOINT</waypoint-type><waypoint-country-code></waypoint-country-code></route-point>
      <route-point><waypoint-identifier>AAA</waypoint-identifier><waypoint-type>USER WAYPOINT</waypoint-type><waypoint-country-code></waypoint-country-code></route-point></route></flight-plan>`;
    const r = importFPL(fpl);
    expect(r.name).toBe("MA ROUTE");
    expect(r.points.map((p) => p.name)).toEqual(["BBB", "AAA"]);
    expect(r.points[0]!.lat).toBe(46.5);
  });
});

describe("fichiers invalides : message clair, jamais de route vide ni de coordonnée inventée", () => {
  it("fichier vide", () => {
    for (const f of [importGPX, importKML, importFPL, importPLN]) expect(() => f("")).toThrow(FormatError);
  });
  it("mauvais format", () => {
    expect(() => importGPX("<kml></kml>")).toThrow(/GPX/);
    expect(() => importKML("<gpx></gpx>")).toThrow(/KML/);
    expect(() => importPLN("<gpx></gpx>")).toThrow(/PLN/);
    expect(() => importFPL("<gpx></gpx>")).toThrow(/FPL/);
  });
  it("coordonnées hors limites ou absentes", () => {
    expect(() => importGPX(`<gpx><rte><rtept lat="95" lon="2"/></rte></gpx>`)).toThrow(/hors limites/);
    expect(() => importGPX(`<gpx><rte><rtept lat="45"/></rte></gpx>`)).toThrow(/coordonnées/);
    expect(() => importKML(`<kml><Document><Placemark><Point><coordinates>200,45,0</coordinates></Point></Placemark></Document></kml>`)).toThrow(/hors limites/);
  });
  it("route vide", () => {
    expect(() => importGPX(`<gpx><rte><name>x</name></rte></gpx>`)).toThrow(/Aucun point/);
  });
  it("FPL : point de route absent de la table", () => {
    const fpl = `<flight-plan><waypoint-table></waypoint-table><route><route-point><waypoint-identifier>ZZZ</waypoint-identifier></route-point></route></flight-plan>`;
    expect(() => importFPL(fpl)).toThrow(/ZZZ/);
  });
  it("PLN : position absente", () => {
    const pln = `<SimBase.Document><FlightPlan.FlightPlan><ATCWaypoint id="X"><WorldPosition>sans virgule</WorldPosition></ATCWaypoint></FlightPlan.FlightPlan></SimBase.Document>`;
    expect(() => importPLN(pln)).toThrow(/absente/);
  });
  it("PLN : position illisible", () => {
    const pln = `<SimBase.Document><FlightPlan.FlightPlan><ATCWaypoint id="X"><WorldPosition>abc,def</WorldPosition></ATCWaypoint></FlightPlan.FlightPlan></SimBase.Document>`;
    expect(() => importPLN(pln)).toThrow(/illisible/);
  });
  it("format non reconnu", () => {
    expect(() => importRoute("x.txt", "bonjour")).toThrow(/non reconnu/);
  });
  it("XML mal formé", () => {
    expect(() => importGPX("<gpx><rte>")).toThrow(FormatError);
  });
});
