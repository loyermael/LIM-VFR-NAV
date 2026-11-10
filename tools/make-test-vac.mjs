// Génère une carte FICTIVE (PDF A4, nord en haut) avec un graticule de coordonnées connues, pour tester le calage.
// Usage : node tools/make-test-vac.mjs sortie.pdf
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const R = 6378137, rad = Math.PI / 180;
const merY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
const C = { lat: 46.6, lon: 2.35 };
const W = 595, H = 842;
const mPerPt = (R * 0.3 * rad) / W; // 0,30° de longitude sur la largeur
const px = (lon) => W / 2 + ((lon - C.lon) * rad * R) / mPerPt;
const py = (lat) => H / 2 + (merY(lat) - merY(C.lat)) / mPerPt; // y PDF vers le haut

const doc = await PDFDocument.create();
const page = doc.addPage([W, H]);
const font = await doc.embedFont(StandardFonts.Helvetica);
page.drawText("CARTE FICTIVE - TEST DE CALAGE - NE PAS UTILISER EN VOL", { x: 30, y: H - 30, size: 12, font, color: rgb(0.7, 0, 0) });
const lons = [2.2, 2.25, 2.3, 2.35, 2.4, 2.45, 2.5], lats = [46.5, 46.55, 46.6, 46.65, 46.7];
for (const lon of lons) page.drawLine({ start: { x: px(lon), y: 0 }, end: { x: px(lon), y: H }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
for (const lat of lats) page.drawLine({ start: { x: 0, y: py(lat) }, end: { x: W, y: py(lat) }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
for (const lon of lons) for (const lat of lats) {
  page.drawCircle({ x: px(lon), y: py(lat), size: 3, color: rgb(0, 0, 0.8) });
  page.drawText(`${lat.toFixed(2)}N ${lon.toFixed(2)}E`, { x: px(lon) + 4, y: py(lat) + 4, size: 6, font });
}
page.drawRectangle({ x: px(2.34), y: py(46.59), width: px(2.36) - px(2.34), height: py(46.61) - py(46.59), borderColor: rgb(0.8, 0, 0), borderWidth: 1.5 });
writeFileSync(process.argv[2] ?? "vac-test.pdf", await doc.save());
console.log("ok");
