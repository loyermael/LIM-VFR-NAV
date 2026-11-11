# Données automatiques par pays : état (11/11/2026)

Objectif : l'utilisateur choisit son pays (France pour l'instant), tout se télécharge et se met à jour tout seul.

## Pourquoi un serveur est nécessaire
openAIP et aviationweather.gov n'envoient pas d'en-têtes CORS : un navigateur ne peut pas les lire directement. Il faut un **paquet de données** reconstruit régulièrement et publié sur un hébergement statique (GitHub Pages ou équivalent, gratuit, avec CORS).
Décision de l'utilisateur (11/11) : **dépôt GitHub séparé, données seulement** (le code de l'appli reste local). **Non créé à ce jour** : il faut un compte/une connexion GitHub et ton feu vert sur le nom et la visibilité.

## Fait et vérifié
| Élément | Vérification |
|---|---|
| `tools/build-data-pack.mjs` : construit le paquet (manifeste + espaces/terrains openAIP + METAR/TAF/SIGMET), avec tailles et SHA-256 ; ne casse jamais l'existant si un téléchargement échoue ; reprend un jeu récent du paquet précédent | **exécuté pour de vrai** (1 503 terrains, 1 790 espaces, 400 METAR, 99 TAF, 121 SIGMET, 6,4 Mo) ; reprise (`--prev`) et mise à jour partielle (`--only weather`) essayées |
| `tools/serve-pack.mjs` : sert un paquet en local avec CORS | utilisé pour le test |
| App : **choisir le pays → téléchargement + import automatiques** ; mise à jour au lancement, au retour du réseau, au retour au premier plan, puis toutes les 15 min ; un jeu n'est retéléchargé que s'il est plus récent | **vu à l'écran** : un clic sur « France » charge terrains, espaces et météo ; après reconstruction de la météo seule, **seuls les 4 fichiers météo** sont retéléchargés |
| Contrôles : taille et SHA-256 de chaque fichier, chemins refusés s'ils sortent du paquet, version du format | 18 tests (fichier altéré, tronqué, erreur HTTP, chemins `..`, manifeste invalide) |
| Hors-ligne / échec : les données déjà installées restent, rien n'est effacé ; message dans les réglages | logique testée ; non essayé en coupant vraiment le réseau |
| `data-pipeline/publish-data.yml` : tâche GitHub Actions horaire + publication Pages | **écrit, jamais exécuté** |

## À faire pour que ce soit « vraiment » automatique
1. **Créer le dépôt de données** (je le fais sur ton feu vert : nom, public ou privé ; Pages exige un dépôt public en offre gratuite), y copier `tools/` (3 scripts) et `data-pipeline/publish-data.yml`, activer GitHub Pages (source : GitHub Actions), définir la variable `PAGES_URL`.
2. **Fixer l'adresse** du paquet dans l'appli (`VITE_DATA_URL` à la construction, ou « Réglages → Avancé »).
3. **Licence openAIP (CC BY-NC 4.0)** : redistribuer l'export dans un dépôt public est permis pour un usage non commercial avec attribution (écrite dans le manifeste et affichée dans l'appli) ; il serait correct de prévenir openAIP. Si l'app devenait payante ou commerciale, ce serait à revoir.

## Pas dans le paquet (sources non vérifiées ou trop lourdes)
- **Fonds de carte** (tuiles vectorielles de la France : plusieurs centaines de Mo, source et hébergement à choisir) : non fait. Les cartes MBTiles se chargent toujours à la main.
- **Cartes VAC** : les VAC du SIA sont des PDF par terrain, non géoréférencés : un téléchargement automatique + calage automatique n'existe pas ; non fait (URL SIA non vérifiée, droits à vérifier).
- **Vents en altitude et radar** : déjà automatiques (Open-Meteo, RainViewer, CORS ouvert), hors paquet.
- **TEMSI/WINTEM, NOTAM, SUP AIP, RTBA** : pas de source ouverte, comme avant.
- **Autres pays** : le script prend un code pays mais un seul est déclaré (France) ; ajouter un pays = une ligne et une zone météo, à tester.
- **Fraîcheur réelle** : openAIP publie une fois par nuit à la source ; la météo est celle de NOAA au moment de la construction (horaire). Les données restent « communautaires, non AIRAC ».

## Enroute (Akaflieg Freiburg)
Étudiée à l'étape 0 (`docs/etude-enroute.md`) : **idées reprises seulement** (paquets de données par pays, GeoJSON datés, mises à jour suivies), **aucun code** (GPL-3). Vérifié le 11/11 : leur serveur de données n'envoie pas de CORS et leurs fichiers France datent de 2022 à 2024 (aviation 18/09/2024, fond de carte 2023, relief 2022) : **inutilisables comme source** pour des mises à jour régulières.
