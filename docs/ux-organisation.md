# Organisation de l'interface (11/11/2026)

Décision de l'utilisateur : garder la barre d'outils à la SDVFR Next (très intuitive) mais **mieux rangée** ; Enroute sert d'inspiration pour la page de données. Boutons pas encore construits : **grisés**, pas retirés.

Barre d'outils, en quatre groupes séparés :
| Groupe | Boutons | Rôle |
|---|---|---|
| Carte | Centrer · Direct · Calques | agir sur la carte ; **Calques** = uniquement ce qui s'AFFICHE (fond, espaces/terrains et filtres, plafond, radar, relief grisé, VAC) |
| Voler | Route · Avion · Météo · Vol | Route : Log, Profil (grisé) · Avion : Fiche, Centrage, Carburant · Météo : Briefing, METAR, TAF, SIGMET, Vents · Vol : Chrono, Traces |
| Bibliothèque | Docs · Données | Docs : documents et VAC · Données : Pays (auto), Fonds de carte, Espaces et terrains, Fichiers perso |
| Réglages | Réglages | Affichage, Unités, Connexions (trafic/simulateur), Sauvegarde |

Avant : « Cartes » mélangeait fonds, imports de fichiers, météo, filtres ; « Réglages » mélangeait données, unités, trafic, sauvegarde ; l'avion et le carburant étaient cachés dans « Route » ; les traces dans « Chrono » ; deux boutons menaient à des pages vides.

Enroute (lu dans son code le 11/11) : un menu latéral en groupes (Aircraft, Route and Wind, Approach Charts, Weather, Flight Log ; Library : Aircraft, Flight Routes, Maps and Data, Waypoints ; Settings ; Information) et une page « Map and Data Library » à onglets Maps / VAC / Data avec filtre, liste par région, taille, mise à jour, import. Idées reprises : séparer « ce qu'on affiche » de « ce qu'on installe », un seul endroit pour les données, badge de mise à jour. Aucun code copié (GPL-3).
