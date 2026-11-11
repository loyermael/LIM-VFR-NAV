#!/usr/bin/env python3
"""
Extrait les symboles de la légende OACI (PDF vectoriel fourni par l'utilisateur : IGN / SIA, édition 2020) en images PNG transparentes,
une par symbole, rendues à 4 pixels par point (le symbole s'affiche à sa taille d'origine avec un pixelRatio de 4).

  python tools/extract-oaci-symbols.py legende-oaci.pdf apps/app/public/oaci [--sheet planche.png]

Chaque symbole est découpé dans une boîte (page, centre en pixels d'une image à 170 dpi, demi-largeur, demi-hauteur) : la légende est un
document de mise en page, pas une bibliothèque de symboles. La planche de contrôle permet de vérifier visuellement les découpes.
"""
import json
import os
import sys

import fitz

DPI = 170
K = 72.0 / DPI  # pixels de l'image de contrôle → points PDF
SCALE = 4.0     # pixels de sortie par point PDF

# nom : (page 1-4, cx, cy, demi-largeur, demi-hauteur) en pixels à 170 dpi
BOXES = {
    # aérodromes : civil, mixte, militaire × piste en dur, bande, hélistation, hydro
    "ad-civil-paved": (1, 413, 1005, 34, 34), "ad-civil-unpaved": (1, 505, 1005, 34, 34), "ad-civil-heli": (1, 595, 1005, 34, 34), "ad-civil-water": (1, 677, 1005, 34, 34),
    "ad-mixte-paved": (1, 413, 1085, 34, 34), "ad-mixte-unpaved": (1, 505, 1085, 34, 34), "ad-mixte-heli": (1, 595, 1085, 34, 34), "ad-mixte-water": (1, 677, 1085, 34, 34),
    "ad-mil-paved": (1, 413, 1155, 30, 30), "ad-mil-unpaved": (1, 505, 1155, 30, 30), "ad-mil-heli": (1, 595, 1155, 30, 30), "ad-mil-water": (1, 677, 1155, 30, 30),
    "ad-p": (1, 568, 1222, 34, 34), "ad-x": (1, 390, 1222, 30, 30),
    # radionavigation
    "vor": (1, 55, 1480, 15, 15, "blue"), "vordme": (1, 55, 1558, 19, 17, "blue"), "vortacan": (1, 55, 1635, 24, 24, "blue"),
    "ndb": (1, 433, 1456, 34, 34, "blue"), "tacan": (1, 498, 1510, 26, 26, "blue"), "dme": (1, 505, 1568, 20, 18, "blue"),
    # obstacles
    "mast": (2, 45, 690, 22, 24), "mast-lit": (2, 85, 690, 24, 28), "mast-group": (2, 128, 690, 24, 24), "mast-group-lit": (2, 178, 690, 26, 28),
    "mast-hi": (2, 47, 752, 18, 26, "blue"), "mast-hi-lit": (2, 100, 752, 26, 34), "mast-hi-group": (2, 140, 757, 24, 30), "mast-hi-group-lit": (2, 190, 752, 28, 34),
    "wind": (2, 116, 810, 26, 30, "blue"), "ground-light": (2, 493, 815, 20, 20),
    # espaces et activités
    "small-area": (4, 513, 725, 26, 26, "red"), "para": (4, 257, 1175, 24, 28, "red"),
    "balloon": (4, 432, 1172, 20, 30, "red"), "glider": (4, 600, 1160, 60, 24, "red", "raw"), "gliders-airfield": (4, 541, 1225, 26, 26, "red"),
    # activités (symboles en police dans le PDF : découpe brute, puis on ne garde que le rouge et on efface les numéros de référence)
    "acro": (4, 72, 1178, 52, 56, "red", "raw"), "aeromodel": (4, 585, 1272, 45, 38, "red", "raw"),
    # règles de survol (page 2) : parc très petit, installation à marque distinctive, centrale nucléaire
    "park-small": (2, 420, 278, 14, 14, "red"), "mark-site": (2, 396, 307, 15, 15, "red"), "nuclear": (2, 440, 309, 16, 16),
    # points de report
    "rp-c": (4, 418, 1500, 18, 18), "rp": (4, 535, 1500, 18, 18),
}


def _is(col, family):
    r, g, b = col[:3]
    if family == "blue":
        return b > 0.45 and r < 0.25
    if family == "red":
        return r > 0.7 and g < 0.45 and b < 0.45
    return True


def tight_rect(page, box, color="any"):
    """Rectangle serré autour du symbole : on part de la boîte, on garde les tracés entièrement dedans (sans les cadres, les traits de repère
    isolés et le fond blanc), on retient le groupe de tracés voisins le plus proche du centre."""
    cx, cy, hw, hh = box
    big = fitz.Rect((cx - hw) * K, (cy - hh) * K, (cx + hw) * K, (cy + hh) * K)
    cand = []
    for g in page.get_drawings():
        r = g["rect"]
        if r.width > page.rect.width * 0.5 or r.height > page.rect.height * 0.5:
            continue
        if not (r.x0 >= big.x0 - 0.5 and r.x1 <= big.x1 + 0.5 and r.y0 >= big.y0 - 0.5 and r.y1 <= big.y1 + 0.5):
            continue
        if len(g["items"]) == 1 and g["items"][0][0] == "l" and max(r.width, r.height) > 8:
            continue  # long trait isolé : ligne de repère de l'étiquette (les rayons des obstacles balisés sont courts)
        if color != "any":
            col = g.get("fill") or g.get("color")
            if not col or not _is(col, color):
                continue
        cand.append(fitz.Rect(r))
    if not cand:
        return big
    centre = fitz.Point((big.x0 + big.x1) / 2, (big.y0 + big.y1) / 2)
    # groupes de rectangles qui se touchent (à 1,5 pt près)
    groups = []
    for r in cand:
        r2 = fitz.Rect(r.x0 - 1.5, r.y0 - 1.5, r.x1 + 1.5, r.y1 + 1.5)
        hit = [g for g in groups if g[0].intersects(r2)]
        merged = fitz.Rect(r)
        for g in hit:
            merged |= g[0]
            groups.remove(g)
        groups.append((merged, 0))
    best = min(groups, key=lambda g: (((g[0].x0 + g[0].x1) / 2 - centre.x) ** 2 + ((g[0].y0 + g[0].y1) / 2 - centre.y) ** 2))
    r = best[0]
    return fitz.Rect(r.x0 - 0.6, r.y0 - 0.6, r.x1 + 0.6, r.y1 + 0.6)


def transparent(pm):
    """Fond blanc → transparent (seulement le blanc relié au bord : l'intérieur blanc d'un symbole reste opaque) ; bord adouci."""
    from PIL import Image, ImageDraw
    im = Image.frombytes("RGB", (pm.width, pm.height), pm.samples)
    w, h = im.size
    mask = im.convert("L").point(lambda v: 255 if v > 246 else 0)
    flood = mask.copy()
    for x in range(w):
        for y in (0, h - 1):
            if flood.getpixel((x, y)) == 255:
                ImageDraw.floodfill(flood, (x, y), 128)
    for y in range(h):
        for x in (0, w - 1):
            if flood.getpixel((x, y)) == 255:
                ImageDraw.floodfill(flood, (x, y), 128)
    alpha = flood.point(lambda v: 0 if v == 128 else 255)
    # bord : pixels clairs au contact du fond → opacité proportionnelle à leur écart au blanc
    px, al, lum = im.load(), alpha.load(), im.convert("L").load()
    for y in range(h):
        for x in range(w):
            if al[x, y] == 255 and lum[x, y] > 150:
                near = any(0 <= x + dx < w and 0 <= y + dy < h and al[x + dx, y + dy] == 0 for dx in (-1, 0, 1) for dy in (-1, 0, 1))
                if near:
                    al[x, y] = max(0, min(255, int((255 - lum[x, y]) * 255 / 105)))
    out = im.copy()
    out.putalpha(alpha)
    return out


# zones à effacer (fractions x0, y0, x1, y1 de l'image) : trait de repère de l'étiquette, numéro de référence…
CLEAR = {}
DARK_CLEAR = {"para", "acro", "balloon", "glider", "gliders-airfield", "aeromodel"}  # symboles rouges : flèches, points et textes noirs de la légende en moins


def cleanup(name, im):
    """Garde le groupe de tracés principal : efface repères, numéros, flèches et textes voisins, puis recadre sur le symbole."""
    import numpy as np
    from scipy import ndimage as ndi
    a = np.array(im)
    h, w = a.shape[:2]
    if name in ("acro", "aeromodel", "glider"):
        # symboles en police : on ne garde que le rouge (alpha = dominance du rouge), tout le reste (textes, flèches, blanc) disparaît
        dom = a[..., 0].astype(int) - np.maximum(a[..., 1], a[..., 2]).astype(int)
        a[..., 0], a[..., 1], a[..., 2] = 232, 30, 36
        a[..., 3] = np.clip(dom * 255 // 170, 0, 255).astype(np.uint8)
        a[..., 3][a[..., 3] < 60] = 0  # franges grises des textes effacés
    for x0, y0, x1, y1 in CLEAR.get(name, []):
        a[int(y0 * h):int(y1 * h) + 1, int(x0 * w):int(x1 * w) + 1, 3] = 0
    if name in DARK_CLEAR:
        mx, mn = a[..., :3].max(axis=2).astype(int), a[..., :3].min(axis=2).astype(int)
        a[((mx - mn) < 45) & (mn < 235), 3] = 0  # noir et gris (flèches, textes, franges) ; le blanc franc reste (rayures du ballon)
    mask = a[..., 3] > 0
    lab, n = ndi.label(ndi.binary_dilation(mask, iterations=3 if name in ('mast-hi', 'mast-hi-group', 'glider') else (16 if name == 'acro' else 7)))
    if n > 1:
        counts = ndi.sum(mask, lab, range(1, n + 1))
        a[..., 3] = np.where((lab == int(np.argmax(counts)) + 1) & mask, a[..., 3], 0)
    ys, xs = np.where(a[..., 3] > 0)
    if len(xs) == 0:
        return im
    from PIL import Image
    pad = 2
    return Image.fromarray(a[max(0, ys.min() - pad):ys.max() + pad + 1, max(0, xs.min() - pad):xs.max() + pad + 1])


def halo(im, px=5):
    """Liseré blanc autour du symbole (≈ 1,2 pt) : il reste lisible sur le plan, les photos et les cartes colorées."""
    import numpy as np
    from scipy import ndimage as ndi
    from PIL import Image
    a = np.array(im)
    a = np.pad(a, ((px, px), (px, px), (0, 0)))
    dil = ndi.binary_dilation(a[..., 3] > 25, structure=ndi.generate_binary_structure(2, 2), iterations=px)
    base = np.zeros_like(a)
    base[..., :3] = 255
    base[..., 3] = np.where(dil, 235, 0)
    out = Image.fromarray(base)
    out.alpha_composite(Image.fromarray(a))
    return out


def render(page, box, scale=SCALE):
    if len(box) > 5 and box[5] == "raw":
        cx, cy, hw, hh = box[:4]
        r = fitz.Rect((cx - hw) * K, (cy - hh) * K, (cx + hw) * K, (cy + hh) * K)
    else:
        r = tight_rect(page, box[:4], box[4] if len(box) > 4 else "any")
    pm = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=r, alpha=False)
    return transparent(pm), r


def main():
    pdf, out = sys.argv[1], sys.argv[2]
    sheet = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    os.makedirs(out, exist_ok=True)
    doc = fitz.open(pdf)
    # numéros de référence et chiffres de la légende (« 6130 », « 900 », « (552) »…) : retirés du texte de la page avant le rendu, les symboles seuls restent
    import re
    for page in doc:
        n = 0
        for w in page.get_text("words"):
            if re.fullmatch(r"\(?\d{2,4}\)?", w[4]):
                page.add_redact_annot(fitz.Rect(w[:4]))
                n += 1
        if n:
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    meta = {}
    tiles = []
    for name, spec in BOXES.items():
        pg = spec[0]
        im, r = render(doc[pg - 1], spec[1:])
        im = cleanup(name, im)
        if name == "aeromodel":
            # la légende 2020 n'a que le rouge ; la carte distingue la hauteur par la couleur (> 500 ft orange, > 1000 ft violet, > 2000 ft rouge)
            for suffix, rgb in (("-orange", (243, 156, 18)), ("-purple", (150, 80, 165))):
                import numpy as np
                from PIL import Image as _I
                a = np.array(im).copy()
                a[..., 0], a[..., 1], a[..., 2] = rgb
                v = halo(_I.fromarray(a))
                v.save(os.path.join(out, f"{name}{suffix}.png"))
                meta[name + suffix] = {"w": v.width, "h": v.height}
                tiles.append((name + suffix, v))
        im = halo(im)
        im.save(os.path.join(out, f"{name}.png"))
        meta[name] = {"w": im.width, "h": im.height}
        tiles.append((name, im))
    json.dump(meta, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    if sheet:
        from PIL import Image, ImageDraw
        cell, cols = 150, 8
        rows = (len(tiles) + cols - 1) // cols
        im = Image.new("RGB", (cols * cell, rows * (cell + 14)), (200, 215, 235))
        dr = ImageDraw.Draw(im)
        for i, (name, t) in enumerate(tiles):
            t = t.copy()
            t.thumbnail((cell - 6, cell - 6))
            x, y = (i % cols) * cell, (i // cols) * (cell + 14)
            im.paste(t, (x + 3, y + 14), t)
            dr.text((x + 3, y + 1), name, fill="black")
        im.save(sheet)
    print(f"{len(tiles)} symboles -> {out}")


if __name__ == "__main__":
    main()
