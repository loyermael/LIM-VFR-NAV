#!/usr/bin/env python3
"""
Centrales nucléaires de production d'EDF (open data EDF, Licence Ouverte) : une position par site (moyenne des tranches).
  python tools/fetch-edf-nuclear.py apps/app/src/data/fr_nuclear.json
Source : https://opendata.edf.fr/datasets/centrales-de-production-nucleaire-edf
"""
import csv, io, json, sys, urllib.request

URL = "https://opendata.edf.fr/data-fair/api/v1/datasets/centrales-de-production-nucleaire-edf/convert"
req = urllib.request.Request(URL, headers={"User-Agent": "LIM-VFR-Nav-data/0.1"})
rows = csv.DictReader(io.StringIO(urllib.request.urlopen(req, timeout=60).read().decode("utf-8")))
sites = {}
for r in rows:
    if (r.get("Filière") or "").strip() != "Nucléaire":
        continue
    try:
        lat, lon = [float(x) for x in r["Point gps (wsg84)"].split(",")]
    except (KeyError, ValueError):
        continue
    sites.setdefault(r["Centrale"].strip().title(), []).append((lat, lon))
items = [[n.replace(" (Le)", "").replace("(Le)", "").strip(), round(sum(p[0] for p in v) / len(v), 4), round(sum(p[1] for p in v) / len(v), 4)] for n, v in sorted(sites.items())]
json.dump({"source": "EDF open data, centrales de production nucléaire (Licence Ouverte)", "items": items}, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(items), "sites")
