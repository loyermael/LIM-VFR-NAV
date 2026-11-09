# Étude d'enroute (Akaflieg Freiburg) — idées reprenables

Dépôt : https://github.com/Akaflieg-Freiburg/enroute — C++/Qt/QML, **GPL-3**. Étude faite sur un clone superficiel (lecture de l'organisation et d'extraits, pas d'audit ligne à ligne). **Aucun code repris** : on ne reprend que des idées d'architecture.

## Organisation du code (`src/`)
`dataManagement` (téléchargement/mises à jour), `geomaps` (cartes, espaces, waypoints, VAC), `fileFormats` (MBTiles, GeoTIFF, GPX, PLN, FPL, OpenAir, CUP, CSV…), `navigation` (route, legs, avion, atmosphère, Navigator), `positioning` (GPS, géoïde), `traffic` (GDL90, FLARM, OGN, XGPS, simulateur), `weather` (METAR/TAF, vent, altitude densité), `notam`, `flightlog` (enregistreur, détection de vol, export), `units` (types forts), `platform` (adaptateurs par OS).

## Ce qui est réutilisable comme idée
1. **Pipeline de cartes** : carte vectorielle MapLibre/Mapbox GL servie en local. enroute lance un mini serveur HTTP interne (`TileServer`) qui sert des tuiles MBTiles à la carte, et génère le fichier de style dynamiquement selon les cartes installées. → Chez nous : MapLibre Native lit directement MBTiles/PMTiles via un protocole local ; style généré par le code selon les couches actives (jour/nuit = deux styles dérivés).
2. **Données aéronautiques en GeoJSON datés** : espaces, terrains, balises sont fournis comme GeoJSON par un pipeline serveur (openAIP → fichier par région), téléchargés par un `DataManager` qui suit versions et mises à jour. → Même principe, mais avec notre manifeste AIRAC explicite (cycle, validité) et import SIA.
3. **Modèle de données** : `Waypoint` = propriétés génériques (CAT, ICAO, nom, coordonnées, élévation) ; `Airspace` = polygone + plancher/plafond sous forme de texte *et* de valeur numérique (texte d'origine conservé pour l'affichage fidèle, ex. « FL 65 », « 1500 ft AGL »). Idée à garder : conserver la chaîne source en plus de la valeur normalisée.
4. **Unités fortes** (`Distance`, `Speed`, `Angle`, `Pressure`…) : valeur interne unique, conversions explicites. C'est la même discipline que nos types brandés.
5. **Navigation** : `FlightRoute` = liste de waypoints → `Leg` avec TC, WCA, TH, GS, ETE, carburant calculés à partir d'un `Wind` et d'un `Aircraft` ; calcul de dérive par `WCA = asin(−sin(TC−WD)·WS/TAS)`. Seuils : leg « proche » à 5 NM, longueur minimale de leg 100 m. → Notre triangle des vitesses est écrit et testé de façon indépendante.
6. **Trafic** : une classe source abstraite, une sous-classe par transport (UDP/TCP Wi-Fi, Bluetooth classique/LE, série, OGN, fichier, simulateur) ; GDL90 décode Heartbeat (alerte de perte de flux), Ownship (position/altitude), Ownship géométrique, Traffic. Facteurs de trafic « distance seule » / « avec position », avec avertissements. → Même découpage : `TrafficSource` abstraite + simulateur, ce qui rend le décodage testable sans matériel.
7. **Géoïde** : correction hauteur ellipsoïdale → AMSL avec la grille EGM96 (fichier `WW15MGH.DAC`, données NGA publiques). → On embarque la même grille publique, lue par notre code.
8. **VAC géoréférencées** : fichiers GeoTIFF / TripKit avec géoréférencement dans le fichier, collection de VAC listée avec emprise ; affichage superposé à la carte. → Pour la France, les VAC SIA sont des PDF non géoréférencés : il faudra un géoréférencement manuel/semi-auto (J7), c'est le vrai chantier.
9. **Météo / NOTAM** : récupérés via un **proxy** de l'association (`enroute-data.akaflieg-freiburg.de/enrouteProxy/…`), pas directement auprès des sources. Leçon : les sources officielles sont rarement utilisables directement depuis une app.
10. **Plateforme** : un adaptateur par OS (fichiers, partage, GPS) derrière une interface. → Même idée via modules Expo.
11. **Enregistreur de vol** (`flightlog`, encore expérimental chez eux) : détection décollage/atterrissage, export JSON et ForeFlight.

## Ce qu'enroute ne fait pas (donc à construire)
Cycle AIRAC SIA et SUP AIP, activations RTBA/AZBA, profil vertical avec relief, vents en altitude sur 18 niveaux, TEMSI/WINTEM, radar, masse et centrage, dossier PDF, rejeu 3D, synchronisation multi-appareils, version web. Ils n'ont pas de tests automatisés (« no test target ») : on fera mieux sur ce point.

## Pièges à retenir
- Dépendance forte à Qt et à un serveur de proxy maintenu par des bénévoles : notre architecture doit rester sans proxy obligatoire.
- La carte de base est OSM (« OSM Liberty ») : OK pour fond de carte, mais l'utilisateur veut surtout ses cartes IGN OACI en MBTiles.
