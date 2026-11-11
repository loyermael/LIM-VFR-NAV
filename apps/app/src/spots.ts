/**
 * Points cotés indicatifs : sommets du relief (maxima locaux du modèle numérique Terrarium), altitude en pieds. La carte OACI en porte des centaines
 * tirés de la base de l'IGN ; ceux-ci sont calculés par maxima locaux, donc approximatifs (quelques dizaines de mètres).
 */
import type { FeatureCollection } from "geojson";

export interface SpotDataset {
  readonly id: "spots";
  readonly meta: { readonly source: string; readonly importedAtMs: number };
  /** [longitude, latitude, altitude en pieds] */
  readonly items: [number, number, number][];
}

export function parseSpots(raw: unknown, now: number): SpotDataset {
  const o = raw as { format?: unknown; items?: unknown; source?: unknown } | null;
  if (!o || o.format !== "lim-nav-spots" || !Array.isArray(o.items)) throw new Error("fichier de points cotés invalide");
  const items: [number, number, number][] = [];
  for (const p of o.items) {
    if (Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === "number" && Number.isFinite(v)) && Math.abs(p[1] as number) <= 90 && Math.abs(p[0] as number) <= 180) items.push([p[0] as number, p[1] as number, p[2] as number]);
  }
  return { id: "spots", meta: { source: typeof o.source === "string" ? o.source : "", importedAtMs: now }, items };
}

/** `major` : sommets de plus de 3 000 ft, écrits en gras comme les points cotés critiques de la légende. */
export function spotsToGeoJSON(d: SpotDataset): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: d.items.map(([lon, lat, ft]) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lon, lat] }, properties: { lbl: String(ft), ft, major: ft >= 3000 } })),
  };
}
