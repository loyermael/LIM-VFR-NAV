import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection } from "geojson";
import { isAirspaceVisible, type AirspaceLimit, type GpsFix, type LimitReference, type SpeedVectorPoint, type TrueDeg } from "@lim/core";
import type { Overlay } from "./overlays";
import "maplibre-gl/dist/maplibre-gl.css";

export type Theme = "day" | "night";
export type Orientation = "north" | "track";

/** Entité touchée par un double-tap, avec la couche d'où elle vient. */
export interface TappedFeature {
  readonly layerName: string;
  readonly properties: Record<string, unknown>;
}

export interface MapViewProps {
  theme: Theme;
  emptyLabel: string;
  fix: GpsFix | null;
  trackTrue: TrueDeg | null;
  vector: readonly SpeedVectorPoint[];
  follow: boolean;
  orientation: Orientation;
  onUserMove: () => void;
  overlays: readonly Overlay[];
  ceilingFL: number;
  onDoubleTap: (features: TappedFeature[]) => void;
  /** Commande externe de zoom : incrémentée à chaque appui sur + ou −. */
  zoomCommand: { delta: number; nonce: number };
}

/** Couleurs lues dans les jetons CSS (aucune couleur en dur) : à relire à chaque changement de thème. */
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return { paper: v("--paper"), ink: v("--ink"), signal: v("--signal"), hair: v("--hair"), brand: v("--brand") };
}

// Style vide : aucune donnée aéronautique en dur, aucun appel réseau. Les fonds de carte (MBTiles, J1 suite) et
// les données SIA / openAIP (J3) s'ajoutent par-dessus.
const baseStyle = (paper: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": paper } }],
});

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

    m.on("load", () => {
      loaded.current = true;
      m.addSource("vector", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "vector-line", type: "line", source: "vector", paint: { "line-color": tk.signal, "line-width": 3 } });
      syncOverlays();
    });

    m.on("zoomend", (e) => {
      // Zoom fait au doigt (pincement) : on le retient comme nouveau niveau voulu.
      if ((e as { originalEvent?: unknown }).originalEvent) targetZoom.current = m.getZoom();
    });

    m.on("movestart", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) latest.current.onUserMove();
    });

    // Double-tap = deux appuis rapprochés dans le temps et l'espace (souris et tactile).
    m.on("click", (e) => {
      const now = Date.now();
      const prev = lastTap.current;
      const { x, y } = e.point;
      if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_TAP_PX) {
        lastTap.current = null;
        const layers = [...addedOverlays.current.keys()].flatMap((id) => [`ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-pt`]).filter((l) => m.getLayer(l));
        const box: [maplibregl.PointLike, maplibregl.PointLike] = [[x - 12, y - 12], [x + 12, y + 12]];
        const hits = layers.length ? m.queryRenderedFeatures(box, { layers }) : [];
        const seen = new Set<string>();
        const out: TappedFeature[] = [];
        for (const h of hits) {
          const key = `${h.source}:${JSON.stringify(h.properties)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            layerName: addedOverlays.current.get(String(h.source).replace(/^ov-/, "")) ?? "",
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

  useEffect(syncOverlays, [props.overlays, props.ceilingFL]);

  // Thème : on change les couleurs sans recréer le style (sinon les couches importées disparaissent).
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded.current) return;
    const tk = tokens();
    m.setPaintProperty("background", "background-color", tk.paper);
    m.setPaintProperty("vector-line", "line-color", tk.signal);
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
      {props.overlays.length === 0 && <div className="map-empty">{props.emptyLabel}</div>}
    </div>
  );
}
