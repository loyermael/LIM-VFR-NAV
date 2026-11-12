/**
 * PDF du log de navigation, au format feuille « ACP » : A4 paysage, deux exemplaires côte à côte (à gauche rempli, à droite vierge pour
 * réécrire en vol). Colonnes : REPORTS | Rm/Cm | D | Tsv/Tav | He | Hr | RNav / Info NAV / Com / Z, avec les reports en quinconce
 * (à cheval entre deux branches), lignes DEPART et ARRIVEE, TOTAL, CARBURANT, AERODROME D'ARRIVEE et PERFO DU JOUR.
 * Généré sur l'appareil (pdf-lib), donc disponible hors-ligne.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { LogModel } from "./logModel";

const W = 650; // largeur de la feuille dans le repère de conception (px)
const H = 940;
const GREY = rgb(0.86, 0.86, 0.86);
const INK = rgb(0.08, 0.1, 0.12);
const FILL = rgb(0.04, 0.16, 0.4); // valeurs saisies : bleu marine
const LINE = rgb(0.25, 0.25, 0.25);
const FINE = rgb(0.65, 0.65, 0.65);

/** Texte compatible polices standard (WinAnsi) : on remplace ce qui ne passe pas. */
const clean = (s: string) => s.replace(/[−–—]/g, "-").replace(/[′’]/g, "'").replace(/[^\x20-\x7e -ÿ]/g, "?");

interface Ctx { page: PDFPage; fonts: { reg: PDFFont; bold: PDFFont; ital: PDFFont }; ox: number; oy: number; f: number; pageH: number }

function rect(c: Ctx, x: number, y: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; border?: boolean; width?: number } = {}) {
  const opts: Parameters<PDFPage["drawRectangle"]>[0] = { x: c.ox + x * c.f, y: c.pageH - c.oy - (y + h) * c.f, width: w * c.f, height: h * c.f };
  if (o.fill) opts.color = o.fill;
  if (o.border !== false) { opts.borderColor = LINE; opts.borderWidth = o.width ?? 0.7; }
  c.page.drawRectangle(opts);
}
function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, color = FINE, width = 0.5) {
  c.page.drawLine({ start: { x: c.ox + x1 * c.f, y: c.pageH - c.oy - y1 * c.f }, end: { x: c.ox + x2 * c.f, y: c.pageH - c.oy - y2 * c.f }, thickness: width, color });
}
type Align = "left" | "center" | "right";
function text(c: Ctx, s: string, x: number, y: number, size: number, o: { font?: "reg" | "bold" | "ital"; color?: ReturnType<typeof rgb>; align?: Align; maxW?: number } = {}) {
  const font = c.fonts[o.font ?? "reg"];
  let str = clean(s);
  let pt = size * c.f;
  if (o.maxW !== undefined) {
    const maxPt = o.maxW * c.f;
    const wPt = font.widthOfTextAtSize(str, pt);
    if (wPt > maxPt) pt = Math.max(3.5, pt * (maxPt / wPt));
  }
  const w = font.widthOfTextAtSize(str, pt);
  const px = o.align === "center" ? c.ox + x * c.f - w / 2 : o.align === "right" ? c.ox + x * c.f - w : c.ox + x * c.f;
  c.page.drawText(str, { x: px, y: c.pageH - c.oy - y * c.f - pt * 0.8, size: pt, font, color: o.color ?? INK });
  void str;
}
/** Texte sur plusieurs lignes dans une boîte. */
function paragraph(c: Ctx, s: string, x: number, y: number, w: number, size: number, color = FILL) {
  let cy = y;
  for (const raw of clean(s).split("\n")) {
    let cur = "";
    for (const word of raw.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (c.fonts.reg.widthOfTextAtSize(test, size * c.f) > w * c.f && cur) { text(c, cur, x, cy, size, { color }); cy += size * 1.25; cur = word; } else cur = test;
    }
    text(c, cur, x, cy, size, { color });
    cy += size * 1.25;
  }
}

export interface LogPdfInput { readonly model: LogModel; readonly form: Record<string, string> }

function drawSheet(c: Ctx, model: LogModel | null, form: Record<string, string>) {
  const m = model;
  const v = (k: string) => (m ? (form[k] ?? "") : "");
  // Titre et bandeau
  text(c, m ? `${m.route}${m.aircraft ? " - " + m.aircraft : ""}` : "", W / 2, 0, 15, { font: "bold", align: "center", maxW: W - 20 });
  rect(c, 0, 24, W, 26, { fill: GREY });
  text(c, "TOP-CAP-RADIO/RADIONAV-ALTI-MOTEUR-ESTIM/ESSENCE-GYRO", W / 2, 29, 17, { font: "bold", align: "center", maxW: W - 10 });

  // En-tête : ATIS / MSA, Avion, Vent
  rect(c, 0, 50, 190, 85); text(c, "ATIS dép:", 4, 53, 12, { font: "bold" });
  if (m) paragraph(c, v("atis"), 6, 70, 180, 12);
  rect(c, 0, 112, 78, 23, { fill: GREY }); text(c, "MSA", 39, 117, 14, { font: "bold", align: "center" });
  rect(c, 78, 112, 112, 23); if (m) text(c, v("msa"), 84, 117, 14, { color: FILL, maxW: 100 });
  rect(c, 190, 50, 193, 20, { fill: GREY }); text(c, "Avion", 286, 53, 14, { font: "bold", align: "center" });
  const rows: [string, string][] = [[`Vp(${m?.vpUnit ?? "kt"})`, m?.vp ?? ""], ["Fb", m?.fb ?? ""], [`Conso(${(m?.consoUnit ?? "L/h").toLowerCase()})`, m?.conso ?? ""]];
  rows.forEach(([lab, val], i) => {
    const y = 70 + i * 21.7;
    rect(c, 190, y, 125, 21.7, { fill: GREY }); text(c, lab, 252, y + 4, 14, { font: "bold", align: "center", maxW: 118 });
    rect(c, 315, y, 68, 21.7); if (m) text(c, val, 349, y + 4, 14, { color: FILL, align: "center", maxW: 62 });
  });
  rect(c, 383, 50, 134, 20, { fill: GREY }); text(c, "Vent (kt,°)", 450, 53, 14, { font: "bold", align: "center" });
  const winds: [string, string][] = [["FL20", m?.winds.fl20 ?? ""], ["FL50", m?.winds.fl50 ?? ""], ["FL100", m?.winds.fl100 ?? ""]];
  winds.forEach(([lab, val], i) => {
    const y = 70 + i * 21.7;
    rect(c, 383, y, 69, 21.7, { fill: GREY }); text(c, lab, 417, y + 5, 12, { font: "bold", align: "center" });
    rect(c, 452, y, 65, 21.7); if (m) text(c, val === "---" ? "" : val, 484, y + 5, 12, { color: FILL, align: "center", maxW: 60 });
  });

  // Titres de colonnes
  const cols = [0, 123, 190, 249, 315, 383, 453, W];
  const heads = ["REPORTS", "Rm\nCm", "D", "Tsv\nTav", "He", "Hr", "RNav / Info NAV / Com / Z"];
  heads.forEach((h, i) => {
    rect(c, cols[i]!, 135, cols[i + 1]! - cols[i]!, 37, { fill: GREY });
    const mid = (cols[i]! + cols[i + 1]!) / 2;
    const parts = h.split("\n");
    parts.forEach((ln, k) => text(c, ln, mid, parts.length === 1 ? 148 : 139 + k * 15, i === 0 ? 17 : 15, { font: "bold", align: "center", maxW: cols[i + 1]! - cols[i]! - 4 }));
  });

  // Corps : points de report (colonne 0) et branches en quinconce
  const top = 172, bottom = 762;
  const nPoints = Math.max(10, m ? m.points.length : 10);
  const rowH = (bottom - top) / nPoints;
  rect(c, cols[6]!, top, W - cols[6]!, bottom - top);
  for (let r = 0; r < nPoints; r++) {
    const y = top + r * rowH;
    rect(c, 0, y, 123, rowH);
    const pt = m?.points[r];
    if (pt) {
      text(c, pt.name, 5, y + rowH / 2 - 7, 14, { font: "bold", color: FILL, maxW: 115 });
      const note = form[`note${r}`] ?? [pt.freq, pt.alt].filter(Boolean).join(" · ");
      if (note) text(c, note, cols[6]! + 8, y + rowH / 2 - 6, 13, { color: FILL, maxW: W - cols[6]! - 14 });
    }
  }
  // Ligne DEPART (demi-ligne) puis branches puis ARRIVEE
  const half = rowH / 2;
  rect(c, cols[1]!, top, cols[5]! - cols[1]!, half, { fill: GREY });
  text(c, "DEPART", cols[4]! + 3, top + 6, 12, { font: "bold" });
  rect(c, cols[5]!, top, cols[6]! - cols[5]!, half);
  if (m?.departure) text(c, m.departure, cols[5]! + 4, top + 6, 12, { color: FILL });
  const nLegs = nPoints - 1;
  for (let r = 0; r < nLegs; r++) {
    const y = top + half + r * rowH;
    for (let k = 1; k <= 5; k++) rect(c, cols[k]!, y, cols[k + 1]! - cols[k]!, rowH);
    line(c, cols[1]!, y + rowH, cols[2]!, y);       // diagonale Rm/Cm
    line(c, cols[3]!, y + rowH, cols[4]!, y);       // diagonale Tsv/Tav
    // flèche du Hr (comme la feuille papier)
    line(c, cols[6]! - 28, y + 8, cols[6]! - 4, y + 8, LINE, 0.6); line(c, cols[6]! - 24, y + 14, cols[6]! - 6, y + 4, LINE, 0.6);
    const l = m?.legs[r];
    if (l) {
      text(c, l.rm, cols[1]! + 5, y + 4, 14, { color: FILL });
      text(c, l.cm, cols[2]! - 5, y + rowH - 19, 14, { color: FILL, align: "right" });
      text(c, l.d, (cols[2]! + cols[3]!) / 2, y + rowH / 2 - 8, 17, { font: "bold", color: FILL, align: "center", maxW: cols[3]! - cols[2]! - 6 });
      text(c, l.tsv, cols[3]! + 5, y + 4, 14, { color: FILL });
      text(c, l.tav, cols[4]! - 5, y + rowH - 19, 14, { color: FILL, align: "right" });
      if (l.he) text(c, l.he, (cols[4]! + cols[5]!) / 2, y + rowH / 2 - 7, 14, { color: FILL, align: "center" });
      const hr = form[`hr${r}`];
      if (m && hr) text(c, hr, cols[5]! + 5, y + rowH - 20, 13, { color: FILL });
    }
  }
  rect(c, cols[1]!, bottom - half, cols[5]! - cols[1]!, half, { fill: GREY });
  text(c, "ARRIVEE", cols[4]! + 3, bottom - half + 10, 12, { font: "bold" });
  rect(c, cols[5]!, bottom - half, cols[6]! - cols[5]!, half);
  const lastLeg = m?.legs[m.legs.length - 1];
  if (lastLeg?.he) text(c, lastLeg.he, cols[5]! + 4, bottom - half + 10, 12, { color: FILL });

  // TOTAL et PERFO DU JOUR
  rect(c, 0, bottom, 195, 24, { fill: GREY }); text(c, "TOTAL", 190, bottom + 5, 15, { font: "bold", align: "right" });
  rect(c, 195, bottom, 188, 24);
  if (m) text(c, `${m.totals.d} ${m.totals.dUnit}   Tsv ${m.totals.tsv}   Tav ${m.totals.tav}`, 200, bottom + 6, 12, { color: FILL, maxW: 180 });
  rect(c, 383, bottom, 91, 24, { fill: GREY });
  rect(c, 474, bottom, 176, 24, { fill: GREY }); text(c, "PERFO DU JOUR", 562, bottom + 5, 15, { font: "bold", align: "center" });

  // Bas : CARBURANT, AERODROME D'ARRIVEE, PERFO
  const by = bottom + 24;
  rect(c, 15, by, 138, 24, { fill: GREY }); text(c, "CARBURANT", 84, by + 5, 15, { font: "bold", align: "center" });
  [["Start", "fStart"], ["AUTO", "fAuto"], ["Stop", "fStop"]].forEach(([lab, key], i) => {
    const y = by + 24 + i * 40;
    rect(c, 15, y, 62, 40, { fill: GREY }); text(c, lab!, 46, y + 12, 15, { font: "bold", align: "center" });
    rect(c, 77, y, 76, 40); if (m) text(c, v(key!), 83, y + 12, 15, { color: FILL, maxW: 68 });
  });
  rect(c, 153, by, 322, 24, { fill: GREY }); text(c, "AERODROME D'ARRIVEE", 314, by + 5, 15, { font: "bold", align: "center" });
  rect(c, 153, by + 24, 322, 124);
  if (m) {
    const arr = m.points[m.points.length - 1];
    text(c, arr?.name ?? "", 160, by + 30, 17, { font: "bold", color: FILL, maxW: 305 });
    paragraph(c, v("arrival"), 160, by + 54, 305, 13);
  }
  // PERFO DU JOUR : DECO / ATT, puis DEP ARR DEG, TODA, LDA
  const px = 474, pw = 176;
  rect(c, px, by, 44, 22, { fill: GREY }); text(c, "DECO", px + 22, by + 6, 11, { font: "bold", align: "center" });
  rect(c, px + 44, by, 44, 22); if (m) text(c, v("deco"), px + 48, by + 6, 12, { color: FILL, maxW: 38 });
  rect(c, px + 88, by, 44, 22, { fill: GREY }); text(c, "ATT", px + 110, by + 6, 11, { font: "bold", align: "center" });
  rect(c, px + 132, by, 44, 22); if (m) text(c, v("att"), px + 136, by + 6, 12, { color: FILL, maxW: 38 });
  const triples: [string, string[]][] = [["DEP ARR DEG", ["dep", "arr", "deg"]], ["TODA", ["toda1", "toda2", "toda3"]], ["LDA", ["lda1", "lda2", "lda3"]]];
  let ty = by + 24;
  const labels: string[][] = [["DEP", "ARR", "DEG"], ["TODA", "TODA", "TODA"], ["LDA", "LDA", "LDA"]];
  triples.forEach(([, keys], row) => {
    for (let k = 0; k < 3; k++) {
      const x = px + k * (pw / 3);
      rect(c, x, ty, pw / 3, 18, { fill: GREY }); text(c, labels[row]![k]!, x + pw / 6, ty + 4, 11, { font: "bold", align: "center" });
      rect(c, x, ty + 18, pw / 3, 22); if (m) text(c, v(keys[k]!), x + 4, ty + 22, 12, { color: FILL, maxW: pw / 3 - 8 });
    }
    ty += 42;
  });
}

export async function buildLogPdf(input: LogPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Log de nav - ${input.model.route}`);
  doc.setCreator("L!M VFR Nav");
  const pageW = 841.89, pageH = 595.28;
  const page = doc.addPage([pageW, pageH]);
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), ital: await doc.embedFont(StandardFonts.HelveticaOblique) };
  const f = 0.592; // pt par px de conception : deux feuilles côte à côte
  const sheetW = W * f;
  const gap = 24;
  const left = (pageW - (2 * sheetW + gap)) / 2;
  const top = (pageH - H * f) / 2 + 4;
  drawSheet({ page, fonts, ox: left, oy: top, f, pageH }, input.model, input.form);
  drawSheet({ page, fonts, ox: left + sheetW + gap, oy: top, f, pageH }, null, {});
  return doc.save();
}
