"""Génère un petit MBTiles de test (pour les tests du lecteur) : tuiles PNG valides, y compris de grosses
tuiles qui débordent sur plusieurs pages SQLite, assez de lignes pour créer des pages intérieures,
et des tuiles unies 256x256 sur la France (z6, z7) pour VOIR la carte dans le navigateur.
Sortie : apps/app/src/mbtiles/fixtures/test.mbtiles et expected.json (empreintes SHA-256 des tuiles).
"""
import hashlib, json, os, random, sqlite3, struct, zlib

PNG_SIG = bytes([0x89]) + b"PNG" + bytes([0x0D, 0x0A, 0x1A, 0x0A])
FILTER_NONE = bytes([0])


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png_from_rows(w, h, rows, level):
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return PNG_SIG + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(rows), level)) + chunk(b"IEND", b"")


def noise_png(w, h, seed):
    rnd = random.Random(seed)
    rows = [FILTER_NONE + bytes(rnd.randrange(256) for _ in range(w * 3)) for _ in range(h)]
    return png_from_rows(w, h, rows, 0)  # non compressé : tuile volumineuse


def solid_png(rgb):
    rows = [FILTER_NONE + bytes(rgb) * 256 for _ in range(256)]
    return png_from_rows(256, 256, rows, 9)


out_dir = os.path.join(os.path.dirname(__file__), "..", "apps", "app", "src", "mbtiles", "fixtures")
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, "test.mbtiles")
if os.path.exists(path):
    os.remove(path)
con = sqlite3.connect(path)
con.execute("PRAGMA page_size=4096")
con.execute("CREATE TABLE metadata (name text, value text)")
con.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
con.execute("CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)")
for k, v in [("name", "Carte de test"), ("format", "png"), ("minzoom", "3"), ("maxzoom", "9"),
             ("bounds", "-5.5,41.0,10.0,51.5"), ("attribution", "test")]:
    con.execute("INSERT INTO metadata VALUES (?,?)", (k, v))

expected = {}
n = 0


def add(z, x, y_xyz, data):
    global n
    tms = 2 ** z - 1 - y_xyz
    con.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, tms, data))
    expected[f"{z}/{x}/{y_xyz}"] = hashlib.sha256(data).hexdigest()
    n += 1


# beaucoup de petites tuiles : force des pages intérieures dans l'arbre B
for i in range(2500):
    z = 8 + (i % 2)
    x = 100 + (i // 50)
    y = 100 + (i % 50)
    if f"{z}/{x}/{y}" in expected:
        continue
    add(z, x, y, noise_png(4, 4, i))

# grosses tuiles : débordent sur des pages de débordement (> 4 Ko)
for i in range(12):
    add(5, i, 3, noise_png(64, 64 + i * 8, 10_000 + i))

# tuiles unies en damier sur la France
for z, xs, ys in ((6, range(30, 35), range(20, 25)), (7, range(61, 68), range(42, 49))):
    for x in xs:
        for y in ys:
            add(z, x, y, solid_png((200, 120, 60) if (x + y) % 2 == 0 else (90, 150, 200)))

con.commit()
con.close()
json.dump({"count": n, "size": os.path.getsize(path), "tiles": expected}, open(os.path.join(out_dir, "expected.json"), "w"))
print("tuiles:", n, "taille:", os.path.getsize(path))
