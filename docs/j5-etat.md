# J5 — Avion : état (10/11/2026)

**Aucune donnée d'avion n'est fournie par l'application.** Une fiche neuve est vide ; masses, bras, enveloppe, vitesse et consommation viennent du **manuel de vol et de la dernière pesée de l'appareil**, saisis par l'utilisateur. Les résultats valent ce que valent ces saisies.

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **Fiches avion** (nom, immatriculation, vitesse propre, consommation, carburant : capacité / inutilisable / densité, masse et bras à vide, masse max décollage, masse max atterrissage optionnelle, postes de chargement libres, enveloppe en polygone), enregistrées sur l'appareil (IndexedDB, hors-ligne) | 12 tests de l'édition et du stockage ; vu à l'écran |
| **Masse et centrage** à zéro carburant, au décollage et à l'atterrissage (carburant consommé = trajet du log de nav) ; marge au bord de l'enveloppe ; défauts détectés (surcharge, CG avant/arrière, hors enveloppe, poste surchargé, carburant > capacité, charge négative) | tests du moteur sur un avion **fictif** à valeurs calculées à la main ; **recalcul manuel confirmé à l'écran** (ZFM 760,0 kg à 0,988 m ; décollage 803,2 kg à 0,994 m) |
| **Graphique d'enveloppe** (SVG à l'écran, tracé dans le PDF) avec les trois points | vu à l'écran et dans le PDF rendu en image |
| **Plan de carburant** : roulage, trajet (log de nav), aléas en %, déroutement et réserve finale en minutes, total nécessaire, embarqué, excédent, autonomie, alertes | tests du moteur ; vu à l'écran (autonomie 60 L à 25 L/h = 2:24) |
| **Choix de l'avion → vitesse propre et consommation** alimentent le log de nav | vu à l'écran |
| **Dossier de vol PDF** (couverture + avertissement, log de nav, centrage + enveloppe, carburant, espaces traversés avec fréquences, METAR/TAF bruts près de la route), FR et EN, généré **sur l'appareil** (pdf-lib), donc hors-ligne | 4 tests ; PDF **rendu en images et lu** (texte extrait, tableaux, graphique) ; **bouton testé dans le navigateur** (PDF de 6 Ko produit, nom de fichier correct) |

## Pas fait / limites
- **Réserves de départ (aléas 10 %, réserve finale 30 min, déroutement 0, roulage 0) : JUGÉES**, pas tirées d'une réglementation. Le pilote les confirme ; elles sont modifiables et mémorisées.
- **Consommation constante** : pas de montée/descente, pas de consommation selon l'altitude ou le régime.
- **« Ordonner » l'enveloppe** trie les sommets par angle : correct pour une enveloppe convexe ou « en étoile » (cas courant), à **vérifier sur le graphique** pour une forme exotique. Une enveloppe à surface nulle est signalée.
- **Pas de plusieurs enveloppes** (catégories normale/utilitaire), pas de bras variable par station, pas de courbe de moment/« chart » : un seul polygone masse/bras.
- **Pas d'import/export des fiches** entre appareils (la synchro est prévue en J8).
- **PDF** : polices standard (Helvetica, Courier) ; les caractères hors Latin-1 sont remplacés (→ devient `->`). Pas de carte dans le PDF, pas de profil vertical, pas de NOTAM ni de TEMSI (sources absentes, voir J4). Les vents par branche figurent dans le log (colonne Vent), pas en tableau séparé.
- **Non testé** : impression réelle sur papier, ouverture du PDF sur iPhone/iPad/Android (téléchargement testé seulement dans le navigateur du bureau).
- Les tests utilisent un avion **fictif** ; aucun avion réel n'a été saisi ni comparé à sa fiche de pesée.
