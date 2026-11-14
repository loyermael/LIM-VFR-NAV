# Refonte de la gestion des routes — état des lieux et proposition (en attente de validation)

Aucun code modifié. Sources lues : `App.tsx` (`selectRoute`, `createRoute`, `onMapTap`, `removeRoute`), `NavScreen.tsx` (liste et détail), `routeStore.ts`, `routeEdit.ts`.

## 1. Fonctionnement actuel

**Un seul concept : « la route choisie » = `activeRouteId`.** Elle est enregistrée sur l'appareil, dessinée sur la carte, et pilote tout : point visé (« Prochain point »), avance automatique au point suivant, Log, NOTAM, Météo, Vents, dossier PDF. Il n'existe ni « aperçu », ni « brouillon », ni « sélectionnée sans être active ».

| Geste | Ce qui se passe |
|---|---|
| **Tap sur une ligne de la liste** | `selectRoute(id)` : devient la route active, enregistrée ; efface le point visé puis le remet au **point 1** ; efface un « direct vers » libre ; **coupe le suivi GPS** (`setFollow(false)`) ; recadre la carte sur la route ; puis ouvre le détail. Tout cela en un seul tap, sans message ni « Annuler ». |
| **Appui long** | rien (aucun appui long sur les routes). |
| **✕ sur la ligne** | suppression en deux temps (« Confirmer »). Pas d'« Annuler » après. Supprimer la route active la désélectionne (aucune route active). |
| **Nouvelle route** | crée « Nouvelle route n » **et la rend active** (remplace l'ancienne). |
| **Importer** (GPX, KML, FPL, PLN) | crée **et active** la route importée, point visé = 1. |
| **Tap sur la carte en mode ✎ sans route** | **crée silencieusement une route et l'active** (`route ?? createRoute()`). Idem pour « + Route » du menu d'un terrain. |
| **Détail** (après le tap) | nom (modifié à la sortie du champ), Tracer sur la carte, Voir la route, Inverser, points (↑ ↓ Direct ✕), vent, export GPX/KML/FPL/PLN, Dossier PDF. **Toute modification s'enregistre tout de suite sur la route active.** |
| **Renommer / inverser / exporter** | dans le détail seulement, donc après avoir activé la route. |
| **Dupliquer une route** | n'existe pas. |
| **Désactiver** | n'existe pas, sauf en supprimant la route active. |
| **Savoir quelle route est active** | ligne en encre pleine + barre jaune + pastille « ◆ ACTIVE » (dans la liste seulement), tracé magenta sur la carte, case « Prochain point ». **Le nom de la route n'apparaît nulle part sur la carte.** |
| **Liste** | ordre de création, pas de tri ; une ligne = nom + nombre de points ; pas de distance, de temps, de date. Message « Aucune route » quand elle est vide. |

## 2. Ambiguïtés et risques

1. **Ouvrir = sélectionner = activer** : on ne peut pas regarder une route sans devenir cette route (et sans changer le guidage).
2. **Le tap change le point visé** (point 1 de la route touchée) **et coupe le suivi GPS** : en vol, un tap involontaire dans la liste redirige le guidage et fait lâcher la carte.
3. **Aucun retour** après l'activation (ni message, ni « Annuler »), et l'ancienne route active n'est mémorisée nulle part.
4. **Trois chemins d'activation implicites** que l'utilisateur ne voit pas : « Nouvelle route », import, et premier tap sur la carte en mode ✎. Chacun remplace la route active sans prévenir.
5. **Impossible de préparer une route sans toucher à celle qu'on suit** : le Log, les NOTAM, la météo, le dossier travaillent tous sur la route active.
6. **On ne peut pas désactiver** une route.
7. **Gérer = deux endroits** : supprimer dans la liste, tout le reste dans le détail ; renommer/inverser/exporter obligent à activer d'abord.
8. **Suppression sans « Annuler »** (alors que les points en ont un) ; la route active se supprime avec la même confirmation que les autres.
9. **Liste muette** : pas de distance, de temps ni de date ; impossible de reconnaître « AR LFHV LFLM » d'« AR LFHV LFLM 2 » sans les ouvrir.
10. **Pas de rappel sur la carte** : on ne sait pas quelle route est suivie sans ouvrir l'écran Route.

## 3. Proposition

### 3.1 Deux notions séparées
- **Route active** (une seule, enregistrée) : c'est la route suivie. Elle pilote seule : tracé magenta, point visé, avance automatique, « Prochain point ».
- **Route en aperçu** (au plus une, non enregistrée comme active) : la route qu'on regarde ou prépare. Le détail, le Log, les NOTAM, la météo, le dossier et l'édition (✎) travaillent sur **la route affichée** (aperçu s'il y en a un, sinon la route active).
- Sur la carte, une route en aperçu **n'est pas magenta** (réservé à la route active) : tracé encre en tirets, étiquette « Aperçu ».

### 3.2 Liste « Routes »
```
ROUTES                                    [Rechercher]   (si > 6 routes)
┌──────────────────────────────────────────────┐
│ ◆ ACTIVE                                      │
│ AR LFHV LFLM                          [Désactiver] [⋯] │
│ LFHV → LFHV · 87 km · 29 min · modifiée il y a 2 h     │
├──────────────────────────────────────────────┤
│ Tour du Beaujolais                    [Activer]  [⋯]   │
│ LFHV → LFHV · 78 km · 31 min · modifiée hier           │
└──────────────────────────────────────────────┘
[ + Nouvelle route ]   Importer
```
- La route active est **épinglée en haut** ; les autres sont triées par modification récente.
- Chaque ligne : nom, départ → arrivée, distance, temps estimé (« --- » sans avion), date de modification.
- **Tap sur la ligne = ouvrir l'aperçu** (n'active rien). **« Activer » = bouton primaire** (jaune) sur la ligne ; un seul primaire par ligne, la route active a « Désactiver » (neutre).
- **« ⋯ » ou appui long** : Renommer, Dupliquer, Inverser, Exporter, Supprimer (rouge, en bas du menu).
- État vide : « Aucune route. » + bouton primaire « Créer une route ».

### 3.3 Aperçu
- Ouvre le détail actuel (points, vent, export, Log…), tracé visible sur la carte en tirets (bouton « Voir sur la carte »).
- En-tête : nom + **« Activer »** (primaire) ; si la route est déjà active : badge « ◆ Active » + « Désactiver ».
- Barre « Aperçu » sur la carte : `Aperçu · AR LFHV LFLM  [Activer]  [✕ fermer]`.

### 3.4 Rappel permanent sur la carte
- Pastille compacte en haut à gauche, sous la pastille GPS : **`◆ AR LFHV LFLM ▾`** (contour magenta, nom tronqué). Un tap ouvre un petit menu : **Changer de route… / Désactiver / Ouvrir**.
- Sans route active : pas de pastille. Avec un aperçu ouvert : la barre « Aperçu » prend sa place.

### 3.5 Feedback et sécurité
- **Activation** : tracé magenta, la carte se recentre sur la route, **toast « Route AR LFHV LFLM activée · Annuler »** (6 s). Annuler restaure l'ancienne route active et son point visé.
- **Remplacer la route active** :
  - **au sol** : remplacement direct + toast « Annuler » ;
  - **en vol** : boîte de confirmation « Remplacer AR LFHV LFLM par … ? Le guidage passera au point 1 (LFHV). [Remplacer] [Garder] ».
- **Suppression** :
  - route non active : suppression immédiate + toast **« Route supprimée · Annuler »** (6 s) ;
  - **route active : confirmation en deux temps obligatoire** (puis toast « Annuler » aussi).
- **Plus d'activation implicite** : « Nouvelle route », import et premier tap de tracé créent la route **en aperçu** (avec le primaire « Activer »), sans toucher à la route active.
- **Le suivi GPS n'est plus coupé** par un simple tap dans la liste (seule l'activation recentre la carte).

## 4. Parcours : avant / après (nombre de taps)

| Action | Avant | Après |
|---|---|---|
| Regarder une route sans rien changer | impossible (active) | **1 tap** (ligne) |
| Activer une route | 1 tap (implicite, sans retour) | **1 tap** (« Activer » sur la ligne) ; 2 taps depuis l'aperçu |
| Changer de route active depuis la carte | Route → ligne = 2 | pastille → « Changer » → « Activer » = **3** |
| Désactiver | impossible | **1 tap** (ligne) ou 2 (pastille → Désactiver) |
| Annuler une activation par erreur | impossible | **1 tap** (« Annuler », 6 s) |
| Préparer une route pendant qu'une autre est suivie | impossible | **possible** (aperçu), la route suivie n'est pas modifiée |
| Renommer | Route → ligne → champ = 3 | ⋯ → Renommer = **3** (ou champ dans l'aperçu = 2) |
| Dupliquer | impossible | ⋯ → Dupliquer = **3** |
| Inverser | 3 | ⋯ → Inverser = **3** (ou bouton dans l'aperçu = 2) |
| Exporter | 3 | ⋯ → Exporter = **3** |
| Supprimer (non active) | ✕ + « Confirmer » = 3, sans retour | ⋯ → Supprimer = **3**, annulable |
| Supprimer (active) | idem, désélectionne | ⋯ → Supprimer → **Confirmer** = 4, annulable |
| Savoir quelle route est active | ouvrir l'écran Route | **voir la carte** (pastille) |

## 5. Décisions à valider avant de coder

1. **« En vol »** : il n'y a pas de « mode vol » (retiré à ta demande). Je propose de définir « en vol » comme : décollage détecté par l'enregistreur et pas encore d'atterrissage, **ou** vitesse sol ≥ 40 kt. OK ?
2. **L'édition (✎) et les écrans Log / NOTAM / Météo / dossier suivent la route affichée** (aperçu sinon active). Ça permet de préparer la suite pendant un vol, mais l'édition en vol reste possible (pas de verrouillage, comme tu l'as demandé). OK ?
3. **Création, import et premier tap de tracé** : la route est créée **en aperçu**, jamais activée d'office (même s'il n'y a pas encore de route active). OK, ou préfères-tu qu'elle s'active seule quand aucune route n'est active ?
4. **« Profil »** (demandé dans l'aperçu) : l'appli n'a pas de profil d'altitude de route (seulement pour les traces enregistrées). Je le laisse hors de ce chantier ; ou veux-tu l'ajouter ensuite ?
5. **Dupliquer** (nouvelle fonction demandée dans « Gérer ») : la copie reçoit « Copie de … » et s'ouvre en aperçu. OK ?
6. **Temps estimé dans la liste** : calculé avec l'avion choisi, le vent par défaut de la route ; « --- » sans avion. OK ?

---

## 6. Implémenté (validation reçue : les 6 décisions acceptées)

- **Modèle** : `activeRoute` (guidage, enregistrée) et `previewRoute` (aperçu, non enregistrée) ; `route` = aperçu sinon active (écran Route, Log, NOTAM, météo, dossier, ✎). Le point visé, l'avance automatique, la simulation et la feuille « Direct vers » ne suivent que la route active.
- **Liste** : active épinglée avec « ◆ ACTIVE » + « Désactiver » ; les autres triées par modification récente avec « Activer » (primaire). Chaque ligne : nom, départ → arrivée (« A ⇄ B » pour un aller-retour), distance, temps (« --- » sans avion), âge. Recherche au-delà de 6 routes. État vide : message + « Créer une route ». Tap = aperçu ; « ⋯ » ou appui long de 0,5 s = Renommer, Dupliquer, Inverser, GPX / KML / FPL / PLN, Supprimer.
- **Carte** : pastille « ◆ nom ▾ » (Ouvrir / Changer de route… / Désactiver) ; en aperçu, tracé encre en tirets et barre « Aperçu · nom · Activer · ✕ ».
- **Sécurité** : activation = toast « Annuler » (restaure route active, point visé, direct libre) ; en vol (≥ 40 kt, ou enregistrement depuis un décollage détecté ≥ 20 kt) remplacer une route active demande confirmation ; suppression annulable, route active avec confirmation en deux temps ; « Nouvelle route », import et premier tap de tracé créent en aperçu, jamais d'activation implicite ; un tap dans la liste ne coupe plus le suivi GPS.
- **« Direct » sur un point d'une route en aperçu** : direct libre vers ce point (la route suivie ne change pas).
- **Vérifié dans l'aperçu** : tap = aperçu sans rien activer ; Activer en vol → confirmation → toast → Annuler ; pastille et menu ; barre d'aperçu ; Dupliquer, Supprimer + Annuler ; 375 px sans débordement. 578 tests (dont `routeList.test.ts`).
- **Non vérifié** : appui long sur téléphone ; suppression de la route active (confirmation) ; import d'un fichier ; confirmation « en vol » hors simulateur ; chaîne complète sur appareil réel.
