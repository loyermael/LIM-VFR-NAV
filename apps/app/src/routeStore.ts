import { tx } from "./db";
import type { RouteRecord } from "./routeEdit";

/** Routes mémorisées sur l'appareil (IndexedDB) : disponibles hors-ligne. */
export const loadRoutes = (): Promise<RouteRecord[]> => tx("routes", "readonly", (s) => s.getAll() as IDBRequest<RouteRecord[]>);
export const saveRoute = (r: RouteRecord): Promise<IDBValidKey> => tx("routes", "readwrite", (s) => s.put(r));
export const deleteRoute = (id: string): Promise<undefined> => tx("routes", "readwrite", (s) => s.delete(id));

const ACTIVE_KEY = "lim.activeRoute.v1";
export function loadActiveRouteId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function saveActiveRouteId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* stockage bloqué : valable pour la session */
  }
}
