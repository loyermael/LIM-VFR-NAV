# Organisation de l'interface (11/11/2026)

Décision de l'utilisateur : garder la barre d'outils à la SDVFR Next (très intuitive) mais **mieux rangée** ; Enroute sert d'inspiration pour la page de données. Boutons pas encore construits : **grisés**, pas retirés.

Barre d'outils, en quatre groupes séparés :
| Groupe | Boutons | Rôle |
|---|---|---|
| Carte | Centrer · Direct · Calques | agir sur la carte ; **Calques** = uniquement ce qui s'AFFICHE (fond, espaces/terrains et filtres, plafond, radar, relief grisé, VAC) |
| Voler | Route · Avion · Météo · Vol | Route : Routes, Points et vents, Log, Profil (grisé) · Avion : Fiche, Centrage, Carburant · Météo : Briefing, METAR, TAF, SIGMET, Vents · Vol : Chrono, Traces |
| Bibliothèque | Docs · Données | Docs : documents et VAC · Données : Pays (auto), Fonds de carte, Espaces et terrains, Fichiers perso |
| Réglages | Réglages | Affichage, Unités, Connexions (trafic/simulateur), Sauvegarde |

Avant : « Cartes » mélangeait fonds, imports de fichiers, météo, filtres ; « Réglages » mélangeait données, unités, trafic, sauvegarde ; l'avion et le carburant étaient cachés dans « Route » ; les traces dans « Chrono » ; deux boutons menaient à des pages vides.

Enroute (lu dans son code le 11/11) : un menu latéral en groupes (Aircraft, Route and Wind, Approach Charts, Weather, Flight Log ; Library : Aircraft, Flight Routes, Maps and Data, Waypoints ; Settings ; Information) et une page « Map and Data Library » à onglets Maps / VAC / Data avec filtre, liste par région, taille, mise à jour, import. Idées reprises : séparer « ce qu'on affiche » de « ce qu'on installe », un seul endroit pour les données, badge de mise à jour. Aucun code copié (GPL-3).

## Écran Route (11/11, 2e passage)
Une seule page de 3 670 px (33 boutons, 21 champs, 6 sections) a été coupée en trois onglets : **Routes** (liste avec suppression en deux temps, nouvelle, import, route sélectionnée, export GPX/KML/FPL/PLN, dossier PDF), **Points et vents** (heure de départ, vent par défaut, points, vent par branche), **Log** (vitesse et consommation repliées, tableau, espaces traversés). Le Log reste long quand la route traverse beaucoup d'espaces.

## Fiche avion (11/11, 3e passage)
La fiche passait de 3 434 px (34 boutons, 32 champs, liste au-dessus) à : une **liste** de mes avions avec l'état de chaque fiche (complète / à compléter), et un **éditeur seul** (423 px liste, ~900 px éditeur replié) en 5 sections repliables avec badge « complet / à compléter » (Croisière, Masse, Carburant, Postes, Enveloppe) ; la première section à compléter s'ouvre toute seule ; le type de poste est une liste déroulante (4 boutons en moins par poste) ; l'enveloppe se dessine en direct pendant la saisie ; suppression en deux temps.
