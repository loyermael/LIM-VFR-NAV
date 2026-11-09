# J3 — Espaces et réglementation : état (10/11/2026)

Sources, licences et limites : voir `docs/j3-sources.md`. Données : **openAIP** (communautaire, non officiel, CC BY-NC 4.0), export du 09/11/2026 : 1 801 espaces, 1 503 terrains.

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **Décodage openAIP** (espaces, terrains, limites m / ft / FL, sol / niveau de la mer / pression standard, fréquences, SUP AIP, dates) | 21 tests de fixtures + **test sur le vrai export** (tout se décode, quelques enregistrements écartés et comptés) |
| **Cycles AIRAC** (28 j, identifiant AAnn) | 10 tests ; retombe sur les vraies dates 2026 (22/01, 29/10, 26/11, 24/12) ; cycle courant 2611 |
| **Date de validité affichée**, cycle AIRAC en cours, avertissements (« openAIP non officiel », « données de N jours », « antérieures au cycle ») | tests + vu à l'écran |
| **Import hors-ligne** des fichiers (export d'espaces, de terrains, manifeste daté), stockage sur l'appareil, retrait | 9 tests ; **vu à l'écran avec ton vrai export** |
| **Espaces sur la carte**, couleur par groupe (contrôlés bleu, réglementés brique, radio ocre, transit planeur vert), filtre par groupe | vu à l'écran |
| **Filtre de plafond** sur les vrais planchers (sol = toujours affiché) | logique testée (J1) ; effet visible sur la carte, **non mesuré** |
| **Terrains** sur la carte (cercles) | vu à l'écran |
| **Double-tap** : fiche de tous les espaces et terrains sous le doigt (type, classe, plancher, plafond, fréquences, période d'activation à venir / en cours / terminée, SUP AIP, activation « à vérifier ») | vu à l'écran avec de vraies zones (ZRT, TMA, CTA) |
| **Espaces traversés par la route** avec fréquences et statut vertical (dans / hors limites / à vérifier) | 12 tests ; vu à l'écran sur Poitiers → Limoges à 3 000 ft |
| **Aide au choix des fréquences** : fréquences des espaces traversés, dans l'ordre de rencontre | vu à l'écran |
| **Terrains les plus proches** et **recherche de terrain** (nom ou OACI) + **Direct vers un terrain** | tests ; vu à l'écran (ex. Direct LFBL : relèvement 225°, 68,5 NM, 45:41) |
| Script `npm run data:openaip` (téléchargement anonyme, vérifie le JSON, écrit un manifeste daté) | exécuté : export du 09/11/2026 |

## Pas fait dans J3 (et pourquoi)
- **Profil de vol et profil de nav avec relief** (Copernicus DEM / SRTM) : demande de préparer des tuiles de relief hors-ligne (volumineuses). Sans relief, les limites « au-dessus du sol » restent « à vérifier ».
- **SUP AIP actifs du jour** : seul le **numéro** (« AIP SUP 084/26 ») est affiché, tel que publié par openAIP ; le texte officiel n'est pas intégré (pas d'API trouvée).
- **Activations RTBA / AZBA en surbrillance** : **impossible aujourd'hui** (aucun jeu ouvert) ; l'application affiche « activation à vérifier », jamais « active / inactive ». Voir `docs/j3-sources.md`.
- **NOTAM** : aucune source gratuite et officielle exploitable trouvée ; non intégrés.
- **Données SIA officielles (AIXM, cycle AIRAC)** : URL de téléchargement non vérifiée ; prochaine source à brancher.
- **Horaires d'ouverture** (`hoursOfOperation`) : présents dans les données, **non affichés**.
- **Recherche de localités** : openAIP ne contient pas de villes ; seule la recherche de terrains existe.
- **Téléchargement dans l'application** : impossible depuis un navigateur (pas de CORS) ; l'import passe par les fichiers du script. Possible plus tard dans la coque Android.

## À savoir
- openAIP n'est **pas** un jeu AIRAC validé : un écart avec la publication du SIA est possible. Les écrans le disent.
- Une zone **temporaire future** est dessinée comme les autres ; sa fiche indique « à venir ». On ne cache rien automatiquement.
- Les limites de niveau de vol sont converties en mètres avec la **pression standard** (estimation).
- Des **centaines de polygones** se superposent en zoom éloigné : utiliser le filtre de plafond et les groupes. Pas de regroupement automatique.
- Le dossier `data/` (fichiers openAIP) est **ignoré par git** : licence non commerciale, ne pas redistribuer.
