# J7 — Documentation : état (10/11/2026)

**L'application ne télécharge rien du SIA** (URL et droits de redistribution non vérifiés) : l'utilisateur importe ses propres fichiers (PDF ou images) ; ils restent sur l'appareil.

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **Bibliothèque** : import PDF/image (plusieurs à la fois), types VAC / AIP / SUP AIP / autre, terrain OACI, date ou cycle de la source, recherche, suppression ; type et OACI devinés d'après le nom du fichier | vu à l'écran (import d'un PDF « VAC LFXX fictive » → type VAC, LFXX) |
| **Lecteur PDF** (pdf.js, Apache-2.0, hors-ligne, worker précaché) : pages, zoom | PDF rendu à l'écran (1190 × 1684 px) ; build PWA OK |
| **Calage (géoréférencement)** : toucher un repère, saisir ses coordonnées (décimal, DMS, « 471830N »…), 2 points minimum, erreur de calage et écart par point dès 3 points | 28 tests du moteur (propriété : toute similitude retrouvée ; un clic faux est désigné par son résidu) ; **vu à l'écran** sur une carte fictive à graticule : 4 points, erreur 9 m (= arrondi des clics), 19,3 m/px, rotation 0° (valeurs attendues 19,26 m/px) |
| **Carte calée posée sur la carte**, alignée | **vu à l'écran** : le graticule et le repère rouge de la carte fictive tombent sur la position prévue |
| **Affichage à l'approche** (GPS à moins de 10 NM du centre, zoom cadré si le suivi est actif) ; modes toujours / jamais | « à l'approche » et « jamais » vus à l'écran avec le simulateur ; cas « GPS loin » et zoom automatique non observés |
| **Documents liés à un terrain** : bouton dans la fiche du terrain (même code OACI) | code écrit et typé, **non vu à l'écran** (pas de données openAIP chargées dans ce test) |

## Pas fait / limites
- **Aucune VAC réelle testée** : seule une carte fictive générée (`tools/make-test-vac.mjs`) a servi. Les VAC du SIA ont leurs propres projections ; le modèle (similitude) est **valable pour une carte à l'échelle sur quelques dizaines de km**, pas pour une grande zone ni une échelle non uniforme.
- **Coordonnées des repères à fournir par l'utilisateur** (graticule, seuils de piste de l'AIP) : pas de calage automatique, pas de choix du point sur la carte, pas d'import de géoréférencement existant (GeoPDF).
- **Une seule page calée par document** ; pas de rotation de l'image au moment de la lecture.
- **Aucune vérification de date** : le champ « source » est libre ; pas d'alerte automatique de document périmé.
- **Pas de recherche dans le texte des PDF**, pas d'annotations, pas de classement par route.
- **SUP AIP / AIP** : simples documents ; pas de source ni de mise à jour automatique (décision à prendre avec l'utilisateur : fichiers SIA, URL à fournir).
- Rendu des PDF volumineux sur téléphone : non mesuré.
- Outil de test : en développement seulement, la carte est exposée à `window.__limMap` (absent en production).
