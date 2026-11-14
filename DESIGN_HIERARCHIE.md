# L!M VFR Nav — Hiérarchie visuelle (étapes 1 à 3, en attente de validation)

Aucun fichier de code n'a été modifié. DA inchangée : on réutilise `tokens.css`, on propose des jetons de rôle seulement là où la sémantique manque.

## 1. Inventaire

### 1.1 Boutons (157 `<button>` dans les `.tsx`, 81 sans classe)
Un seul style de base (`button`, `styles.css:16`) : 56 px, capitales condensées 20 px, filet d'encre, fond `--field`. Variantes réelles :

| Famille | Classe / sélecteur | Taille | Style | Usage |
|---|---|---|---|---|
| Défaut | `button` | 56 px, 20 px | contour encre, fond papier | tout ce qui n'a pas de classe (81) |
| « Brand » | `.brand` (26 + `.btn-inline.brand`) | 56 px | **plein jaune** | « Nouvelle », « Dessiner », « Dossier », « Direct vers », « Terminé », « Modifier », « Installer », « Télécharger », « Arrêter », « Stop », « Analyser », « PDF », « Oui, dupliquer », « Voir la fiche »… |
| Inline | `.btn-inline` (18) | 40 px, 14 px | idem défaut, plus petit | actions de ligne, bandeau d'annulation |
| Bascule | `[aria-pressed=true]` | 56 px | **plein jaune** + liseré intérieur | Calques, ◎, ✎, N, onglets actifs |
| Case | `.tgl` (7) | 56 px | pastille ✓ jaune | options des calques |
| Carte | `.mapctl button` | 56×56, 28 px | ombre dure | +, −, ◎, ✎, N |
| Onglets | `.tabs button` | 72 px | pleine largeur | sous-onglets d'écran |
| Cellule | `button.cell` | 72 px | grille de données | 6 cases de vol |
| Ligne | `.row`, `.dirrow`, `.choices>button` | 56 px | alignées à gauche | listes |
| Destructif | `ConfirmButton` (12 emplois) | 56 px | **identique au défaut**, puis **jaune « Confirmer »** | supprimer |
| `.primary` | `button.primary` | — | encre pleine | **défini mais jamais utilisé** |

### 1.2 Typographie
Boutons : Archivo condensé 700 capitales 20 px. Titres d'écran 32 px / feuille 28 px (Archivo 800). Étiquettes h3 : Plex Mono 14 px capitales. Corps : Plex Sans 16 px. Données de vol : Plex Mono 600, 32 px (40 px ≥ 1100), chiffres tabulaires. Tailles utilisées : 12 ×15, 14 ×24, 16 ×15, 20 ×9, 24 ×5, 28, 32, 40, 64, + 4 paliers fluides (Log/NOTAM). Quasi tout passe par `--fs-*` ; 3 valeurs en dur (`40px`, `20px`, `12px`).

### 1.3 Couleurs
- Jetons : papier / champ / encre / encre atténuée / filet, `--brand` jaune, `--signal` rouge, `--zone-*`, `--data-figure`, `--route` vert, `--direct` magenta.
- **Jaune (`--brand`) a 7 sens** : action principale (`.brand`), état actif (`aria-pressed`), confirmation de suppression, bandeau de prudence, point de route sélectionné, titres de section (liseré), pastille ✓, cellule active du Log.
- **Rouge (`--signal`)** : avion, alerte bandeau, GPS perdu, trafic. Jamais le destructif.
- **Pas d'orange** : « prudence » = jaune (donc même couleur que l'action principale).
- Vert = route sur la carte ; magenta = « direct vers » (pas « route active »).
- Valeurs en dur : surtout `MapView.tsx` (≈ 20 couleurs de symboles OACI, voulu : elles imitent la carte papier) ; `LogSheet`/`DocsScreen` quelques styles en ligne de grille.

### 1.4 Espacements
Échelle `--sp-1…6` (4, 8, 12, 16, 24, 32) bien respectée ; reste : `gap: 2px` ×7, `padding: 2px` ×3, `1px`, `6px 4px`, `26px` (tableaux du Log et symboles). À aligner sur l'échelle ou à justifier comme « filet ».

### 1.5 Doublons et incohérences à signaler
1. **Sept sens pour le jaune** (voir 1.3) : « Confirmer la suppression » ressemble à « Nouvelle route ».
2. **Plusieurs boutons jaunes par écran** : l'écran Route en a jusqu'à 3 (Nouvelle, Dessiner, Dossier), Aéronef 3, Traces 2–3. Aucun n'est « le » primaire.
3. **Destructif sans signal** : « Supprimer » = bouton ordinaire placé à côté des autres ; rouge absent.
4. **Pas de taille « vol » vs « prépa »** : 56 px partout, y compris la prépa ; `.btn-inline` 40 px est un troisième cas non nommé.
5. **`.primary` mort**, `.brand` fait office de primaire ET d'accent.
6. **Capitales condensées 20 px pour tous les libellés**, du bouton « Direct » au lien « Effacer ».
7. **Trois hauteurs de zone tactile** (56 / 72 / 40) sans règle.

## 2. Classement par rôle

| Rôle | Boutons (exemples) | Justification | Aujourd'hui |
|---|---|---|---|
| **Critique en vol** | Direct (barre), Calques, ◎, N, +/− ; cellules de la grille de données | Toujours visibles, une main | 56 px, même style que le reste |
| **Primaire** (1 par écran) | Route : *Nouvelle route* (liste) / *Dossier* (détail) ; Aéronef : *Terminé* ; Données : *Installer* ; Traces : *Arrêter* pendant l'enregistrement ; NOTAM : *Analyser* ; fiche terrain : *Direct vers* | L'action qui fait avancer le parcours | `.brand` partout, 2–3 par écran |
| **Secondaire** | *Dessiner*, *Modifier*, *PDF*, *Exporter*, *Dupliquer*, *Voir la fiche*, onglets | Utiles, pas principales | `.brand` ou défaut |
| **Tertiaire** | *Effacer l'import*, *Réinitialiser*, ✕ de fermeture, liens de réglage | Rares ou confort | défaut 56 px |
| **Commandes carte** | +, −, ◎, ✎, N | Icône seule, même famille | déjà homogène (bon) |
| **Destructif** | Supprimer route / point / trace / données (12 emplois) | Jamais près du primaire, jamais jaune | défaut → jaune « Confirmer » |
| **Bascule / état** | Calques (`.tgl`), ◎, N, ✎, onglets actifs | État lisible sans lire | jaune = actif, mais jaune aussi = primaire |

## 3. Système proposé (à valider)

### 3.1 Boutons
| Rôle | Hauteur | Remplissage | Couleur | Texte | Notes |
|---|---|---|---|---|---|
| Primaire | 56 (prépa) / 64 (vol) | **plein jaune** | `--brand` / `--on-brand` | Archivo cap. 20 | **un seul par écran/panneau**, couleur réservée au primaire |
| Secondaire | 56 → **48** en prépa | contour encre, fond champ | neutre | Archivo cap. 16 | remplace le `.brand` des actions non principales |
| Tertiaire | 40 | fantôme (sans fond ni cadre, soulignement au toucher) | encre atténuée | Plex Sans 14, casse normale | plus de capitales |
| Critique vol | 64 | contour encre 2 px, fond champ | neutre | Archivo cap. 20 | barre Direct/Calques, grille de données |
| Commande carte | 56×56 | fond champ, ombre dure | neutre | icône 28 | inchangé |
| Destructif | 48 | contour **rouge**, texte rouge ; une fois armé : plein rouge | `--signal` (le rouge reste « alerte / danger ») | Archivo cap. 16 | placé à l'écart (bas de fiche, à droite) |
| Bascule actif | idem rôle | **plein encre** (`--ink`/`--on-ink`) + coche ou icône pleine | neutre | — | **ne plus utiliser le jaune pour « actif »** |
États : survol `--paper-2` ; appui encre inversée ; désactivé 45 % ; actif = encre pleine ; chargement = libellé « … » + curseur d'attente ; focus = anneau 3 px existant.
Tailles : **vol = 56–64**, **prépa = 48**, **compact = 40** (jamais en vol), seuls trois niveaux, nommés par jetons (`--h-flight`, `--h-prep`, `--h-compact`).

### 3.2 Échelle typographique (6 niveaux)
| Niveau | Police | Taille / graisse | Interligne | Couleur |
|---|---|---|---|---|
| Donnée de vol XXL | Plex Mono, tabulaire | 40 (24 mobile) / 600 | 1,1 | `--data-figure` |
| Titre d'écran | Archivo cond. | 32 / 800, capitales | 1,1 | `--ink` |
| Sous-titre / titre de bloc | Archivo cond. | 24 / 800 (remplace le 28) | 1,15 | `--ink` |
| Corps | Plex Sans | 16 / 400 | 1,4 | `--ink` |
| Label | Plex Mono | 14 / 600, capitales, +0,08 em | 1,2 | `--ink-muted` |
| Légende | Plex Mono | 12 / 500 | 1,2 | `--ink-muted` |
Les valeurs 20 et 28 disparaissent des textes ; 20 reste réservé aux libellés de boutons primaire et critique. Les paliers fluides du Log / NOTAM restent (cas de tableau dense).

### 3.3 Couleurs par rôle
| Sens | Couleur | Règle |
|---|---|---|
| Action principale | `--brand` jaune | **uniquement** le bouton primaire (+ liseré de titre de section si on veut garder la touche de marque) |
| Neutre / secondaire / actif | encre, champ, papier | actif = encre pleine |
| Destructif et alerte critique | `--signal` rouge | jamais pour autre chose |
| Prudence | **nouveau jeton** `--caution` (orange ambré, ex. `#e0820a` jour / `#f0a030` nuit, contraste ≥ 4,5:1 avec `--ink`) | bandeau de prudence, badges « à vérifier » |
| Route | `--route` vert (route) ; `--direct` magenta (direct vers) | **tu avais demandé « magenta = route active »** : dans l'appli la route est verte et le magenta est le Direct. Je propose de garder ainsi (changer ferait rompre avec la carte actuelle) — à confirmer |
| OK / bon | `--zone-good` | statuts seulement |

### 3.4 Espacements
Échelle unique inchangée : 4 · 8 · 12 · 16 · 24 · 32. Règles : lié = 8, groupe = 16, section = 24, bord d'écran = 16. Les `2px`/`1px` restants deviennent des filets (`--hair`) ou passent à 4.

### 3.5 Surfaces
3 niveaux : **carte** (fond), **panneau** (`--field`, filet 3 px), **surélevé** (`--shadow-pop`, feuilles, menus, commandes carte). Pas d'autre ombre.

## Décisions à prendre avant d'appliquer
1. Jaune réservé au primaire, et « actif » en encre pleine (au lieu de jaune) : OK ?
2. Nouveau jeton `--caution` orange pour la prudence (bandeau jaune actuel → orange) : OK ?
3. Destructif en rouge contour / plein rouge armé : OK ?
4. Route verte et Direct magenta conservés (au lieu de « magenta = route active ») : OK ?
5. Taille prépa 48 px (au lieu de 56) pour secondaire et destructif ; 56–64 px gardés pour le vol : OK ?

---

## 4. Appliqué (validation des 5 décisions reçue)

- **Jetons** (`tokens.css`) : `--caution` (jour `#e0820a`, nuit `#f0a030`, texte `--on-caution` sombre), `--h-flight` 64, `--h-prep` 48. Le reste réutilise les jetons existants.
- **Composants** : `ui/Button.tsx` (`role` primary / secondary / tertiary / critical / danger ; `size` flight / prep / compact), `ui/Text.tsx` (6 variantes), `ConfirmButton` en rouge (armé = plein rouge). 41 boutons migrés vers `Button` ; les autres gardent le style neutre par défaut (secondaire 48 px).
- **Jaune réservé au primaire** : les 26 anciens `.brand` ont été triés (1 primaire par vue ; « Modifier », « Dessiner », « Annuler »… passent en secondaire). Actif / sélectionné = encre pleine (boutons, cellules, calques, onglet courant du Log). Prudence = orange (bandeau, badges, trafic niveau 1). Liserés de titres = encre.
- **Vol** : Direct et Calques à 64 px ; fiche terrain « Direct vers » 64 px, pleine largeur.
- **Destructif** : rouge, à l'écart (fiche d'un point : fin de rangée) ; double confirmation inchangée.
- **Taille** : bouton de base 56 → 48 px (prépa) ; primaire 56 ; compact 40.
- **Vérifié** : un seul primaire visible sur Route (liste, détail), Log, NOTAM, Données ; aucun débordement horizontal à 375 px ; 571 tests, `tsc` propre.
- **Gardés en jaune volontairement (carte)** : halo du point de route sélectionné, repères de calage des cartes VAC, bouton central du menu terrain (c'est le « Direct »).
- **Pas fait / à revoir** : `Text` n'est pas encore utilisé dans les écrans (les titres h2/h3 suivent déjà les mêmes tailles par CSS) ; ~110 boutons sans classe restent « secondaire » par défaut sans passer par `Button` ; vérification visuelle en mode nuit non faite ; fiche terrain et feuille « Direct » vues seulement en maquette.

## 5. Couleur avec intention (appliqué)

Nuancier : `apps/app/design-couleurs.html`. Palette (jour / nuit) :
accent `--brand` (primaire) · route active `--route` / `--direct` `#c2188c` (UI nuit `--route-ink` `#ee5fc0`) · alerte `--signal` · prudence `--caution` · OK `--zone-good` · info `--info` `#1f55b8` / `#7aa9ff` · catégories `--cat-notam` violet, `--cat-meteo` teal, `--cat-piste` brun (fréquences neutres).

- **Actif / sélectionné** : encre pleine + barre jaune de 5 px (boutons, cellules, onglets, calques, case du Log, commandes de carte).
- **Route** : magenta plein sur la carte (liseré `#4d0a3a`), « direct vers » magenta tireté ; le vert n'est plus utilisé pour la route. Pastille « ◆ ACTIVE » magenta dans la liste.
- **États avec forme + libellé** : bandeaux ▲ alerte / ◆ prudence / ■ information ; puce GPS en cercle / losange / triangle ; catégories de vol ● VFR, ◆ MVFR (orange), ▲ IFR (rouge), ▲▲ LIFR ; espaces traversés ▲ dedans, ◆ niveau inconnu ; données ✓ à jour (vert) ou ◆ à vérifier (ambre foncé).
- **Catégories** : liseré + symbole dans les fiches NOTAM (◆), météo (☁), pistes (▬). Information neutre (source, cycle AIRAC) : barre bleue + « ■ i ».
- **Part colorée hors carte, mesurée dans l'aperçu (fenêtre ~800×685)** : carte 5 % · Route liste 8 % · Docs 8 % · Données 6 % · Réglages 5 % · Log / NOTAM / Avion / Météo ≈ 1 %. Vol 13,5 % avant correction (« Arrêter l'enregistrement » en jaune) : le primaire est maintenant « Démarrer l'enregistrement », l'arrêt est secondaire.
- **Pas vérifié** : écrans avec données réelles (NOTAM, fiches terrain, SIGMET) ; la deutéranopie n'a été simulée que sur le nuancier.
