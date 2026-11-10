import { describe, expect, it } from "vitest";
import { BackupError, buildBackup, parseBackup } from "./backup";

const ok = () => JSON.stringify(buildBackup({ routes: [{ id: "r1" }], aircraft: [{ id: "a1" }], tracks: [] }, { "lim.perf.v1": "{}" }, 5));

describe("sauvegarde", () => {
  it("aller-retour : ce qui est écrit est relu à l'identique", () => {
    const b = parseBackup(ok());
    expect(b.stores.routes).toEqual([{ id: "r1" }]);
    expect(b.stores.aircraft).toEqual([{ id: "a1" }]);
    expect(b.stores.tracks).toEqual([]);
    expect(b.local).toEqual({ "lim.perf.v1": "{}" });
    expect(b.createdAt).toBe(5);
  });
  it("sections absentes : vides ; réglages hors « lim.* » ou non textuels écartés", () => {
    const b = parseBackup(JSON.stringify({ format: "lim-vfr-nav-backup", version: 1, local: { "lim.x": "1", autre: "2", "lim.y": 3 } }));
    expect(b.stores.routes).toEqual([]);
    expect(b.local).toEqual({ "lim.x": "1" });
  });
  it.each([
    ["pas du json", "illisible"],
    [JSON.stringify({ format: "autre", version: 1 }), "pas une sauvegarde"],
    [JSON.stringify(null), "pas une sauvegarde"],
    [JSON.stringify({ format: "lim-vfr-nav-backup", version: 2 }), "version"],
    [JSON.stringify({ format: "lim-vfr-nav-backup", version: 1, stores: { routes: "x" } }), "invalide"],
    [JSON.stringify({ format: "lim-vfr-nav-backup", version: 1, stores: { routes: [{ nom: "sans id" }] } }), "identifiant"],
  ])("refuse %s", (text, msg) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(msg);
  });
});
