import { describe, expect, it } from "vitest";
import { retryDelayMs, uniqueWindPoints, windHttpMessage } from "./windClient";

describe("client des vents : limites du service gratuit", () => {
  it("points proches (même maille de 0,1°) regroupés en une seule requête", () => {
    const pts = [{ lat: 47.01, lon: 2.01 }, { lat: 47.03, lon: 2.04 }, { lat: 47.31, lon: 2.6 }];
    expect(uniqueWindPoints(pts as never)).toHaveLength(2);
  });
  it("nouvelle tentative après 429 ou erreur serveur, avec attente croissante, Retry-After respecté et plafonné", () => {
    expect(retryDelayMs(429, null, 0)).toBe(1500);
    expect(retryDelayMs(429, null, 1)).toBe(3000);
    expect(retryDelayMs(503, null, 0)).toBe(1500);
    expect(retryDelayMs(429, "4", 0)).toBe(4000);
    expect(retryDelayMs(429, "120", 0)).toBe(8000);
    expect(retryDelayMs(429, null, 2)).toBeNull();
    expect(retryDelayMs(404, null, 0)).toBeNull();
  });
  it("message clair pour un 429", () => {
    expect(windHttpMessage(429)).toContain("saturé");
    expect(windHttpMessage(500)).toContain("HTTP 500");
  });
});
