import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MbtilesReader } from "./mbtiles";
import { SqliteReader } from "./sqlite";

const dir = new URL("./fixtures/", import.meta.url);
const file = readFileSync(new URL("test.mbtiles", dir));
const expected = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8")) as {
  count: number;
  tiles: Record<string, string>;
};
const blob = new Blob([file]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("lecteur SQLite", () => {
  it("rejette un fichier qui n'est pas SQLite", async () => {
    await expect(SqliteReader.open(new Blob(["pas une base de données"]))).rejects.toThrow(/SQLite/);
  });
  it("lit le schéma", async () => {
    const db = await SqliteReader.open(blob);
    const names = (await db.schema()).map((s) => s.name);
    expect(names).toContain("tiles");
    expect(names).toContain("metadata");
  });
});

describe("MBTiles", () => {
  it("indexe toutes les tuiles et lit les métadonnées", async () => {
    const r = await MbtilesReader.open(blob);
    expect(r.info.tileCount).toBe(expected.count);
    expect(r.info.format).toBe("png");
    expect(r.info.minZoom).toBe(3);
    expect(r.info.maxZoom).toBe(9);
    expect(r.info.name).toBe("Carte de test");
    expect(r.info.bounds).toEqual([-5.5, 41, 10, 51.5]);
  });

  it("retrouve chaque tuile à l'octet près, y compris celles qui débordent sur plusieurs pages (conversion TMS → XYZ)", async () => {
    const r = await MbtilesReader.open(blob);
    const keys = Object.keys(expected.tiles);
    for (const k of keys) {
      const [z, x, y] = k.split("/").map(Number) as [number, number, number];
      const data = await r.getTile(z, x, y);
      expect(data, k).not.toBeNull();
      expect(sha(data!), k).toBe(expected.tiles[k]);
    }
  }, 60_000);

  it("une tuile absente donne null, pas une erreur", async () => {
    const r = await MbtilesReader.open(blob);
    expect(await r.getTile(1, 0, 0)).toBeNull();
    expect(r.has(5, 99, 99)).toBe(false);
  });

  it("l'index sérialisé redonne exactement les mêmes tuiles sans relire la table", async () => {
    const first = await MbtilesReader.open(blob);
    const again = await MbtilesReader.open(blob, { index: first.serializeIndex() });
    expect(again.info.tileCount).toBe(first.info.tileCount);
    const data = await again.getTile(5, 3, 3);
    expect(sha(data!)).toBe(expected.tiles["5/3/3"]);
  });

  it("un fichier tronqué est refusé avec un message clair", async () => {
    const cut = new Blob([file.subarray(0, 8192)]);
    await expect(MbtilesReader.open(cut)).rejects.toThrow();
  });
});
