/**
 * Obstacles officiels de l'AIP France (ENR 5.4.1, SIA / DGAC) : hauteur au-dessus du sol et altitude du sommet en pieds, balisage de nuit, éoliennes.
 * C'est la base dont la carte OACI tire ses obstacles. Elle remplace les obstacles d'OpenStreetMap quand elle est installée.
 */
export interface OnaDataset {
  readonly id: "obstacles";
  readonly meta: { readonly source: string; readonly cycle: string; readonly importedAtMs: number };
  /** [latitude, longitude, hauteur sol (ft), altitude sommet (ft), éolienne 0/1, balisé de nuit 0/1] */
  readonly items: [number, number, number, number, number, number][];
}

export function parseOna(raw: unknown, now: number): OnaDataset {
  const o = raw as { format?: unknown; items?: unknown; cycle?: unknown; source?: unknown } | null;
  if (!o || o.format !== "lim-nav-obstacles" || !Array.isArray(o.items)) throw new Error("fichier d'obstacles invalide");
  const items: OnaDataset["items"] = [];
  for (const p of o.items) {
    if (Array.isArray(p) && p.length === 6 && p.every((v) => typeof v === "number" && Number.isFinite(v)) && Math.abs(p[0] as number) <= 90 && Math.abs(p[1] as number) <= 180) items.push(p as OnaDataset["items"][number]);
  }
  return { id: "obstacles", meta: { source: typeof o.source === "string" ? o.source : "", cycle: typeof o.cycle === "string" ? o.cycle : "", importedAtMs: now }, items };
}
