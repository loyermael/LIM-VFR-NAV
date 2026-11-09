# Formats de route (J2) — état au 10/11/2026

Code : `packages/core/src/formats.ts` (module pur, testé sans navigateur). Dépendance : `fast-xml-parser` (MIT).

| Format | Export | Import | Remarques |
|---|---|---|---|
| **GPX 1.1** | route `<rte>` avec `<ele>` en mètres et `<name>` | `<rte>`, sinon les `<wpt>` dans l'ordre ; **traces `<trk>` ignorées** | les traces seront traitées en J6 |
| **KML 2.2** | une ligne + un repère par point, altitudes en mètres | repères ponctuels dans l'ordre du document (dossiers imbriqués compris), sinon sommets de la première ligne | altitude 0 lue comme « inconnue » |
| **Garmin FPL** (flight-plan v1) | table de points + route, points utilisateur | la route renvoie à la table ; erreur claire si un point manque | identifiants normalisés Garmin (majuscules, 12 car. max) ; pas d'altitude |
| **MSFS PLN** | `ATCWaypoint` utilisateur, position en degrés-minutes-secondes, altitude en pieds | idem | |

## Vérifié
- Aller-retour export → import sur nos propres fichiers (noms, coordonnées à 1e-5°, altitudes à 0,6 m, hémisphères Sud/Ouest, caractères spéciaux, identifiants en double).
- Lecture de fichiers écrits à la main selon la structure publique de chaque format.
- Fichiers invalides : message d'erreur clair, jamais de route vide ni de coordonnée inventée (vide, mauvais format, coordonnées hors limites, XML mal formé, point manquant dans la table FPL).

## NON vérifié (à tester avec les vrais logiciels)
- Un GPX/KML/FPL/PLN exporté ici **n'a jamais été ouvert** dans Google Earth, un GPS Garmin ou Microsoft Flight Simulator. Les structures sont écrites de mémoire d'après les formats publics : si un logiciel refuse un fichier, ce sera un défaut à corriger ici, avec le fichier d'exemple de ce logiciel.
- Un vrai fichier exporté par ces logiciels peut contenir des éléments que le lecteur ignore (airways, procédures, noms d'aéroports…) : seuls nom, position et altitude sont repris.

## Limites assumées
- Une route = une suite de points ; pas d'ensemble de routes dans un fichier.
- Les points ne gardent pas leur type d'origine (aéroport, VOR…) : tout devient « point utilisateur » à l'export. Les types viendront avec les données SIA/openAIP (J3).
