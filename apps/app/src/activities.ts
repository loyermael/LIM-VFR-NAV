/**
 * Activités aériennes sportives et récréatives de l'AIP France (ENR 5.5, SIA) : parachutage, voltige, aéromodélisme, treuillage.
 * La carte OACI les dessine avec leur numéro de référence ; la couleur de l'aéromodélisme dépend de la hauteur.
 */
import type { FeatureCollection } from "geojson";

export type ActivityKind = "para" | "acro" | "glider" | "aeromodel" | "balloon" | "cable" | "freeflight" | "other";
export interface Activity { readonly ref: string; readonly kind: ActivityKind; readonly name: string; readonly lat: number; readonly lon: number; readonly upper: string | null; readonly lower: string | null; readonly hours: string | null }
export interface ActivityDataset {
  readonly id: "activities";
  readonly meta: { readonly source: string; readonly cycle: string; readonly importedAtMs: number };
  readonly items: Activity[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const KINDS: readonly string[] = ["para", "acro", "glider", "aeromodel", "balloon", "cable", "freeflight", "other"];

/** Lit le fichier du paquet ; une entrée mal formée est écartée. */
export function parseActivities(raw: unknown, now: number): ActivityDataset {
  const o = raw as { format?: unknown; items?: unknown; cycle?: unknown; source?: unknown } | null;
  if (!o || o.format !== "lim-nav-activities" || !Array.isArray(o.items)) throw new Error("fichier d'activités invalide");
  const items: Activity[] = [];
  for (const a of o.items as Record<string, unknown>[]) {
    if (typeof a?.["ref"] !== "string" || !isNum(a["lat"]) || !isNum(a["lon"]) || !KINDS.includes(String(a["kind"]))) continue;
    items.push({
      ref: a["ref"], kind: a["kind"] as ActivityKind, name: typeof a["name"] === "string" ? a["name"] : "", lat: a["lat"], lon: a["lon"],
      upper: typeof a["upper"] === "string" ? a["upper"] : null, lower: typeof a["lower"] === "string" ? a["lower"] : null, hours: typeof a["hours"] === "string" ? a["hours"] : null,
    });
  }
  return { id: "activities", meta: { source: typeof o.source === "string" ? o.source : "SIA", cycle: typeof o.cycle === "string" ? o.cycle : "", importedAtMs: now }, items };
}

/** Hauteur en pieds d'une limite écrite « 1700ft AMSL », « 490ft ASFC », « FL 055 » (FL → ×100) ; null si illisible. */
export function limitFeet(s: string | null): number | null {
  if (!s) return null;
  const fl = /FL\s*(\d{2,3})/i.exec(s);
  if (fl) return Number(fl[1]) * 100;
  const ft = /(\d{2,5})\s*ft/i.exec(s);
  return ft ? Number(ft[1]) : null;
}

/**
 * Symbole de la légende OACI : parachute, voltige, planeur (treuillage), ballon ; aéromodélisme coloré selon la hauteur (> 500 ft orange, > 1000 ft violet, > 2000 ft rouge).
 * La hauteur est celle du plafond écrit dans l'AIP, sans distinguer AMSL de ASFC (l'altitude du terrain est inconnue) : la couleur est donc indicative.
 */
export function activitySymbol(a: Pick<Activity, "kind" | "upper">): string | null {
  switch (a.kind) {
    case "para": return "para";
    case "acro": return "acro";
    case "glider": return "glider";
    case "balloon": return "balloon";
    case "aeromodel": {
      const h = limitFeet(a.upper);
      return h !== null && h > 2000 ? "aeromodel" : h !== null && h > 1000 ? "aeromodel-purple" : "aeromodel-orange";
    }
    default: return null;
  }
}

/**
 * Décalage géographique éventuel (mètres vers l'est, vers le nord) des symboles d'activité, par type. Aucun pour l'instant : les positions de l'AIP sont déjà
 * sur le terrain (à 100-200 m en médiane) et les symboles doivent y rester ; un décalage éventuel serait fixé en mètres, jamais en pixels (il glisserait au zoom).
 */
export const ACTIVITY_SHIFT_M: Readonly<Partial<Record<ActivityKind, readonly [number, number]>>> = {};
export function shiftedPosition(lat: number, lon: number, kind: ActivityKind): [number, number] {
  const s = ACTIVITY_SHIFT_M[kind];
  if (!s) return [lon, lat];
  return [lon + s[0] / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))), lat + s[1] / 111320];
}

export function activitiesToGeoJSON(d: ActivityDataset): FeatureCollection {
  const features: FeatureCollection["features"] = [];
  for (const a of d.items) {
    const sym = activitySymbol(a);
    if (!sym) continue;
    features.push({
      type: "Feature", geometry: { type: "Point", coordinates: shiftedPosition(a.lat, a.lon, a.kind) },
      properties: { sym, kind: a.kind, ref: a.ref, onAd: /\((LF|LS)[A-Z0-9]{2}\)/.test(a.name), lbl: a.kind === "glider" ? `${a.ref}
CABLE` : a.ref, cat: `Activité ${a.kind === "para" ? "de parachutage" : a.kind === "acro" ? "de voltige" : a.kind === "glider" ? "de treuillage (planeur)" : a.kind === "aeromodel" ? "d'aéromodélisme" : "aérienne"}`, name: a.name, upper: a.upper ?? "", lower: a.lower ?? "", hours: a.hours ?? "" },
    });
  }
  return { type: "FeatureCollection", features };
}
