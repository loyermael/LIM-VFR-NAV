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

## Docs et traces (11/11, 4e passage)
**Docs** : liste groupée par terrain (LFXX, LFYY, « Sans terrain »), filtres avec compteurs, recherche seulement au-delà de 5 documents ; une carte par document (nom, type, calée, date de source, taille). Fiche : le lecteur d'abord, puis deux sections repliables (Informations, Géoréférencement avec badge « calée / non calée ») ; la section de calage s'ouvre seule pour une VAC non calée. **Traces** : liste groupée par mois (la plus récente d'abord) ; détail = chiffres clés et bouton de rejeu, puis sections repliables (Rejeu, Profils, Export, Renommer) ; bouton « Supprimer les traces de moins de 2 min » (confirmation) pour les essais et redémarrages. Composant partagé : `Section.tsx`.
Redémarrage en vol : voir « Recollage des traces » ci-dessous.

## Météo (11/11, 5e passage)
Chaque onglet commençait par un bloc « Importer les fichiers météo » devenu inutile avec le téléchargement automatique : remplacé par une ligne d'état (« Données téléchargées il y a 1 h 14 » + bouton Actualiser) ; sans données, un bouton mène à Données → Pays ; l'import à la main reste dans une section repliée (secours). Messages bruts (METAR, TAF, SIGMET) repliés. **SIGMET** : 18 431 px (92 SIGMET du monde) → 868 px : seuls ceux à moins de 400 NM de la route ou de la position sont montrés (4 ici), un bouton affiche tous. **Vents** : vents de la route en premier, tableau par niveaux replié, un seul message (au lieu d'un par branche) quand l'altitude des points manque.

## Recollage des traces (11/11)
Si l'appli est relancée en vol (fermeture, coupure, batterie), l'enregistrement qui repart prolonge la trace interrompue **au lieu d'en créer une nouvelle**, à deux conditions (JUGÉES) : coupure de 10 minutes au plus, et distance plausible (au plus 150 kt × durée de la coupure + 2 km). Le décollage d'origine est gardé, le nombre de reprises et le temps sans enregistrement sont affichés dans le détail de la trace. Limites : la distance totale compte la ligne droite à travers le trou ; au-delà de 10 minutes ou trop loin, c'est une nouvelle trace ; un démarrage manuel ne recolle jamais. Vu à l'écran avec une trace coupée posée à côté du départ du simulateur (1 trace au lieu de 2, « 1 × (22 s sans enregistrement) »).
