/**
 * Simulateur X-Plane : sortie « GPS » en UDP (port 49002 usuel), datagramme texte
 * « XGPSnom,longitude,latitude,altitude_MSL_m,route_vraie,vitesse_sol_m/s » (format publié par Laminar Research pour les applis de vol).
 * MSFS (SimConnect) et FlightGear (protocole à configurer) : non pris en charge ici.
 */
export interface XPlaneGps {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly altitudeMslM: number;
  readonly trackTrue: number;
  readonly groundSpeedMps: number;
}

export function parseXGps(text: string): XPlaneGps | null {
  const t = text.replace(/\0/g, "").trim();
  if (!t.startsWith("XGPS")) return null;
  const f = t.slice(4).split(",");
  if (f.length < 6) return null;
  const v = f.slice(1, 6).map(Number);
  if (v.some((x) => !Number.isFinite(x))) return null;
  const [lon, lat, alt, trk, gs] = v as [number, number, number, number, number];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: (f[0] ?? "").trim(), lat, lon, altitudeMslM: alt, trackTrue: ((trk % 360) + 360) % 360, groundSpeedMps: gs };
}
