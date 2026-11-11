import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  fitGeoref, fromMercator, georefMetrics, imageCorners, latLonToPixel, parseCoordinate, pixelToLatLon, toMercator, type ControlPoint, type Georef,
} from "./georef";

/** Fabrique des points de calage à partir d'une similitude connue (vérité terrain). */
function truth(g: Georef, pixels: [number, number][]): ControlPoint[] {
  return pixels.map(([px, py]) => { const p = pixelToLatLon(g, px, py); return { px, py, lat: p.lat, lon: p.lon }; });
}
const G: Georef = { ar: 2.5, ai: 0.8, tx: 230_000, ty: 5_900_000 }; // ~ 2,6 m Mercator par pixel, légère rotation, vers 46,5° N

describe("projection Mercator", () => {
  it("aller-retour", () => {
    fc.assert(fc.property(fc.double({ min: -80, max: 80, noNaN: true }), fc.double({ min: -179, max: 179, noNaN: true }), (lat, lon) => {
      const p = fromMercator(toMercator({ lat, lon } as never));
      expect(p.lat).toBeCloseTo(lat, 9);
      expect(p.lon).toBeCloseTo(lon, 9);
    }));
  });
  it("valeur connue : 0°,0° → origine ; 180° de longitude = π·R", () => {
    const o = toMercator({ lat: 0, lon: 0 } as never);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(0, 6);
    expect(toMercator({ lat: 0, lon: 180 } as never).x).toBeCloseTo(Math.PI * 6378137, 6);
  });
});

describe("calage", () => {
  it("deux points : retrouve exactement la transformation, résidus nuls", () => {
    const fit = fitGeoref(truth(G, [[100, 120], [1800, 1500]]))!;
    expect(fit.georef.ar).toBeCloseTo(G.ar, 9);
    expect(fit.georef.ai).toBeCloseTo(G.ai, 9);
    expect(fit.georef.tx).toBeCloseTo(G.tx, 5);
    expect(fit.georef.ty).toBeCloseTo(G.ty, 5);
    expect(fit.rmsError).toBeLessThan(1e-4);
  });
  it("propriété : pour toute similitude et trois points non alignés, on la retrouve et un pixel fait l'aller-retour", () => {
    fc.assert(fc.property(
      fc.double({ min: 0.3, max: 8, noNaN: true }), fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      fc.double({ min: -5e5, max: 5e5, noNaN: true }), fc.double({ min: 5e6, max: 6.2e6, noNaN: true }),
      (scale, ang, tx, ty) => {
        const g: Georef = { ar: scale * Math.cos(ang), ai: scale * Math.sin(ang), tx, ty };
        const fit = fitGeoref(truth(g, [[50, 60], [2000, 90], [900, 1700]]))!;
        expect(fit.georef.ar).toBeCloseTo(g.ar, 6);
        expect(fit.georef.ai).toBeCloseTo(g.ai, 6);
        const p = pixelToLatLon(fit.georef, 777, 555);
        const back = latLonToPixel(fit.georef, p);
        expect(back.px).toBeCloseTo(777, 4);
        expect(back.py).toBeCloseTo(555, 4);
      },
    ), { numRuns: 200 });
  });
  it("un clic faux sur trois points : le résidu le plus grand désigne le point fautif", () => {
    const pts = truth(G, [[100, 100], [1900, 120], [1000, 1700], [200, 1600]]);
    const bad = pts.map((p, i) => (i === 2 ? { ...p, px: p.px + 60 } : p)); // 60 px ≈ 150 m de décalage
    const fit = fitGeoref(bad)!;
    expect(fit.rmsError).toBeGreaterThan(30);
    expect(fit.residuals.indexOf(Math.max(...fit.residuals))).toBe(2);
  });
  it("impossible : un seul point, ou deux points au même pixel", () => {
    expect(fitGeoref(truth(G, [[10, 10]]))).toBeNull();
    expect(fitGeoref([{ px: 5, py: 5, lat: 46, lon: 2 }, { px: 5, py: 5, lat: 47, lon: 3 }])).toBeNull();
    expect(fitGeoref([])).toBeNull();
  });
});

describe("coins et mesures", () => {
  it("image nord en haut, 2 m/px au sol : coins alignés, rotation 0, échelle exacte", () => {
    const k = Math.cos((46.5 * Math.PI) / 180);
    const g: Georef = { ar: 2 / k, ai: 0, tx: toMercator({ lat: 46.5, lon: 2 } as never).x, ty: toMercator({ lat: 46.5, lon: 2 } as never).y };
    const [tl, tr, br, bl] = imageCorners(g, 1000, 800);
    expect(tl[1]).toBeCloseTo(tr[1], 9); // bord haut horizontal
    expect(tl[0]).toBeCloseTo(bl[0], 9); // bord gauche vertical
    expect(tl[1]).toBeGreaterThan(bl[1]); // le haut est au nord
    expect(tr[0]).toBeGreaterThan(tl[0]);
    expect(br[1]).toBeLessThan(tr[1]);
    const m = georefMetrics(g, 1000, 800);
    expect(m.rotationDeg).toBeCloseTo(0, 9);
    expect(m.metersPerPixel).toBeGreaterThan(1.9); // au centre (≈ 46,5° − 0,0033°) : proche de 2 m/px
    expect(m.metersPerPixel).toBeLessThan(2.1);
  });
  it("image tournée de 90° (le haut regarde vers l'est) : rotation 90°", () => {
    const g: Georef = { ar: 0, ai: 3, tx: 0, ty: 5_800_000 }; // haut de l'image : (−ai, ar) = (−3, 0)… vers l'ouest si ai > 0
    expect(georefMetrics(g, 100, 100).rotationDeg).toBeCloseTo(270, 9);
    expect(georefMetrics({ ...g, ai: -3 }, 100, 100).rotationDeg).toBeCloseTo(90, 9);
  });
});

describe("saisie des coordonnées", () => {
  it.each([
    ["47.3083", "lat", 47.3083], ["47,3083 N", "lat", 47.3083], ["-1.5", "lon", -1.5], ["1.5 W", "lon", -1.5], ["47°18'30\"N", "lat", 47.308333333],
    ["47 18 30.5 N", "lat", 47.308472222], ["471830N", "lat", 47.308333333], ["0022015E", "lon", 2.337500], ["0022015W", "lon", -2.3375], ["45 S", "lat", -45],
  ] as const)("%s (%s) → %f", (txt, axis, want) => {
    expect(parseCoordinate(txt, axis)).toBeCloseTo(want, 6);
  });
  it.each([
    ["", "lat"], ["abc", "lat"], ["91", "lat"], ["181", "lon"], ["47 61 00", "lat"], ["47 18 61", "lat"], ["47E", "lat"], ["2N", "lon"], ["47.5 18", "lat"], ["4718", "lat"],
  ] as const)("refuse « %s » (%s)", (txt, axis) => {
    expect(parseCoordinate(txt, axis)).toBeNull();
  });
});

import { destination } from "./geodesy";
import { georefFromRunway, type RunwayAssist } from "./georef";

describe("calage assisté par une piste", () => {
  // Vérité : carte nord en haut, 3,2 m/px au sol, légèrement tournée, autour de LFBI (46,5875 N ; 0,3067 E).
  const ARP = { lat: 46.58751, lon: 0.30667 };
  const k = Math.cos((ARP.lat * Math.PI) / 180);
  const m0 = toMercator(ARP as never);
  const truthG = (rotDeg: number, groundMPerPx: number): Georef => {
    const s = groundMPerPx / k, r = (rotDeg * Math.PI) / 180;
    const g0: Georef = { ar: s * Math.cos(r), ai: s * Math.sin(r), tx: 0, ty: 0 };
    // l'ARP tombe au pixel (600, 800)
    return { ...g0, tx: m0.x - (g0.ar * 600 + g0.ai * 800), ty: m0.y - (g0.ai * 600 - g0.ar * 800) };
  };
  const pix = (g: Georef, p: { lat: number; lon: number }) => latLonToPixel(g, p as never);
  const scenario = (g: Georef, heading: number, length: number, arpOffsetM = 0): RunwayAssist => {
    // la piste est centrée sur le point « centre » ; l'ARP peut en être décalé (arpOffsetM vers l'est)
    const centre = arpOffsetM === 0 ? ARP : (destination(ARP as never, 90 as never, -arpOffsetM as never) as { lat: number; lon: number });
    const e1 = destination(centre as never, ((heading + 180) % 360) as never, (length / 2) as never);
    const e2 = destination(centre as never, heading as never, (length / 2) as never);
    return { start: pix(g, e1), end: pix(g, e2), headingTrue: heading, lengthM: length, arp: ARP, arpPixel: pix(g, ARP) };
  };
  const g0 = truthG(7, 3.2);

  /** Échelle (relative), rotation (°) et position de l'ARP (m) de l'écart entre un calage et la vérité. */
  const diff = (g: Georef, t: Georef) => {
    const scale = Math.hypot(g.ar, g.ai) / Math.hypot(t.ar, t.ai);
    const rot = ((Math.atan2(g.ai, g.ar) - Math.atan2(t.ai, t.ar)) * 180) / Math.PI;
    const p = pixelToLatLon(g, 600, 800);
    const pos = Math.hypot((p.lat - ARP.lat) * 111320, (p.lon - ARP.lon) * 111320 * k);
    return { scale, rot, pos };
  };
  it("données exactes, ARP visible : échelle à 0,3 %, rotation à 0,2°, ARP à moins de 1 m (écart résiduel = sphère de Mercator contre ellipsoïde)", () => {
    const fit = georefFromRunway(scenario(g0, 29, 2350))!;
    const d = diff(fit.georef, g0);
    expect(Math.abs(d.scale - 1)).toBeLessThan(0.003);
    expect(Math.abs(d.rot)).toBeLessThan(0.2);
    expect(d.pos).toBeLessThan(1);
    expect(fit.rmsError).toBeLessThan(1e-3);
  });
  it("ARP non visible mais au milieu de la piste : même résultat", () => {
    const fit = georefFromRunway({ ...scenario(g0, 29, 2350), arpPixel: null })!;
    const d = diff(fit.georef, g0);
    expect(Math.abs(d.scale - 1)).toBeLessThan(0.003);
    expect(d.pos).toBeLessThan(1);
  });
  it("extrémités touchées dans l'ordre inverse avec le cap opposé : même calage", () => {
    const s = scenario(g0, 29, 2350);
    const rev = georefFromRunway({ ...s, start: s.end, end: s.start, headingTrue: 209 })!;
    const fit = georefFromRunway(s)!;
    expect(rev.georef.ar).toBeCloseTo(fit.georef.ar, 6);
    expect(rev.georef.ai).toBeCloseTo(fit.georef.ai, 6);
  });
  it("tout cap et toute rotation de la carte : l'angle et l'échelle sont retrouvés (propriété)", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 359, noNaN: true }), fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: 1, max: 12, noNaN: true }), (heading, rot, mpp) => {
      const g = truthG(rot, mpp);
      const fit = georefFromRunway(scenario(g, heading, 1500))!;
      expect(fit.georef.ar / g.ar).toBeCloseTo(1, 2);
      expect(Math.abs(fit.georef.ai - g.ai) / Math.hypot(g.ar, g.ai)).toBeLessThan(0.01);
    }), { numRuns: 100 });
  });
  it("longueur publiée fausse de 5 % : échelle fausse de 5 % (limite connue du calage assisté)", () => {
    const s = scenario(g0, 29, 2350);
    const fit = georefFromRunway({ ...s, lengthM: 2350 * 1.05 })!;
    expect(diff(fit.georef, g0).scale).toBeGreaterThan(1.045);
    expect(diff(fit.georef, g0).scale).toBeLessThan(1.055);
  });
  it("ARP décalé de 300 m du milieu de la piste et non visible : position fausse d'environ 300 m (limite annoncée)", () => {
    const s = { ...scenario(g0, 29, 2350, 300), arpPixel: null };
    const fit = georefFromRunway(s)!;
    const wrong = pixelToLatLon(fit.georef, 600, 800);
    const err = Math.hypot((wrong.lat - ARP.lat) * 111320, (wrong.lon - ARP.lon) * 111320 * k);
    expect(err).toBeGreaterThan(150);
    expect(err).toBeLessThan(450);
  });
  it("impossible : extrémités confondues ou longueur nulle", () => {
    const s = scenario(g0, 29, 2350);
    expect(georefFromRunway({ ...s, end: s.start })).toBeNull();
    expect(georefFromRunway({ ...s, lengthM: 0 })).toBeNull();
  });
});

import { cropGeoref } from "./georef";

describe("échelles x et y distinctes (VAC du SIA) et recadrage", () => {
  const g: Georef = { ar: 18.48, ai: 0, ay: 18.43, tx: 215516, ty: 5439322 };
  it("aller-retour pixel → position → pixel", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 900, noNaN: true }), fc.double({ min: 0, max: 1200, noNaN: true }), (px, py) => {
      const p = pixelToLatLon(g, px, py);
      const back = latLonToPixel(g, p);
      expect(back.px).toBeCloseTo(px, 4);
      expect(back.py).toBeCloseTo(py, 4);
    }));
  });
  it("sans ay : identique à la similitude (rétro-compatible)", () => {
    const sim: Georef = { ar: 2.5, ai: 0.8, tx: 230000, ty: 5900000 };
    const p = pixelToLatLon(sim, 100, 200);
    const back = latLonToPixel({ ...sim, ay: sim.ar }, p);
    expect(back.px).toBeCloseTo(100, 5);
    expect(back.py).toBeCloseTo(200, 5);
  });
  it("recadrage : un point garde sa position quand l'image est recoupée en (x0, y0)", () => {
    const c = cropGeoref(g, 120, 80);
    const a = pixelToLatLon(g, 500, 600), b = pixelToLatLon(c, 380, 520);
    expect(b.lat).toBeCloseTo(a.lat, 9);
    expect(b.lon).toBeCloseTo(a.lon, 9);
    const sim: Georef = { ar: 2.5, ai: 0.8, tx: 230000, ty: 5900000 };
    const s2 = cropGeoref(sim, 50, 70), a2 = pixelToLatLon(sim, 300, 400), b2 = pixelToLatLon(s2, 250, 330);
    expect(b2.lat).toBeCloseTo(a2.lat, 9);
    expect(b2.lon).toBeCloseTo(a2.lon, 9);
  });
});
