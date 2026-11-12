# Audit UX « application de navigation VFR » — L!M VFR Nav

Audit en lecture seule : aucun fichier de l'application n'a été modifié. Le rapport de l'audit précédent (CSS, accessibilité générale, contrastes) est conservé dans `AUDIT_UI_UX_GENERAL.md` ; celui-ci le complète sans le répéter.

Date : 12/11/2026. Référentiel : pratiques courantes de SkyDemon, SDVFR, Enroute Flight Navigation, Air Navigation Pro et XCSoar, **d'après mes connaissances de ces applications, sans les avoir rouvertes pour cet audit**. Quand je cite une application comme référence, c'est pour une fonction que je sais qu'elle propose ; vérifie-la si tu t'en sers comme cahier des charges.

**Contexte retenu** (le champ « Stack » était vide) : React 19 + Vite 7, MapLibre GL 5, CSS maison (`src/ui/tokens.css`, `src/styles.css`, aucun kit), PWA + coque Capacitor Android, données OACI/SIA/openAIP hors-ligne. Utilisateur : pilote seul, tablette ou téléphone, une main, turbulences, plein soleil, gants.

**Méthode et limites.** Lecture du code, relevés dans le navigateur intégré (375, 1000 px, thème nuit, simulation de perte GPS), calculs de contraste. **Non fait** : test sur tablette ou téléphone réels, test en vibration ou au soleil, test avec un vrai GPS, test lecteur d'écran. Les scénarios ci-dessous sont déroulés sur le code et sur le simulateur, pas en vol.

---

## 1. Résumé : les 5 problèmes qui comptent le plus

1. **Aucun mode Vol.** La route reste modifiable en vol : le crayon ✎ est à côté du bouton N, un appui sur la carte ajoute un point, les points se déplacent au doigt (`App.tsx:1189`, `MapView.tsx:474, 674`). En turbulence, un appui parasite modifie la route active. Les dix boutons de préparation restent visibles en vol.
2. **Aucune alerte d'espace aérien en vol** (ni d'obstacle ni de NOTAM). L'appli affiche les espaces mais ne prévient pas d'une entrée prochaine, alors qu'elle connaît déjà la position, la vitesse et un vecteur à 1, 2 et 5 minutes.
3. **Le mode nuit n'assombrit pas la carte.** L'interface passe en sombre, mais la carte aéro reste en pleine luminosité (capture faite) : éblouissement au crépuscule, perte de la vision nocturne.
4. **Les messages de la bannière ne sont pas hiérarchisés par gravité** : un message d'information (VAC, `vacMsg`) passe avant l'alerte « GPS perdu » (`App.tsx:1030-1041`) ; et les données aéro périmées ne sont signalées nulle part sur la carte (`App.tsx:1470`, écran Données seulement).
5. **Le bandeau de données manque l'essentiel de la nav** : pas d'ETA, pas de destination finale (distance, ETE, ETA), non personnalisable (`App.tsx:1003`). Et retrouver la fréquence du prochain espace passe par un double appui précis (350 ms, 32 px, `MapView.tsx:368`) ou par la lecture des étiquettes de la carte.

**Ce qui marche bien** : recentrage ◎ et bascule N/↑ en un appui avec état visible, vecteur vitesse à 1/2/5 min, bandeau de chiffres lisible (13:1), valeurs remplacées par des tirets sans position, fiche terrain qui va à l'essentiel d'abord, toutes les suppressions confirmées ou annulables, perte GPS signalée sans bloquer l'usage.

---

## 2. DA extraite, incohérences et conflits avec la sémantique aéro

### Tokens (source : `src/ui/tokens.css`)

| Famille | Valeurs |
|---|---|
| Couleurs jour | `--paper #f3f1ea`, `--paper-2 #eae7dd`, `--field #fbfaf6`, `--ink #15191d`, `--ink-muted #42484d`, `--hair #b8b3a4`, `--brand #ffd700`, `--signal #c8321e`, `--zone-good #2f6b3a`, `--zone-warn #7a5200`, `--zone-bad #9a3b2b`, `--data-figure #0a2a66`, `--route #22d65f`, `--route-casing #04331a`, `--direct #c2188c` |
| Couleurs nuit | `--paper #15191d`, `--field #101417`, `--ink #f3f1ea`, `--signal #ee6a53`, `--zone-good #8cbf7b`, `--zone-warn #e0b24a`, `--zone-bad #e58c79`, `--data-figure #c7dcff` (route / direct inchangés) |
| Typographie | Archivo condensé (titres, boutons), IBM Plex Sans (texte), IBM Plex Mono (valeurs) ; `--fs-12/14/16/20/24/28/32/40/64` + 4 tailles fluides |
| Espacement | `--sp-1…6` = 4, 8, 12, 16, 24, 32 px |
| Rayon, filets, ombre | `--r 2px`, filets 3 px / 1 px, `--shadow-pop` (décalage plein) |
| Hauteurs | `--h-control 56`, `--h-touch 44`, `--h-compact 40`, `--h-strip 72` |
| Mouvement | aucune transition CSS ; caméra de la carte 250-900 ms (0 si mouvement réduit) |

Incohérences : voir `AUDIT_UI_UX_GENERAL.md` §2 (corrigées pour la plupart). Reste : couleurs de la carte OACI (orange `#f8a000`, jaune `#fff200`, bleu, rouge) définies dans le code de la carte, hors tokens, par fidélité à la légende.

### Conflits avec la sémantique aéro (signalés, non corrigés)

- **Magenta = route active** est la convention des applis de nav. Ici la route est **verte** (`--route`) et le **magenta** est le « direct vers » (`--direct`). Choix assumé de ta part pour la lisibilité ; à garder en tête pour un pilote habitué à SkyDemon ou Garmin.
- **Rouge** : `--signal` sert à la fois à l'avion (`styles.css:44`, `.plane svg`) et aux alertes, alors que la carte OACI emploie du rouge pour les zones réglementées. L'avion rouge se confond avec les hachures rouges d'une zone R/D.
- **Jaune de marque** (`--brand`) porte trois sens à la fois : bouton sélectionné (`button[aria-pressed]`), action principale (`.brand`) et bandeau d'information « prudence » (`.banner:not(.alert)`). Dans la sémantique aéro, jaune/orange = prudence.
- **Vert** : `--zone-good` (OK) et la route (`--route`) sont deux verts différents pour deux sens ; la route verte sur zone rouge hachurée est le cas le plus fragile pour un deutéranope (atténué par le liseré sombre).
- **Orange** : absent de l'interface (la carte l'utilise pour les villes). Aucun niveau « prudence » distinct entre le jaune de marque et le rouge d'alerte.

---

## 3. Grille de conformité (A à J)

Statuts : **conforme** / **partiel** / **absent** / *non vérifié*.

### A. La carte d'abord

| Point | Statut | Constat et emplacement |
|---|---|---|
| Carte visible en permanence | **partiel** | ≥ 1100 px : panneau de 600 px à côté de la carte (`styles.css` ~l.174). En dessous (téléphone, tablette portrait), chaque écran est **plein cadre** (`.screen {inset: 0}`, `styles.css:108`), avec « ← Retour » en un appui. Les fiches couvrent jusqu'à 70 % de la hauteur (`.sheet`, `styles.css:62`). |
| Rien ne masque l'avion | **partiel** | Un appui sur un terrain coupe le suivi (`App.tsx:451`) ; une fiche à 70 % peut cacher la position. |
| Overlays ordonnés alertes > prudence > info | **partiel** | Une seule bannière à la fois, avec une chaîne de priorité (`App.tsx:1030-1041`), mais mal ordonnée : un message VAC (info) précède « GPS perdu » (alerte). |
| Recentrage clair | **conforme** | Bouton ◎ en bas à gauche, jaune quand le suivi est actif ; un déplacement à la main coupe le suivi (`onUserMove`, `App.tsx:1074`) ; un appui recentre. |
| Nord / route en haut | **conforme** | Bouton N ↔ ↑ à côté (`App.tsx:1190`). |
| Vecteur vitesse avec repères de temps | **conforme** | Points à 1, 2 et 5 minutes (`SPEED_VECTOR_MINUTES`, `config.ts:19`). |

### B. Séparation prépa / vol

| Point | Statut | Constat et emplacement |
|---|---|---|
| Deux modes distincts, on sait lequel on est | **absent** | Aucun état « mode » (recherche `flightMode`, `inFlight` : rien). Le décollage est détecté (`recorder.takeoffMs`) mais ne change pas l'interface. |
| Route protégée en vol | **absent** | `editMode` activable à tout moment ; en mode tracé un appui ajoute un point (`MapView.tsx:474`) et les points deviennent déplaçables (`MapView.tsx:674`). |
| Seules les commandes de vol visibles | **absent** | Barre de 10 boutons toujours affichée (`App.tsx:1018`) : sur téléphone, Direct, Calques, Route + Plus (Avion, Météo, Vol, Docs, Données, Réglages). |

### C. Création de nav (prépa)

| Point | Statut | Constat et emplacement |
|---|---|---|
| Taper des points, glisser un point | **conforme** | `MapView.tsx:474, 674`, avec aimantation sur terrains, balises, reports et noms de villes. |
| Glisser un segment pour insérer un point | **absent** | Aucune insertion par segment (recherche : rien dans `MapView.tsx` / `routeEdit.ts`). Pour insérer, il faut ajouter à la fin puis monter avec ↑ / ↓. |
| Saisie clavier (OACI, VRP, nom) | **absent** | Pas de champ pour ajouter un point à la route. La recherche par nom ou OACI n'existe que dans la fiche « Direct » (`NavScreen.tsx` ~l.555) ; le menu rond d'un terrain propose « Route ». |
| Log synchronisé avec la carte | **conforme** | Calculé à partir de la route active (`LogSheet`, `computeNavLog`). |
| Inverser, multi-étapes | **conforme** | « Inverser » dans le détail de la route ; points illimités. |
| Simulation de la nav avant le vol | **absent** | Seul le simulateur de développement `?sim`, non exposé. |
| Profil vertical (terrain, espaces, altitude au doigt) | **absent** | L'onglet « Profil » a été retiré faute de fonction ; les altitudes se saisissent à la main par point. |
| Alertes de prépa regroupées et cliquables | **partiel** | NOTAM dans un onglet, espaces traversés dans le Log (`NavScreen.tsx`), obstacles absents ; deux endroits, aucun élément cliquable vers la carte. |

### D. Bandeau de données en vol

| Point | Statut | Constat et emplacement |
|---|---|---|
| Prochain point : nom, cap, distance, ETE | **conforme** | `App.tsx:1003` : GS, route, point, altitude, relèvement, distance + ETE. |
| ETA du prochain point, destination (dist, ETE, ETA) | **absent** | Aucune cellule. |
| Lisible en 1 s | **conforme** | Chiffres à `--fs-32` mono, unités discrètes en étiquette, contraste 13:1 (jour). |
| Invalide = tirets, jamais figé | **conforme** | Sans position : `---`. Périmé (> 5 s) : atténué à 65 % avec « Position vieille de N s » ; au-delà de 15 s, état « perdu » (`config.ts:7-10`). |
| Précision cohérente avec la réelle | *non vérifié* | Vitesse et altitude affichées entières ; je n'ai pas comparé à la précision du GPS. |
| Champs personnalisables par appui long | **absent** | Un appui sur une cellule ouvre le choix d'unité (`openCell`), pas le choix de la donnée. |

### E. Interrogation de la carte

| Point | Statut | Constat et emplacement |
|---|---|---|
| Appui long listant tout ce qui est dessous | **absent** | Le geste est un **double appui** (350 ms, 32 px, `MapView.tsx:368`) ; il liste espaces et terrains seulement (`App.tsx:463-475`), sans NOTAM ni obstacles ; titres de couche « Espace aérien » / « Terrain » écrits en français dans le code, hors traduction. |
| Fiche terrain : l'essentiel d'abord | **conforme** | Altitude, pistes, fréquences, puis météo, NOTAM, VAC (`AdMenu.tsx`). |

### F. Sécurité et situations dégradées

| Point | Statut | Constat et emplacement |
|---|---|---|
| Terrains les plus proches en un appui, utilisables en direct | **partiel** | « Direct » (1 appui) liste 6 terrains publics par distance (`NavScreen.tsx:559`), un appui = direct. Mais **ni relèvement, ni piste, ni fréquence, ni météo** dans la liste. |
| Alertes espaces / NOTAM / obstacles en vol | **absent** | Recherche d'alertes de proximité : rien. |
| Perte GPS | **conforme** | Pastille « GPS FAIBLE / PERDU » + bannière + tirets (`App.tsx:1030`). |
| Absence de réseau | **absent** | Aucun indicateur « hors ligne » ; l'usage hors-ligne fonctionne mais n'est jamais dit. |
| Données périmées (cycle AIRAC) | **partiel** | Avertissement dans l'écran Données seulement (`App.tsx:1470`), pas dans la bannière de la carte. |
| Filtre d'altitude des espaces, rappel visible | **absent** | Curseur FL dans le menu Calques (`App.tsx:1335`) ; rien sur la carte quand il est actif : des espaces plus hauts disparaissent sans que ce soit dit. |

### G. Couleurs et lisibilité

| Point | Statut | Constat et emplacement |
|---|---|---|
| Une couleur = un sens, partout | **partiel** | Voir §2 : jaune à trois sens, route verte et magenta pour le « direct », rouge pour l'avion. |
| Saturation réservée à l'important | **partiel** | Carte OACI très saturée par fidélité à la légende ; l'interface, sobre. |
| Texte monochrome | **partiel** | Chiffres de vol en bleu marine (`--data-figure`), avec réglage « En noir » dans Réglages. |
| Plein soleil | **conforme / partiel** | Interface ≥ 8:1 ; sur la carte, les noms de villages en gris clair (`#8c8c8c` sur blanc, ≈ 3,4:1, fidèle à l'OACI) restent faibles. |
| Mode nuit qui préserve la vision | **partiel** | Interface sombre, **carte inchangée** (capture : pleine luminosité). Bascule manuelle (Réglages > Affichage), pas de mode automatique. |
| Information jamais portée par la couleur seule | **partiel** | Pastille GPS et catégories météo ont un texte ; route verte sur zones rouges : risque pour le deutéranope, atténué par le liseré. |

### H. Interaction en cockpit

| Point | Statut | Constat et emplacement |
|---|---|---|
| Cibles ≥ 48 px | **partiel** | 56 px pour la barre, les commandes de carte, les onglets ; **40 px** pour la fermeture ✕ des fiches, « Annuler » du bandeau et les boutons de point (`.btn-inline`, `styles.css:60`). |
| Actions fréquentes à une main, en bas | **partiel** | Commandes de carte et données en bas ; barre d'actions (Direct, Calques) **en haut** ; menu « Plus » en haut. |
| Pas de geste fin ou caché pour une action critique | **partiel** | Interrogation de la carte au double appui ; déplacement de point au glisser (en mode tracé). |
| Pas d'action destructive sans annulation | **conforme** | Confirmation en deux temps, annulation de 6 s pour les points. |
| Zoom et pan sans réajustement constant | **partiel** | Suivi + bascule N/↑ ; zoom automatique non évalué. |
| Rien qui oblige à fixer l'écran | **conforme** | Aucune animation d'interface, aucun texte qui défile. |

### I. Simplicité

| Point | Statut | Constat et emplacement |
|---|---|---|
| Réglages minimaux, pas de doublons | **conforme** | 4 onglets, ~24 libellés `set.*`. Fonds de carte à deux endroits (Calques, Données) mais pour deux usages. |
| Première nav en moins de 5 min | **partiel** | Prérequis non guidés : choisir le pays (bannière), créer un avion (le Log le dit), et le crayon ✎ n'a pas de libellé visible. |
| Une action principale par écran | **partiel** | Oui sur Route (« Tracer sur la carte »), Log, NOTAM ; non sur Calques, Données. |

### J. Bases d'une bonne UI

| Point | Statut | Constat et emplacement |
|---|---|---|
| États vide / chargement / erreur | **conforme / partiel** | Vides et erreurs soignés (Log sans avion, NOTAM, Données) ; chargement de la carte sans indicateur. |
| Feedback immédiat | **partiel** | Inversion `:active` seulement ; pas de transition (choix assumé). |
| Cohérence des composants | **partiel** | Voir `AUDIT_UI_UX_GENERAL.md` UX-09 (interrupteurs). |
| Responsive | **conforme** | Vérifié à 320, 360, 375 et 1000 px ; trois paliers (600, 900, 1100). |

---

## 4. Scénarios

| # | Scénario | Ce qui se passe | Où ça coince |
|---|---|---|---|
| 1 | Préparer une nav de 3 branches à la maison | Route → « Nouvelle route » → « Tracer sur la carte » → 4 appuis sur la carte (aimantation sur les terrains, nom automatique) → retour → Log → choisir un avion → heure et vent se règlent. **≈ 10 appuis** si l'avion existe. | Sans avion : détour par l'écran Avion (≈ 6 appuis + 2 saisies) que rien n'annonce avant le Log. Le crayon ✎ n'a pas de texte. Pas de champ ICAO pour ajouter un point, pas d'insertion par segment. |
| 2 | Au parking : vérifier la nav, passer en mode vol | Route, Log, NOTAM pour vérifier (plein écran, retour en un appui). « Passer en mode vol » : **n'existe pas**. | Aucune bascule, aucun verrou de la route : rien ne distingue le sol du vol. Aucune alerte de prépa unifiée (espaces traversés dans le Log, NOTAM dans un autre onglet). |
| 3 | Croisière, turbulence, une main : fréquence du prochain espace | Les étiquettes des TMA/CTR portent nom, limites et fréquence sur la carte (lisible si l'échelle convient). Sinon : double appui précis (350 ms, 32 px) → fiche à 70 % → lire « Fréquences ». | Aucune liste « espaces devant moi » avec distance, ETE et fréquence ; le double appui en turbulence est le geste le moins fiable. La fiche masque la carte et la position. |
| 4 | Pané et zoomé : revenir sur la position | ◎ en bas à gauche, **1 appui**, état jaune quand actif. | Bien. À noter : une fiche de terrain ouverte coupe aussi le suivi (`App.tsx:451`) sans le dire. |
| 5 | Météo qui se dégrade : se dérouter | « Direct » (1 appui) → liste de 6 terrains par distance → appui = direct. **2 appuis.** | La liste n'indique ni le relèvement, ni la piste, ni la fréquence, ni la météo du terrain ; herbe et dur mélangés ; pas de lien direct vers la météo du terrain avant de choisir. « Direct » est en haut de l'écran. |
| 6 | Le GPS décroche 30 s | À 5 s : chiffres atténués (65 %), « Position vieille de N s », pastille jaune « GPS FAIBLE » ; à 15 s : « GPS perdu » en alerte, chiffres remplacés par des tirets (testé en simulation). | Si un message VAC ou un compte à rebours est en cours, il masque l'alerte « GPS perdu » (priorité de `App.tsx:1030`). Pas d'indicateur de réseau. |
| 7 | Fin de journée : soleil de face, puis crépuscule | Interface lisible (≥ 8:1). Réglages > Nuit : **2 appuis** sur tablette, **3** sur téléphone (derrière « Plus »), bascule manuelle. | Au crépuscule la carte reste en pleine luminosité (capture) : éblouissement et perte de la vision nocturne. Pas de bascule automatique ni de réglage de luminosité de la carte. |

---

## 5. Problèmes

Gravité : **sécurité** (peut induire en erreur ou distraire dangereusement), **fort**, **moyen**, **faible**. Effort : faible (< 1 h), moyen (demi-journée), fort (plusieurs jours).

| ID | Écran | Constat factuel | Impact pour le pilote | Gravité | Effort | Solution compatible avec la DA | Référence |
|---|---|---|---|---|---|---|---|
| EFB-01 | Carte, barre d'outils | Pas de mode Vol : crayon ✎ à côté de N (`App.tsx:1189`), appui carte ajoute un point (`MapView.tsx:474`), points déplaçables (`:674`), 10 boutons toujours affichés (`App.tsx:1018`). | Modification accidentelle de la route active en turbulence ; encombrement en vol. | **sécurité** | moyen | Mode Vol armé au décollage détecté ou à la main (pastille « VOL » / « PRÉPA » visible) : verrouille l'édition, masque ✎ et les écrans de prépa, garde Direct, Calques, ◎, N. Déverrouillage par appui long. | SkyDemon (vues Plan / Fly) |
| EFB-02 | Carte | Aucune alerte de proximité d'espace, d'obstacle ou de NOTAM en vol (recherche dans `App.tsx`, `MapView.tsx` : rien). | Pénétration d'un espace non vu ; l'appli connaît déjà position, route et vecteur 1/2/5 min. | **sécurité** | fort | Bannière « TMA LYON dans 2 min · 135.200 » dans la chaîne existante, calculée avec `airspacesAt` sur le vecteur ; niveaux info / prudence / alerte. | SkyDemon, SDVFR |
| EFB-03 | Carte, mode nuit | Le thème nuit change l'interface ; la carte aéro garde ses couleurs (`MapView.tsx:1216` ne règle que l'avion ; capture en nuit). | Éblouissement au crépuscule, perte de la vision nocturne. | **fort** | faible à moyen | Variante nuit de la carte : atténuation de luminosité du canevas (filtre sur `.map`) + bascule automatique proposée au coucher du soleil (calcul du coucher à reprendre : il existait dans une ancienne version du Log, supprimée). | SkyDemon (mode nuit) |
| EFB-04 | Bannière | Chaîne de priorité unique où l'info précède l'alerte : `cdFired > vacMsg > trafficAlert > GPS perdu > …` (`App.tsx:1030-1041`). | Un message d'information masque « GPS perdu » ; une seule ligne, pas de pile. | **sécurité** | faible | Trier par gravité (alerte > prudence > info) et n'afficher le moins grave qu'en l'absence de plus grave ; compteur « +2 » pour le reste. | — |
| EFB-05 | Carte, Données | Fraîcheur des données (cycle AIRAC) visible seulement dans l'écran Données (`App.tsx:1470`) ; absente de la bannière et de la carte. | Voler avec des espaces périmés sans le savoir. | **sécurité** | faible | Entrée « Données aéro périmées (cycle xx) » dans la bannière (niveau prudence) et pastille discrète sur la carte. | SkyDemon, Enroute |
| EFB-06 | Bandeau de données | Six cellules : GS, route, point, altitude, relèvement, distance + ETE (`App.tsx:1003`) ; pas d'ETA, pas de destination ; un appui ouvre l'unité. | Il faut calculer l'heure d'arrivée et la durée jusqu'à la destination de tête. | fort | moyen | Ajouter ETA du point et bloc destination (distance, ETE, ETA) ; appui long sur une cellule = choisir la donnée affichée (sans doublon). | XCSoar (champs d'info), SkyDemon |
| EFB-07 | Carte | Interrogation par double appui (350 ms, 32 px, `MapView.tsx:368`) ; liste espaces et terrains seulement, titres de couche écrits en dur (`App.tsx:470`). | Geste peu fiable en turbulence ; pas de NOTAM ni d'obstacle ; libellés non traduits. | fort | moyen | Appui long ouvrant une liste « Ici » triée par pertinence (plancher/plafond, fréquence, terrain), titres traduits. | SkyDemon (« What's here ») |
| EFB-08 | Carte | Pas de liste « espaces devant » avec distance, ETE et fréquence ; la fréquence se lit sur les étiquettes de la carte ou via la fiche. | Retrouver une fréquence demande de viser et de lire en vol. | fort | fort | Liste des 3 prochains espaces sur la route ou le cap (nom, distance, ETE, fréquence à contacter) dans une feuille basse de 45 % qui rend la main à la carte. | SkyDemon, SDVFR |
| EFB-09 | Fiche « Direct » | 6 terrains par distance, nom + distance seulement (`NavScreen.tsx:559`). | Pour un déroutement : pas de relèvement, de piste, de fréquence ni de météo avant de choisir. | fort | moyen | Ajouter relèvement (flèche), plus longue piste + revêtement, fréquence principale, point de catégorie météo ; filtre dur/herbe ; garder « un appui = direct ». | Enroute (« Nearby »), SkyDemon (« Nearest ») |
| EFB-10 | Menu Calques | Le filtre d'altitude (`App.tsx:1335-1345`) n'a aucun rappel sur la carte quand il est actif. | Des espaces plus hauts disparaissent sans que le pilote le sache. | fort | faible | Pastille « FL ≤ 115 » à côté de la pastille GPS tant que le filtre n'est pas au maximum. | SkyDemon |
| EFB-11 | Fiches, bandeau d'annulation | `.btn-inline` à 40 px (`styles.css:60`) pour ✕ de fermeture des fiches, « Annuler » et boutons de point. | Cible sous 48 px en vibration ou avec gants. | moyen | faible | `--h-control` (56) pour tout ce qui reste atteignable en vol ; 40 px réservé à la prépa. | — |
| EFB-12 | Fiches, écrans | Fiches à 70 % de la hauteur (`styles.css:62`), écrans plein cadre sous 1100 px (`:108`), fiche de terrain qui coupe le suivi (`App.tsx:451`). | La position disparaît sous la fiche ; le suivi ne reprend pas tout seul. | moyen | moyen | En vol : fiches limitées à 45 %, reprise du suivi à la fermeture, minuterie de fermeture auto pour les fiches de lecture. | SkyDemon |
| EFB-13 | Route | Pas d'insertion de point par glissement d'un segment ; pas de champ pour ajouter un point par OACI, VRP ou nom (recherche seulement dans « Direct »). | Prépa plus longue : ajouter à la fin puis réordonner ; aucune saisie clavier. | fort | moyen | Glisser un segment pour insérer ; champ « Ajouter un point » (OACI, nom, VRP) réutilisant `searchAirfields`. | SkyDemon, SDVFR |
| EFB-14 | Route | Plus de profil vertical (onglet retiré), pas de simulation de la nav, alertes de prépa dispersées (Log, NOTAM) et non cliquables. | Pas de vérification verticale terrain/espaces, pas de rejouer la nav, pas de synthèse « problèmes de ma route ». | moyen | fort | Liste « Alertes de la route » (espaces traversés, NOTAM du couloir, obstacles) avec appui = zoom carte ; profil et simulation ensuite. | SkyDemon, Air Navigation Pro |
| EFB-15 | Carte, DA | Rouge = avion (`styles.css:44`) = alertes = zones OACI ; jaune = sélection = principal = prudence ; magenta = « direct » (route verte) ; voir §2. | Lecture ambiguë du sens des couleurs ; avion rouge peu distinct sur zone rouge. | moyen | faible | Avion en couleur propre (encre avec liseré clair) ou contour renforcé ; décider d'un niveau « prudence » distinct du jaune de sélection. **Signalé seulement, à arbitrer.** | Garmin / SkyDemon (route magenta) |
| EFB-16 | Carte | Aucun indicateur de réseau (hors ligne). | Le pilote ne sait pas si le vent, les NOTAM, la météo sont à jour ou en cache. | moyen | faible | Pastille « HORS LIGNE » discrète et âge des données météo à côté de chaque donnée. | Enroute |
| EFB-17 | Première utilisation | Prérequis non guidés (pays, avion), crayon ✎ sans libellé (`App.tsx:1189`). | Première nav lente ; fonction centrale peu découvrable. | moyen | moyen | Liste de démarrage en trois étapes (pays, avion, tracer) et libellé « Tracer » sous l'icône. | SkyDemon |
| EFB-18 | Carte, jour | Noms de villages en gris clair `#8c8c8c` sur blanc, ≈ 3,4:1 (`MapView.tsx`, couche `aerob-agglo-name`). | Peu lisibles au plein soleil ; fidèle à l'OACI. | faible | faible | Option « texte renforcé » (gris plus foncé) dans Calques. | — |

---

## 6. Ordre de traitement recommandé

**Sécurité d'abord**
1. **EFB-04** (bannière hiérarchisée) et **EFB-05** (AIRAC dans la bannière) : effort faible, gain de sécurité immédiat.
2. **EFB-01** (mode Vol) : la protection de la route et l'allègement de l'écran conditionnent presque tout le reste.
3. **EFB-02** (alertes d'espace en vol) : le plus gros chantier, mais la matière existe déjà (vecteur, `airspacesAt`, bannière).

**Puis meilleur rapport impact/effort**
4. **EFB-10** (rappel du filtre d'altitude), **EFB-11** (cibles 56 px), **EFB-16** (indicateur hors ligne) : chacun moins d'une heure.
5. **EFB-03** (carte de nuit) : effet très visible pour un effort réduit.
6. **EFB-09** (liste « Direct » enrichie) et **EFB-06** (ETA et destination dans le bandeau).
7. **EFB-07 / EFB-08** (appui long, espaces devant), **EFB-12** (fiches plus discrètes en vol).
8. **EFB-13, EFB-14, EFB-17** (prépa : insertion, saisie, alertes de route, démarrage), puis **EFB-15** (arbitrage des couleurs) et **EFB-18**.

*Si tu ne devais en faire que trois : EFB-01 (mode Vol), EFB-04 (bannière par gravité) et EFB-03 (carte de nuit).*
