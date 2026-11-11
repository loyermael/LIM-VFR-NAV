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

import { BASE_MAPS, IGN_ATTRIBUTION, getTile, type BaseMapId } from "./baseMaps";

export interface MapViewProps {
  /** Fond de carte IGN affiché (plan, photos) ou aucun ; relief ombré LiDAR par-dessus. */
  baseMap: "none" | "plan" | "ortho";
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
  docCharts: readonly { id: string; url: string; corners: [[number, number], [number, number], [number, number], [number, number]] }[];
  /** Trafic reçu (GDL90, FLARM) : un repère par cible, avec l'écart d'altitude en centaines de pieds. */
  traffic: readonly { key: string; lat: number; lon: number; track: number | null; label: string; level: number; stale: boolean; relAltM: number | null }[];
  /** Demande de cadrage sur une carte calée (approche) ; appliquée seulement si le suivi de l'avion est actif. */
  docFocus: { nonce: number; corners: [number, number][] } | null;
  /** Commande externe de zoom : incrémentée à chaque appui sur + ou −. */
  zoomCommand: { delta: number; nonce: number };
}

/** Couleurs lues dans les jetons CSS (aucune couleur en dur) : à relire à chaque changement de thème. */
const NAV_LAYERS = ["nav-sym", "nav-obs-mid", "nav-obs-low"];

/** Symboles de la carte aéro, dessinés en canvas (à 2x) : balises (VOR hexagone, NDB cercle pointillé), points de report (triangle plein si obligatoire), obstacles (mât, éolienne). */
let iconCache: Map<string, ImageData> | null = null;
function navIcons(): Map<string, ImageData> {
  if (iconCache) return iconCache;
  const out = new Map<string, ImageData>();
  const S = 40, C = S / 2;
  const make = (name: string, draw: (c: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    const c = cv.getContext("2d");
    if (!c) return;
    c.lineJoin = "round"; c.lineCap = "round";
    draw(c);
    out.set(name, c.getImageData(0, 0, S, S));
  };
  /** Trait avec un filet blanc dessous : lisible sur le plan comme sur les photos. */
  const stroke = (c: CanvasRenderingContext2D, color: string, w: number, fill?: string) => {
    if (fill) { c.fillStyle = fill; c.fill(); }
    c.strokeStyle = "#fff"; c.lineWidth = w + 3; c.stroke();
    c.strokeStyle = color; c.lineWidth = w; c.stroke();
  };
  const BLUE = "#1b4f9c", INK = "#111";
  const hex = (c: CanvasRenderingContext2D, r: number) => { c.beginPath(); for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; c.lineTo(C + r * Math.cos(a), C + r * Math.sin(a)); } c.closePath(); };
  const dot = (c: CanvasRenderingContext2D, r: number, color: string) => { c.beginPath(); c.arc(C, C, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };
  make("vor", (c) => { hex(c, 12); stroke(c, BLUE, 2.5); dot(c, 2.5, BLUE); });
  make("vordme", (c) => { c.beginPath(); c.rect(C - 14, C - 14, 28, 28); stroke(c, BLUE, 2.5); hex(c, 10); stroke(c, BLUE, 2.5); dot(c, 2.5, BLUE); });
  make("dme", (c) => { c.beginPath(); c.rect(C - 11, C - 11, 22, 22); stroke(c, BLUE, 2.5); dot(c, 2.5, BLUE); });
  make("ndb", (c) => { c.setLineDash([3, 4]); c.beginPath(); c.arc(C, C, 13, 0, Math.PI * 2); stroke(c, BLUE, 2.5); c.setLineDash([]); c.beginPath(); c.arc(C, C, 7, 0, Math.PI * 2); stroke(c, BLUE, 2); dot(c, 2.5, BLUE); });
  const tri = (c: CanvasRenderingContext2D) => { c.beginPath(); c.moveTo(C, C - 12); c.lineTo(C + 11, C + 9); c.lineTo(C - 11, C + 9); c.closePath(); };
  make("rp-c", (c) => { tri(c); stroke(c, BLUE, 2.5, BLUE); });
  make("rp", (c) => { tri(c); stroke(c, BLUE, 2.5, "rgba(255,255,255,0.6)"); });
  make("mast", (c) => { c.beginPath(); c.moveTo(C - 8, C + 11); c.lineTo(C, C - 11); c.lineTo(C + 8, C + 11); stroke(c, INK, 2.5); dot(c, 2.5, INK); });
  make("wind", (c) => { c.beginPath(); c.moveTo(C, C + 12); c.lineTo(C, C - 2); stroke(c, INK, 2.5); c.beginPath(); c.arc(C, C - 4, 9, 0, Math.PI * 2); stroke(c, INK, 2, "rgba(255,255,255,0.6)"); dot(c, 2, INK); });
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
  maplibregl.addProtocol("lim", async (params) => {
    const m = /^lim:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const reader = m ? getReader(m[1] as string) : undefined;
    const tile = m && reader ? await reader.getTile(Number(m[2]), Number(m[3]), Number(m[4])) : null;
    const bytes = tile ?? TRANSPARENT_PNG;
    return { data: bytes.slice().buffer as ArrayBuffer };
  });
}

/** Couleur d'un espace selon son groupe : contrôlés en bleu, réglementés en brique, radio en ocre, planeur en vert. */
const groupColor = (tk: ReturnType<typeof tokens>) =>
  ["match", ["get", "group"], "controlled", tk.data, "restricted", tk.bad, "radio", tk.warn, "glider", tk.good, tk.muted] as unknown as string;

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
      loaded.current = true;
      m.addSource("vector", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tk.ink, "line-width": 4 } });
      m.addSource("replay", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "replay-line", type: "line", source: "replay", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": tk.signal, "line-width": 3, "line-dasharray": [2, 1] } });
      m.addSource("direct", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "direct-line", type: "line", source: "direct", paint: { "line-color": tk.good, "line-width": 4 } });
      m.addLayer({ id: "vector-line", type: "line", source: "vector", paint: { "line-color": tk.signal, "line-width": 3 } });
      syncBase();
      syncNav();
      syncCharts();
      syncOverlays();
      syncRoute();
      syncAero();
      syncRadar();
      syncReplay();
      syncDocs();
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
        const hit = m.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]] as [maplibregl.PointLike, maplibregl.PointLike], { layers: ["apt-circle"] })[0];
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
        const layers = [...addedOverlays.current.keys()].flatMap((id) => [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`]).concat(["apt-circle", "asp-fill", ...NAV_LAYERS]).filter((l) => m.getLayer(l));
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [[x - 12, y - 12], [x + 12, y + 12]];
        const hits = layers.length ? m.queryRenderedFeatures(box, { layers }) : [];
        const seen = new Set<string>();
        const out: TappedFeature[] = [];
        for (const h of hits) {
          const key = `${h.source}:${JSON.stringify(h.properties)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // Espaces et terrains : l'application retrouve la fiche complète par l'identifiant.
          const aero = h.layer.id === "asp-fill" ? "asp" : h.layer.id === "apt-circle" ? "apt" : null;
          out.push({
            layerName: NAV_LAYERS.includes(h.layer.id) ? String((h.properties as { cat?: unknown } | null)?.cat ?? "") : aero ?? addedOverlays.current.get(String(h.source).replace(/^ov-/, "")) ?? "",
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
      m.addLayer({ id: "asp-fill", type: "fill", source: "asp", paint: { "fill-color": groupColor(tk), "fill-opacity": 0.06 } }, before);
      m.addLayer({ id: "asp-line", type: "line", source: "asp", paint: { "line-color": groupColor(tk), "line-width": 1.6 } }, before);
    }
    if (ensure("apt", airfieldData) && !m.getLayer("apt-circle")) {
      m.addLayer(
        { id: "apt-circle", type: "circle", source: "apt", minzoom: 6, paint: { "circle-radius": 7, "circle-color": tk.paper, "circle-stroke-color": tk.ink, "circle-stroke-width": 2.5 } },
        before,
      );
    }
    if (m.getLayer("asp-fill")) {
      const ceilingM = flightLevelToMeters(ceilingFL);
      const filter = ["all", ["in", ["get", "group"], ["literal", [...visibleGroups]]], ["<", ["get", "floorM"], ceilingM]] as never;
      for (const id of ["asp-fill", "asp-line"]) {
        m.setFilter(id, filter);
        m.setLayoutProperty(id, "visibility", showAirspaces ? "visible" : "none");
      }
    }
    if (m.getLayer("apt-circle")) m.setLayoutProperty("apt-circle", "visibility", showAirfields ? "visible" : "none");
  }
  /** Balises, points de report, obstacles : symboles dessinés sur la carte (aucune police nécessaire, donc utilisable hors-ligne). */
  function syncNav() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { navData, showNav } = latest.current;
    if (navData) {
      for (const [name, img] of navIcons()) if (!m.hasImage(name)) m.addImage(name, img, { pixelRatio: 2 });
      const src = m.getSource("nav") as maplibregl.GeoJSONSource | undefined;
      if (!src) m.addSource("nav", { type: "geojson", data: navData });
      else if (aeroData.current.get("nav") !== navData) src.setData(navData);
      aeroData.current.set("nav", navData);
      if (!m.getLayer("nav-sym")) {
        // Les filtres ne peuvent pas dépendre du zoom : un calque par niveau de détail des obstacles (les plus hauts de loin, tous de près).
        const layout = { "icon-image": ["get", "sym"], "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 7, 0.9, 12, 1.3] } as never;
        const before = m.getLayer("route-line") ? "route-line" : undefined;
        const obs = ["==", ["get", "grp"], "obstacle"];
        m.addLayer({ id: "nav-sym", type: "symbol", source: "nav", minzoom: 7, layout, filter: ["any", ["!=", ["get", "grp"], "obstacle"], [">=", ["get", "h"], 150]] as never }, before);
        m.addLayer({ id: "nav-obs-mid", type: "symbol", source: "nav", minzoom: 9.5, layout, filter: ["all", obs, [">=", ["get", "h"], 60], ["<", ["get", "h"], 150]] as never }, before);
        m.addLayer({ id: "nav-obs-low", type: "symbol", source: "nav", minzoom: 11.5, layout, filter: ["all", obs, ["<", ["get", "h"], 60]] as never }, before);
      }
    }
    for (const id of NAV_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", showNav ? "visible" : "none");
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
  useEffect(syncAero, [props.airspaceData, props.airfieldData, props.showAirspaces, props.showAirfields, props.visibleGroups, props.ceilingFL]);

  /** Fond IGN et relief : sources raster sous tout le reste. */
  function syncBase() {
    const m = map.current;
    if (!m || !loaded.current) return;
    const { baseMap, relief } = latest.current;
    const want: { id: string; map: BaseMapId; opacity: number }[] = [];
    if (baseMap !== "none") want.push({ id: "base-ign", map: baseMap, opacity: 1 });
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
      const bottom = m.getStyle().layers.find((l) => l.id !== "background" && !(w.id === "relief-ign" && l.id === "base-ign"))?.id;
      // fond tout en bas ; relief juste au-dessus du fond
      const before = w.id === "relief-ign" ? m.getStyle().layers.find((l) => l.id !== "background" && l.id !== "base-ign")?.id : bottom;
      m.addLayer({ id: w.id, type: "raster", source: w.id, paint: { "raster-opacity": w.opacity, "raster-fade-duration": 0 } }, before);
    }
  }
  useEffect(syncBase, [props.baseMap, props.relief]);

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
    for (const d of wanted.values()) {
      if (docLayers.current.has(d.id)) continue;
      m.addSource(`doc-${d.id}`, { type: "image", url: d.url, coordinates: d.corners });
      m.addLayer({ id: `doc-${d.id}`, type: "raster", source: `doc-${d.id}`, paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } }, m.getLayer("replay-line") ? "replay-line" : undefined);
      docLayers.current.add(d.id);
    }
  }
  useEffect(syncDocs, [props.docCharts]);

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
    if (m.getLayer("asp-line")) {
      m.setPaintProperty("asp-line", "line-color", groupColor(tk));
      m.setPaintProperty("asp-fill", "fill-color", groupColor(tk));
    }
    if (m.getLayer("apt-circle")) {
      m.setPaintProperty("apt-circle", "circle-color", tk.paper);
      m.setPaintProperty("apt-circle", "circle-stroke-color", tk.ink);
    }
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
