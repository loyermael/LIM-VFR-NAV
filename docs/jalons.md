# Jalons — proposition de découpage

Chaque jalon se termine par : démo testable sur iPad, tests verts, résumé court (fait / reste).
Un **J0** est ajouté : il ne livre pas de fonction, mais rend les suivants possibles.

## J0 — Socle (nouveau)
Monorepo, TypeScript strict, Vitest, CI locale, i18n FR/EN, écran d'avertissement, types d'unités et d'angles, config des seuils, manifeste de données (AIRAC). PWA (React + Vite + MapLibre GL JS) installable qui affiche une carte vide, hors-ligne.
*Plateformes cibles (tout le projet)* : iPhone, iPad, téléphones et tablettes Android, et ordinateur via le web pour préparer vols et navs. Interface adaptative dès J0 (téléphone / tablette / ordinateur, portrait et paysage).
*Démo* : l'app se lance sur un appareil iOS **et** un Android, avertissement, carte, bascule jour/nuit ; la page web équivalente s'ouvre sur ordinateur.

## J1 — Carte et GPS
Carte vectorielle aéronautique, styles jour/nuit, filtre plafond ; import MBTiles (cartes IGN OACI), couches KML/GeoJSON/SHP, superposition, changement de carte selon le zoom ; moving map (position, GS, cap, altitude, vecteur vitesse à bulles de temps, centrage auto, nord/route) ; double-tap pour détails ; déclinaison (WMM), géoïde (EGM96), alerte perte GPS.
*Risque* : GPS en arrière-plan iOS ; perf du rendu avec beaucoup d'espaces. *Données* : fond de carte de départ (OSM/OpenFreeMap, à confirmer en J1).

## J2 — Préparation de nav
Route au clic, waypoints perso, points de report VFR ; log de nav configurable ; Direct, recherche de localités, terrains les plus proches ; import/export GPX, KML, PLN, FPL. **Tests unitaires obligatoires** : triangle des vitesses, géodésie.
*Web ordinateur* : l'application web de préparation (création de route, log de nav, import/export) est livrée **dans ce jalon**, pas après J8 ; seule la synchronisation avec les appareils attend J8 (en attendant : export/import de fichiers).
*Risque* : aucune donnée de terrains avant J3 → J2 s'appuie sur un jeu openAIP daté minimal.

## J3 — Espaces et réglementation
SIA + openAIP, AIRAC 28 j, validité affichée ; profil de vol et profil de nav avec relief (DEM) ; SUP AIP du jour, RTBA/AZBA ; NOTAM ; aide au choix des fréquences.
*Limites NOTAM (à étudier au début du jalon)* : pas d'API publique gratuite officielle pour la France ; SIA publie des NOTAM sur son site (pas d'API documentée) ; EAD/Eurocontrol demandent un compte ; sources tierces (proxy type enroute, FAA) peuvent ne pas couvrir la France. On présentera les options avec leurs limites avant de coder.

## J4 — Météo
METAR/TAF/SIGMET bruts et décodés ; vents en altitude 18 niveaux sur 24 h ; TEMSI/WINTEM, radar ; briefing couloir.
*Risque* : TEMSI/WINTEM et radar Météo-France ont des licences/API à vérifier ; METAR/TAF/SIGMET via AviationWeather.gov ou sources ouvertes. Les vents en altitude = modèle ouvert (ex. GFS/ICON/AROME), pas d'API unique évidente.

## J5 — Avion
Fiches avion, masse et centrage avec enveloppe, carburant ; dossier de vol PDF.

## J6 — Traces
Enregistrement auto, boîte noire, rejeu 2D/3D, export KML/GPX/**IGC** (compatible L!M Debrief), live track, chronomètres.

## J7 — Documentation
VAC géoréférencées (zoom auto à l'approche), AIP, SUP AIP, documents liés à des waypoints, bibliothèque.
*Risque majeur* : les VAC SIA sont des PDF non géoréférencés → outil de géoréférencement (points de calage) à construire ; droits de redistribution à vérifier (usage perso : OK).

## J8 — Connectivité
Trafic GDL90/FLARM Wi-Fi (module UDP natif), SafeSky, alerte perte de flux ; simulateurs (X-Plane, MSFS, FlightGear) ; synchro entre appareils ; version web synchronisée.
*Risque* : la synchro implique un serveur (ou peer-to-peer) : seul endroit où un coût d'hébergement peut apparaître ; à décider avant J8.

## Ordre et dépendances
J0 → J1 → J2 → J3 → (J4, J5, J6 indépendants) → J7 → J8. J6 peut passer avant J4 si tu veux enregistrer tes vols très tôt.
