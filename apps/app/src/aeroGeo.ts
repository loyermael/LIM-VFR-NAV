/** Conversion des espaces et terrains en GeoJSON pour la carte, et textes de détail. Fonctions pures (testées). */
import type { FeatureCollection } from "geojson";
import {
  flightLevelToMeters, type Airfield, type Airspace, type DatasetFreshness, formatQuantity, type UnitPrefs,
} from "@lim/core";

/** Plancher en mètres AMSL pour le filtre de plafond. -1 = limite relative au sol (toujours affichée, relief inconnu). */
export function floorMeters(a: Pick<Airspace, "lower">): number {
  if (a.lower.reference === "FL") return flightLevelToMeters(a.lower.value);
  if (a.lower.reference === "AMSL") return a.lower.value;
  return -1;
}

export function airspacesToGeoJSON(airspaces: readonly Airspace[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: airspaces.map((a) => ({
      type: "Feature" as const,
      properties: { id: a.id, name: a.name, group: a.group, floorM: floorMeters(a) },
      geometry: { type: "Polygon" as const, coordinates: a.rings.map((r) => r.map((c) => [c[0], c[1]])) },
    })),
  };
}

export function airfieldsToGeoJSON(airfields: readonly Airfield[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: airfields.map((a) => ({
      type: "Feature" as const,
      properties: { id: a.id, name: a.name, icao: a.icao ?? "" },
      geometry: { type: "Point" as const, coordinates: [a.position.lon, a.position.lat] },
    })),
  };
}

const freqText = (f: readonly { name: string; mhz: string; primary: boolean }[]) =>
  f.map((x) => `${x.mhz}${x.name ? ` ${x.name}` : ""}${x.primary ? " ★" : ""}`).join(" · ");

export type PeriodStatus = "upcoming" | "current" | "ended";

/** Où en est-on par rapport à la période d'activation d'un espace temporaire ? null si l'espace n'a pas de période. */
export function periodStatus(a: Pick<Airspace, "activeFrom" | "activeUntil">, nowMs: number): PeriodStatus | null {
  const from = a.activeFrom ? Date.parse(a.activeFrom) : NaN;
  const until = a.activeUntil ? Date.parse(a.activeUntil) : NaN;
  if (Number.isNaN(from) && Number.isNaN(until)) return null;
  if (!Number.isNaN(from) && nowMs < from) return "upcoming";
  if (!Number.isNaN(until) && nowMs > until) return "ended";
  return "current";
}

const STATUS_TEXT: Record<PeriodStatus, string> = { upcoming: "à venir", current: "en cours", ended: "terminée" };

/** Date et heure UTC lisibles : « 02/12/2026 08:00 UTC ». Texte inchangé si la date est illisible. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}

/** Détail d'un espace pour la fiche (clés et valeurs lisibles). */
export function airspaceDetails(a: Airspace, exportedAtMs: number | null, nowMs: number = Date.now()): Record<string, string> {
  const d: Record<string, string> = {
    Nom: a.name,
    Type: a.typeLabel + (a.icaoClass ? ` · classe ${a.icaoClass}` : ""),
    Plancher: a.lower.label,
    Plafond: a.upper.label,
  };
  if (a.frequencies.length > 0) d["Fréquences"] = freqText(a.frequencies);
  if (a.onRequest || a.byNotam) d["Activation"] = `${a.byNotam ? "par NOTAM" : "sur demande"} : à vérifier (SIA / NOTAM), état du jour inconnu`;
  const status = periodStatus(a, nowMs);
  if (status !== null) {
    d["Période"] = `${a.activeFrom ? formatUtc(a.activeFrom) : "?"} → ${a.activeUntil ? formatUtc(a.activeUntil) : "?"} (${STATUS_TEXT[status]})`;
  }
  if (a.remarks) d["Remarques"] = a.remarks;
  d["Source"] = `openAIP${exportedAtMs !== null ? `, export du ${new Date(exportedAtMs).toLocaleDateString("fr-FR")}` : ""} (non officiel)`;
  return d;
}

export function airfieldDetails(a: Airfield, prefs: UnitPrefs, exportedAtMs: number | null): Record<string, string> {
  const d: Record<string, string> = { Nom: a.name };
  if (a.icao) d["Code OACI"] = a.icao;
  if (a.elevation !== null) d["Altitude"] = `${formatQuantity("altitude", prefs, a.elevation)} ${prefs.altitude === "ft" ? "ft" : "m"}`;
  if (a.private) d["Accès"] = "privé";
  if (a.runways.length > 0) {
    d["Pistes"] = a.runways
      .map((r) => `${r.designator}${r.trueHeading !== null ? ` (${Math.round(r.trueHeading)}°V)` : ""}${r.lengthM !== null ? ` ${Math.round(r.lengthM)} m` : ""}`)
      .join(" · ");
  }
  if (a.frequencies.length > 0) d["Fréquences"] = freqText(a.frequencies);
  d["Source"] = `openAIP${exportedAtMs !== null ? `, export du ${new Date(exportedAtMs).toLocaleDateString("fr-FR")}` : ""} (non officiel)`;
  return d;
}

/** Phrases d'avertissement sur la fraîcheur des données (vides si tout va bien). */
export function freshnessWarnings(f: DatasetFreshness): string[] {
  const w: string[] = ["openAIP n'est pas un jeu AIRAC officiel : vérifier sur les documents du SIA."];
  if (f.stale) w.push(`Données de ${f.ageDays} jours (plus de 28) : à mettre à jour.`);
  else if (f.beforeCurrentCycle) w.push("Données antérieures au cycle AIRAC en cours.");
  return w;
}
