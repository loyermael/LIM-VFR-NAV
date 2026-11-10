/**
 * Dossier de vol en PDF (pdf-lib, MIT) : généré entièrement sur l'appareil, donc disponible hors-ligne.
 * Contenu : couverture, log de nav, centrage (tableau + enveloppe), carburant, espaces traversés, météo près de la route.
 * Tout vient des données de l'utilisateur et des fichiers datés importés ; rien n'est inventé : une valeur inconnue s'écrit « --- ».
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  computeBalance, formatAngle, formatDuration, formatQuantity, planFuel, unitLabel, validateAircraft,
  type Aircraft, type Loads, type Metar, type NavLog, type RouteHit, type Taf, type UnitPrefs,
} from "@lim/core";
import type { RouteRecord } from "./routeEdit";
import type { FuelPlanParams } from "./aircraftStore";
import type { Lang } from "./i18n";

export interface DossierInput {
  readonly lang: Lang;
  readonly prefs: UnitPrefs;
  /** Instant de génération (ms UTC). */
  readonly nowMs: number;
  readonly route: RouteRecord;
  readonly navLog: NavLog | null;
  readonly aircraft: Aircraft | null;
  readonly loads: Loads;
  readonly fuelPlan: FuelPlanParams;
  /** Carburant du trajet (L) d'après le log de nav, ou null. */
  readonly tripLiters: number | null;
  readonly crossed: readonly RouteHit[];
  readonly hasAeroData: boolean;
  /** Messages météo des stations proches de la route, dans l'ordre de rencontre. */
  readonly metars: readonly Metar[];
  readonly tafs: readonly Taf[];
}

const TXT = {
  fr: {
    title: "Dossier de vol", warning: "Aide à la navigation, pas un moyen de navigation primaire. Données possiblement absentes, périmées ou erronées : le pilote reste seul responsable et utilise les cartes et documents officiels à jour.",
    route: "Route", aircraft: "Avion", generated: "Généré le", points: "Points", noAircraft: "Aucun avion choisi", departure: "Départ prévu",
    navlog: "Log de navigation", noLog: "Log indisponible : route de 2 points au moins et vitesse propre requises.",
    leg: "Branche", dist: "Dist", crs: "Route", hdg: "Cap", wind: "Vent", wca: "Dér.", gs: "VS", tsv: "TSV", tav: "TAV", fuel: "Carb.", total: "Total",
    tsvNote: "TSV = temps sans vent, TAV = temps avec vent.", vrb: "Vent non renseigné sur cette branche.",
    balance: "Masse et centrage", sheetIncomplete: "Fiche avion incomplète", zfm: "Zéro carburant", takeoff: "Décollage", landing: "Atterrissage",
    mass: "Masse (kg)", cg: "CG (m)", margin: "Marge (m)", state: "État", ok: "OK", limit: "HORS LIMITE", station: "Poste", load: "Charge", arm: "Bras (m)",
    envelope: "Enveloppe", axisArm: "Bras du CG (m)", axisMass: "Masse (kg)",
    balNote: "Calcul indicatif d'après les données saisies par l'utilisateur (manuel de vol, pesée). À vérifier avec le manuel de vol.",
    fuelTitle: "Carburant", taxi: "Roulage", trip: "Trajet", contingency: "Aléas", alternate: "Déroutement", reserve: "Réserve finale",
    required: "Total nécessaire", onboard: "Embarqué", surplus: "Excédent", endurance: "Autonomie", insufficient: "CARBURANT INSUFFISANT",
    fuelNote: "Valeurs de réserve choisies par le pilote. Estimation à consommation constante.",
    airspaces: "Espaces traversés (en plan)", noAero: "Aucune donnée d'espaces importée : section non renseignée.", noneCrossed: "Aucun espace traversé dans les données importées.",
    inside: "DANS", outside: "hors", unknown: "?", entry: "entrée", activation: "activation sur demande ou NOTAM",
    airspaceNote: "Source openAIP (non officielle). Vérifier dans l'AIP, les SUP AIP et les NOTAM.",
    weather: "Météo près de la route", noWx: "Aucun METAR/TAF importé près de la route.", metar: "METAR", taf: "TAF",
    wxNote: "Aide à la préparation, non officielle : briefing officiel Météo-France / SOFIA, NOTAM au SIA.",
    page: "Page", cruise: "Croisière",
  },
  en: {
    title: "Flight dossier", warning: "Navigation aid, not a primary means of navigation. Data may be missing, outdated or wrong: the pilot alone is responsible and must use current official charts and documents.",
    route: "Route", aircraft: "Aircraft", generated: "Generated", points: "Points", noAircraft: "No aircraft selected", departure: "Planned departure",
    navlog: "Navigation log", noLog: "Log unavailable: needs at least 2 points and a true airspeed.",
    leg: "Leg", dist: "Dist", crs: "Crs", hdg: "Hdg", wind: "Wind", wca: "WCA", gs: "GS", tsv: "TNW", tav: "TWW", fuel: "Fuel", total: "Total",
    tsvNote: "TNW = time without wind, TWW = time with wind.", vrb: "No wind entered for this leg.",
    balance: "Weight and balance", sheetIncomplete: "Incomplete aircraft sheet", zfm: "Zero fuel", takeoff: "Takeoff", landing: "Landing",
    mass: "Mass (kg)", cg: "CG (m)", margin: "Margin (m)", state: "Status", ok: "OK", limit: "OUT OF LIMITS", station: "Station", load: "Load", arm: "Arm (m)",
    envelope: "Envelope", axisArm: "CG arm (m)", axisMass: "Mass (kg)",
    balNote: "Indicative calculation from user-entered data (flight manual, weighing). Check against the flight manual.",
    fuelTitle: "Fuel", taxi: "Taxi", trip: "Trip", contingency: "Contingency", alternate: "Alternate", reserve: "Final reserve",
    required: "Total required", onboard: "On board", surplus: "Surplus", endurance: "Endurance", insufficient: "FUEL INSUFFICIENT",
    fuelNote: "Reserve values chosen by the pilot. Estimate at constant fuel flow.",
    airspaces: "Airspaces crossed (lateral)", noAero: "No airspace data imported: section not filled.", noneCrossed: "No airspace crossed in the imported data.",
    inside: "INSIDE", outside: "outside", unknown: "?", entry: "entry", activation: "activation on request or NOTAM",
    airspaceNote: "Source openAIP (unofficial). Check AIP, AIP SUP and NOTAM.",
    weather: "Weather near the route", noWx: "No METAR/TAF imported near the route.", metar: "METAR", taf: "TAF",
    wxNote: "Planning aid, unofficial: official briefing via Météo-France / SOFIA, NOTAM from SIA.",
    page: "Page", cruise: "Cruise",
  },
} as const;

/** Les polices standard du PDF ne couvrent que WinAnsi : on remplace ce qui n'y est pas plutôt que de planter. */
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const REPLACE: Record<string, string> = {
  "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "−": "-", "★": "*", "✕": "x", " ": " ", " ": " ", " ": " ", "—": "-", "–": "-", "…": "...", "≈": "~", "′": "'", "″": '"',
};
export function sanitize(s: string): string {
  let out = "";
  for (const ch of s) {
    const r = REPLACE[ch];
    if (r !== undefined) out += r;
    else {
      const cp = ch.codePointAt(0) as number;
      out += cp < 0x100 || WIN_EXTRA.includes(ch) ? (cp >= 32 || ch === "\n" ? ch : " ") : "?";
    }
  }
  return out;
}

const MARGIN = 40;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const INK = rgb(0.1, 0.1, 0.1);
const NAVY = rgb(0.039, 0.165, 0.4);
const MUTED = rgb(0.4, 0.4, 0.38);
const BAD = rgb(0.72, 0.1, 0.1);
const GOOD = rgb(0.18, 0.42, 0.23);
const HAIR = rgb(0.72, 0.7, 0.64);

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  constructor(readonly doc: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont, readonly mono: PDFFont, readonly footer: string) {
    this.newPage();
  }
  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.pageNo += 1;
    this.y = PAGE_H - MARGIN;
    this.page.drawText(sanitize(`${this.footer} · ${this.pageNo}`), { x: MARGIN, y: 20, size: 8, font: this.font, color: MUTED });
  }
  need(h: number): void {
    if (this.y - h < MARGIN + 10) this.newPage();
  }
  /** Texte avec retour à la ligne ; retourne le nombre de lignes écrites. */
  text(s: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}): number {
    const size = o.size ?? 10, font = o.font ?? this.font, x = o.x ?? MARGIN, width = o.width ?? PAGE_W - MARGIN - x;
    const lines: string[] = [];
    for (const para of sanitize(s).split("\n")) {
      let cur = "";
      for (const w of para.split(" ")) {
        const next = cur ? `${cur} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next;
      }
      lines.push(cur);
    }
    for (const l of lines) {
      this.need(size + 3);
      this.y -= size + 2;
      this.page.drawText(l, { x, y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 2;
    return lines.length;
  }
  heading(s: string): void {
    this.need(40);
    this.y -= 8;
    this.text(s, { size: 13, font: this.bold, color: NAVY, gap: 2 });
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 1, color: NAVY });
    this.y -= 4;
  }
  /** Tableau : colonnes à largeurs fixes, première colonne alignée à gauche, les autres à droite. */
  table(head: readonly string[], rows: readonly (readonly string[])[], widths: readonly number[], opts: { badRows?: ReadonlySet<number>; foot?: readonly (readonly string[])[] } = {}): void {
    const size = 8.5, h = 14;
    const draw = (cells: readonly string[], font: PDFFont, color: ReturnType<typeof rgb>, rule: boolean) => {
      this.need(h);
      let x = MARGIN;
      cells.forEach((c, i) => {
        const w = widths[i] as number;
        const txt = sanitize(c);
        const tw = font.widthOfTextAtSize(txt, size);
        this.page.drawText(txt, { x: i === 0 ? x : x + w - tw, y: this.y - 10, size, font, color });
        x += w;
      });
      this.y -= h;
      if (rule) this.page.drawLine({ start: { x: MARGIN, y: this.y + 1 }, end: { x: x, y: this.y + 1 }, thickness: 0.4, color: HAIR });
    };
    draw(head, this.bold, MUTED, true);
    rows.forEach((r, i) => draw(r, this.font, opts.badRows?.has(i) ? BAD : INK, true));
    (opts.foot ?? []).forEach((r) => draw(r, this.bold, INK, false));
    this.y -= 4;
  }
}

function drawEnvelope(w: Writer, a: Aircraft, states: { name: string; cg: number; mass: number; ok: boolean }[], labels: { axisArm: string; axisMass: string }): void {
  const W = 300, H = 200, L = 38, B = 28, T = 8, R = 8;
  w.need(H + 30);
  w.y -= 12; // place pour le titre de l'axe vertical
  const x0 = MARGIN, yTop = w.y;
  const yBase = yTop - H; // bas du cadre
  const xs = [...a.envelope.map((v) => v[0]), ...states.map((s) => s.cg)];
  const ys = [...a.envelope.map((v) => v[1]), ...states.map((s) => s.mass)];
  const span = (v: number[]) => { const lo = Math.min(...v), hi = Math.max(...v); const d = (hi - lo) * 0.08 || 1; return [lo - d, hi + d] as const; };
  const [ax0, ax1] = span(xs), [ay0, ay1] = span(ys);
  const px = (x: number) => x0 + L + ((x - ax0) / (ax1 - ax0)) * (W - L - R);
  const py = (y: number) => yBase + B + ((y - ay0) / (ay1 - ay0)) * (H - B - T);
  const p = w.page;
  for (let i = 0; i <= 4; i++) {
    const gx = ax0 + ((ax1 - ax0) * i) / 4, gy = ay0 + ((ay1 - ay0) * i) / 4;
    p.drawLine({ start: { x: px(gx), y: py(ay0) }, end: { x: px(gx), y: py(ay1) }, thickness: 0.3, color: HAIR });
    p.drawLine({ start: { x: px(ax0), y: py(gy) }, end: { x: px(ax1), y: py(gy) }, thickness: 0.3, color: HAIR });
    p.drawText(gx.toFixed(2), { x: px(gx) - 9, y: yBase + B - 10, size: 7, font: w.mono, color: MUTED });
    p.drawText(String(Math.round(gy)), { x: x0 + 4, y: py(gy) - 2, size: 7, font: w.mono, color: MUTED });
  }
  const n = a.envelope.length;
  for (let i = 0; i < n; i++) {
    const [x1, m1] = a.envelope[i] as readonly [number, number];
    const [x2, m2] = a.envelope[(i + 1) % n] as readonly [number, number];
    p.drawLine({ start: { x: px(x1), y: py(m1) }, end: { x: px(x2), y: py(m2) }, thickness: 1.6, color: INK });
  }
  states.forEach((s, k) => {
    const col = s.ok ? GOOD : BAD;
    p.drawCircle({ x: px(s.cg), y: py(s.mass), size: 3.5, color: col, borderColor: INK, borderWidth: 0.6 });
    p.drawText(s.name, { x: px(s.cg) + 6, y: py(s.mass) + [-10, 4, -3][k % 3]!, size: 8, font: w.bold, color: INK });
  });
  p.drawText(sanitize(labels.axisArm), { x: x0 + L + 60, y: yBase + 2, size: 8, font: w.font, color: INK });
  p.drawText(sanitize(labels.axisMass), { x: x0 + 2, y: yTop + 3, size: 8, font: w.font, color: INK });
  w.y = yBase - 8;
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const dateTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 10)} ${hhmm(ms)} UTC`;

/** Construit le PDF et retourne ses octets. Fonction asynchrone (pdf-lib) mais sans accès réseau. */
export async function buildDossier(inp: DossierInput): Promise<Uint8Array> {
  const L = TXT[inp.lang];
  const { prefs } = inp;
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`${L.title} - ${inp.route.name}`));
  doc.setProducer("L!M VFR Nav");
  doc.setCreator("L!M VFR Nav");
  doc.setCreationDate(new Date(inp.nowMs));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const w = new Writer(doc, font, bold, mono, `L!M VFR Nav - ${inp.route.name}`);
  const dist = (v: number) => formatQuantity("distance", prefs, v);
  const dU = unitLabel("distance", prefs), sU = unitLabel("groundSpeed", prefs), fU = unitLabel("fuel", prefs);
  const fuelTxt = (v: number | null) => (v === null ? "---" : `${formatQuantity("fuel", prefs, v)} ${fU}`);

  // Couverture
  w.text(L.title, { size: 22, font: bold, color: NAVY, gap: 4 });
  w.text(inp.route.name, { size: 14, font: bold, gap: 6 });
  w.text(`${L.generated} ${dateTime(inp.nowMs)}`, { color: MUTED });
  if (inp.route.departureMs !== null) w.text(`${L.departure} ${dateTime(inp.route.departureMs)}`);
  const names = inp.route.points.map((p) => p.name).join(" > ");
  w.text(`${L.points} : ${names || "---"}`);
  if (inp.navLog) w.text(`${dist(inp.navLog.totals.distance)} ${dU} - TAV ${formatDuration(inp.navLog.totals.timeWithWind)} - ${fuelTxt(inp.tripLiters)}`, { font: bold });
  w.text(inp.aircraft ? `${L.aircraft} : ${inp.aircraft.registration ? `${inp.aircraft.registration} - ` : ""}${inp.aircraft.name}` : `${L.aircraft} : ${L.noAircraft}`);
  w.y -= 6;
  w.text(L.warning, { font: bold, color: BAD, size: 9 });

  // Log de navigation
  w.heading(L.navlog);
  if (!inp.navLog || inp.navLog.legs.length === 0) w.text(L.noLog, { color: MUTED });
  else {
    const mag = prefs.track === "mag";
    const rows = inp.navLog.legs.map((l) => [
      `${l.index + 1} ${l.from.name}>${l.to.name}`,
      dist(l.distance),
      formatAngle(mag ? l.magneticCourse : l.trueCourse),
      formatAngle(mag ? l.magneticHeading : l.trueHeading),
      l.wind ? `${formatAngle(l.wind.direction)}/${formatQuantity("groundSpeed", prefs, l.wind.speed)}` : "---",
      l.wca === null ? "---" : `${l.wca > 0.5 ? "+" : l.wca < -0.5 ? "-" : ""}${Math.abs(Math.round(l.wca))}`,
      l.groundSpeed === null ? "---" : formatQuantity("groundSpeed", prefs, l.groundSpeed),
      formatDuration(l.timeNoWind),
      formatDuration(l.timeWithWind),
      l.fuel === null ? "---" : formatQuantity("fuel", prefs, l.fuel),
    ]);
    const t = inp.navLog.totals;
    w.table(
      [L.leg, `${L.dist} ${dU}`, `${L.crs} ${mag ? "M" : "V"}`, `${L.hdg} ${mag ? "M" : "V"}`, `${L.wind} ${sU}`, L.wca, `${L.gs} ${sU}`, L.tsv, L.tav, `${L.fuel} ${fU}`],
      rows,
      [118, 46, 40, 40, 60, 28, 38, 42, 42, 46],
      { foot: [[L.total, dist(t.distance), "", "", "", "", "", formatDuration(t.timeNoWind), formatDuration(t.timeWithWind), t.fuel === null ? "---" : formatQuantity("fuel", prefs, t.fuel)]] },
    );
    w.text(L.tsvNote, { size: 8, color: MUTED });
    if (inp.navLog.legs.some((l) => l.wind === null)) w.text(L.vrb, { size: 8, color: MUTED });
  }

  // Masse et centrage
  w.heading(L.balance);
  const a = inp.aircraft;
  const defects = a ? validateAircraft(a) : [];
  if (!a) w.text(L.noAircraft, { color: MUTED });
  else if (defects.length > 0) w.text(`${L.sheetIncomplete} : ${defects.join(", ")}`, { color: BAD });
  else {
    const res = computeBalance(a, inp.loads, inp.tripLiters ?? 0);
    w.table(
      [L.station, L.load, L.arm],
      res.lines.map((ln) => [ln.station.name, ln.station.kind === "fuel" ? `${ln.mass.toFixed(1)} kg (${fuelTxt(res.fuelLiters.takeoff)})` : ln.mass.toFixed(1), ln.station.arm.toFixed(3)]),
      [200, 160, 80],
    );
    const st = [[L.zfm, res.zeroFuel], [L.takeoff, res.takeoff], [L.landing, res.landing]] as const;
    w.table(
      ["", L.mass, L.cg, L.margin, L.state],
      st.map(([n, s]) => [n, s.mass.toFixed(1), s.cg.toFixed(3), s.cgMargin === null ? "---" : s.cgMargin.toFixed(3), s.issues.length === 0 ? L.ok : L.limit]),
      [120, 80, 80, 80, 80],
      { badRows: new Set(st.flatMap(([, s], i) => (s.issues.length > 0 ? [i] : []))) },
    );
    drawEnvelope(
      w, a,
      [
        { name: "ZFM", cg: res.zeroFuel.cg, mass: res.zeroFuel.mass, ok: res.zeroFuel.inEnvelope },
        { name: inp.lang === "fr" ? "DEC" : "TO", cg: res.takeoff.cg, mass: res.takeoff.mass, ok: res.takeoff.inEnvelope },
        { name: inp.lang === "fr" ? "ATT" : "LDG", cg: res.landing.cg, mass: res.landing.mass, ok: res.landing.inEnvelope },
      ],
      L,
    );
    w.text(L.balNote, { size: 8, color: MUTED });
  }

  // Carburant
  w.heading(L.fuelTitle);
  if (!a) w.text(L.noAircraft, { color: MUTED });
  else {
    const fuelStation = a.stations.find((s) => s.kind === "fuel");
    const onboard = fuelStation ? (inp.loads[fuelStation.id] ?? 0) : 0;
    w.need(150);
    const plan = planFuel({
      tripLiters: inp.tripLiters, taxiLiters: inp.fuelPlan.taxiLiters, contingencyPercent: inp.fuelPlan.contingencyPercent,
      alternateMinutes: inp.fuelPlan.alternateMinutes, reserveMinutes: inp.fuelPlan.reserveMinutes, fuelFlowLph: a.fuelFlowLph,
      onboardLiters: onboard, usableCapacityLiters: Math.max(0, a.fuel.capacity - a.fuel.unusable),
    });
    w.table(
      ["", ""],
      [
        [L.taxi, fuelTxt(plan.taxi)],
        [L.trip, fuelTxt(plan.trip)],
        [`${L.contingency} (${inp.fuelPlan.contingencyPercent} %)`, fuelTxt(plan.contingency)],
        [`${L.alternate} (${inp.fuelPlan.alternateMinutes} min)`, fuelTxt(plan.alternate)],
        [`${L.reserve} (${inp.fuelPlan.reserveMinutes} min)`, fuelTxt(plan.reserve)],
      ],
      [260, 120],
      { foot: [[L.required, fuelTxt(plan.required)], [L.onboard, fuelTxt(plan.onboard)], [L.surplus, fuelTxt(plan.surplus)], [L.endurance, plan.endurance === null ? "---" : formatDuration(plan.endurance * 3600).replace(/:\d\d$/, "")]] },
    );
    if (plan.sufficient === false) w.text(L.insufficient, { font: bold, color: BAD });
    w.text(L.fuelNote, { size: 8, color: MUTED });
  }

  // Espaces traversés
  w.heading(L.airspaces);
  if (!inp.hasAeroData) w.text(L.noAero, { color: MUTED });
  else if (inp.crossed.length === 0) w.text(L.noneCrossed, { color: MUTED });
  else {
    for (const h of inp.crossed) {
      const sp = h.airspace;
      const v = h.vertical === "inside" ? L.inside : h.vertical === "outside" ? L.outside : L.unknown;
      w.text(`${sp.name} [${v}]`, { font: bold, gap: 0 });
      w.text(`${sp.typeLabel}${sp.icaoClass ? ` ${sp.icaoClass}` : ""} - ${sp.lower.label} -> ${sp.upper.label} - ${L.entry} ${dist(h.entry)} ${dU}${sp.byNotam || sp.onRequest ? ` - ${L.activation}` : ""}`, { size: 9, color: MUTED, gap: 0 });
      if (sp.frequencies.length > 0) w.text(sp.frequencies.map((f) => `${f.mhz} ${f.name}`.trim()).join("  "), { size: 9, font: mono, gap: 3 });
    }
    w.text(L.airspaceNote, { size: 8, color: MUTED });
  }

  // Météo
  w.heading(L.weather);
  if (inp.metars.length === 0 && inp.tafs.length === 0) w.text(L.noWx, { color: MUTED });
  for (const m of inp.metars) w.text(`${L.metar} ${m.station} (${hhmm(m.observedAt)}Z) ${m.raw}`, { font: mono, size: 8, gap: 3 });
  for (const f of inp.tafs) w.text(`${L.taf} ${f.station} ${f.raw}`, { font: mono, size: 8, gap: 3 });
  w.text(L.wxNote, { size: 8, color: MUTED });

  return doc.save();
}
