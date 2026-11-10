# J4 — Météo : sources, limites, décisions (10/11/2026)

Vérifié le 09/11/2026 par de vraies requêtes. La météo sert à **préparer** le vol (réseau nécessaire) ; en vol, l'application garde la dernière version reçue avec son **âge** affiché. Aucune fonction de vol ne dépend du réseau.

| Donnée | Source retenue | Accès depuis un navigateur | Licence / conditions | Statut |
|---|---|---|---|---|
| **METAR, TAF** (bruts et décodés) | aviationweather.gov (NOAA/AWC), API de données, JSON | 200 OK, **mais aucun en-tête CORS** (ni sur la réponse ni au préalable) → un navigateur ne peut pas l'appeler | données du gouvernement américain, libres | **via script** `npm run data:weather` puis import de fichiers (comme openAIP) ; Android : requête native possible plus tard |
| **SIGMET** (internationaux) | aviationweather.gov `isigmet` | idem (pas de CORS) | idem | idem |
| **Vents en altitude, 18 niveaux de pression, 48 h** | **Open-Meteo** (modèle météo « meilleur choix » ; AROME France disponible) : vent, direction et altitude géopotentielle à 1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50 hPa | **CORS autorisé** : appel direct depuis l'application | données CC BY 4.0 (attribution « Open-Meteo.com »), service gratuit **non commercial** | **intégré** |
| **Radar de pluie** | RainViewer (tuiles, 2 h passées) | **CORS autorisé** | gratuit, attribution « RainViewer » ; conditions d'usage à relire avant un usage club large | **intégré** (calque, réseau requis) |
| **TEMSI / WINTEM** officiels | Météo-France aviation (aviation.meteo.fr) | **compte requis**, pas d'accès ouvert trouvé | — | **non intégrés** : les vents en altitude du modèle les remplacent en partie, sans leur valeur officielle |

Autres sources essayées sans succès : NOAA `tgftp` (METAR texte) et Ogimet : réponses 200 mais **pas de CORS**.

## Conséquences à connaître
- **METAR/TAF/SIGMET ne se téléchargent pas depuis le navigateur.** Sur ordinateur : `npm run data:weather` écrit `data/weather/*.json` (avec la date de téléchargement) et l'application les importe. C'est la même contrainte que pour les données openAIP.
- **Aucun produit officiel TEMSI/WINTEM** : la carte des vents du modèle n'est pas un document de vol. Le briefing officiel reste celui de Météo-France / SOFIA.
- Les vents d'Open-Meteo sont des **prévisions de modèle** (maille de plusieurs km), pas des mesures. Ils ne remplacent ni le TAF ni le jugement du pilote.
- **Âge des données affiché partout** ; un METAR de plus de 90 min et un TAF expiré sont signalés.
- Les catégories VFR/MVFR/IFR/LIFR sont celles des États-Unis (définitions de la FAA), recalculées ici à partir de la visibilité et du plafond ; elles ne valent pas minima VFR français.
