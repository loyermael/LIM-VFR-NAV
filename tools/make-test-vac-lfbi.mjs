// Génère une VAC FICTIVE de Poitiers-Biard (LFBI), tournée de 12° (comme une vraie carte pas orientée au nord), avec la piste 03/21
// dessinée à l'échelle (cap 29°V, 2 350 m, centrée sur l'ARP) et un graticule de contrôle. Sert à tester le calage assisté.
// Usage : node tools/make-test-vac-lfbi.mjs sortie.pdf
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const R = 6378137, rad = Math.PI / 180;
const ARP = { lat: 46.58751, lon: 0.30667 };
const merX = (lon) => R * lon * rad;
const merY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
const k = Math.cos(ARP.lat * rad);
const MPP = 14 / k; // 14 m de terrain par point de page
const ROT = 12 * rad; // le haut de la carte est tourné de 12° par rapport au nord
const W = 419.528, H = 595.276; // A5, comme une VAC
/** (lat, lon) → point de page (origine en bas à gauche). */
const page = (lat, lon) => {
  const dx = merX(lon) - merX(ARP.lon), dy = merY(lat) - merY(ARP.lat);
  const rx = dx * Math.cos(ROT) - dy * Math.sin(ROT) * -1; // rotation du repère nord → repère carte
  const x = dx * Math.cos(ROT) + dy * Math.sin(ROT), y = -dx * Math.sin(ROT) + dy * Math.cos(ROT);
  void rx;
  return { x: W / 2 + x / MPP, y: H / 2 + y / MPP };
};
const dest = (lat, lon, bearingDeg, m) => {
  const b = bearingDeg * rad, d = m / R;
  const la = lat * rad, lo = lon * rad;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 / rad, lon: lo2 / rad };
};

const doc = await PDFDocument.create();
const p = doc.addPage([W, H]);
const font = await doc.embedFont(StandardFonts.Helvetica);
p.drawText("VAC FICTIVE LFBI - TEST - NE PAS UTILISER EN VOL", { x: 20, y: H - 24, size: 9, font, color: rgb(0.7, 0, 0) });
// graticule de contrôle tous les 0,01°
for (let lat = 46.55; lat <= 46.62; lat += 0.01) { const a = page(lat, 0.26), b = page(lat, 0.36); p.drawLine({ start: a, end: b, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) }); }
for (let lon = 0.26; lon <= 0.361; lon += 0.01) { const a = page(46.55, lon), b = page(46.62, lon); p.drawLine({ start: a, end: b, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) }); }
// piste 03/21 : seuil 03 au sud-ouest, seuil 21 au nord-est
const t03 = dest(ARP.lat, ARP.lon, 209, 1175), t21 = dest(ARP.lat, ARP.lon, 29, 1175);
const a = page(t03.lat, t03.lon), b = page(t21.lat, t21.lon);
p.drawLine({ start: a, end: b, thickness: 6, color: rgb(0.1, 0.1, 0.1) });
p.drawCircle({ x: a.x, y: a.y, size: 3, color: rgb(1, 1, 1) });
p.drawCircle({ x: b.x, y: b.y, size: 3, color: rgb(1, 1, 1) });
p.drawText("03", { x: a.x - 14, y: a.y - 12, size: 9, font });
p.drawText("21", { x: b.x + 6, y: b.y + 4, size: 9, font });
const c = page(ARP.lat, ARP.lon);
p.drawCircle({ x: c.x, y: c.y, size: 5, borderColor: rgb(0.8, 0, 0), borderWidth: 1.5 });
p.drawText("ARP", { x: c.x + 7, y: c.y + 7, size: 8, font, color: rgb(0.8, 0, 0) });
writeFileSync(process.argv[2] ?? "vac-lfbi.pdf", await doc.save());
// positions des repères en pixels de rendu (échelle 2, origine en haut à gauche) : pour les essais
const px = (q) => ({ px: Math.round(q.x * 2), py: Math.round((H - q.y) * 2) });
console.log(JSON.stringify({ seuil03: px(a), seuil21: px(b), arp: px(c), ref_46_60_0_33: px(page(46.6, 0.33)) }));
