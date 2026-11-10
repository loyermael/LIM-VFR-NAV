# J4 — Météo : état (10/11/2026)

Sources, accès et limites : `docs/j4-sources.md`. La météo sert à **préparer** le vol (réseau ou import de fichiers) ; l'application garde la dernière version reçue avec son **âge**.

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **METAR bruts et décodés** (vent, rafales, visibilité, nuages, plafond, temps présent, température, rosée, QNH, catégorie VFR/MVFR/IFR/LIFR, âge, alerte > 90 min) | 31 tests sur **de vrais messages** + sur le fichier réel complet (400 METAR) : la catégorie recalculée **concorde avec celle du service** ; vu à l'écran (LFBI, LFBL : décodé = brut) |
| **TAF bruts et décodés** (périodes de base, BECMG, TEMPO, PROB, validité, période à l'heure du vol) | tests sur de vrais TAF ; vu à l'écran |
| **SIGMET** (danger, FIR, validité, niveaux, polygones, « sur la route ») | tests sur de vrais SIGMET (zones simples et multiples) ; **vu à l'écran seulement dans le cas « aucun SIGMET sur la route »** (aucun SIGMET français actif le jour du test) |
| **Briefing couloir** : stations à ≤ 25 NM de la route (METAR + TAF à l'heure du vol), SIGMET traversés, avertissements | 8 tests ; vu à l'écran sur Poitiers → Limoges avec les vrais messages du jour |
| **Vents en altitude, 18 niveaux de pression × 24 h** (sur 48 h chargées) en un point, avec l'altitude de chaque niveau | 22 tests sur une vraie réponse ; **vu à l'écran avec le vrai service** |
| **Vents de la route** : vent de chaque branche à son altitude et à son heure de passage, appliqué au log de nav | testé ; vu à l'écran (226°/19,7 kt sur la branche 1 à 3 000 ft) et enregistré dans la route |
| **Radar de pluie** (RainViewer, 2 h passées) en calque sur la carte | **vu à l'écran** avec la vraie pluie du jour |
| Import des fichiers météo (`npm run data:weather` → import), date de téléchargement exacte avec le manifeste | script exécuté (400 METAR, 97 TAF, 120 SIGMET) ; import testé et vu |

## Pas fait / limites (voir aussi `docs/j4-sources.md`)
- **TEMSI / WINTEM officiels** : pas d'accès ouvert (compte Météo-France). Les vents du modèle les remplacent en partie, **sans leur valeur officielle**.
- **METAR / TAF / SIGMET ne se téléchargent pas depuis le navigateur** (pas de CORS) : il faut lancer `npm run data:weather` puis importer les fichiers. Sur Android, un téléchargement direct sera possible dans la coque.
- **Vents en altitude = prévision de modèle**, pas une mesure ; la prévision n'est chargée qu'en réseau, avec cache sur l'appareil. L'altitude de vol est confondue avec l'altitude géopotentielle.
- **Une seule ligne de vent par point** : les vents de la route interpolent entre les prévisions faites aux points de la route (une requête par point) ; la grille complète n'est pas téléchargée.
- **Radar** : réseau requis (pas hors-ligne), seul le dernier instant observé est affiché (pas d'animation) ; les conditions d'usage de RainViewer sont à relire avant un usage club large.
- **Catégories de vol américaines** : ne valent pas minima VFR français. Pas de calcul de minima VFR (visibilité 5 km, plafond 1 500 ft…) : à décider avec l'utilisateur.
- **Pas de mini-carte des stations** ni de cartes de vent colorées par niveau (seul le tableau d'un point existe).
- **Couverture SIGMET** : internationaux d'aviationweather.gov, la couverture de la France n'est pas garantie.
- Le briefing est une **aide à la préparation non officielle** : le briefing officiel reste celui de Météo-France / SOFIA, les NOTAM sont au SIA.
