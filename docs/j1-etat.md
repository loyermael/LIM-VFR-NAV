# J1 — Carte et GPS : état (09/11/2026)

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| Géodésie WGS84 (distance, cap, destination) | 12 tests dont 4 propriétés fast-check (symétrie, aller-retour, cap inverse, accord avec la sphère à 0,6 %) |
| Variation magnétique WMM2025, alerte hors validité | tests de signe (Est/Ouest) et de plage ; bannière dans l'app |
| Correction du géoïde EGM96 | points de référence NGA, continuité, France 40–55 m |
| Position GPS : état ok / faible / périmé / perdu, route utilisable, vecteur vitesse (1, 2, 5 min) | tests des seuils ; **alerte rouge « SIGNAL GPS PERDU » vue à l'écran** avec le simulateur |
| Moving map : avion, vecteur à bulles, centrage auto, nord en haut, zoom + / − | vu à l'écran avec le simulateur (`?sim`). **« Route en haut » (rotation de la carte) : code écrit, non vu à l'écran** |
| Double-tap : détails des entités sous le doigt | vu à l'écran (fiche avec propriétés) |
| Couches GeoJSON (testé), KML et Shapefile zippé (code écrit, **non testé avec de vrais fichiers**) | GeoJSON : tests + écran ; stockage hors-ligne IndexedDB |
| Filtre de plafond | tests + écran (l'espace de plancher FL195 disparaît à FL195) |
| Import MBTiles hors-ligne (lecteur SQLite maison, copie en OPFS, index conservé) | **2 586 tuiles relues à l'octet près** (dont tuiles sur pages de débordement) ; import, affichage et survie au rechargement vus dans le navigateur |
| Changement de carte selon le zoom | réglage « du zoom X au zoom Y » par carte ; **non testé avec deux cartes** |
| Unités par information, avertissement, FR/EN, jour/nuit | écran + tests |

## Ajout du 09/11 : réglages par case
Toucher la case altitude : QNH du jour, mode QNH / niveau de vol / GPS brute, calage sur un terrain, source de l'altitude GPS. Toucher une autre case : son unité. Vérifié à l'écran : QNH 1003 + 3281 ft GPS → FL036 ; calage sur 3000 ft → affiche 3000 ; réglages mémorisés. 16 tests sur les calculs (altitude pression ISA, FL, calage, expiration 6 h). Voir `docs/design.md`.

## Pas fait / pas vérifié
- **Carte vectorielle aéronautique** (espaces, terrains, balises, obstacles) : dépend des données SIA/openAIP, donc **J3**. En J1 le fond est vide, ou tes MBTiles.
- **Aucun test sur un vrai appareil** : GPS réel, altitude (voir ci-dessous), gros MBTiles (IGN OACI), service worker hors-ligne, iPhone/iPad.
- Vrais fichiers KML et Shapefile.
- Vibration/son lors de la perte GPS (non disponible sur iOS en PWA) : alerte visuelle seulement.
- MBTiles très volumineux : l'index est gardé en mémoire (≈ 40 octets par tuile). Plusieurs millions de tuiles seraient lourds ; une carte France 1:500 000 reste très en dessous.

## Point de vigilance : altitude GPS
Le navigateur ne dit pas si l'altitude est ellipsoïdale ou AMSL, et ça varie selon l'appareil (écart de 40 à 55 m en France). Réglage dans Réglages → « Altitude fournie par le GPS ». **À calibrer au sol sur un terrain d'altitude connue** avant de se fier à l'altitude.

## Démo sans GPS
`?sim` dans l'adresse = vol simulé en cercle ; `?sim=loss` = idem avec perte de signal périodique.

## Liste de vérification sur appareil (à faire par l'utilisateur)
1. Installer la PWA (Safari « Sur l'écran d'accueil » / Chrome « Installer »), couper le réseau, relancer : l'app doit s'ouvrir.
2. Autoriser la localisation, sortir dehors : vitesse, route, altitude cohérentes.
3. Comparer l'altitude affichée à celle d'un terrain connu, ajuster le réglage.
4. Importer un MBTiles IGN OACI (taille et durée à noter), couper le réseau, vérifier l'affichage.
5. Verrouiller l'écran 30 s : le signal doit passer en « périmé » puis « perdu » (comportement attendu sur iOS).
