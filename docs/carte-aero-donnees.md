# Carte aéro « type OACI » : inventaire des données ouvertes

Objectif : une carte vectorielle aéronautique inspirée de l'OACI (couleurs et symboles de la légende publique), nommée à part, jamais présentée comme la carte officielle.
État : inventaire par recherche web, puis **vérification sur les fichiers réels openAIP (téléchargés le 2026-11-11)**. SIA, DIRCAM et BD TOPO restent à ouvrir.

| Élément de la carte | Source candidate | Licence annoncée | État |
|---|---|---|---|
| Espaces aériens | openAIP (déjà utilisé) ; SIA (AIXM 4.5 / xml SIA, 28 jours) | openAIP : CC BY-NC (NC-SA selon une source) ; SIA : Licence Ouverte, source + date | openAIP OK dans l'appli ; SIA à vérifier (format, accès) |
| Terrains, pistes, fréquences | openAIP (déjà utilisé) | idem | OK |
| Balises (VOR, NDB), points de report VFR | openAIP (selon une source) ; SIA AIP ENR 4 / VFR | à vérifier | à vérifier fichier par fichier |
| Obstacles | SIA AIP ENR 5.4.1 (obstacles hors servitudes) ; fichiers obstacles DIRCAM (tirés de l'AIP) ; openAIP (type de donnée mentionné) | licence non lue | à vérifier : format et licence |
| Servitudes aéronautiques | data.gouv.fr « servitude aéronautique de dégagement » | Licence Ouverte (à confirmer) | enveloppe seulement, pas des obstacles individuels |
| Zones UAS / géovigilance | SIA / DGAC (guide « UAS ») | Licence Ouverte ; géovigilance, pas pour décisions de sécurité seules | hors périmètre OACI |
| Cartographies VFR/IFR GeoJSON/OpenAir | data.gouv.fr (dérivées SIA + Eurocontrol) | à lire | piste à vérifier |
| Routes, villes, hydrographie, bâtiments | IGN BD TOPO ; OpenStreetMap | BD TOPO : Licence Ouverte Etalab 2.0 (selon wiki OSM) ; OSM : ODbL | à vérifier sur le site IGN |
| Relief ombré | IGN LiDAR HD (déjà utilisé) | Licence Ouverte | OK |
| Plan de fond | IGN Plan V2 (déjà utilisé) | Licence Ouverte | OK |

## Points ouverts
1. openAIP : licence non commerciale ; sa page autorise l'embarquement dans une appli payante tant qu'on ne vend pas la donnée seule : à clarifier avec openAIP.
2. Obstacles : aucune base nationale ouverte unique trouvée ; passer par le SIA/DIRCAM, sinon OSM (pylônes, éoliennes).
3. Mentions obligatoires : SIA = source + date de mise à jour ; IGN = © IGN ; OSM = © contributeurs.
4. Dessin et symboles : légendes OACI publiques sur Géoportail ; le dessin exact de la carte IGN/SIA relève du droit d'auteur : ne pas copier, s'en inspirer.
5. SDVFR : sa carte SDOACI est propre à SkyDreamSoft, « comparable » à l'OACI et non identique.

## Suite proposée
Ouvrir les vrais fichiers (SIA AIXM, DIRCAM obstacles, BD TOPO, openAIP obstacles/balises), noter format, volume et licence lue sur place, puis décider du premier lot (espaces + terrains + balises + obstacles).

## Vérifié sur les exports openAIP France (anonymes, sans clé : `https://storage.openaip.net/openaip-system-exports/fr_<type>.json`)
| Type | Fichier | Éléments | Poids | Contenu constaté |
|---|---|---|---|---|
| Espaces aériens | `asp` | déjà utilisé | 2,9 Mo | - |
| Terrains | `apt` | déjà utilisé | 2,2 Mo | - |
| **Balises** | `nav` | 148 (VOR/DME/NDB…, 5 types) | 0,23 Mo | nom, identifiant, fréquence, canal, position, altitude, portée |
| **Points de report** | `rpp` | 678 | 0,31 Mo | nom, obligatoire ou non, terrains liés, position |
| **Obstacles** | `obs` | 8 887 (7 631 de type 0, le reste 4 autres types) | 6,7 Mo | position, altitude ; hauteur renseignée sur 2 276 seulement (max 350 m) ; **issus d'OpenStreetMap** (`osmId`, `osmTags`, ex. éoliennes) |
| Parapentes/deltas (décollages) | `hgl` | 449 | 0,2 Mo | position, altitude, type |
| Points chauds (planeurs) | `hot` | 27 | 14 Ko | position, catégories |

Lacunes et points d'attention :
- Les obstacles viennent d'OSM : la liste est incomplète (pas un recensement officiel) et la licence ODbL d'OSM s'ajoute à la mention openAIP. À afficher comme « obstacles indicatifs ».
- Hauteur absente pour environ 3 obstacles sur 4 : le symbole ne peut pas toujours porter la hauteur comme sur l'OACI.
- Base communautaire, non alignée sur le cycle AIRAC (déjà signalé dans l'appli).
- Le téléchargement long d'`obs` coupe à 40 s en connexion lente : prévoir un délai plus large.
- DIRCAM : la page des fichiers obstacles renvoie 403 aux accès automatiques ; SIA : adresse de téléchargement AIXM non retrouvée : à ouvrir à la main.

## Premier lot proposé
Espaces + terrains (déjà là) + balises + points de report + obstacles : tout est dans le même format que les données déjà chargées, donc ajoutable au paquet de données sans nouvelle source.

## État du dessin (carte aéro inspirée de l'OACI, légende SIA/IGN 2026 fournie par l'utilisateur)
Fait : balises (VOR, VOR/DME, DME, NDB), points de report, obstacles ≥ 300 ft AGL (mât, mât élevé ≥ 500 ft, éolienne), terrains (civil / mixte / militaire × piste en dur / bande / héli / hydro, privé, désaffecté) avec étiquettes ; espaces : bandes colorées A/B-C-D/E, hachures R/D, quadrillage P, trait mixte RMZ/TMZ, pointillés ATZ/SIV, étiquettes nom + plafond + plancher.
Pas fait : TACAN / VOR-TACAN, groupes d'obstacles, balisage de nuit, lignes électriques et câbles, RTBA (cadre et ALT MAX), activités diverses (voltige, vol à voile, aéromodélisme, parachutisme), itinéraires VFR, fond cartographique OACI (routes, villes, relief teinté), cadre d'espace avec lettre de classe, encoche des CTR.
Écarts connus : les formes sont redessinées d'après la légende, pas pixel pour pixel ; le classement P/R/D, SIV, ATZ repose sur les codes de type openAIP.

## Fond de carte aéro (ajouté)
Choix « Carte aéro (type OACI) » dans Calques > Fond : tuiles vectorielles OpenStreetMap servies par OpenFreeMap (adresse lue dans son TileJSON, gardée pour le hors-ligne) et relief Terrarium (AWS Open Data), dessinés avec les couleurs de la légende : teintes hypsométriques (0-1000-2000-3000-5000-8200-11500 ft, bleu pâle au-dessus), végétation, agglomérations, eau, autoroutes (double trait), routes principales et secondaires, voies ferrées, frontière, noms de villes, altitudes des sommets en pieds.
Hors-ligne : tuiles gardées au fil de l'eau et par zone (Données > Fonds de carte > Carte aéro ; vecteur jusqu'au zoom 14, relief jusqu'au 12).
Pas fait : points cotés critiques, repères isolés (châteaux, tours…), canaux navigables, routes en construction/tunnels, tracé exact de l'échangeur, teinte du bord de mer. Dépendance : service OpenFreeMap (gratuit, sans clé, sans garantie) ; une copie propre des tuiles reste possible plus tard.
Licences : © contributeurs OpenStreetMap (ODbL) ; relief : Mapzen / AWS Open Data.
