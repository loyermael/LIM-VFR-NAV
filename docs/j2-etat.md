# J2 — Préparation de nav : état (10/11/2026)

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **Triangle des vitesses** (dérive, cap, vitesse sol, vent impossible) | 21 tests : cas calculés à la main (face, arrière, traversier droite/gauche, oblique), cas impossibles, 3 propriétés fast-check (bornes de la GS, **fermeture du triangle**, signe de la dérive) |
| **Calculs géodésiques** (distance, caps, destination, ligne de changement de date) | 12 tests dont 4 propriétés (voir J1) |
| **Log de nav** : route vraie et magnétique (mesurée au milieu de la branche), dérive, cap, GS, TSV, TAV, carburant, DSD, DTA, heure de passage, tendance montée/descente | 24 tests ; vu à l'écran (187,3 NM à 100 kt → TSV 1:52:23, 49,2 L pour 1:38:26 à 30 L/h) |
| Vent par défaut et **vent par branche** | moteur testé ; saisie par branche présente à l'écran, **non essayée à la main** |
| **Direct** : cap, distance, temps vers un point ; fiche « Direct vers… » ; avance automatique au point suivant (0,5 NM ou < 10 s) | moteur testé ; fiche Direct et ligne verte vues à l'écran ; l'avance automatique est testée en logique mais **pas vue en vol simulé** |
| Création de route **au toucher sur la carte** (mode ✎), points numérotés, déplaçables, fiche d'un point (nom, altitude, Direct, suppression) | ajout et affichage vus ; **déplacement au doigt et fiche d'un point non essayés** |
| Liste de points : renommer, altitude, monter / descendre, inverser, supprimer | édition testée (12 tests) ; écran vu, boutons non tous essayés |
| **Import / export GPX, KML, FPL, PLN** | 28 tests (aller-retour, fichiers invalides) ; **jamais essayés avec les logiciels d'origine** (docs/formats.md) ; le bouton Importer et les téléchargements n'ont pas été essayés dans le navigateur |
| Routes mémorisées hors-ligne (IndexedDB), vitesse propre et consommation mémorisées | rechargement vérifié (3 points, vitesse propre) |

## Version ordinateur (ajoutée le 10/11)
À partir de 1100 px de large : bouton **Route** = ouvre/ferme un panneau à droite de la carte (la carte reste utilisable : tracé, Direct, points déplaçables), grille de données sur une seule ligne de 6 cases, **Échap** ferme fiches, tiroir et mode tracé, survol des boutons, cadrage automatique sur la route (« Voir la route » et à l'ouverture du panneau, quand il n'y a pas de GPS). Sans GPS (ordinateur), la bannière « GPS indisponible » est jaune (attention), pas rouge. **Vu à l'écran à 1280 px** (carte + panneau + grille) ; pas essayé sur un vrai grand écran ni à la souris (glisser un point, molette).

## Pas fait dans J2
- **Terrains les plus proches, recherche de localités, points de report VFR** : ils exigent des données (SIA / openAIP) que J3 apporte ; la règle « aucune donnée aéronautique en dur » interdit de les inventer.
- **Waypoints perso réutilisables** (bibliothèque) : aujourd'hui un point existe seulement dans une route.
- **Montée / descente** : le log affiche seulement la tendance (↑ → ↓ d'après les altitudes des points). Pas de temps ni de carburant de montée : il faut les performances de l'avion (J5).
- **Synchronisation** entre appareils : J8 ; en attendant, passer par les fichiers exportés.
- **Aucune performance d'avion par défaut** : vitesse propre et consommation sont saisies par l'utilisateur (ce sont des données d'avion).

## Choix de calcul à connaître
- La route d'une branche est mesurée **au milieu** (méridien médian), comme sur une carte, pas au départ : différence jusqu'à ~1° sur une longue branche est-ouest.
- La variation magnétique est celle du **milieu** de la branche (WMM2025, valable jusqu'au 31/12/2029).
- Un vent trop fort pour tenir la route laisse dérive, cap, TAV et carburant vides (« --- ») avec un avertissement : on n'invente jamais un chiffre.
- Modifier la structure d'une route (ajouter, retirer, échanger, inverser un point) **efface les vents par branche** (les indices changent).
