import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type Theme = "day" | "night";

// J0 : style vide (aucune donnée aéronautique en dur, aucun appel réseau).
// Les vraies couches arrivent avec J1.
const style = (theme: Theme): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": theme === "day" ? "#eef2f5" : "#0b1220" },
    },
  ],
});

export function MapView({ theme, emptyLabel }: { theme: Theme; emptyLabel: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!el.current) return;
    map.current = new maplibregl.Map({
      container: el.current,
      style: style(theme),
      center: [2.35, 46.6], // centre de vue initial sur la France, pas une donnée aéronautique
      zoom: 5,
    });
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // Création unique : le thème est appliqué par l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(style(theme));
  }, [theme]);

  return (
    <div className="map" ref={el}>
      <div className="map-empty">{emptyLabel}</div>
    </div>
  );
}
