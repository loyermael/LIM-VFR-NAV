import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { flightLevelToMeters, isAirspaceVisible, type AirspaceLimit, type GpsFix, type LimitReference, type SpeedVectorPoint, type TrueDeg } from "@lim/core";
import { getReader, type ChartRecord } from "./charts";
import type { Overlay } from "./overlays";
import type { RouteRecord } from "./routeEdit";
import "maplibre-gl/dist/maplibre-gl.css";

export type Theme = "day" | "night";
export type Orientation = "north" | "track";

/** Entité touchée par un double-tap, avec la couche d'où elle vient. */
export interface TappedFeature {
  readonly layerName: string;
  readonly properties: Record<string, unknown>;
}

import { AERO_ATTRIBUTION, AERO_DEM_MAX_ZOOM, BASE_MAPS, IGN_ATTRIBUTION, getAeroTile, getTile, type BaseMapId } from "./baseMaps";

export interface MapViewProps {
  /** Fond de carte IGN affiché (plan, photos) ou aucun ; relief ombré LiDAR par-dessus. */
  baseMap: "none" | "plan" | "ortho" | "aero";
  relief: boolean;
  /** Donne à l'appli un accès à la zone visible (pour télécharger la zone affichée). */
  onMapApi?: (api: { getBounds: () => { west: number; south: number; east: number; north: number } }) => void;
  theme: Theme;
  emptyLabel: string;
  fix: GpsFix | null;
  trackTrue: TrueDeg | null;
  vector: readonly SpeedVectorPoint[];
  follow: boolean;
  orientation: Orientation;
  onUserMove: () => void;
  overlays: readonly Overlay[];
  charts: readonly ChartRecord[];
  /** Espaces aériens et terrains importés (openAIP), déjà convertis en GeoJSON. */
  airspaceData: FeatureCollection | null;
  airfieldData: FeatureCollection | null;
  /** Balises, points de report et obstacles (carte aéro) et leur affichage. */
  navData: FeatureCollection | null;
  showNav: boolean;
  /** Activités de l'AIP (parachutage, voltige, aéromodélisme, treuillage) et leur affichage. */
  activityData: FeatureCollection | null;
  showActivities: boolean;
  /** Points cotés indicatifs (altitude des sommets, en pieds). */
  spotData: FeatureCollection | null;
  showSpots: boolean;
  showAirspaces: boolean;
  showAirfields: boolean;
  /** Modèle d'URL des tuiles du radar de pluie (réseau requis), ou null. */
  radarTemplate: string | null;
  /** Groupes d'espaces affichés (contrôlés, réglementés…). */
  visibleGroups: readonly string[];
  /** Route active à dessiner (ligne et points numérotés). */
  route: RouteRecord | null;
  /** Cible hors route (Direct vers un terrain), prioritaire sur le point visé de la route. */
  adhocTarget: { lat: number; lon: number } | null;
  /** Indice du point visé (ligne « direct » depuis l'avion), ou null. */
  targetIndex: number | null;
  selectedIndex: number | null;
  /** Mode tracé : un appui sur la carte ajoute un point, les points se déplacent au doigt. */
  editMode: boolean;
  /** Demande de cadrage sur la route ; `force` ignore la présence d'un GPS (action de l'utilisateur). */
  fitRequest: { nonce: number; force: boolean };
  onMapTap: (lat: number, lon: number) => void;
  onPointTap: (index: number) => void;
  onPointMove: (index: number, lat: number, lon: number) => void;
  ceilingFL: number;
  onDoubleTap: (features: TappedFeature[]) => void;
  /** Appui simple sur un terrain (id + position écran), ou null si l'appui est ailleurs (ferme le menu). */
  onAirfieldTap: (hit: { id: string; x: number; y: number } | null) => void;
  /** Rejeu d'une trace : ligne complète + position courante (null = pas de rejeu). */
  replay: { line: [number, number][]; pos: { lat: number; lon: number; trk: number | null } | null; key: string } | null;
  /** Cartes calées (VAC) posées sur la carte : image + coins [lon, lat] (haut-gauche, haut-droit, bas-droit, bas-gauche). */
  docCharts: readonly { id: string; url: string; corners: [[number, number], [number, number], [number, number], [number, number]]; framePtW?: number }[];
  /** Redessine une carte depuis son PDF à l'échelle demandée (pixels par point) ; null si impossible. */
  renderDocHires?: (id: string, scale: number) => Promise<string | null>;
  /** Trafic reçu (GDL90, FLARM) : un repère par cible, avec l'écart d'altitude en centaines de pieds. */
  traffic: readonly { key: string; lat: number; lon: number; track: number | null; label: string; level: number; stale: boolean; relAltM: number | null }[];
  /** Demande de cadrage sur une carte calée (approche) ; appliquée seulement si le suivi de l'avion est actif. */
  docFocus: { nonce: number; corners: [number, number][] } | null;
  /** Commande externe de zoom : incrémentée à chaque appui sur + ou −. */
  zoomCommand: { delta: number; nonce: number };
}

/** Couleurs lues dans les jetons CSS (aucune couleur en dur) : à relire à chaque changement de thème. */
const ASP_LAYERS = ["asp-ctl", "asp-siv", "asp-sym", "asp-fill", "asp-band", "asp-hatch-pro", "asp-hatch-res", "asp-edge", "asp-dash-rmz", "asp-dash-dot", "asp-dash-minor", "asp-park-line", "asp-park-dots", "asp-siv-line", "asp-lbl"];

/** Motifs de hachures des zones rouges (tuile de 16 px, diagonales sans couture) : réglementée/dangereuse = diagonale, interdite = quadrillage. */
let hatchCache: Map<string, ImageData> | null = null;
function hatchIcons(): Map<string, ImageData> {
  if (hatchCache) return hatchCache;
  const out = new Map<string, ImageData>();
  for (const [name, cross] of [["hatch-res", false], ["hatch-pro", true]] as const) {
    const cv = document.createElement("canvas");
    cv.width = 16; cv.height = 16;
    const c = cv.getContext("2d");
    if (!c) continue;
    c.strokeStyle = "#e0202a"; c.lineWidth = 1.6; c.lineCap = "square";
    c.beginPath();
    for (const [x0, y0, x1, y1] of [[0, 16, 16, 0], [-8, 8, 8, -8], [8, 24, 24, 8]] as const) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
    if (cross) for (const [x0, y0, x1, y1] of [[0, 0, 16, 16], [-8, 8, 8, 24], [8, -8, 24, 8]] as const) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
    c.stroke();
    out.set(name, c.getImageData(0, 0, 16, 16));
  }
  hatchCache = out;
  return out;
}
function addAspIcons(m: maplibregl.Map) {
  for (const [name, img] of hatchIcons()) if (!m.hasImage(name)) m.addImage(name, img, { pixelRatio: 2 });
}

const NAV_SYM_LAYERS = ["nav-sym", "nav-obs-mid", "nav-nuc"];
const NAV_LAYERS = [...NAV_SYM_LAYERS, "nav-name", "nav-box"];
/** Bleu et rouge de la carte OACI (légende SIA / IGN). */
const OACI_BLUE = "#1b3f9a", OACI_RED = "#e8412a";

/**
 * Symboles de la carte aéro, dessinés en canvas selon la légende de la carte OACI (SIA / IGN, édition 2026) : balises (VOR hexagone, VOR/DME hexagone dans un carré,
 * DME carré, NDB disque pointillé), points de report (triangle plein = obligatoire, vide = sur demande), obstacles (Λ avec point, Λ élevé, éolienne),
 * terrains (disque barré en dur, cercle = bande, H = hélistation, ancre = hydro, double cercle = mixte, rouge = militaire, P = privé, croix = désaffecté).
 * Grille de dessin de 40 agrandie 1,6 fois ; un filet blanc sous chaque trait garde les symboles lisibles sur le plan comme sur les photos.
 */
/**
 * Symboles OACI extraits du PDF de la légende (tools/extract-oaci-symbols.py → public/oaci/*.png, 4 pixels par point : taille d'origine avec un pixelRatio de 4).
 * Ils remplacent les symboles dessinés à la main de même nom ; ceux qui manquent (voltige…) gardent le dessin de repli.
 */
const OACI_PIXEL_RATIO = 4;
const oaciIcons = new Map<string, ImageData>();
const oaciReady: Promise<void> = (async () => {
  try {
    const base = import.meta.env.BASE_URL;
    const man = (await (await fetch(`${base}oaci/manifest.json`)).json()) as Record<string, unknown>;
    await Promise.all(Object.keys(man).map(async (n) => {
      try {
        const img = new Image();
        img.src = `${base}oaci/${n}.png`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        oaciIcons.set(n, ctx.getImageData(0, 0, c.width, c.height));
      } catch { /* ce symbole garde son dessin de repli */ }
    }));
    // symboles de terrain à piste en dur : la barre blanche pivote (12 positions) pour suivre le cap réel de la piste
    for (const [base, rin] of [["ad-civil-paved", 27], ["ad-mixte-paved", 21], ["ad-mil-paved", 21]] as const) {
      const src = oaciIcons.get(base);
      if (!src) continue;
      const w = src.width, h = src.height, cx = (w - 1) / 2, cy = (h - 1) / 2;
      const sample = (y: number) => { const i = (Math.round(y) * w + Math.round(cx)) * 4; return `rgb(${src.data[i]},${src.data[i + 1]},${src.data[i + 2]})`; };
      const color = sample(cy - rin * 0.6); // couleur du disque (bleu, rouge pour le militaire), prise hors de la barre
      for (let k = 0; k < 12; k++) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        if (!ctx) continue;
        ctx.putImageData(src, 0, 0);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, rin, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); // efface la barre d'origine
        ctx.translate(cx, cy); ctx.rotate((k * 15 * Math.PI) / 180 - Math.PI / 2);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(-rin - 2, -6, 2 * rin + 4, 12);
        ctx.restore();
        oaciIcons.set(`${base}-h${k}`, ctx.getImageData(0, 0, w, h));
      }
    }
  } catch { /* hors-ligne sans cache : symboles de repli */ }
})();

let iconCache: Map<string, ImageData> | null = null;
function navIcons(): Map<string, ImageData> {
  if (iconCache) return iconCache;
  const out = new Map<string, ImageData>();
  const S = 64, K = 1.6, C = 20;
  const make = (name: string, draw: (c: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    const c = cv.getContext("2d");
    if (!c) return;
    c.scale(K, K);
    c.lineJoin = "round"; c.lineCap = "round";
    draw(c);
    out.set(name, c.getImageData(0, 0, S, S));
  };
  const stroke = (c: CanvasRenderingContext2D, color: string, w: number, fill?: string) => {
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.strokeStyle = "#fff"; c.lineWidth = w + 2.4; c.stroke();
    c.strokeStyle = color; c.lineWidth = w; c.stroke();
  };
  const circle = (c: CanvasRenderingContext2D, r: number) => { c.beginPath(); c.arc(C, C, r, 0, Math.PI * 2); };
  const dot = (c: CanvasRenderingContext2D, r: number, color: string, x = C, y = C) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };
  const hex = (c: CanvasRenderingContext2D, r: number) => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; c.lineTo(C + r * Math.cos(a), C + r * Math.sin(a)); } c.closePath(); };
  const B = OACI_BLUE;

  // balises
  make("vor", (c) => { hex(c, 10); stroke(c, B, 2); dot(c, 1.7, B); });
  make("vordme", (c) => { c.beginPath(); c.rect(C - 12, C - 12, 24, 24); stroke(c, B, 1.8); hex(c, 8.5); stroke(c, B, 1.8); dot(c, 1.7, B); });
  make("dme", (c) => { c.beginPath(); c.rect(C - 9, C - 9, 18, 18); stroke(c, B, 2); dot(c, 1.7, B); });
  make("ndb", (c) => {
    circle(c, 15); c.fillStyle = "rgba(255,255,255,0.7)"; c.fill();
    for (const [r, n] of [[6.5, 8], [9.5, 12], [12.5, 16], [15, 20]] as const) for (let i = 0; i < n; i++) dot(c, 0.95, B, C + r * Math.cos((2 * Math.PI * i) / n), C + r * Math.sin((2 * Math.PI * i) / n));
    circle(c, 3.2); c.strokeStyle = B; c.lineWidth = 1.4; c.stroke(); dot(c, 1.3, B);
  });
  // points de report
  const tri = (c: CanvasRenderingContext2D) => { c.beginPath(); c.moveTo(C, C - 11); c.lineTo(C + 10, C + 8); c.lineTo(C - 10, C + 8); c.closePath(); };
  make("rp-c", (c) => { tri(c); stroke(c, B, 2, B); });
  make("rp", (c) => { tri(c); stroke(c, B, 2.2, "rgba(255,255,255,0.85)"); });
  // obstacles
  make("mast", (c) => { c.beginPath(); c.moveTo(C - 8, C + 9); c.lineTo(C, C - 11); c.lineTo(C + 8, C + 9); stroke(c, B, 2.4); dot(c, 1.7, B, C, C + 7); });
  make("mast-hi", (c) => { c.beginPath(); c.moveTo(C - 6, C + 12); c.quadraticCurveTo(C - 1.2, C + 2, C, C - 14); c.quadraticCurveTo(C + 1.2, C + 2, C + 6, C + 12); c.closePath(); stroke(c, B, 1.6, B); });
  make("wind", (c) => {
    c.beginPath(); c.moveTo(C, C + 12); c.lineTo(C, C - 3); stroke(c, B, 2.2);
    c.beginPath(); c.moveTo(C - 4.5, C + 12); c.lineTo(C + 4.5, C + 12); stroke(c, B, 2.2);
    for (const [dx, dy] of [[0, -11], [-9.5, 5.5], [9.5, 5.5]] as const) { c.beginPath(); c.moveTo(C, C - 3); c.lineTo(C + dx, C - 3 + dy); stroke(c, B, 2.4); }
    dot(c, 1.8, B, C, C - 3);
  });
  // terrains
  const ticks = (c: CanvasRenderingContext2D, color: string) => { for (const [x, y, w, h] of [[C - 1.6, C - 14, 3.2, 5.5], [C - 1.6, C + 8.5, 3.2, 5.5], [C - 14, C - 1.6, 5.5, 3.2], [C + 8.5, C - 1.6, 5.5, 3.2]] as const) { c.fillStyle = "#fff"; c.fillRect(x - 1, y - 1, w + 2, h + 2); c.fillStyle = color; c.fillRect(x, y, w, h); } };
  const glyph = (c: CanvasRenderingContext2D, kind: "H" | "P" | "X" | "anchor", color: string) => {
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.7;
    c.beginPath();
    if (kind === "H") { c.moveTo(C - 3.2, C - 4.5); c.lineTo(C - 3.2, C + 4.5); c.moveTo(C + 3.2, C - 4.5); c.lineTo(C + 3.2, C + 4.5); c.moveTo(C - 3.2, C); c.lineTo(C + 3.2, C); }
    else if (kind === "P") { c.moveTo(C - 2.6, C + 4.8); c.lineTo(C - 2.6, C - 4.8); c.lineTo(C + 0.6, C - 4.8); c.arc(C + 0.6, C - 2.4, 2.4, -Math.PI / 2, Math.PI / 2); c.lineTo(C - 2.6, C); }
    else if (kind === "X") { c.moveTo(C - 5, C - 5); c.lineTo(C + 5, C + 5); c.moveTo(C + 5, C - 5); c.lineTo(C - 5, C + 5); }
    else { c.moveTo(C, C - 3.6); c.lineTo(C, C + 5); c.moveTo(C - 3, C - 0.8); c.lineTo(C + 3, C - 0.8); c.moveTo(C - 4.6, C + 1.2); c.quadraticCurveTo(C - 4, C + 5.4, C, C + 5.4); c.quadraticCurveTo(C + 4, C + 5.4, C + 4.6, C + 1.2); }
    c.stroke();
    if (kind === "anchor") { c.beginPath(); c.arc(C, C - 5, 1.5, 0, Math.PI * 2); c.stroke(); }
  };
  for (const cls of ["civil", "mixte", "mil"] as const) {
    const col = cls === "mil" ? OACI_RED : B;
    const r = cls === "mil" ? 10.5 : 9;
    for (const kind of ["paved", "unpaved", "heli", "water"] as const) {
      make(`ad-${cls}-${kind}`, (c) => {
        if (cls !== "mil") ticks(c, col);
        circle(c, r); stroke(c, col, 2.2, "rgba(255,255,255,0.9)");
        const inner = cls === "civil" ? r : r - 3.2; // mixte et militaire : double cercle
        if (cls !== "civil") { circle(c, inner); c.strokeStyle = col; c.lineWidth = 1.1; c.stroke(); }
        if (kind === "paved") {
          circle(c, inner - (cls === "civil" ? 0.6 : 0.4)); c.fillStyle = col; c.fill();
          c.beginPath(); c.moveTo(C - inner * 0.62, C + inner * 0.62); c.lineTo(C + inner * 0.62, C - inner * 0.62); c.strokeStyle = "#fff"; c.lineWidth = cls === "mil" ? 3 : 3.6; c.stroke();
        } else if (kind === "heli") glyph(c, "H", col);
        else if (kind === "water") glyph(c, "anchor", col);
      });
    }
  }
  make("ad-p", (c) => { ticks(c, B); circle(c, 9); stroke(c, B, 2.2, "rgba(255,255,255,0.9)"); glyph(c, "P", B); });
  make("ad-x", (c) => { circle(c, 9); stroke(c, "#111", 2.2, "rgba(255,255,255,0.9)"); glyph(c, "X", "#111"); });
  // petites zones, parachutage (rouge OACI) ; vol libre (symboles propres à l'appli : non présents dans la légende OACI)
  make("small-area", (c) => { c.beginPath(); c.moveTo(C - 12, C); c.lineTo(C + 12, C); c.moveTo(C, C - 12); c.lineTo(C, C + 12); stroke(c, OACI_RED, 2.6); });
  make("para", (c) => {
    c.beginPath(); c.moveTo(C - 11, C - 1); c.quadraticCurveTo(C, C - 20, C + 11, C - 1); c.quadraticCurveTo(C + 5.5, C - 4, C, C - 1); c.quadraticCurveTo(C - 5.5, C - 4, C - 11, C - 1); c.closePath(); stroke(c, OACI_RED, 1.4, OACI_RED);
    c.beginPath(); c.moveTo(C - 10, C); c.lineTo(C, C + 9); c.moveTo(C + 10, C); c.lineTo(C, C + 9); c.moveTo(C, C - 1); c.lineTo(C, C + 9); stroke(c, OACI_RED, 1.3);
    dot(c, 2.2, OACI_RED, C, C + 11);
  });
  // voltige : avion dans un arc (rouge OACI)
  make("acro", (c) => {
    c.beginPath(); c.arc(C, C, 12, Math.PI * 0.9, Math.PI * 2.1); stroke(c, OACI_RED, 2);
    c.beginPath(); c.moveTo(C - 8, C + 7); c.lineTo(C + 8, C - 3); c.moveTo(C - 3, C - 1); c.lineTo(C + 4, C + 6); c.moveTo(C - 8, C + 7); c.lineTo(C - 8, C + 3); stroke(c, OACI_RED, 2.4);
    dot(c, 1.6, OACI_RED, C, C - 5);
  });
  // carrés de classe d'espace (A à E) pour les étiquettes des espaces contrôlés ; « cls-none » = rien
  for (const L of ["A", "B", "C", "D", "E"]) make(`cls-${L}`, (c) => { c.fillStyle = OACI_BLUE; c.fillRect(8, 8, 24, 24); c.fillStyle = "#fff"; c.font = "bold 19px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(L, 20, 21); });
  make("cls-none", () => undefined);
  // cadre à coins (étirable) autour des étiquettes d'espaces contrôlés
  {
    const cv = document.createElement("canvas"); cv.width = 32; cv.height = 32;
    const c = cv.getContext("2d");
    if (c) {
      c.fillStyle = "rgba(255,255,255,0.78)"; c.fillRect(0, 0, 32, 32);
      c.strokeStyle = OACI_BLUE; c.lineWidth = 3; c.lineCap = "square";
      c.beginPath();
      for (const [x, y, dx, dy] of [[1.5, 1.5, 1, 1], [30.5, 1.5, -1, 1], [1.5, 30.5, 1, -1], [30.5, 30.5, -1, -1]] as const) { c.moveTo(x + dx * 9, y); c.lineTo(x, y); c.lineTo(x, y + dy * 9); }
      c.stroke();
      out.set("ctl-frame", c.getImageData(0, 0, 32, 32));
    }
  }
  // cadre des balises (image étirable : le texte lui donne sa taille)
  const fcv = document.createElement("canvas");
  fcv.width = 32; fcv.height = 32;
  const fc = fcv.getContext("2d");
  if (fc) {
    for (const [name, color] of [["nav-frame", OACI_BLUE], ["siv-frame", "#1f7a3a"]] as const) {
      fc.clearRect(0, 0, 32, 32); fc.fillStyle = "rgba(255,255,255,0.92)"; fc.fillRect(0, 0, 32, 32); fc.strokeStyle = color; fc.lineWidth = 3; fc.strokeRect(1.5, 1.5, 29, 29);
      out.set(name, fc.getImageData(0, 0, 32, 32));
    }
  }
  iconCache = out;
  return out;
}

function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return { paper: v("--paper"), ink: v("--ink"), signal: v("--signal"), hair: v("--hair"), brand: v("--brand"), good: v("--zone-good"), bad: v("--zone-bad"), warn: v("--zone-warn"), muted: v("--ink-muted"), data: v("--data-figure") };
}

// Style vide : aucune donnée aéronautique en dur, aucun appel réseau. Les fonds de carte (MBTiles, J1 suite) et
// les données SIA / openAIP (J3) s'ajoutent par-dessus.
const baseStyle = (paper: string): StyleSpecification => ({
  version: 8,
  // Polices embarquées (public/fonts) : les noms et hauteurs restent lisibles hors-ligne.
  glyphs: `${location.origin}${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": paper } }],
});

// Tuile transparente 1x1 renvoyée quand une carte n'a pas la tuile demandée (évite les erreurs de chargement).
const TRANSPARENT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

let protocolRegistered = false;
/** Protocole « lim://<carte>/<z>/<x>/<y> » : sert les tuiles des MBTiles importés, sans réseau. */
function registerTileProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  // Fonds IGN : tuile téléchargée pour le hors-ligne si on l'a, sinon le service IGN (CORS ouvert) ; transparente si indisponible.
  maplibregl.addProtocol("ign", async (params) => {
    const mm = /^ign:\/\/(plan|ortho|relief)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const buf = mm ? await getTile(BASE_MAPS[mm[1] as BaseMapId], Number(mm[2]), Number(mm[3]), Number(mm[4])) : null;
    return { data: buf ?? (TRANSPARENT_PNG.slice().buffer as ArrayBuffer) };
  });
  // Fond aéro : tuile vectorielle ou de relief, depuis le cache (hors-ligne) sinon le réseau.
  maplibregl.addProtocol("oaci", async (params) => {
    const mm = /^oaci:\/\/(v|dem)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const buf = mm ? await getAeroTile(mm[1] as "v" | "dem", Number(mm[2]), Number(mm[3]), Number(mm[4])) : null;
    if (!buf) throw new Error("tuile du fond aéro indisponible");
    return { data: buf };
  });
  maplibregl.addProtocol("lim", async (params) => {
    const m = /^lim:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const reader = m ? getReader(m[1] as string) : undefined;
    const tile = m && reader ? await reader.getTile(Number(m[2]), Number(m[3]), Number(m[4])) : null;
    const bytes = tile ?? TRANSPARENT_PNG;
    return { data: bytes.slice().buffer as ArrayBuffer };
  });
}

const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 32;

/** Plancher d'un espace d'après les propriétés normalisées `floorRef` (AMSL | AGL | FL) et `floorValue`. */
function floorOf(f: Feature): AirspaceLimit | null {
  const p = f.properties ?? {};
  const ref = p["floorRef"];
  const value = p["floorValue"];
  if ((ref === "AMSL" || ref === "AGL" || ref === "FL") && typeof value === "number") {
    return { reference: ref as LimitReference, value };
  }
  return null;
}

function visibleCollection(fc: FeatureCollection, ceilingFL: number): FeatureCollection {
  return { type: "FeatureCollection", features: fc.features.filter((f) => isAirspaceVisible(floorOf(f), ceilingFL)) };
}

let aggloFileCache: Promise<GeoJSON.FeatureCollection | null> | null = null;
/** Contours d'agglomérations de la France (fichier livré avec l'application) en GeoJSON. */
function aggloFile(): Promise<GeoJSON.FeatureCollection | null> {
  aggloFileCache ??= (async () => {
    try {
      const o = (await (await fetch(`${import.meta.env.BASE_URL}agglo-fr.json`)).json()) as { items?: [number, number[]][] };
      const features: GeoJSON.Feature[] = (o.items ?? []).map(([c, r]) => {
        const ring: [number, number][] = [];
        for (let i = 0; i + 1 < r.length; i += 2) ring.push([r[i]!, r[i + 1]!]);
        return { type: "Feature", properties: { c }, geometry: { type: "Polygon", coordinates: [ring] } };
      });
      return { type: "FeatureCollection", features };
    } catch { return null; }
  })();
  return aggloFileCache;
}

export function MapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const planeMarker = useRef<maplibregl.Marker | null>(null);
  const bubbleMarkers = useRef<maplibregl.Marker[]>([]);
  const wpMarkers = useRef<maplibregl.Marker[]>([]);
  const loaded = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const addedOverlays = useRef<Map<string, string>>(new Map()); // id -> nom
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  /** Niveau de zoom voulu : le suivi le réapplique à chaque position, sinon il interrompt l'animation de zoom. */
  const targetZoom = useRef(5);

  // Création unique de la carte.
  useEffect(() => {
    if (!el.current) return;
    registerTileProtocol();
    const tk = tokens();
    const m = new maplibregl.Map({
      container: el.current,
      style: baseStyle(tk.paper),
      center: [2.35, 46.6], // centre de vue initial sur la France, pas une donnée aéronautique
      zoom: 5,
      doubleClickZoom: false, // le double-tap ouvre les détails ; le zoom passe par le pincement et les boutons + / −
      attributionControl: { compact: true },
    });
    map.current = m;
    latest.current.onMapApi?.({ getBounds: () => { const b = m.getBounds(); return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }; } });
    if (import.meta.env.DEV) (window as unknown as { __limMap?: unknown }).__limMap = m; // outil de test en développement seulement

    m.on("load", () => {
      m.addSource("vector", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tk.ink, "line-width": 4 } });
      m.addSource("replay", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "replay-line", type: "line", source: "replay", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tk.signal, "line-width": 3, "line-dasharray": [2, 1] } });
      m.addSource("direct", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "direct-line", type: "line", source: "direct", paint: { "line-color": tk.good, "line-width": 4 } });
      m.addLayer({ id: "vector-line", type: "line", source: "vector", paint: { "line-color": tk.signal, "line-width": 3 } });
      // les symboles OACI (images PNG de la légende) sont chargés avant le premier dessin des couches
      void oaciReady.then(() => {
        loaded.current = true;
        syncBase();
        syncAeroBase();
        syncNav();
        syncActivities();
        syncSpots();
        syncCharts();
        syncOverlays();
        syncRoute();
        syncAero();
        syncRadar();
        syncReplay();
        syncDocs();
      });
    });

    m.on("zoomend", (e) => {
      // Zoom fait au doigt (pincement) : on le retient comme nouveau niveau voulu.
      if ((e as { originalEvent?: unknown }).originalEvent) targetZoom.current = m.getZoom();
    });

    m.on("movestart", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) { latest.current.onUserMove(); latest.current.onAirfieldTap(null); }
    });

    // Double-tap = deux appuis rapprochés dans le temps et l'espace (souris et tactile).
    m.on("click", (e) => {
      if (latest.current.editMode) {
        latest.current.onMapTap(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const now = Date.now();
      const prev = lastTap.current;
      const { x, y } = e.point;
      // Appui simple sur un terrain : menu autour du terrain (Direct, Infos, VAC, Route).
      if (m.getLayer("apt-circle")) {
        const hit = m.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]] as [maplibregl.PointLike, maplibregl.PointLike], { layers: ["apt-circle", "apt-minor"].filter((l) => m.getLayer(l)) })[0];
        const id = hit ? String((hit.properties as { id?: unknown } | null)?.id ?? "") : "";
        if (hit && id) {
          lastTap.current = null;
          const g = hit.geometry as { type: string; coordinates: [number, number] };
          const sp = g.type === "Point" ? m.project(g.coordinates) : e.point;
          latest.current.onAirfieldTap({ id, x: sp.x, y: sp.y });
          return;
        }
      }
      latest.current.onAirfieldTap(null);
      if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        const layers = [...addedOverlays.current.keys()].flatMap((id) => [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`]).concat(["apt-circle", "apt-minor", "asp-fill", "act-sym", "act-model", ...NAV_SYM_LAYERS]).filter((l) => m.getLayer(l));
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [[x - 12, y - 12], [x + 12, y + 12]];
        const hits = layers.length ? m.queryRenderedFeatures(box, { layers }) : [];
        const seen = new Set<string>();
        const out: TappedFeature[] = [];
        for (const h of hits) {
          const key = `${h.source}:${JSON.stringify(h.properties)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // Espaces et terrains : l'application retrouve la fiche complète par l'identifiant.
          const aero = h.layer.id === "asp-fill" ? "asp" : (h.layer.id === "apt-circle" || h.layer.id === "apt-minor") ? "apt" : null;
          out.push({
            layerName: NAV_SYM_LAYERS.includes(h.layer.id) || h.layer.id === "act-sym" || h.layer.id === "act-model" ? String((h.properties as { cat?: unknown } | null)?.cat ?? "") : aero ?? addedOverlays.current.get(String(h.source).replace(/^ov-/, "")) ?? "",
            properties: (h.properties ?? {}) as Record<string, unknown>,
          });
        }
        latest.current.onDoubleTap(out);
      } else {
        lastTap.current = { t: now, x, y };
      }
    });

    return () => {
      planeMarker.current?.remove();
      bubbleMarkers.current.forEach((b) => b.remove());
      wpMarkers.current.forEach((b) => b.remove());
      m.remove();
      map.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ajoute, met à jour ou retire les couches importées pour refléter `props.overlays` et le filtre de plafond. */
  function syncOverlays() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { overlays, ceilingFL } = latest.current;
    const tk = tokens();
    const wanted = new Set(overlays.map((o) => o.id));
    for (const id of [...addedOverlays.current.keys()]) {
      if (!wanted.has(id)) {
        for (const l of [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`]) if (m.getLayer(l)) m.removeLayer(l);
        if (m.getSource(`ov-${id}`)) m.removeSource(`ov-${id}`);
        addedOverlays.current.delete(id);
      }
    }
    for (const o of overlays) {
      const data = visibleCollection(o.data, ceilingFL);
      const src = m.getSource(`ov-${o.id}`) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        continue;
      }
      m.addSource(`ov-${o.id}`, { type: "geojson", data });
      m.addLayer({ id: `ov-${o.id}-fill`, type: "fill", source: `ov-${o.id}`, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": tk.ink, "fill-opacity": 0.08 } });
      m.addLayer({ id: `ov-${o.id}-line`, type: "line", source: `ov-${o.id}`, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": tk.ink, "line-width": 2 } });
      m.addLayer({ id: `ov-${o.id}-pt`, type: "circle", source: `ov-${o.id}`, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": tk.paper, "circle-stroke-color": tk.ink, "circle-stroke-width": 2 } });
      addedOverlays.current.set(o.id, o.name);
    }
  }

  /** Ajoute, met à jour ou retire les cartes raster (MBTiles) ; elles restent sous les couches importées. */
  function syncCharts() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const wanted = new Set(latest.current.charts.map((c) => c.id));
    for (const l of m.getStyle().layers) {
      if (l.id.startsWith("ch-") && !wanted.has(l.id.slice(3))) {
        m.removeLayer(l.id);
        m.removeSource(l.id);
      }
    }
    for (const c of latest.current.charts) {
      const id = `ch-${c.id}`;
      if (!m.getSource(id)) {
        m.addSource(id, {
          type: "raster",
          tiles: [`lim://${c.id}/{z}/{x}/{y}`],
          tileSize: 256,
          minzoom: c.info.minZoom,
          maxzoom: c.info.maxZoom,
          ...(c.info.bounds ? { bounds: [...c.info.bounds] as [number, number, number, number] } : {}),
        });
        const before = m.getStyle().layers.find((l) => l.id !== "background" && !l.id.startsWith("ch-") && !l.id.startsWith("base-") && !l.id.startsWith("relief-"))?.id;
        m.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0 } }, before);
      }
      m.setLayoutProperty(id, "visibility", c.visible ? "visible" : "none");
      // maxzoom d'une couche est exclusif : « jusqu'au zoom N inclus » = N + 1.
      m.setLayerZoomRange(id, c.showFromZoom, c.showToZoom + 1);
    }
  }

  /** Ligne de la route et ligne « direct » de l'avion vers le point visé. */
  function syncRoute() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { route, targetIndex, fix, adhocTarget } = latest.current;
    const pts = route?.points ?? [];
    (m.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features:
        pts.length >= 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map((p) => [p.position.lon, p.position.lat]) } }]
          : [],
    });
    const routeTarget = targetIndex !== null ? pts[targetIndex] : undefined;
    const target = adhocTarget ? { position: adhocTarget } : routeTarget;
    (m.getSource("direct") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features:
        fix && target
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[fix.position.lon, fix.position.lat], [target.position.lon, target.position.lat]] } }]
          : [],
    });
  }
  useEffect(syncRoute, [props.route, props.targetIndex, props.fix, props.adhocTarget]);

  /** Rejeu : ligne de la trace, repère de la position rejouée, cadrage à l'ouverture d'une nouvelle trace. */
  const replayMarker = useRef<maplibregl.Marker | null>(null);
  const replayKey = useRef<string | null>(null);
  function syncReplay() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const rp = latest.current.replay;
    (m.getSource("replay") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: rp && rp.line.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: rp.line } }] : [],
    });
    if (!rp || !rp.pos) {
      replayMarker.current?.remove();
      replayMarker.current = null;
    } else {
      const ll: [number, number] = [rp.pos.lon, rp.pos.lat];
      if (!replayMarker.current) {
        const div = document.createElement("div");
        div.className = "plane";
        div.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M20 3 L31 35 L20 28 L9 35 Z"/></svg>';
        replayMarker.current = new maplibregl.Marker({ element: div, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(ll).addTo(m);
      }
      replayMarker.current.setLngLat(ll);
      if (rp.pos.trk !== null) replayMarker.current.setRotation(rp.pos.trk);
    }
    if (rp && rp.key !== replayKey.current && rp.line.length >= 2) {
      const b = new maplibregl.LngLatBounds(rp.line[0] as [number, number], rp.line[0] as [number, number]);
      rp.line.forEach((c) => b.extend(c));
      m.fitBounds(b, { padding: 60, duration: 600, maxZoom: 13 });
    }
    replayKey.current = rp ? rp.key : null;
  }
  useEffect(syncReplay, [props.replay]);

  // Points numérotés (déplaçables en mode tracé).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    wpMarkers.current.forEach((x) => x.remove());
    wpMarkers.current = [];
    (props.route?.points ?? []).forEach((p, i) => {
      const el = document.createElement("div");
      el.className = `wp${i === props.targetIndex ? " target" : ""}${i === props.selectedIndex ? " selected" : ""}`;
      el.textContent = String(i + 1);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation(); // sinon la carte comprend un appui « ajouter un point »
        latest.current.onPointTap(i);
      });
      const mk = new maplibregl.Marker({ element: el, draggable: props.editMode })
        .setLngLat([p.position.lon, p.position.lat])
        .addTo(m);
      mk.on("dragend", () => {
        const ll = mk.getLngLat();
        latest.current.onPointMove(i, ll.lat, ll.lng);
      });
      wpMarkers.current.push(mk);
    });
  }, [props.route, props.targetIndex, props.selectedIndex, props.editMode]);

  // Cadrer la carte sur la route (préparation sur ordinateur : pas de GPS, donc pas d'avion à suivre).
  useEffect(() => {
    const m = map.current;
    const { route, fix, fitRequest } = latest.current;
    if (!m || fitRequest.nonce === 0 || !route || route.points.length === 0) return;
    if (!fitRequest.force && fix) return; // avec un GPS, la carte suit l'avion sauf demande explicite
    m.resize(); // le conteneur vient peut-être de changer de taille (panneau Route) : on recalcule avant de cadrer
    if (route.points.length === 1) {
      const p0 = route.points[0]!;
      m.easeTo({ center: [p0.position.lon, p0.position.lat], zoom: 9, duration: 600 });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    route.points.forEach((p) => b.extend([p.position.lon, p.position.lat]));
    // Marges plus grandes en haut et à gauche : bannière, pastille GPS et boutons de la carte s'y trouvent.
    m.fitBounds(b, { padding: { top: 110, bottom: 70, left: 100, right: 70 }, maxZoom: 11, duration: 600 });
  }, [props.fitRequest.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Espaces aériens et terrains : données posées une fois, filtres (groupe, plafond, visibilité) appliqués sans recharger. */
  const aeroData = useRef(new Map<string, FeatureCollection>());
  const aspBase = useRef(new Map<string, unknown>());
  function syncAero() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { airspaceData, airfieldData, showAirspaces, showAirfields, visibleGroups, ceilingFL } = latest.current;
    const tk = tokens();
    const before = m.getLayer("route-line") ? "route-line" : undefined;
    const ensure = (id: string, data: FeatureCollection | null) => {
      if (!data) return false;
      const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (!src) m.addSource(id, { type: "geojson", data });
      else if (aeroData.current.get(id) !== data) src.setData(data);
      aeroData.current.set(id, data);
      return true;
    };
    if (ensure("asp", airspaceData) && !m.getLayer("asp-fill")) {
      addAspIcons(m);
      const sty = (...v: string[]) => ["in", ["get", "sty"], ["literal", v]];
      const big = (...v: string[]) => ["all", sty(...v), ["!=", ["get", "small"], true]]; // les petites zones P/R/D sont figurées par une croix
      const half = (a: number, b: number) => ["interpolate", ["linear"], ["zoom"], 5, a, 12, b] as never;
      const bandColor = ["match", ["get", "sty"], "ca", "#e8506a", "cbd", "#5f82c6", "#a9c5ea"] as never;
      const edgeColor = ["match", ["get", "sty"], "ca", "#c8183a", "cbd", "#1d46a6", "ce", "#3d68b5", "pro", "#e0202a", "res", "#e0202a", "rtba", "#e0202a", "parz", "#e0202a", "act", "#e0202a", "park", "#e0202a", "fir", "#1b5faa", "#777777"] as never;
      // Fond transparent : sert à retrouver l'espace au double appui.
      m.addLayer({ id: "asp-fill", type: "fill", source: "asp", paint: { "fill-color": "#1d46a6", "fill-opacity": 0 } }, before);
      // Espaces contrôlés : bande colorée à l'intérieur de la limite, puis trait.
      m.addLayer({ id: "asp-band", type: "line", source: "asp", filter: sty("ca", "cbd", "ce") as never, layout: { "line-join": "round" }, paint: { "line-color": bandColor, "line-width": half(2, 4), "line-offset": half(1, 2), "line-opacity": 0.85 } }, before);
      // Zones interdites (quadrillage) et réglementées / dangereuses (hachures rouges).
      m.addLayer({ id: "asp-hatch-pro", type: "line", source: "asp", filter: big("pro") as never, paint: { "line-pattern": "hatch-pro", "line-width": half(6, 10), "line-offset": half(3, 5) } }, before);
      m.addLayer({ id: "asp-hatch-res", type: "line", source: "asp", filter: big("res", "act", "rtba", "parz") as never, paint: { "line-pattern": "hatch-res", "line-width": half(6, 10), "line-offset": half(3, 5) } }, before);
      m.addLayer({ id: "asp-edge", type: "line", source: "asp", filter: big("ca", "cbd", "ce", "pro", "res", "act", "fir", "rtba", "parz") as never, layout: { "line-join": "round" }, paint: { "line-color": edgeColor, "line-width": ["match", ["get", "sty"], "rtba", 4.5, "parz", 3, 1.4] as never } }, before);
      // RMZ / TMZ : trait mixte ; ATZ et secteurs SIV : pointillés ; parcs, transits planeur : tirets fins.
      m.addLayer({ id: "asp-dash-rmz", type: "line", source: "asp", filter: sty("rmz") as never, paint: { "line-color": "#1a1a2e", "line-width": 2.2, "line-dasharray": [5, 1.5, 1, 1.5] } }, before);
      m.addLayer({ id: "asp-dash-dot", type: "line", source: "asp", filter: sty("atz") as never, layout: { "line-cap": "round" }, paint: { "line-color": "#1d46a6", "line-width": 3, "line-dasharray": [0.1, 2.2] } }, before);
      m.addLayer({ id: "asp-dash-minor", type: "line", source: "asp", filter: sty("glider", "other") as never, paint: { "line-color": ["match", ["get", "sty"], "park", "#e0202a", "glider", "#2e9a4a", "#777777"] as never, "line-width": 1.1, "line-dasharray": [3, 2.5] } }, before);
      // Limite de secteur d'information de vol (SIV) : trait épais mauve clair comme sur la carte OACI.
      m.addLayer({ id: "asp-siv-line", type: "line", source: "asp", filter: big("siv") as never, layout: { "line-join": "round" }, paint: { "line-color": "#b9a2d0", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.6, 10, 3.2] } }, before);
      // Grand parc ou réserve naturelle (légende OACI) : trait rouge continu et rangée de points ronds rouges juste en dessous.
      m.addLayer({ id: "asp-park-line", type: "line", source: "asp", filter: big("park") as never, layout: { "line-join": "round" }, paint: { "line-color": "#e8202a", "line-width": 1.6 } }, before);
      m.addLayer({ id: "asp-park-dots", type: "line", source: "asp", filter: big("park") as never, layout: { "line-cap": "round" }, paint: { "line-color": "#e8202a", "line-width": 3.4, "line-offset": 4, "line-dasharray": [0.01, 2.6] } }, before);
      addIcons(m);
      m.addLayer({
        id: "asp-lbl", type: "symbol", source: "asp", minzoom: 6.6, filter: ["!=", ["get", "lbl"], ""] as never,
        layout: { "text-field": ["get", "lbl"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 7.4, 9, 12, 12], "text-justify": "center", "text-optional": true, "text-padding": 6 } as never,
        paint: { "text-color": ["match", ["get", "sty"], "pro", "#e0202a", "res", "#e0202a", "rtba", "#e0202a", "parz", "#e0202a", "#1b3f9a"] as never, "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
      }, before);
      // Espaces contrôlés (TMA, CTA, CTR, LTA) : carré de la classe, nom, plafond, plancher et fréquence dans un cadre à coins, comme l'OACI.
      m.addLayer({
        id: "asp-ctl", type: "symbol", source: "asp", minzoom: 6.6, filter: ["all", ["has", "ctllbl"], ["!=", ["get", "ctllbl"], ""]] as never,
        layout: {
          "text-field": ["format", ["image", ["get", "cls"]], {}, "\n", {}, ["get", "ctllbl"], { "text-color": OACI_BLUE }],
          "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 6.6, 10.5, 12, 14], "text-justify": "center", "text-padding": 6, "text-optional": false, "text-line-height": 1.15,
          "icon-image": "ctl-frame", "icon-text-fit": "both", "icon-text-fit-padding": [2, 3, 2, 3],
        } as never,
        paint: { "text-color": OACI_BLUE, "text-halo-color": "#ffffff", "text-halo-width": 2.2 },
      }, before);
      // Secteurs d'information de vol : nom, limites et fréquence dans un encadré vert.
      m.addLayer({
        id: "asp-siv", type: "symbol", source: "asp", minzoom: 8, maxzoom: 12.5, filter: ["all", ["has", "sivlbl"], ["!=", ["get", "sivlbl"], ""]] as never,
        layout: {
          "text-field": ["get", "sivlbl"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 11], "text-justify": "center", "text-padding": 10, "text-allow-overlap": false, "icon-allow-overlap": false,
          "icon-image": "siv-frame", "icon-text-fit": "both", "icon-text-fit-padding": [2, 4, 2, 4],
        } as never,
        paint: { "text-color": "#1f7a3a", "icon-opacity": 0.8 },
      }, before);
      // Au-dessus des étiquettes : les symboles ponctuels (croix, parachute) ne doivent pas être masqués par elles.
      m.addLayer({
        id: "asp-sym", type: "symbol", source: "asp", minzoom: 5.5, filter: sty("cross", "para", "acro") as never,
        layout: {
          "icon-image": ["get", "sym"], "icon-allow-overlap": false, "icon-padding": 3, "icon-size": ["interpolate", ["linear"], ["zoom"], 5.5, 0.8, 7, 1.3, 12, 2.1],
          "text-field": ["step", ["zoom"], "", 8, ["get", "lbl"]], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9, 12, 12], "text-anchor": "left", "text-justify": "left", "text-offset": [1.3, 0], "text-optional": true,
        } as never,
        paint: { "text-color": OACI_RED, "text-halo-color": "#ffffff", "text-halo-width": 1.8 } as never,
      }, before);
    }
    if (ensure("apt", airfieldData) && !m.getLayer("apt-circle")) {
      addIcons(m);
      // Comme la carte OACI : seuls les terrains à code OACI s'affichent d'emblée ; les autres (bases ULM, pistes privées) apparaissent en zoomant de près.
      for (const [id, minzoom, filter] of [["apt-circle", 4.5, ["!=", ["get", "icao"], ""]], ["apt-minor", 11, ["==", ["get", "icao"], ""]]] as const) {
        m.addLayer(
          {
            id, type: "symbol", source: "apt", minzoom, filter: filter as never,
            layout: {
              "icon-image": ["get", "sym"], "icon-allow-overlap": false, "icon-padding": 3, "symbol-sort-key": ["case", ["get", "mil"], 1, 0], "icon-size": ["interpolate", ["linear"], ["zoom"], 4.5, 0.75, 6, 1.2, 12, 1.9], "icon-rotation-alignment": "map", // la barre de piste reste alignée sur le nord géographique
              "text-field": ["step", ["zoom"], "", id === "apt-circle" ? 6.6 : 11, ["get", "lbl"]], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 7.6, 10, 12, 14],
              "text-anchor": "left", "text-justify": "left", "text-offset": [1.6, 0], "text-optional": true,
            } as never,
            paint: { "text-color": ["case", ["get", "mil"], OACI_RED, OACI_BLUE], "text-halo-color": "#ffffff", "text-halo-width": 2 } as never,
          },
          before,
        );
      }
    }
    if (m.getLayer("asp-fill")) {
      const ceilingM = flightLevelToMeters(ceilingFL);
      // les secteurs SIV (groupe « autre ») restent affichés : ils font partie de la carte OACI
      const common = ["all", ["any", ["in", ["get", "group"], ["literal", [...visibleGroups]]], ["==", ["get", "sty"], "siv"]], ["<", ["get", "floorM"], ceilingM]] as never;
      for (const id of ASP_LAYERS) {
        const l = m.getLayer(id);
        if (!l) continue;
        // chaque couche garde son filtre de style ; on lui ajoute celui des groupes et du plafond
        const base = id === "asp-fill" ? null : (aspBase.current.get(id) ?? (aspBase.current.set(id, m.getFilter(id) ?? null), aspBase.current.get(id)));
        m.setFilter(id, (base ? ["all", base, common] : common) as never);
        m.setLayoutProperty(id, "visibility", showAirspaces ? "visible" : "none");
      }
    }
    for (const id of ["apt-circle", "apt-minor"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showAirfields ? "visible" : "none");
    raiseDocs();
  }
  /** Balises, points de report, obstacles : symboles et étiquettes de la carte OACI, dessinés sur la carte (polices embarquées : utilisable hors-ligne). */
  function addIcons(m: maplibregl.Map) {
    for (const [name, img] of oaciIcons) if (!m.hasImage(name)) m.addImage(name, img, { pixelRatio: OACI_PIXEL_RATIO });
    for (const [name, img] of navIcons()) {
      if (m.hasImage(name)) continue;
      if (name === "ctl-frame") m.addImage(name, img, { pixelRatio: 2, stretchX: [[10, 22]], stretchY: [[10, 22]], content: [10, 10, 22, 22] } as never);
      else if (name === "nav-frame" || name === "siv-frame") m.addImage(name, img, { pixelRatio: 2, stretchX: [[8, 24]], stretchY: [[8, 24]], content: [8, 8, 24, 24] } as never);
      else m.addImage(name, img, { pixelRatio: 2 });
    }
  }
  /** Activités aériennes de l'AIP : symboles OACI avec leur numéro de référence en rouge. */
  function syncActivities() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { activityData, showActivities } = latest.current;
    if (activityData) {
      addIcons(m);
      const src = m.getSource("act") as maplibregl.GeoJSONSource | undefined;
      if (!src) m.addSource("act", { type: "geojson", data: activityData });
      else if (aeroData.current.get("act") !== activityData) src.setData(activityData);
      aeroData.current.set("act", activityData);
      if (!m.getLayer("act-sym")) {
        // Parachutage, voltige, treuillage : toujours dessinés (ils sont souvent sur un terrain, dont le symbole les chassait) et décalés ; l'aéromodélisme, très dense, évite les chevauchements.
        const key = ["match", ["get", "sym"], "aeromodel-orange", "#e08a00", "aeromodel-purple", "#8a3f9b", "#e8202a"] as never;
        for (const [id, filter, overlap] of [
          ["act-sym", ["in", ["get", "kind"], ["literal", ["para", "acro", "glider"]]], true],
          ["act-model", ["!", ["in", ["get", "kind"], ["literal", ["para", "acro", "glider"]]]], false],
        ] as const) {
          m.addLayer({
            id, type: "symbol", source: "act", minzoom: 6.5, filter: filter as never,
            layout: {
              "icon-image": ["get", "sym"], "icon-allow-overlap": overlap, "icon-padding": 2,
              // sur un terrain : le symbole est écarté de celui du terrain (déplacement permis par la légende OACI). Décalage faible, proportionnel à la taille du symbole : il reste collé au terrain à tout zoom.
              "icon-offset": ["case", ["get", "onAd"], ["match", ["get", "kind"], "glider", ["literal", [-16, 3]], "para", ["literal", [-12, -16]], "acro", ["literal", [-16, -8]], ["literal", [0, 0]]], ["literal", [0, 0]]], "icon-size": ["interpolate", ["linear"], ["zoom"], 6.5, 0.8, 8, 1.0, 12, 1.4],
              "text-field": ["step", ["zoom"], "", 8, ["get", "lbl"]], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 13, 13],
              // voltige : le numéro est écrit au centre de la boucle du symbole, comme sur l'OACI ; les autres activités : numéro à droite
              "text-anchor": ["match", ["get", "kind"], "acro", "center", "left"], "text-offset": ["match", ["get", "kind"], "acro", ["literal", [0, -0.6]], ["literal", [1.1, 0]]], "text-optional": true, "symbol-sort-key": ["match", ["get", "kind"], "para", 0, "acro", 1, "glider", 2, 3],
            } as never,
            paint: { "text-color": key, "text-halo-color": "#ffffff", "text-halo-width": 1.8 },
          }, m.getLayer("route-line") ? "route-line" : undefined);
        }
      }
    }
    for (const id of ["act-sym", "act-model"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showActivities ? "visible" : "none");
    raiseDocs();
  }
  /** Points cotés : petit point et altitude en pieds (gras au-dessus de 3 000 ft), comme sur la carte OACI. */
  function syncSpots() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { spotData, showSpots } = latest.current;
    if (spotData) {
      const src = m.getSource("spot") as maplibregl.GeoJSONSource | undefined;
      if (!src) m.addSource("spot", { type: "geojson", data: spotData });
      else if (aeroData.current.get("spot") !== spotData) src.setData(spotData);
      aeroData.current.set("spot", spotData);
      if (!m.getLayer("spot-dot")) {
        const before = m.getLayer("route-line") ? "route-line" : undefined;
        m.addLayer({ id: "spot-dot", type: "circle", source: "spot", minzoom: 7.5, paint: { "circle-radius": 1.8, "circle-color": "#222222" } }, before);
        m.addLayer({
          id: "spot-lbl", type: "symbol", source: "spot", minzoom: 7.5,
          layout: { "text-field": ["get", "lbl"], "text-font": ["Open Sans Semibold"], "text-size": ["case", ["get", "major"], 13, 10.5], "text-anchor": "left", "text-offset": [0.5, 0], "text-optional": true, "symbol-sort-key": ["-", 0, ["get", "ft"]] } as never,
          paint: { "text-color": "#222222", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
        }, before);
      }
    }
    for (const id of ["spot-dot", "spot-lbl"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showSpots ? "visible" : "none");
    raiseDocs();
  }
  function syncNav() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { navData, showNav } = latest.current;
    if (navData) {
      addIcons(m);
      const src = m.getSource("nav") as maplibregl.GeoJSONSource | undefined;
      if (!src) m.addSource("nav", { type: "geojson", data: navData });
      else if (aeroData.current.get("nav") !== navData) src.setData(navData);
      aeroData.current.set("nav", navData);
      if (!m.getLayer("nav-sym")) {
        const font = ["Open Sans Semibold"];
        const size = ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 14] as never;
        const before = m.getLayer("route-line") ? "route-line" : undefined;
        const layout = {
          "icon-image": ["get", "sym"], "icon-allow-overlap": false, "icon-padding": 3, "symbol-sort-key": ["match", ["get", "grp"], "navaid", 0, "report", 1, 2], "icon-size": ["interpolate", ["linear"], ["zoom"], 5.5, 0.8, 7, 1.3, 12, 2.1],
          "text-field": ["get", "lbl"], "text-font": font, "text-size": size, "text-anchor": "left", "text-justify": "left", "text-offset": [1.5, 0], "text-optional": true,
        } as never;
        const paint = { "text-color": OACI_BLUE, "text-halo-color": "#ffffff", "text-halo-width": 2 } as never;
        const obs = ["==", ["get", "grp"], "obstacle"];
        // Obstacles : seuls ceux de 300 ft AGL et plus (comme sur la carte OACI) ; les plus hauts de loin, les autres dès le zoom 9,5. Les filtres ne dépendent pas du zoom : un calque par niveau.
        m.addLayer({ id: "nav-sym", type: "symbol", source: "nav", minzoom: 5.5, layout, paint, filter: ["any", ["in", ["get", "grp"], ["literal", ["navaid", "report"]]], ["all", ["==", ["get", "grp"], "obstacle"], [">=", ["get", "h"], 152.4]]] as never }, before);
        m.addLayer({ id: "nav-obs-mid", type: "symbol", source: "nav", minzoom: 8, layout, paint, filter: ["all", obs, [">=", ["get", "h"], 91.44], ["<", ["get", "h"], 152.4]] as never }, before);
        m.addLayer({ id: "nav-nuc", type: "symbol", source: "nav", minzoom: 5, filter: ["==", ["get", "grp"], "nuclear"] as never, layout: { "icon-image": "nuclear", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 9, 1, 12, 1.5] } as never }, before);
        const navaid = ["==", ["get", "grp"], "navaid"];
        m.addLayer({
          id: "nav-box", type: "symbol", source: "nav", minzoom: 6.5, filter: navaid as never,
          layout: { "text-field": ["get", "box"], "text-font": font, "text-size": size, "text-anchor": "left", "text-offset": [1.9, 0.3], "text-allow-overlap": false, "icon-image": "nav-frame", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3] } as never,
          paint: { "text-color": OACI_BLUE } as never,
        }, before);
        m.addLayer({
          id: "nav-name", type: "symbol", source: "nav", minzoom: 6.5, filter: navaid as never,
          layout: { "text-field": ["get", "nm"], "text-font": font, "text-size": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 12], "text-anchor": "bottom-left", "text-offset": [1.9, -0.55], "text-optional": true } as never,
          paint: { "text-color": OACI_BLUE, "text-halo-color": "#ffffff", "text-halo-width": 2 } as never,
        }, before);
      }
    }
    for (const id of NAV_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showNav ? "visible" : "none");
    raiseDocs();
  }
  /** Radar de pluie : tuiles distantes (le seul calque qui exige le réseau), sous la route et au-dessus des cartes. */
  function syncRadar() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const url = latest.current.radarTemplate;
    if (m.getLayer("radar")) m.removeLayer("radar");
    if (m.getSource("radar")) m.removeSource("radar");
    if (!url) return;
    m.addSource("radar", { type: "raster", tiles: [url], tileSize: 256, maxzoom: 7, attribution: "© RainViewer" });
    m.addLayer({ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": 0.65 } }, m.getLayer("asp-fill") ? "asp-fill" : m.getLayer("route-line") ? "route-line" : undefined);
  }
  useEffect(syncRadar, [props.radarTemplate]);

  useEffect(syncNav, [props.navData, props.showNav]);
  useEffect(syncActivities, [props.activityData, props.showActivities]);
  useEffect(syncSpots, [props.spotData, props.showSpots]);
  useEffect(syncAero, [props.airspaceData, props.airfieldData, props.showAirspaces, props.showAirfields, props.visibleGroups, props.ceilingFL]);

  /** Fond IGN et relief : sources raster sous tout le reste. */
  function syncBase() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { baseMap, relief } = latest.current;
    const want: { id: string; map: BaseMapId; opacity: number }[] = [];
    if (baseMap === "plan" || baseMap === "ortho") want.push({ id: "base-ign", map: baseMap, opacity: 1 });
    if (relief) want.push({ id: "relief-ign", map: "relief", opacity: 0.5 });
    for (const l of m.getStyle().layers) {
      if ((l.id === "base-ign" || l.id === "relief-ign") && !want.some((w) => w.id === l.id && (m.getSource(l.id) as unknown as { tiles?: string[] } | undefined)?.tiles?.[0]?.startsWith(`ign://${w.map}/`))) {
        m.removeLayer(l.id);
        m.removeSource(l.id);
      }
    }
    for (const w of want) {
      if (m.getSource(w.id)) continue;
      m.addSource(w.id, { type: "raster", tiles: [`ign://${w.map}/{z}/{x}/{y}`], tileSize: 256, maxzoom: BASE_MAPS[w.map].maxZoom, attribution: IGN_ATTRIBUTION });
      const bottom = m.getStyle().layers.find((l) => l.id !== "background" && !(w.id === "relief-ign" && l.id === "base-ign") && !l.id.startsWith("aerob-"))?.id;
      // fond tout en bas ; relief juste au-dessus du fond
      const before = w.id === "relief-ign" ? m.getStyle().layers.find((l) => l.id !== "background" && l.id !== "base-ign" && !l.id.startsWith("aerob-"))?.id : bottom;
      m.addLayer({ id: w.id, type: "raster", source: w.id, paint: { "raster-opacity": w.opacity, "raster-fade-duration": 0 } }, before);
    }
  }
  useEffect(syncBase, [props.baseMap, props.relief]);

  /**
   * Fond « aéro » dans l'esprit de la carte OACI (légende « Fonds cartographiques ») : teintes hypsométriques (blanc, jaune pâle à orangé, bleu pâle au-dessus de 11 500 ft),
   * végétation vert pâle, agglomérations jaunes, autoroutes et routes brun-gris, voies ferrées noires, frontière rose. Données OpenStreetMap (OpenFreeMap) et relief Terrarium.
   */
  const agglo = useRef(new Map<string, GeoJSON.Feature>());
  /** Points des agglomérations : petites (rond jaune + nom gris) et, aux petits zooms, villes (disque coloré). Les contours des moyennes et grandes viennent de public/agglo-fr.json (tools/build-agglomerations.py). */
  function syncAglo() {
    const m = map.current;
    if (!m || !loaded.current || !m.getSource("aerob-agglo") || !m.getSource("aerob-v")) return;
    let changed = false;
    for (const f of m.querySourceFeatures("aerob-v", { sourceLayer: "place" })) {
      const pr = f.properties ?? {};
      const cls = String(pr["class"] ?? "");
      if (!["city", "town", "village", "hamlet"].includes(cls) || f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const name = String(pr["name"] ?? "");
      const key = `${name}|${lon.toFixed(3)}|${lat.toFixed(3)}`;
      const big = cls === "city" || (cls === "town" && Number(pr["capital"] ?? 99) <= 6); // le rang OpenMapTiles est relatif à la tuile : inutilisable
      const kind = cls === "hamlet" ? "hamlet" : big ? "big" : cls === "town" ? "mid" : "small";
      const prevKind = agglo.current.get(key)?.properties?.["kind"] as string | undefined;
      const order = ["hamlet", "small", "mid", "big"];
      if (prevKind && order.indexOf(prevKind) >= order.indexOf(kind)) continue; // jamais de rétrogradation : certaines tuiles omettent la capitale
      agglo.current.set(key, { type: "Feature", properties: { kind, name: String(pr["name:fr"] ?? name) }, geometry: { type: "Point", coordinates: [lon, lat] } });
      changed = true;
    }
    if (changed) (m.getSource("aerob-agglo") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: [...agglo.current.values()].slice(-40000) });
  }
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const on = () => syncAglo();
    m.on("idle", on);
    m.on("moveend", on);
    return () => { m.off("idle", on); m.off("moveend", on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function syncAeroBase() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const want = latest.current.baseMap === "aero";
    const has = !!m.getSource("aerob-v");
    if (!want) {
      if (has) {
        for (const l of m.getStyle().layers) if (l.id.startsWith("aerob-")) m.removeLayer(l.id);
        m.removeSource("aerob-v");
        m.removeSource("aerob-dem");
        if (m.getSource("aerob-agglo")) m.removeSource("aerob-agglo");
        if (m.getSource("aerob-agglo-fr")) m.removeSource("aerob-agglo-fr");
        agglo.current.clear();
      }
      return;
    }
    if (has) return;
    m.addSource("aerob-dem", { type: "raster-dem", tiles: ["oaci://dem/{z}/{x}/{y}"], tileSize: 256, maxzoom: AERO_DEM_MAX_ZOOM, encoding: "terrarium" });
    m.addSource("aerob-v", { type: "vector", tiles: ["oaci://v/{z}/{x}/{y}"], maxzoom: 14, attribution: AERO_ATTRIBUTION });
    const before = m.getStyle().layers.find((l) => l.id !== "background" && !l.id.startsWith("aerob-") && l.id !== "base-ign")?.id;
    const add = (l: Record<string, unknown>) => m.addLayer(l as never, before);
    const zoomW = (a: number, b: number, z0 = 8, z1 = 14) => ["interpolate", ["linear"], ["zoom"], z0, a, z1, b];
    const font = ["Open Sans Semibold"];
    const halo = { "text-halo-color": "#ffffff", "text-halo-width": 1.6 };
    // Teintes hypsométriques (pieds → mètres) : 0-1000 blanc, 1000-2000, 2000-3000, 3000-5000, 5000-8200, 8200-11500, plus de 11500.
    const bands: [number, string][] = [[0, "#ffffff"], [305, "#fffce6"], [610, "#fff4cf"], [914, "#ffeaaa"], [1524, "#ffe1a5"], [2499, "#fccc93"], [3505, "#eaf6fd"]];
    const stops: (number | string)[] = [];
    bands.forEach(([e, c], i) => { if (i > 0) stops.push(e - 1, bands[i - 1]![1]); stops.push(e, c); });
    add({ id: "aerob-hypso", type: "color-relief", source: "aerob-dem", paint: { "color-relief-color": ["interpolate", ["linear"], ["elevation"], -500, "#ffffff", ...stops], "color-relief-opacity": 1 } });
    add({ id: "aerob-wood", type: "fill", source: "aerob-v", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["wood", "forest"]]], paint: { "fill-color": "#e2eedd" } });
    add({ id: "aerob-marsh", type: "fill", source: "aerob-v", "source-layer": "landcover", filter: ["==", ["get", "class"], "wetland"], paint: { "fill-color": "#a1c3ce", "fill-opacity": 0.45 } });
    // Agglomérations selon la légende OACI : grande (largeur > 3600 m) orange, moyenne (1200 à 3600 m) jaune, toutes deux en contour ; petite (< 1200 m) simple point jaune.
    // Les contours sont des polygones à l'échelle réelle générés autour des villes de la carte (cf. syncAglo).
    m.addSource("aerob-agglo", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const col = ["match", ["get", "kind"], "big", "#f8a000", "#fff200"];
    const poly = ["==", ["geometry-type"], "Polygon"];
    // Contours des agglomérations moyennes (jaune) et grandes (orange) : calculés d'après les zones bâties (public/agglo-fr.json).
    m.addSource("aerob-agglo-fr", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    add({ id: "aerob-agglo-poly", type: "fill", source: "aerob-agglo-fr", minzoom: 7, paint: { "fill-color": ["match", ["get", "c"], 2, "#f8a000", "#fff200"], "fill-opacity": 1, "fill-outline-color": "#b07400" } });
    void aggloFile().then((fc) => { if (fc && m.getSource("aerob-agglo-fr")) (m.getSource("aerob-agglo-fr") as maplibregl.GeoJSONSource).setData(fc); });
    const pt = (k: string[]) => ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "kind"], ["literal", k]]];
    add({ id: "aerob-agglo-dot-low", type: "circle", source: "aerob-agglo", maxzoom: 7, filter: pt(["big", "mid"]) as never, paint: { "circle-color": col as never, "circle-radius": 4, "circle-stroke-color": "#6b5400", "circle-stroke-width": 0.8 } });
    add({ id: "aerob-agglo-dot-small", type: "circle", source: "aerob-agglo", minzoom: 9.2, filter: pt(["small"]) as never, paint: { "circle-color": "#fff200", "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.2, 2.4, 12, 3.6], "circle-stroke-color": "#222222", "circle-stroke-width": 1 } });
    add({ id: "aerob-agglo-dot-hamlet", type: "circle", source: "aerob-agglo", minzoom: 9.2, filter: pt(["hamlet"]) as never, paint: { "circle-color": "#ffffff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.4, 12, 3.6], "circle-stroke-color": "#222222", "circle-stroke-width": 1 } });
    add({ id: "aerob-water", type: "fill", source: "aerob-v", "source-layer": "water", paint: { "fill-color": "#cfe8f4" } });
    add({ id: "aerob-river", type: "line", source: "aerob-v", "source-layer": "waterway", filter: ["in", ["get", "class"], ["literal", ["river", "canal"]]], paint: { "line-color": "#5fa8cf", "line-width": zoomW(0.6, 1.8) } });
    add({ id: "aerob-boundary", type: "line", source: "aerob-v", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "#c1608f", "line-width": zoomW(1.6, 3.4, 5, 12), "line-opacity": 0.6, "line-dasharray": [3, 2] } });
    const road = (cls: string[]) => ["in", ["get", "class"], ["literal", cls]];
    add({ id: "aerob-sec", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 9, filter: road(["secondary", "tertiary", "minor"]), paint: { "line-color": "#b6adac", "line-width": zoomW(0.6, 1.6, 9, 14) } });
    add({ id: "aerob-main", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 7, filter: road(["trunk", "primary"]), paint: { "line-color": "#958886", "line-width": zoomW(0.9, 2.6, 7, 14) } });
    add({ id: "aerob-mw-casing", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 6, filter: road(["motorway"]), paint: { "line-color": "#85716d", "line-width": zoomW(1.6, 5, 6, 14) } });
    add({ id: "aerob-mw-core", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 8, filter: road(["motorway"]), paint: { "line-color": "#ffffff", "line-width": zoomW(0.4, 1.6, 8, 14) } });
    add({ id: "aerob-rail", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 8, filter: ["==", ["get", "class"], "rail"], paint: { "line-color": "#222222", "line-width": zoomW(0.7, 1.4, 8, 14) } });
    add({ id: "aerob-rail-ticks", type: "line", source: "aerob-v", "source-layer": "transportation", minzoom: 10, filter: ["==", ["get", "class"], "rail"], paint: { "line-color": "#222222", "line-width": zoomW(2.2, 4, 10, 14), "line-dasharray": [0.2, 6] } });
    add({
      id: "aerob-peak", type: "symbol", source: "aerob-v", "source-layer": "mountain_peak", minzoom: 9,
      layout: { "text-field": ["to-string", ["coalesce", ["get", "ele_ft"], ""]], "text-font": font, "text-size": 10, "text-anchor": "left", "text-offset": [0.5, 0], "text-optional": true },
      paint: { "text-color": "#222222", ...halo },
    });
    // Nom des petites agglomérations : gris clair à côté du point, comme sur la carte OACI.
    add({
      id: "aerob-agglo-name", type: "symbol", source: "aerob-agglo", minzoom: 9.8, filter: ["all", ["==", ["geometry-type"], "Point"], ["in", ["get", "kind"], ["literal", ["small", "hamlet"]]]],
      layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9.5, 13, 12], "text-anchor": "left", "text-offset": [0.9, 0], "text-max-width": 7, "text-padding": 2 },
      paint: { "text-color": "#8c8c8c", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
    });
    const placeSize = (c: number, t: number, v: number) => ["match", ["get", "class"], "city", c, "town", t, v];
    add({
      id: "aerob-place", type: "symbol", source: "aerob-v", "source-layer": "place", minzoom: 5, filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
      layout: {
        "text-field": ["coalesce", ["get", "name:fr"], ["get", "name"]], "text-font": font, "text-size": placeSize(15, 12.5, 11), "text-max-width": 7, "text-allow-overlap": true, // les symboles aéro (placés en premier) ne doivent pas effacer les noms de villes
        "symbol-sort-key": ["match", ["get", "class"], "city", 1, "town", 2, 3],
      },
      paint: { "text-color": "#3a3a3a", ...halo },
    });
  }
  useEffect(syncAeroBase, [props.baseMap]);

  useEffect(syncCharts, [props.charts]);

  /** Cartes calées (VAC) : une source image par document, sous la ligne de route. */
  const docLayers = useRef(new Set<string>());
  function syncDocs() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const wanted = new Map(latest.current.docCharts.map((d) => [d.id, d]));
    for (const id of [...docLayers.current]) {
      if (!wanted.has(id)) {
        if (m.getLayer(`doc-${id}`)) m.removeLayer(`doc-${id}`);
        if (m.getSource(`doc-${id}`)) m.removeSource(`doc-${id}`);
        docLayers.current.delete(id);
      }
    }
    // Les cartes calées (VAC) se posent juste au-dessus du fond de carte et sous tout le reste (espaces, terrains, balises, route…).
    const anchor = m.getLayer("route-line") ? "route-line" : undefined;
    for (const d of wanted.values()) {
      if (docLayers.current.has(d.id)) continue;
      m.addSource(`doc-${d.id}`, { type: "image", url: d.url, coordinates: d.corners });
      m.addLayer({ id: `doc-${d.id}`, type: "raster", source: `doc-${d.id}`, paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } }, anchor);
      docLayers.current.add(d.id);
      docScale.current.set(d.id, 2);
    }
    syncHires();
  }
  /** Remonte les cartes calées juste sous la route : les couches aéro ajoutées après elles ne doivent pas les recouvrir. */
  /** Symboles (terrains, balises, activités, cotes, secteurs) : devant les bandes colorées des espaces, qui les masquaient. */
  function raiseSymbols() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const top = m.getLayer("route-line") ? "route-line" : undefined;
    for (const id of ["spot-dot", "spot-lbl", "nav-sym", "nav-obs-mid", "nav-nuc", "nav-box", "nav-name", "act-model", "act-sym", "asp-siv", "asp-sym", "apt-minor", "apt-circle", "asp-ctl"]) if (m.getLayer(id)) m.moveLayer(id, top);
  }
  function raiseDocs() {
    raiseSymbols();
    const m = map.current;
    if (!m || !loaded.current) return;
    for (const id of docLayers.current) if (m.getLayer(`doc-${id}`)) m.moveLayer(`doc-${id}`, m.getLayer("route-line") ? "route-line" : undefined);
  }
  /** Échelle (pixels par point PDF) actuellement affichée pour chaque carte ; 2 = image d'origine. */
  const docScale = useRef(new Map<string, number>());
  const hiresBusy = useRef(new Set<string>());
  /** Quand on zoome, redessine les cartes calées depuis leur PDF pour qu'elles restent nettes (échelles 2, 3, 4, 6, 8). */
  function syncHires() {
    const m = map.current;
    const render = latest.current.renderDocHires;
    if (!m || !loaded.current || !render) return;
    for (const d of latest.current.docCharts) {
      if (!d.framePtW || !docLayers.current.has(d.id) || hiresBusy.current.has(d.id)) continue;
      const tl = m.project([d.corners[0][0], d.corners[0][1]]);
      const tr = m.project([d.corners[1][0], d.corners[1][1]]);
      const screenPx = Math.hypot(tr.x - tl.x, tr.y - tl.y) * (window.devicePixelRatio || 1);
      const needed = screenPx / d.framePtW; // pixels d'écran par point PDF
      const tier = [2, 3, 4, 6, 8].find((t) => t >= needed) ?? 8;
      const cur = docScale.current.get(d.id) ?? 2;
      if (tier <= cur) continue;
      hiresBusy.current.add(d.id);
      void render(d.id, tier)
        .then((url) => {
          const src = m.getSource(`doc-${d.id}`) as maplibregl.ImageSource | undefined;
          if (url && src && docLayers.current.has(d.id)) {
            src.updateImage({ url, coordinates: d.corners });
            docScale.current.set(d.id, tier);
          }
        })
        .finally(() => hiresBusy.current.delete(d.id));
    }
  }
  useEffect(syncDocs, [props.docCharts]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => { clearTimeout(t); t = setTimeout(syncHires, 350); };
    m.on("moveend", on);
    return () => { clearTimeout(t); m.off("moveend", on); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Repères du trafic : flèche orientée selon la route, écart d'altitude (« +3 » = 300 ft au-dessus), couleur selon le niveau. */
  const trafficMarkers = useRef(new Map<string, maplibregl.Marker>());
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const x of props.traffic) {
      seen.add(x.key);
      let mk = trafficMarkers.current.get(x.key);
      if (!mk) {
        const div = document.createElement("div");
        div.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 2 L19 21 L12 17 L5 21 Z"/></svg><span></span>';
        mk = new maplibregl.Marker({ element: div, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([x.lon, x.lat]).addTo(m);
        trafficMarkers.current.set(x.key, mk);
      }
      const el = mk.getElement();
      el.className = `traffic lvl${x.level}${x.stale ? " stale" : ""}`;
      const rel = x.relAltM === null ? "?" : `${x.relAltM >= 0 ? "+" : "−"}${Math.round(Math.abs(x.relAltM) / 0.3048 / 100)}`;
      (el.querySelector("span") as HTMLElement).textContent = rel;
      (el.querySelector("svg") as SVGElement).style.transform = `rotate(${x.track ?? 0}deg)`;
      (el.querySelector("svg") as SVGElement).style.opacity = x.track === null ? "0.5" : "1";
      mk.setLngLat([x.lon, x.lat]);
    }
    for (const [k, mk] of trafficMarkers.current) {
      if (!seen.has(k)) { mk.remove(); trafficMarkers.current.delete(k); }
    }
  }, [props.traffic]);
  const lastFocus = useRef(0);
  useEffect(() => {
    const f = props.docFocus;
    const m = map.current;
    if (!f || !m || f.nonce === lastFocus.current) return;
    lastFocus.current = f.nonce;
    const b = new maplibregl.LngLatBounds(f.corners[0] as [number, number], f.corners[0] as [number, number]);
    f.corners.forEach((c) => b.extend(c));
    const cam = m.cameraForBounds(b, { padding: 20 });
    if (cam && typeof cam.zoom === "number") {
      targetZoom.current = Math.min(15, cam.zoom);
      m.easeTo({ zoom: targetZoom.current, duration: 800 });
    }
  }, [props.docFocus]);
  useEffect(syncOverlays, [props.overlays, props.ceilingFL]);

  // Thème : on change les couleurs sans recréer le style (sinon les couches importées disparaissent).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded.current) return;
    const tk = tokens();
    m.setPaintProperty("background", "background-color", tk.paper);
    m.setPaintProperty("vector-line", "line-color", tk.signal);
    m.setPaintProperty("route-line", "line-color", tk.ink);
    m.setPaintProperty("direct-line", "line-color", tk.good);
    for (const id of addedOverlays.current.keys()) {
      m.setPaintProperty(`ov-${id}-fill`, "fill-color", tk.ink);
      m.setPaintProperty(`ov-${id}-line`, "line-color", tk.ink);
      m.setPaintProperty(`ov-${id}-pt`, "circle-color", tk.paper);
      m.setPaintProperty(`ov-${id}-pt`, "circle-stroke-color", tk.ink);
    }
    if (planeMarker.current) planeMarker.current.getElement().dataset.theme = props.theme;
  }, [props.theme]);

  // Avion, vecteur vitesse, bulles de temps et suivi.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const { fix, vector, trackTrue, follow, orientation } = props;

    if (!fix) {
      planeMarker.current?.remove();
      planeMarker.current = null;
      bubbleMarkers.current.forEach((b) => b.remove());
      bubbleMarkers.current = [];
      return;
    }

    const lngLat: [number, number] = [fix.position.lon, fix.position.lat];
    if (!planeMarker.current) {
      const div = document.createElement("div");
      div.className = "plane";
      div.innerHTML = '<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path d="M20 3 L31 35 L20 28 L9 35 Z"/></svg>';
      planeMarker.current = new maplibregl.Marker({ element: div, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(lngLat).addTo(m);
    }
    planeMarker.current.setLngLat(lngLat);
    if (trackTrue !== null) planeMarker.current.setRotation(trackTrue);

    bubbleMarkers.current.forEach((b) => b.remove());
    bubbleMarkers.current = vector.map((p) => {
      const d = document.createElement("div");
      d.className = "bubble";
      d.textContent = String(p.minutes);
      return new maplibregl.Marker({ element: d }).setLngLat([p.position.lon, p.position.lat]).addTo(m);
    });

    if (loaded.current) {
      const coords = [lngLat, ...vector.map((p) => [p.position.lon, p.position.lat] as [number, number])];
      (m.getSource("vector") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: vector.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
      });
    }

    if (follow) {
      m.easeTo({
        center: lngLat,
        zoom: targetZoom.current,
        bearing: orientation === "track" && trackTrue !== null ? trackTrue : 0,
        duration: 900,
        easing: (t) => t,
      });
    }
  }, [props.fix, props.vector, props.trackTrue, props.follow, props.orientation]);

  useEffect(() => {
    const m = map.current;
    if (!m || props.zoomCommand.nonce === 0) return;
    targetZoom.current = Math.max(0, Math.min(18, targetZoom.current + props.zoomCommand.delta));
    m.easeTo({ zoom: targetZoom.current, duration: 250 });
  }, [props.zoomCommand]);

  return (
    <div className="map" ref={el}>
      {props.overlays.length === 0 && props.charts.length === 0 && !props.airspaceData && <div className="map-empty">{props.emptyLabel}</div>}
    </div>
  );
}
