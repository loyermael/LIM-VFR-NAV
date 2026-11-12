#!/usr/bin/env python3
"""
Agglomérations de la carte OACI, calculées comme la légende : on réunit les zones bâties d'OpenStreetMap (tuiles OpenFreeMap, couche landuse),
on les soude (fermeture morphologique), puis on classe chaque agglomération par sa largeur moyenne (4 x surface / périmètre) :
  moyenne : 1200 à 3600 m (jaune)    grande : plus de 3600 m (orange)    (en dessous : simple point, géré par l'application)

  python tools/build-agglomerations.py sortie.json [ouest sud est nord] [zoom]

Sortie : {"format": "lim-nav-agglo", "items": [[classe(1 moyenne, 2 grande), [[lon, lat, ...] anneau extérieur]], ...]}  (coordonnées en 1/10000 de degré)
Données OpenStreetMap (ODbL), via OpenFreeMap.
"""
import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import mapbox_vector_tile
from shapely.geometry import Polygon, MultiPolygon, shape
from shapely.ops import unary_union
from shapely import affinity

UA = {"User-Agent": "LIM-VFR-Nav-data/0.1 (GitHub loyermael/lim-vfr-nav-data)"}
CLASSES = {"residential", "commercial", "industrial", "retail"}
LAT0 = 46.5
KX = 111320 * math.cos(math.radians(LAT0))
KY = 111320
CLOSE = float(__import__("os").environ.get("AGG_CLOSE", 130))  # on gonfle de CLOSE m (soude les zones à moins de 2 x CLOSE)
OPEN = float(__import__("os").environ.get("AGG_OPEN", 250))  # ramifications plus fines que 2 x OPEN supprimées
MARGIN = float(__import__("os").environ.get("AGG_MARGIN", 40))  # marge conservée autour des zones bâties


def http(url):
    for _ in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception:
            pass
    return None


def tile_xy(lon, lat, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def to_lonlat(px, py, tx, ty, z, ext):
    n = 2 ** z
    lon = (tx + px / ext) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / ext) / n))))
    return lon, lat


def fetch(args):
    tpl, z, tx, ty = args
    data = http(tpl.format(z=z, x=tx, y=ty))
    polys = []
    if not data:
        return (tx, ty, polys)
    try:
        layers = mapbox_vector_tile.decode(data)
    except Exception:
        return (tx, ty, polys)
    lay = layers.get("landuse")
    if not lay:
        return (tx, ty, polys)
    ext = lay.get("extent", 4096)
    for f in lay["features"]:
        if f["properties"].get("class") not in CLASSES:
            continue
        g = f["geometry"]
        parts = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]] if g["type"] == "Polygon" else []
        for part in parts:
            rings = []
            for ring in part:
                # le décodeur donne y vers le haut depuis le bas de la tuile : on repasse en coordonnées de tuile
                pts = [to_lonlat(x, ext - y, tx, ty, z, ext) for x, y in ring]
                rings.append([((lon) * KX, lat * KY) for lon, lat in pts])
            try:
                p = Polygon(rings[0], rings[1:])
                if not p.is_valid:
                    p = p.buffer(0)
                if not p.is_empty and p.area > 1500:
                    polys.append(p.simplify(15))
            except Exception:
                pass
    return (tx, ty, polys)


def main():
    out = sys.argv[1]
    bbox = [float(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [-5.3, 41.3, 9.7, 51.2]
    z = int(sys.argv[6]) if len(sys.argv) >= 7 else 11
    tj = json.loads(http("https://tiles.openfreemap.org/planet"))
    tpl = tj["tiles"][0].replace("{z}", "{z}").replace("{x}", "{x}").replace("{y}", "{y}")
    x0, y1 = tile_xy(bbox[0], bbox[1], z)
    x1, y0 = tile_xy(bbox[2], bbox[3], z)
    jobs = [(tpl, z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    print(len(jobs), "tuiles", file=sys.stderr)
    blocks = {}
    with ThreadPoolExecutor(16) as ex:
        for tx, ty, r in ex.map(fetch, jobs):
            blocks.setdefault((tx // 6, ty // 6), []).extend(r)
    print(sum(len(v) for v in blocks.values()), "polygones en", len(blocks), "blocs", file=sys.stderr)
    # fermeture : on gonfle de CLOSE m (soude les zones proches), on fusionne bloc par bloc puis l'ensemble, puis on dégonfle en gardant MARGIN de marge
    parts = []
    for k, v in blocks.items():
        if v:
            parts.append(unary_union([p.buffer(CLOSE, 2) for p in v]).simplify(25))
    merged = unary_union(parts)
    merged = merged.buffer(-(CLOSE - MARGIN), 2)
    # généralisation : ouverture (retire les ramifications étroites le long des routes) puis fermeture douce, comme le dessin cartographique de l'OACI
    merged = merged.buffer(-OPEN, 2).buffer(OPEN + 150, 2).buffer(-150, 2)
    geoms = list(merged.geoms) if isinstance(merged, MultiPolygon) else [merged]
    items = []
    for g in geoms:
        if g.is_empty or g.area < 1e5:
            continue
        g = Polygon(g.exterior).simplify(90)  # sans trous (les parcs enclavés sont absorbés, comme sur l'OACI)
        width = 2 * math.sqrt(g.area / math.pi)  # largeur moyenne = diamètre du disque de même surface
        if width < 1200:
            continue
        cls = 2 if width > 3600 else 1
        ring = [[round(x / KX, 4), round(y / KY, 4)] for x, y in g.exterior.coords]
        items.append([cls, [c for pt in ring for c in pt]])
    json.dump({"format": "lim-nav-agglo", "version": 1, "source": "OpenStreetMap (ODbL) via OpenFreeMap, calcul LIM", "items": items}, open(out, "w"), separators=(",", ":"))
    print(len(items), "agglomérations (", sum(1 for i in items if i[0] == 2), "grandes )", file=sys.stderr)


if __name__ == "__main__":
    main()
