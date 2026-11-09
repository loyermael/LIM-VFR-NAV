# Design : UX type SDVFR, direction artistique L!M Debrief

## Principe
- **UX** : celle de SDVFR Next, analysée sur 8 captures d'écran de l'utilisateur (09/11/2026, Android, portrait). Objectif : intuitif sans mode d'emploi.
- **DA** : celle de L!M Debrief, « carnet de vol sous un panneau d'instruments » : papier chaud `#F3F1EA`, encre `#15191D`, un seul rouge signal, jaune de marque `#FFD700` en touches, filets (3 px en tête, 1 px entre) au lieu d'ombres douces, rayon unique de 2 px, Archivo condensé en capitales (titres, boutons), IBM Plex Sans (texte), IBM Plex Mono (toutes les valeurs mesurées). Variante nuit : encre en fond, papier en texte.
- **Différence avec SDVFR** : SDVFR est un thème sombre bleu marine avec valeurs cyan ; nous gardons l'organisation et les gestes, mais habillés papier/encre (jour) et encre/papier (nuit). Pas de cyan, pas de bleu marine.
- **Cockpit** : cibles de 56 px minimum, chiffres de vol en grand, contraste fort, aucun geste fin obligatoire.

## Ce que montrent les captures SDVFR (à reproduire)
1. **Carte (écran principal)** : carte plein écran. En haut, **barre d'outils d'icônes défilante** (profil/avion, route, direct, réglages, centrer, cartes, relief, profil vertical, chrono). En bas, **grille de données 2 lignes × 3 colonnes** : vitesse sol, route suivie, prochain point / altitude, relèvement vers le point, distance + temps restant. Chrono en bas au centre, échelle en bas à gauche, **bouton rond de calques** en bas à droite, icône « GPS perdu » en haut au centre.
2. **Tracé** : route en noir avec points numérotés dans des cercles ; ligne directe vers le prochain point en vert ; **ligne de recoupement** en violet ; avion avec vecteur vitesse ; espaces en bleu (contrôlés) et rouge (interdits/réglementés) avec nom et plancher/plafond ; obstacles avec hauteur sol et altitude ; mode jour et mode nuit.
3. **Cartes raster** (IGN OACI) en fond, avec **VAC en vignette géoréférencée** près de l'avion, et **profil vertical en écran partagé** sous la carte (route, points numérotés, relief vert, espaces en rectangles).
4. **Tiroir latéral droit** : Options ; Météo (Metar, Taf, Sigmet, Wintem, Radar) ; Cartes en ligne ; Cartes (France IGN OACI, Espagne, Italie…) avec carte active mise en évidence ; Surcouches perso (fichiers importés) ; **filtre de plafond** (curseur en niveaux de vol).
5. **Log de nav** : tableau en lignes de segments, **segment en cours en couleur**, colonnes à deux niveaux (valeur principale grande, valeur secondaire petite en italique) ; colonne de points à droite avec fréquence ; onglets en bas **Log / Profil / Carburant / Centrage**, bouton rond de réglages.
6. **Réglages** : unités (altitude, distance), format des coordonnées, échelle, icône de l'appareil, mode clair/sombre, **couleurs personnalisables** (avion et vecteur, ligne de nav, ligne de recoupement, trace live, trace enregistrée), épaisseurs.
7. **Profil vertical** : plein écran, curseur le long de la route, légende des espaces traversés.
8. **Documents** : arbre par pays/catégorie (AIP, AZBA, GEOMAP, ICA, MISC, SUPAIP, ULM) avec cases à cocher et gros bouton « Mettre à jour » ; onglets **Traces / Documents / Produits / Points perso**.

## Gabarit de L!M VFR Nav (J0)
```
┌ [Route][Direct][Réglages][Centrer][Cartes][Relief][Profil][Chrono][Docs] ┐ barre d'outils défilante
│                                                                          │
│                         CARTE plein écran                                │
│  échelle                    chrono                         ( calques )   │
├──────────────────────────────────────────────────────────────────────────┤
│  VITESSE SOL   │   ROUTE      │   PROCHAIN POINT                         │ grille de données
│  ALTITUDE      │   RELÈVEMENT │   DISTANCE · TEMPS                       │ valeurs mono, `---` sans GPS
└──────────────────────────────────────────────────────────────────────────┘
```
Tiroir de calques à droite (Météo, Cartes, Surcouches, Filtre de plafond). Écrans « Nav » et « Docs » : plein écran avec **onglets contextuels en bas** (Log / Profil / Carburant / Centrage ; Traces / Documents / Produits / Points perso).
Les valeurs affichent `---` tant qu'aucun GPS n'est branché : on n'invente jamais une valeur.

## Cases de la grille touchables (décidé le 09/11/2026)
Toucher une case ouvre ses réglages, sans passer par Réglages :
- **Altitude** : QNH du jour (− / + / saisie / STD), mode (Altitude QNH, Niveau de vol, GPS brute), calage sur l'altitude d'un terrain, source de l'altitude GPS (AMSL ou ellipsoïde), unité. Le label de la case affiche toujours le mode et le QNH réglé (« ALT QNH 1013 », « NIV. VOL 1003 »), avec une étoile si un calage est actif.
- **Vitesse sol, route, relèvement, distance** : choix de l'unité (ou magnétique / vrai).
- **Honnêteté** : sans baromètre, altitude QNH et niveau de vol sont **estimés depuis l'altitude GPS** (atmosphère standard) ; l'altimètre de bord reste la référence. Le QNH et le calage saisis sont abandonnés après 6 h (retour à 1013, avec message) pour ne jamais voler avec le réglage de la veille sans le savoir.

## Log de nav (J2) : colonnes de SDVFR
Z vol / Z min, Rm / Cm, DSD / DIST / DTA, TSV / TAV, Report.
- **TSV = temps sans vent** : distance ÷ vitesse propre (TAS) ; base de calcul.
- **TAV = temps avec vent** : distance ÷ vitesse sol (GS), donc TSV corrigé du vent. Sert aux heures de passage estimées et au carburant.
- Rm = route magnétique, Cm = cap magnétique (Cm = Rm corrigé de la dérive). DSD = distance depuis le départ, DTA = distance restante, Z min = altitude minimale de sécurité : lecture déduite des captures, à confirmer par l'utilisateur à la livraison de J2.

## Unités : un choix par information (décidé le 09/11/2026)
Chaque information a sa propre unité, réglable dans Réglages : vitesse sol (kt, km/h, mph, m/s), altitude (ft, m), distance (NM, km, SM, m), vitesse verticale (ft/min, m/s), pression QNH (hPa, inHg), et la référence des angles route et relèvement (magnétique ou vrai). Défaut : kt, ft, NM, ft/min, hPa, magnétique (usage aviation). Le choix est mémorisé sur l'appareil. Le calcul reste en SI (`packages/core/src/display.ts`).

## Règles
1. Une action fréquente = un bouton visible, jamais derrière un menu.
2. Utilisable d'un pouce, avec des gants, en portrait et en paysage.
3. Un chiffre = une unité ; angle vrai ou magnétique toujours indiqué (`°M` / `°V`).
4. Rouge : position de l'avion et alertes prioritaires. Couleurs de tracé (route, direct, recoupement, traces) : jetons personnalisables dans les réglages, jamais en dur.
5. Ordinateur : mêmes jetons, mise en page large (carte + panneau de log de nav à côté), clavier et souris.
6. On ne reprend ni les visuels, ni les icônes, ni les textes de SDVFR : même organisation, identité L!M.

## Source unique
`apps/app/src/ui/tokens.css` reprend les noms et valeurs de `L!M Debrief/src/ui/tokens.css`. Polices et licences OFL dans `apps/app/src/ui/fonts/` (embarquées, aucun chargement réseau). Aucun style en dur dans les composants ; une couleur nouvelle se crée d'abord en jeton.
