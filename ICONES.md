# Icônes — état des lieux et proposition (en attente de validation)

Aucun code modifié. Sources lues : `package.json`, tous les `.tsx` / `.css` / `.ts` de `apps/app/src`, `public/oaci`.

## 1. Ce qui existe

**Aucune bibliothèque d'icônes** (rien dans `package.json`). Les « icônes » sont de trois sortes :

| Sorte | Où | Style |
|---|---|---|
| **Caractères Unicode dans le texte** | `✕` fermer (13 emplois), `✎` tracer, `◎` recentrer, `←` retour (5), `‹ ›` pager, `▾ ▸` replier / déplier, `⋯` menu route, `↑ ↓` (points, orientation), `↺ ↻`, `➤` Direct, `★` radio principale, `+ −` (zoom, QNH, « + Route ») | police de repli du système ; taille du texte (14 à 28 px) ; pas de trait réglable |
| **Formes CSS ajoutées pour l'état** (`::before`) | `▲ ◆ ■ ● ✓ ☁ ▬ ⇄` : bandeaux, badges, catégories de fiches, catégories de vol, pastille « route active » | caractères, pleins, taille du texte |
| **SVG inline** | bouton Calques (`layers`, 28 px, trait 2, jointures rondes, `currentColor`) ; avion et trafic sur la carte (triangles pleins) ; graphiques de centrage / profils ; icône d'appli `public/icon.svg` | un seul SVG « interface » ; le reste est cartographique |
| **PNG OACI** | `public/oaci/*.png` (45 symboles : terrains, VRP, obstacles, balises, centrales, parcs) | légende OACI, déjà conforme |

**Incohérences relevées**
1. **Rendu dépendant de l'appareil.** Archivo et IBM Plex ne contiennent pas `✕ ✎ ◎ ➤ ☁ ⋯ ▲ ◆`, donc le système choisit une police de repli (Segoe, Noto, parfois version emoji colorée) : épaisseur et forme changent d'un téléphone à l'autre.
2. **Deux styles qui cohabitent** : caractères pleins (28 px) à côté d'un seul SVG au trait de 2 px (Calques).
3. **Tailles libres** : 14 px (✕ compact), 16, 20 (menu rond), 28 (commandes carte, Calques). Pas d'échelle.
4. **Un glyphe, plusieurs sens** : `◆` = prudence, NOTAM, « route active », (et groupe d'espaces) ; `↑` = « monter un point » et « cap en haut » ; `✕` = fermer **et** supprimer un point ; `+` = zoom avant, « ajouter à la route », incrément QNH.
5. **Un sens, plusieurs glyphes** : replier / déplier = `▸ ▾` (sections) mais `▾` seul (pastille de route) ; recharger = `↻` (Log) alors que remise à zéro = `↺` (vent par branche) ; retour = `←` dans le texte mais `‹ ›` pour les pages.
6. **Info-bulles** : `aria-label` sur la plupart des boutons sans texte, mais seulement 15 `title` (info-bulle) et aucun sur les commandes de carte.
7. **Barre du haut, onglets, menus, boutons** : texte seul (pas d'icône) ; le composant `Button` ne sait pas porter d'icône.

## 2. Bibliothèque proposée : **Lucide** (copiée dans l'appli, pas en dépendance)

- **Pourquoi Lucide.** Trait de 2 px sur grille 24 (c'est déjà le style de l'icône Calques, qui est un `layers` de Lucide), `currentColor`, ~1 500 icônes dont tout notre vocabulaire (navigation, plane, layers, locate-fixed, route, cloud, timer, database, trash, copy, download, radio…), licence ISC (libre, sans attribution à l'écran).
- **Pourquoi pas Phosphor / Tabler.** Phosphor : 6 graisses, donc plus de choix mais plus de risques d'incohérence ; Tabler : très complet mais traits plus fins et formes plus arrondies, moins « instrument ».
- **Adaptation à la DA** (rayon de 2 px, filets d'encre, capitales condensées) : trait **2 px constant** quelle que soit la taille (`vector-effect: non-scaling-stroke`), extrémités et jointures **carrées / vives** (`stroke-linecap: square`, `stroke-linejoin: miter`) plutôt qu'arrondies.
- **Mise en œuvre prévue** : un fichier `ui/Icon.tsx` contenant uniquement les ~40 icônes utilisées (chemins SVG copiés, aucune dépendance, fonctionne hors ligne), un composant `<Icon name size />`, et `Button` qui accepte `icon`. Les icônes manquantes (piste, losange « ! ») sont dessinées dans le même style.
- **Avant de remplacer partout** : une page « planche d'icônes » (comme le nuancier) pour valider l'aspect trait carré / arrondi.

**Règles de rendu**
- 3 tailles : **16** (dans le texte, badges, chevrons, champ de recherche) · **20** (boutons, bandeaux) · **24** (commandes carte, menu rond).
- Couleur = couleur du texte ou du rôle (`currentColor`) : encre, rouge sur destructif et alerte, orange sur prudence, vert sur OK, magenta sur route active, `on-ink` sur actif ; jamais multicolore.
- Statuts : formes distinctes **en plus** de la couleur (daltoniens) — alerte = triangle, prudence = losange, OK = cercle ✓, information = carré « i ».
- Les symboles de la carte (PNG OACI, avion, trafic) ne changent pas.

## 3. Tableau : emplacement / icône / texte / justification

Icône seule = `aria-label` + info-bulle (`title`) obligatoires. Lucide : nom entre accolades.

### Commandes de carte (24 px)
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Zoom + / − | `plus` / `minus` | seule | universel |
| Recentrer (◎) | `locate-fixed` | seule | universel ; état actif = encre + barre jaune |
| Couches | `layers` | seule | universel (déjà en place) |
| Tracer (✎) | `pencil` | seule — **exception à valider** | pas universel, mais le crayon est le standard « modifier » des cartes ; sinon `pencil` + « Tracer » sous l'icône |
| Orientation N / ↑ | `compass` | seule | remplace `N` / `↑` ; état = actif (cap en haut) ou non (nord en haut), annoncé par l'`aria-label` |
| Pastille de route active | `route` (16 px, magenta) | avec texte (nom) | remplace le `◆` ; un seul sens = « route » |
| Barre d'aperçu | `eye` (16) | avec texte « Aperçu » | distingue l'aperçu de la route suivie |

### Navigation principale et onglets (20 px)
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Barre : Direct | `navigation` | avec texte | « direct vers » ; même icône partout |
| Barre : Route | `route` | avec texte | |
| Barre : Plus | `ellipsis` | avec texte | menu |
| Barre (bureau) : Avion, Météo, Vol, Docs, Données, Réglages | `plane`, `cloud-sun`, `timer`, `file-text`, `database`, `settings` | avec texte | reconnaissance rapide ; le texte reste obligatoire |
| Onglets Route / Log / NOTAM | `route`, `clipboard-list`, `scroll-text` | avec texte (icône au-dessus sur les barres de 5) | onglets = icône + texte (règle 4) |
| Onglets Météo : Briefing, METAR, TAF, SIGMET, Vents | `newspaper`, `cloud`, `calendar-clock`, `cloud-lightning`, `wind` | avec texte, icône au-dessus | 5 onglets étroits sur téléphone |
| Onglets Avion : Fiche, Centrage, Carburant | `id-card`, `scale`, `fuel` | avec texte | |
| Onglets Vol : Chrono, Traces | `timer`, `history` | avec texte | |
| Retour de l'écran | `arrow-left` | seule | universel ; texte conservé pour « ← Documents » / « ← Traces » (destination utile) |
| Fermer (feuilles, tiroirs) | `x` | seule | universel ; **plus jamais utilisé pour « supprimer »** |

### Fiches terrain et menu rond
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Menu rond : Direct, Infos, VAC, + Route | `navigation`, `info`, `map`, `map-pin-plus` (24) | avec texte | icône + libellé déjà présent ; remplace `➤ i VAC +` |
| En-tête de fiche : Direct | `navigation` | avec texte | primaire |
| Sections : Altitude, Pistes, Fréquences, Météo, NOTAM, VAC | `mountain`, `runway` (dessinée), `radio`, `cloud`, `scroll-text`, `map` (16) | avec titre | remplacent `☁ ◆ ▬` ; le liseré de couleur de catégorie reste |
| Radio principale | `star` (16, pleine) | avec la fréquence | remplace `★` |

### Indicateurs d'état
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Bandeau alerte / prudence / information | `triangle-alert` / `diamond-alert` (dessiné si absent) / `info` (20) | avec message | forme + couleur, remplace `▲ ◆ ■` |
| Catégories de vol, espaces traversés, badges d'état | `circle-check`, `diamond-alert`, `triangle-alert` (16) | avec libellé | remplace `● ◆ ▲ ✓` |
| Pastille GPS | point-forme existant (cercle, losange, triangle) | avec texte | la forme est déjà l'état ; pas d'icône de satellite en plus |
| Données périmées (bandeau, écran Données) | `database` + statut | avec texte | |
| Réseau / hors ligne | `wifi-off` | avec texte | **n'existe pas encore** (EFB-16) : à ajouter seulement avec l'indicateur |
| Mode | — | — | pas de « mode vol » (retiré) |

### Routes
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Nouvelle route | `plus` | avec texte | primaire |
| Activer / Désactiver | `play` / `square` | avec texte | démarrer / arrêter le suivi (même sens que Démarrer / Arrêter le chrono et l'enregistrement) |
| Menu « ⋯ » de la ligne | `ellipsis` | seule | universel |
| Renommer, Dupliquer, Inverser | `text-cursor-input`, `copy`, `arrow-left-right` | avec texte | actions du menu = icône + texte |
| Exporter (GPX…) / Importer | `download` / `upload` | avec texte | |
| Supprimer | `trash-2` (rouge) | avec texte | destructif |
| Supprimer un point | `trash-2` | seule | universel, **distinct de « fermer »** |
| Monter / descendre un point | `chevron-up` / `chevron-down` | seule | liste ordonnée, universel |
| Direct (point) | `navigation` | avec texte | |
| Réinitialiser vent (↺), recharger (↻) | `rotate-ccw`, `refresh-cw` | seule + info-bulle | |
| Recherche (liste, stations, terrains) | `search` (16, dans le champ) | seule | universel |

### Boutons principaux et secondaires (20 px)
| Emplacement | Icône | Texte | Justification |
|---|---|---|---|
| Mettre à jour maintenant | `refresh-cw` | avec texte | primaire |
| Télécharger la zone | `download` | avec texte | |
| Dossier de vol PDF, PDF du log | `file-down` | avec texte | |
| Démarrer / Arrêter (chrono, compte à rebours, enregistrement) | `play` / `square` | avec texte | même sens que Activer / Désactiver |
| Replier / déplier une section | `chevron-right` / `chevron-down` (16) | avec titre | remplace `▸ ▾` |
| Pager document | `chevron-left` / `chevron-right` | seule | universel |

## 4. Où il vaut mieux ne PAS mettre d'icône

| Emplacement | Pourquoi |
|---|---|
| Grille de données en vol (6 cases) | le libellé en 12 px et le chiffre en 32-40 px se lisent d'un coup d'œil ; une icône ajouterait du bruit |
| Puces d'unités (kt, km/h, ft, hPa…) et champs numériques | le texte est déjà la donnée |
| Tableaux (Log, NOTAM, PDF) | denses, déjà organisés par colonnes |
| Symboles de la carte (terrains, VRP, obstacles, balises, avion, trafic) | conventions OACI : PNG existants, pas la bibliothèque |
| Libellés de bandeau, toasts, textes d'aide | le message suffit ; l'icône d'état du bandeau suffit |
| Badges très courts (« à vérifier », « ACTIVE ») sauf forme d'état | déjà un mot, une forme suffit |
| Plusieurs icônes sur une même ligne de menu | une icône = une action ; pas de décoration |
| Boutons de langue, de thème (« English », « Nuit ») | texte clair ; une icône lune / soleil ne ferait que doubler |

## 5. Décisions à valider avant de coder

1. **Lucide** (copiée dans l'appli, ~40 icônes, aucune dépendance), trait 2 px constant, extrémités carrées. OK ? (planche de contrôle d'abord)
2. **Exceptions « icône seule »** hors liste universelle : `pencil` (Tracer), `compass` (orientation), `chevron-up/down` (ordre des points), `refresh-cw` / `rotate-ccw`. OK ?
3. **Fin des glyphes ambigus** : `✕` ne veut plus dire « supprimer » (→ corbeille) ; `◆` ne sert plus qu'à la prudence ; `↑` ne sert plus qu'à… rien (→ chevrons). OK ?
4. **Activer / Désactiver** = `play` / `square`, comme Démarrer / Arrêter. OK ?
5. **Barre du haut avec icônes** sur téléphone (Direct, Route, Plus) : elle reste sur une ligne ; sur ordinateur, 8 entrées avec icône + texte.
6. **Réseau / hors ligne** : seulement quand l'indicateur existera (hors de ce chantier).

---

## 6. Implémenté (les 6 décisions validées)

- **`ui/iconData.ts`** : 57 icônes Lucide 0.468.0 (ISC) + `diamond-alert` et `runway` dessinées dans le même style. **`ui/Icon.tsx`** : trait 2 px constant (`vector-effect: non-scaling-stroke`), extrémités et jointures carrées, 3 tailles (16 / 20 / 24), `currentColor`. **`Button`** accepte `icon` ; une icône seule exige un `aria-label`, qui sert aussi d'info-bulle. Planche de contrôle : `apps/app/design-icones.html`.
- **Commandes de carte (24 px, info-bulle)** : `plus`, `minus`, `locate-fixed`, `pencil`, `compass`, `layers`. **Barre du haut** : icône + texte (`navigation`, `route`, `ellipsis`, `plane`, `cloud-sun`, `timer`, `file-text`, `database`, `settings`). **Onglets** : icône au-dessus du texte. **Retour** : `arrow-left` seule. **Fermer** : `x` seule ; **supprimer** : `trash-2` (plus de `✕` pour supprimer).
- **États** : bandeaux `triangle-alert` / `diamond-alert` / `info` ; catégories de vol et badges `circle-check` / `diamond-alert` / `triangle-alert` ; notes d'information `info` (bleu) ; sections repliables `chevron-right` / `chevron-down` ; catégories de fiches (`scroll-text`, `cloud`, `cloud-lightning`, `runway`, `radio`, `mountain`, étoile pleine). Les glyphes CSS (`▲ ◆ ■ ● ☁ ▬`) ont été retirés.
- **Routes** : `play` / `square` (Activer / Désactiver, comme Démarrer / Arrêter), `ellipsis`, `text-cursor-input`, `copy`, `arrow-left-right`, `download`, `trash-2`, `upload`, `plus`, `eye`, `pencil`, `file-down`, `route` (pastille), `chevron-up` / `chevron-down` (ordre des points).
- **Vérifié** : carte, Route (liste, menu ⋯), Météo à 375 px (onglets 75×56 px, pas de débordement), fiche terrain et menu rond, 579 tests.
- **Pas fait / à revoir** : boutons secondaires de plusieurs écrans restés en texte seul (Docs, Avion, Réglages, assistant de calage) ; compteurs `+ −` d'autres écrans ; vérification en mode nuit et sur téléphone réel ; les symboles de la carte (PNG OACI, avion, trafic) sont inchangés comme prévu.
