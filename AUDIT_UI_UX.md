# Audit UI / UX — L!M VFR Nav

Audit en lecture seule : aucun fichier de l'application n'a été modifié (seul ce rapport a été créé).
Date : 12/11/2026. Version auditée : branche `master`, dernier commit au moment de l'audit.

## Contexte retenu

Le gabarit contenait des champs à remplir ; je les ai renseignés d'après notre travail commun. Corrige-moi si un point est faux.

- **Application** : L!M VFR Nav, aide à la navigation VFR pour pilotes français (carte aéro type OACI, route, log, météo, NOTAM, avion, documents). PWA + coque Capacitor Android.
- **Utilisateurs** : pilote seul, en préparation (bureau, tablette, téléphone) puis **en vol** (cockpit, turbulences, gants possibles, regard bref, soleil). Expert aéronautique, débutant sur l'application.
- **Tâches principales** : (1) lire la position et les données de vol sur la carte, (2) préparer une route (points, vent, heure de décollage), (3) consulter le log de navigation en vol, (4) se briefer (météo, NOTAM, terrains), (5) gérer avion / documents / données hors-ligne.
- **Stack** : React 19, Vite 7, MapLibre GL 5, CSS maison (`src/ui/tokens.css`, `src/styles.css`, 500 lignes), aucun kit de composants.
- **Ce qui te gêne déjà** (d'après tes retours) : écrans trop chargés, alignements approximatifs, boutons en double, petits textes superflus, cases qui se touchent.

**DA figée** : papier chaud + encre + un jaune de marque, filets noirs, rayon unique de 2 px, ombres « décalées », Archivo condensé / IBM Plex Sans / IBM Plex Mono, cibles cockpit de 56 px. Aucune proposition ci-dessous ne la change.

**Méthode et limites.** Lecture du code (CSS, TSX), calculs de contraste sur les tokens, mesures dans le navigateur intégré à 375 × 812 (débordements, hauteur des cibles) et captures. **Non fait** : test avec lecteur d'écran réel, test sur téléphone ou tablette réels, profilage de performance, build Android. Les points « performance perçue » restent donc partiels.

---

## 1. Résumé

1. **Le Log, écran critique en vol, a des zones de saisie minuscules** : 24 cibles de moins de 44 px mesurées à 375 px, dont Hr (15 px) et Z min (16 px), à manipuler en turbulence.
2. **Suppressions sans confirmation ni annulation** pour les points de route, les NOTAM, les cartes importées et les surcouches, alors que le reste de l'app utilise une confirmation en deux temps. Aucun « annuler » nulle part.
3. **Débordement horizontal à 375 px** sur Docs et Avion (éléments de 430 px dans 375 px), et un débordement signalé sur Réglages non localisé.
4. **Barre du haut : 10 boutons de même poids, 6 débordent à droite sur téléphone** (un coupé, cinq masqués) sans indice de défilement ; et un onglet « Profil » grisé en permanence.
5. **La DA est solide mais contournée** : échelle typographique (96 usages) contredite par 14 `clamp()` ad hoc, 5 hauteurs de contrôle, 5 points de rupture, 3 motifs différents pour un même interrupteur, ~35 classes CSS mortes.

**Ce qui fonctionne bien** : tokens centralisés (226 usages d'espacement tokenisé contre 23 en dur), contrastes de texte très bons (≥ 6:1 partout), anneau de focus global de 3 px, cibles principales de 56 px, onglets de 72 px, gestion des encoches (`safe-area`), polices embarquées hors-ligne, `lang` mis à jour au changement de langue, thème nuit mesuré, états vides soignés (Log sans avion, NOTAM, Route).

---

## 2. La DA extraite (tokens) et ses incohérences

### Tokens (source : `src/ui/tokens.css`)

| Famille | Valeurs |
|---|---|
| Couleurs jour | `--paper #f3f1ea`, `--paper-2 #eae7dd`, `--field #fbfaf6`, `--ink #15191d`, `--ink-muted #42484d`, `--hair #b8b3a4`, `--brand #ffd700` (texte `--on-brand #15191d`), `--signal #c8321e`, `--zone-good #2f6b3a`, `--zone-warn #7a5200`, `--zone-bad #9a3b2b`, `--data-figure #0a2a66` |
| Couleurs nuit | `--paper #15191d`, `--paper-2 #1e2429`, `--field #101417`, `--ink #f3f1ea`, `--ink-muted #a9afb3`, `--hair #3a4147`, `--signal #ee6a53`, `--zone-good #8cbf7b`, `--zone-warn #e0b24a`, `--zone-bad #e58c79`, `--data-figure #c7dcff` |
| Typographie | Titres Archivo variable condensé (`--stretch-display 68 %`), texte IBM Plex Sans 400/500/600, valeurs IBM Plex Mono 500/600. Échelle `--fs-12/14/16/20/24/28/32/40/64` |
| Espacement | `--sp-1…6` = 4, 8, 12, 16, 24, 32 px |
| Rayon / filets | `--r 2px` (9 usages), `--rule-heavy 3px`, `--rule-line 1px`, `--rule-hair 1px` |
| Ombre | `--shadow-pop` (contour + décalage 4 px, plein) |
| Tailles de cible | `--h-control 56px`, `--h-strip 72px`, `--focus-ring 3px solid ink` |
| Animation | Aucune (`transition` / `animation` : 0 occurrence dans le CSS) |
| Points de rupture | `max 480`, `max 600`, `max 700`, `min 900`, `min 1100` (non tokenisés) |

### Contrastes mesurés (WCAG AA : 4,5:1 texte, 3:1 composants)

| Paire | Jour | Nuit |
|---|---|---|
| ink / field | 16,9 | 16,4 |
| ink-muted / field | 8,9 | 8,4 |
| ink-muted / paper-2 (lignes alternées) | 7,5 | 7,1 |
| on-brand / brand | 12,6 | 12,6 |
| on-signal / signal | 4,7 | 5,7 |
| zone-good / warn / bad sur field | 6,1 / 6,6 / 6,6 | 8,7 / 9,4 / 7,4 |
| data-figure / field | 13,1 | 13,3 |
| **hair / field** (filets d'entrée de champ) | **2,0** | **1,8** |
| **valeur « périmée » (opacité .45)** | **2,7** | — |
| contrôle désactivé (opacité .45) | 2,9 | — |

### Incohérences relevées

- **Deux verts, deux jaunes** : la trace de route `#22d65f` et le « direct » `#c2188c` sont en dur dans `MapView.tsx:150-151`, hors tokens ; `--zone-good` (#2f6b3a) est un autre vert. Le jaune de marque `#ffd700` côtoie le jaune OACI des agglomérations `#fff200` : une ligne active du Log (jaune marque) peut se confondre visuellement avec la carte.
- **Cinq hauteurs de contrôle** : 56 (`--h-control`), 48 (`.pt-actions`, `.pt-del` en largeur), 44 (`input.mini`, `styles.css:487`), 40 (`.btn-inline`, `:61`, `.wg-reset`), et des champs sans hauteur (voir UX-01).
- **Échelle typographique contournée** : 96 tailles via `--fs-*`, mais 14 `clamp()` dans le Log et les NOTAM (`styles.css` ~l.420-480) et 3 valeurs en `px`.
- **Cinq points de rupture** différents, aucun pour la tablette (768-1024 px).
- **Trois visuels pour « activer / désactiver »** : lignes à case cochée (`.tgl`, menu Calques), pastilles jaunes `aria-pressed` (Types d'espaces, Réglages), case native (vent automatique, `NavScreen.tsx`).
- **Quatre façons de fermer ou revenir** : « Fermer » (fiche des détails), ✕ (Calques, Direct), « ← Retour » (écrans), et « ← Mes routes » empilé sous « ← Retour » dans le détail d'une route.
- **CSS mort** : ~35 classes jamais utilisées (`.paperlog`, `.pl-*`, `.legtable`, `.lg-*`, `.vfrtable`, `.ls-leg`, `.ls-rep`, `.c-*`, `.fab`, `.log-*`…), restes des anciennes versions du Log, soit ~120 lignes.

---

## 3. Problèmes

Gravité : **bloquant** / fort / moyen / faible. Effort : faible (< 1 h) / moyen (demi-journée) / fort.

| ID | Écran / composant | Problème constaté (emplacement) | Impact utilisateur | Gravité | Effort | Solution proposée (dans la DA) |
|---|---|---|---|---|---|---|
| UX-01 | **Log** (`LogSheet.tsx`, `styles.css:458-461`) | Les champs **Z min** et **Hr** sont des `<input>` de 15-16 px de haut avec un simple filet pointillé ; le champ des notes est à 14 px. 24 cibles < 44 px mesurées à 375 px. | En vol (turbulence, gants) : saisies ratées sur le seul écran qu'on consulte pendant le vol. Le filet pointillé n'est pas non plus perçu comme un champ (voir UX-05). | **Fort** | Moyen | Faire de la cellule entière la zone tactile (hauteur ≥ 44 px) : Hr en bas de la cellule T sur toute sa largeur, Z min idem ; filet plein `--ink-muted`. Garder la police mono bleue actuelle. |
| UX-02 | **corrigé** | Confirmation en deux temps pour NOTAM, cartes importées, surcouches et données aéro (même bouton que le reste). Suppression d'un point de route : exécutée tout de suite, avec un bandeau « Point supprimé · Annuler » pendant 6 s qui restaure la route. |
| UX-03 | **Docs** (`DocsScreen.tsx`) et **Avion** (`AircraftScreens.tsx`) | À 375 px, `LABEL.filebtn`, `.choices` et les lignes de document mesurent **430 px** dans un écran de 375 px ; dans Avion, le libellé « — à compléter (3) » dépasse. Réglages signale aussi `scrollWidth > clientWidth` (élément non isolé). | Éléments coupés, défilement horizontal parasite ; sur Docs la liste est en partie hors écran. | **Fort** | Faible | `min-width: 0` sur les enfants de grille/flex, `flex-wrap` sur `.choices`, `overflow-wrap: anywhere` sur les noms ; `white-space: normal` sur `.filebtn`. Retester les trois écrans à 320 et 375 px. |
| UX-04 | **corrigé** | Sur téléphone (≤ 600 px), un bouton « Plus » regroupe Avion, Météo, Vol, Docs, Données et Réglages ; la barre ne garde que Direct, Calques, Route et Plus, et tient dans 375 px sans défilement. **Écart par rapport à ta validation** : j'y ai aussi mis Avion, Météo et Vol, car avec seulement Docs / Données / Réglages la barre débordait encore (706 px) et « Plus » restait hors écran. L'onglet actif de la barre reste visible. |
| UX-05 | **Champs à filet pointillé** (`styles.css:422, 458, 461`, `.zmin`, `.he input`) | Les champs n'ont pour bordure que `--hair` : **2,0:1** (jour) / **1,8:1** (nuit), sous le seuil de 3:1 pour les limites de composants (WCAG 1.4.11). | Le champ n'apparaît pas comme saisissable, surtout au soleil. | Moyen | Faible | Remplacer `--hair` par `--ink-muted` (8:1) sur les filets de champs. Garder `--hair` pour les séparateurs décoratifs. |
| UX-06 | **corrigé** | Valeur périmée à 65 % d'opacité (4,6:1 jour, 6,2:1 nuit) et mention « Position vieille de N s » au-dessus de la bande de données quand la position est périmée. |
| UX-07 | **corrigé** | Onglet « Profil » retiré (Route, Log, NOTAM). |
| UX-08 | **Vent automatique** (`NavScreen.tsx:248-250, 366-370`) | Depuis la suppression du bouton, un échec réseau affiche un message rouge **sans action** : seul un changement de route / d'heure / d'altitude relance la requête. | Utilisateur bloqué sur un message d'erreur, sans moyen évident de réessayer. | Moyen | Faible | Bouton « Réessayer » en ligne dans le message d'erreur, et relance automatique au retour du réseau (`online`). |
| UX-09 | **Interrupteurs** (`styles.css:100-104`, `NavScreen.tsx`, Réglages) | Même action (activer/désactiver) = 3 visuels : ligne à case cochée (Calques), pastille jaune (Types d'espaces, Réglages), case native (vent automatique). | Il faut réapprendre la lecture de l'état à chaque écran. | Moyen | Moyen | Un seul composant `Toggle` (le motif ligne + case de Calques) pour oui/non ; la pastille jaune réservée aux choix exclusifs (fonds, unités). |
| UX-10 | **Route, détail** (`NavScreen.tsx`) | Chaque point occupe une carte de 3 lignes (~140 px) ; avec 8 points il faut ~1100 px de défilement avant « Vent et décollage » et l'export. Pas d'action primaire nette (« Tracer sur la carte » n'est qu'un bouton parmi trois). | Parcours long pour la tâche la plus fréquente de préparation (régler l'heure et le vent) ; hiérarchie plate. | Moyen | Moyen | Ligne de point compacte (n° + nom + altitude sur une ligne, déplacements dans un menu), « Vent et décollage » placé avant la liste de points ; « Tracer sur la carte » en bouton marque. |
| UX-11 | **Navigation retour** (Route détail, fiches) | Deux flèches de retour empilées (« ← Retour » de l'écran et « ← Mes routes ») ; fiches : « Fermer » (texte) ou ✕ selon l'écran. | Doute sur l'effet de chaque bouton ; bruit visuel (déjà relevé par toi). | Moyen | Faible | Écrans : une seule flèche (le retour de la route mène à la liste) ; fiches/feuilles : toujours ✕ à droite de 44 px. |
| UX-12 | **Log, en-têtes** (`styles.css:446`) | L'en-tête « RNav / Info NAV / Com / Z » est coupé (3 lignes dans 44 px) à 375 px ; mêmes sigles (Cm, DSD, TAV…) non traduits en anglais. | Libellé tronqué ; sigles sans aide pour un débutant. | Faible | Faible | Libellé court « Info · Com · Z » ; `title`/info-bulle de définition sur chaque sigle. |
| UX-13 | **Confirmation en deux temps** (`NavScreen.tsx:280`, `AircraftScreens.tsx:254`, `DocsScreen.tsx:282`…) | Le bouton « Confirmer » apparaît **à la place exacte** du bouton ✕ ; l'état armé ne retombe jamais (ni délai, ni clic ailleurs). | Double-appui = suppression ; confirmation oubliée active plus tard. | Moyen | Faible | Retomber à l'état normal après 4 s ou au premier autre appui ; décaler le bouton « Confirmer » (largeur pleine sous la ligne). |
| UX-14 | **Typographie** (`styles.css` l.420-480, 14 `clamp()`) | Tailles fluides ad hoc (ex. `clamp(22px, 5.6vw, 32px)`, `clamp(13px, 3.4vw, 18px)`) en dehors de l'échelle `--fs-*`. | Incohérence visuelle entre écrans, difficile à ajuster d'un coup. | Faible | Faible | Ajouter 4 jetons fluides dans `tokens.css` (`--fs-fluid-s/m/l/xl`) et les utiliser. |
| UX-15 | **corrigé** | Points de rupture ramenés à 600 / 900 / 1100 ; Route (détail), Log et NOTAM passent sur deux colonnes entre 900 et 1099 px (au-delà, le panneau de route de 600 px à côté de la carte reste en une colonne). |
| UX-16 | **Accessibilité des noms** (`App.tsx:1137-1138`, `:1009`) | `aria-label="zoom +"`, `"zoom −"` et `aria-label="outils"` en minuscules/anglais dans une UI française ; marqueurs de la carte (`MapView.tsx:654-660`, `div.wp`) cliquables mais non focalisables. | Lecture d'écran incohérente ; points de route inaccessibles au clavier (atténué par la liste de points de l'écran Route). | Faible | Faible | Libellés issus du dictionnaire i18n ; `role="button"` + `tabindex="0"` + `aria-label="Point 2 : LFLM"` sur les marqueurs. |
| UX-17 | **Mouvement** (`MapView.tsx:641, 689, 695, 1190, 1254`) | Caméra animée (250-900 ms) sans test de `prefers-reduced-motion` ; en revanche **aucune** animation d'interface (retour visuel = inversion `:active` seule). | Gêne vestibulaire pour une minorité ; interface sans transition de confirmation. | Faible | Faible | Durée 0 si `prefers-reduced-motion: reduce` ; ajouter 120 ms de transition de fond sur les interrupteurs (supprimée si mouvement réduit). |
| UX-18 | **corrigé** | 111 règles CSS mortes retirées (519 → 421 lignes), après vérification des classes construites dynamiquement (`adpos`, `cat-`, `gps-`, `lvl`). |
| UX-19 | **Couleurs hors tokens** (`MapView.tsx:150-151`) | Vert de route et magenta du « direct » en dur ; aucun jeton, aucune variante nuit. | Dérive de couleur au prochain réglage ; pas de contrôle de contraste. | Faible | Faible | Jetons `--route` et `--direct` dans `tokens.css` lus par `tokens()`. |

### Points vérifiés sans problème
- **Hiérarchie de l'écran carte** : la carte occupe l'espace, le bandeau de données est stable, un seul bouton de centrage ; l'action primaire (position + route) se voit.
- **États** : vide / partiel / erreur gérés sur Log (sans avion), NOTAM (structure toujours affichée), Données (« choisis ton pays »), GPS (attente, périmé, perdu).
- **Cibles principales** : boutons ≥ 56 px, onglets 72 px, commandes de carte 56 px.
- **Écran d'avertissement à chaque lancement** : un appui de plus, volontaire (sécurité), bouton primaire bien visible : à conserver.

---

## 4. Ordre de traitement recommandé (impact / effort)

1. **UX-05, UX-06, UX-07, UX-12** (1 h au total) : contrastes, onglet mort, libellé tronqué.
2. **UX-03** : débordements Docs/Avion/Réglages (rapide et visible).
3. **UX-02 et UX-13** : cohérence des suppressions, confirmations plus sûres, annulation des points.
4. **UX-08** : bouton « Réessayer » pour le vent automatique (régression récente).
5. **UX-11, UX-16, UX-19** : retours, noms accessibles, jetons de couleur.
6. **UX-01** : agrandir les saisies du Log (le plus important en vol, un peu plus de travail de mise en page).
7. **UX-04, UX-09, UX-10** : barre du haut, composant d'interrupteur, ligne de point compacte.
8. **UX-14, UX-15, UX-17, UX-18** : échelle fluide, paliers de rupture, mouvement réduit, nettoyage du CSS.

*Si tu ne devais en faire que trois : UX-01 (saisies du Log), UX-02 (suppressions) et UX-03 (débordements).*

---

## 5. Suivi des corrections (12/11/2026)

Statuts : **corrigé**, **partiel**, **reporté** (avec la raison). Règles suivies : DA inchangée, jetons uniquement, pas de nouvelle fonction, de suppression ni de décoration sans ton accord. Vérifications faites après chaque lot : rendu à 320, 360 et 375 px, contrôle des débordements et des cibles, 205 tests, `tsc` propre. Non fait : test clavier complet de chaque écran, test sur appareil réel.

| ID | Statut | Ce qui a été fait / pourquoi le reste attend |
|---|---|---|
| UX-01 | **corrigé** | Z min, Hr et le champ d'info des reports font 44 px de haut avec un cadre visible (`--ink-muted`) ; lignes du Log portées de 96 à 128 px pour les loger. Mesuré à 360 px : plus aucune cible < 40 px dans le tableau. |
| UX-02 | **partiel** | Confirmation ajoutée pour NOTAM, cartes importées, surcouches et données aéro (même bouton que le reste). **Reporté** : points de route (suppression fréquente) : la bonne solution est une annulation de 5 s, donc un nouveau composant « toast » : à valider. |
| UX-03 | **corrigé** | Cause : colonnes de grille et boutons à `nowrap` qui s'élargissaient. Docs, Avion, Route, Réglages (barre d'onglets) mesurés sans débordement à 320 px. |
| UX-04 | **partiel** | L'onglet actif de la barre reste toujours visible. **Reporté** : bouton « Plus » (nouvelle fonction) et indicateur de défilement (dégradé exclu par tes règles) : à valider. |
| UX-05 | **corrigé** | Filets de saisie du Log en `--ink-muted` (8:1) au lieu de `--hair` (2:1). |
| UX-06 | **partiel** | Valeur périmée à 65 % d'opacité (4,6:1 jour, 6,2:1 nuit). **Reporté** : afficher l'âge de la donnée (nouvelle information). |
| UX-07 | **reporté** | Supprimer l'onglet « Profil » est une suppression : à valider. |
| UX-08 | **corrigé** | Bouton « Réessayer » dans le message d'erreur du vent, et relance automatique au retour du réseau. |
| UX-09 | **partiel** | Le vent automatique utilise maintenant le même interrupteur que Calques (`.tgl`, désormais commun). **Reporté** : pastilles multi-choix (Types d'espaces) et Réglages, gardées car ce sont des filtres et des choix exclusifs : à valider. |
| UX-10 | **partiel** | Lignes de point compactes (≈ 100 px au lieu de 140) et « Tracer sur la carte » en bouton primaire. **Reporté** : placer « Vent et décollage » avant les points, car tu avais demandé les points en premier. |
| UX-11 | **corrigé** | « Retour » remonte d'un niveau (détail de route → liste → carte) et la deuxième flèche est supprimée ; toutes les fiches se ferment par ✕. |
| UX-12 | **corrigé** | Libellé court « Info · Com · Z » et info-bulle (`title`) de définition sur chaque en-tête du Log. Réserve : une info-bulle ne s'affiche pas au tactile. |
| UX-13 | **corrigé** | Composant `ConfirmButton` unique (7 écrans) : retombe après 4 s ou à l'appui ailleurs, double appui ignoré 0,35 s. |
| UX-14 | **corrigé** | 4 jetons fluides `--fs-fluid-xs/s/m/l`, plus aucun `clamp()` en dur. |
| UX-15 | **partiel** | Points de rupture ramenés à 600 / 900 / 1100 (480 et 700 supprimés au profit de 600). **Reporté** : mise en page à deux colonnes sur tablette (nouvelle mise en page). |
| UX-16 | **partiel** | Libellés des commandes de zoom et de la barre traduits ; points de route atteignables au clavier (`role`, `tabindex`, libellé, Entrée/Espace). **Non traité** : repères de trafic. |
| UX-17 | **partiel** | La caméra de la carte n'est plus animée si le système demande moins de mouvement. Aucune transition ajoutée (pas d'animation gratuite). |
| UX-18 | **reporté** | Suppression d'environ 35 classes CSS mortes : à valider (suppression). |
| UX-19 | **corrigé** | Jetons `--route`, `--route-casing`, `--direct` dans `tokens.css`, lus par la carte. |

### Décisions prises (12/11/2026)

Tu as validé les cinq points : suppression de l'onglet « Profil » et du CSS mort, annulation des suppressions de points, bouton « Plus » sur téléphone, âge des données périmées, deux colonnes sur tablette. Tous sont faits (voir ci-dessus).

### Reste ouvert

- **UX-09** (partiel) : les pastilles multi-choix (Types d'espaces) et Réglages gardent leur forme de pastille jaune.
- **UX-10** (partiel) : « Vent et décollage » n'a pas été placé avant les points.
- **UX-16** (partiel) : repères de trafic non atteignables au clavier.
- **UX-17** (partiel) : aucune transition d'interface ajoutée, volontairement.
