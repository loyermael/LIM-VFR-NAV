import type { Feature, FeatureCollection, Geometry } from "geojson";
import { kml } from "@tmcw/togeojson";
import shp from "shpjs";
import { tx } from "./db";

/** Une couche importée par l'utilisateur (GeoJSON, KML, Shapefile zippé). */
export interface Overlay {
  readonly id: string;
  readonly name: string;
  readonly format: "geojson" | "kml" | "shp";
  readonly importedAt: string;
  readonly data: FeatureCollection;
}

const GEOMETRY_TYPES = new Set([
  "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection",
]);

/**
 * Ramène n'importe quel GeoJSON valide (FeatureCollection, Feature ou géométrie nue) à une FeatureCollection.
 * Rejette ce qui n'est pas du GeoJSON : mieux vaut une erreur claire qu'une couche vide silencieuse.
 */
export function normalizeGeoJSON(input: unknown): FeatureCollection {
  if (typeof input !== "object" || input === null) throw new Error("Contenu GeoJSON invalide");
  const o = input as { type?: unknown; features?: unknown; geometry?: unknown };
  if (o.type === "FeatureCollection" && Array.isArray(o.features)) {
    const features = (o.features as unknown[]).filter(isFeature);
    if (features.length === 0 && o.features.length > 0) throw new Error("Aucune entité GeoJSON valide");
    return { type: "FeatureCollection", features };
  }
  if (isFeature(input)) return { type: "FeatureCollection", features: [input] };
  if (typeof o.type === "string" && GEOMETRY_TYPES.has(o.type)) {
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: input as Geometry }] };
  }
  throw new Error("Ce fichier n'est pas du GeoJSON");
}

function isFeature(x: unknown): x is Feature {
  if (typeof x !== "object" || x === null) return false;
  const f = x as { type?: unknown; geometry?: unknown };
  if (f.type !== "Feature") return false;
  if (f.geometry === null) return false;
  const g = f.geometry as { type?: unknown };
  return typeof g === "object" && g !== null && typeof g.type === "string" && GEOMETRY_TYPES.has(g.type);
}

/** Lit un fichier choisi par l'utilisateur et le convertit en couche. Formats : .geojson/.json, .kml, .zip (Shapefile). */
export async function readOverlayFile(file: File): Promise<Overlay> {
  const lower = file.name.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, "");
  let data: FeatureCollection;
  let format: Overlay["format"];
  if (lower.endsWith(".kml")) {
    const doc = new DOMParser().parseFromString(await file.text(), "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("KML illisible");
    data = normalizeGeoJSON(kml(doc));
    format = "kml";
  } else if (lower.endsWith(".zip")) {
    const result = await shp(await file.arrayBuffer());
    const collections = Array.isArray(result) ? result : [result];
    data = {
      type: "FeatureCollection",
      features: collections.flatMap((c) => normalizeGeoJSON(c).features),
    };
    format = "shp";
  } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    data = normalizeGeoJSON(JSON.parse(await file.text()));
    format = "geojson";
  } else {
    throw new Error("Format non pris en charge (GeoJSON, KML ou Shapefile .zip)");
  }
  return {
    id: crypto.randomUUID(),
    name: base,
    format,
    importedAt: new Date().toISOString(),
    data,
  };
}

/* Stockage hors-ligne (IndexedDB) : les couches doivent être disponibles en vol sans réseau. */

export const loadOverlays = (): Promise<Overlay[]> => tx("overlays", "readonly", (s) => s.getAll() as IDBRequest<Overlay[]>);
export const saveOverlay = (o: Overlay): Promise<IDBValidKey> => tx("overlays", "readwrite", (s) => s.put(o));
export const deleteOverlay = (id: string): Promise<undefined> => tx("overlays", "readwrite", (s) => s.delete(id));
