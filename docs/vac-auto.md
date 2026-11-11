# Cartes VAC et fonds de carte : la solution (11/11/2026)

## Ce que font SDVFR Next et Enroute (sources en bas)
- **SDVFR Next** (SkyDreamSoft) : VAC **géoréférencées par l'éditeur** (« GEO VAC ») et fond de carte OACI **généré par l'éditeur** (« SDOACI », à partir du dernier cycle AIRAC), servis depuis ses serveurs et mis à jour avec chaque cycle AIRAC. C'est un produit commercial avec une infrastructure.
- **Enroute** (Akaflieg Freiburg) : les VAC ne sont **pas fournies** pour la France ; l'utilisateur importe des GeoTIFF qu'il a lui-même géoréférencés (outils GDAL/QGIS). Leurs données serveur France datent de 2022 à 2024 et n'ont pas de CORS : inutilisables.

## Licence du SIA (vérifiée)
La « licence ouverte » du SIA (PDF publié sur son site) accorde un droit **gratuit, commercial ou non, mondial et illimité** de reproduire, adapter, transformer, **redistribuer** les informations, à deux conditions : **ne pas les altérer ni en dénaturer le sens**, et **mentionner la source (nom du SIA) et la date de dernière mise à jour**. Les « informations légales » du site disent la même chose pour ses données publiques. Les pages portent aussi « © SIA. Tous droits réservés » : à faire confirmer par écrit auprès du SIA avant de republier les PDF eux-mêmes. Les données de l'**IGN** (dont la carte OACI) suivent les conditions de l'IGN, pas celles du SIA.

## Solution retenue pour les VAC : calage automatique par le graticule (vérifié)
Les VAC du SIA sont **orientées nord et portent un graticule** (trait de repère + étiquette « 43°46' » / « 002° 00' » sur le cadre). Le texte du PDF est chiffré par police, mais décodable (glyphes « MT48 » = code ASCII 48 dans le CFF intégré). `tools/vac_georef.py` lit les étiquettes et les traits, ajuste x↔longitude et y↔latitude (Mercator, échelles x/y séparées) et contrôle l'ARP écrit dans l'en-tête.
- **Réel** : sur la VAC LFCQ fournie, 7 repères en longitude et 4 en latitude, résidu 0,01 pt (≈ 0,3 m), et l'ARP de l'en-tête tombe à moins de 1 pt (≈ 25 m) du symbole ⊕ dessiné.
- **Échantillon** : 51 VAC prises au hasard sur le site du SIA (cycle du 29 OCT 2026) : **49 calées automatiquement, 2 refusées** (étiquettes absentes ou autrement formatées), les autres échecs étant des délais réseau. Contrôle visuel de l'ARP prédit sur LFBI et LFBD (Bordeaux, longitude ouest) : sur le symbole du terrain.
- `tools/build-vac-index.py` produit un **index** `vac/index.json` : pour chaque PDF, son SHA-256 et les coefficients de calage (+ cadre de la carte, date d'édition). Il ne contient que des faits, pas les cartes. Le dépôt de données le reconstruit **une fois par cycle AIRAC**.
- **Appli** : un PDF importé dont l'empreinte est dans l'index est calé et recadré **sans aucune saisie** (vu à l'écran avec le vrai `AD-2.LFCQ.pdf` : posé sur la carte, ARP au centre). Une autre édition du fichier n'est jamais calée « au jugé » (repli : calage par la piste ou à la main).

## Étapes suivantes (non faites)
1. **Téléchargement automatique des VAC** : le site du SIA n'a pas de CORS. Deux voies : (a) republier les PDF sur Pages du dépôt de données avec la mention « SIA, date » (si le SIA confirme), (b) passer par un petit relais sans stockage. Taille : environ 250 Mo pour 450 terrains → télécharger **par terrain** (menu autour du terrain) et par région, pas tout d'un coup.
2. **Fonds de carte** : le plan IGN (`GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`) répond avec CORS sur `data.geopf.fr` (essai). Idée : télécharger les tuiles d'une zone et d'un niveau de zoom choisis, les garder dans l'appareil. La carte OACI IGN (SCAN-OACI) n'est pas dans ce service ouvert : l'import MBTiles de l'utilisateur reste le seul chemin, ou un rendu « aéronautique » maison (espaces et terrains sur le plan IGN).
3. **NOTAM** : aucune source libre vérifiée (SOFIA-Briefing du SIA sur compte ; EAD payant).
4. Mentionner la source et la date dans l'appli quand une VAC est affichée (à faire : bandeau d'attribution).

## Sources
- [Licence ouverte du SIA](https://www.sia.aviation-civile.gouv.fr/pub/media/news/file//l/i/licenceopendata-vf_2.pdf) · [Informations légales du SIA](https://www.sia.aviation-civile.gouv.fr/informationslegales)
- [SDVFR Next, App Store](https://apps.apple.com/fr/app/sdvfr-next/id6480184189) · [SDOACI (SkyDreamSoft)](https://skydreamsoft.fr/fr_FR/page/sdoaci) · [Guide NEXT 2026](https://www.reimspegase.org/wp-content/uploads/2026/03/NEXT-Guide-v1.178-2026-03-25.pdf)
- [Enroute : import des VAC (GeoTIFF)](https://akaflieg-freiburg.github.io/enrouteManual/03-tutorialAdvanced/04-vac.html)
