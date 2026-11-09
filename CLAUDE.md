# L!M VFR Nav — CLAUDE.md

Nom de l'application : **L!M VFR Nav** (le dossier du projet s'appelle `LIM Nav` car `L!M VFR Nav` existe déjà : c'est l'ancien essai Flutter).
Application de navigation VFR sous la marque L!M. Usage perso puis club, gratuite.
Pilote de planeur et élève PPL en France ; l'utilisateur écrit en français.
Statut : **étape 0 (architecture) — aucun code tant que les jalons ne sont pas validés.**
Ancien essai (Flutter) : `..\L!M VFR Nav` — abandonné, on repart de zéro, ne pas le modifier.

## Règles non négociables
1. **Hors-ligne d'abord** : aucune fonction de vol ne dépend du réseau. Le réseau sert à préparer et à mettre à jour.
2. **Aucune donnée aéronautique en dur** : tout vient d'une source datée (AIRAC, date de validité, URL, licence) enregistrée avec la donnée.
3. **Avertissement au lancement** : aide à la navigation, jamais un moyen primaire. Message à accepter à chaque lancement.
4. **Cockpit** : cibles tactiles ≥ 56 pt, contraste fort (lisible au soleil), pas de geste fin, utilisable avec gants et en turbulence. Modes jour/nuit.
5. **Français + anglais** : toute chaîne passe par i18n (clés), jamais de texte en dur dans les composants.
6. **GPL** : on a étudié enroute (GPL-3) pour les idées uniquement. **Ne jamais copier de code d'enroute** sans accord explicite de l'utilisateur.
7. Ne jamais modifier le code métier pour faire passer un test : si le test est faux, on le dit.

## Architecture (monorepo npm workspaces, TypeScript strict)
```
packages/core      TS pur, zéro dépendance plateforme : unités, géodésie, triangle des vitesses,
                   route/log de nav, déclinaison, géoïde, formats (GPX/KML/PLN/FPL/IGC), géométrie
                   d'espaces, décodeurs METAR/TAF, GDL90/FLARM. Partagé par toutes les plateformes.
packages/data      Scripts Node : import SIA / openAIP / DEM → SQLite + tuiles ; manifeste AIRAC.
apps/app           PWA unique (React + Vite + MapLibre GL JS), installable gratuitement sur iPhone, iPad,
                   Android et ordinateur (aucun compte Apple payant). Mise en page adaptative : téléphone,
                   tablette, ordinateur (préparation des vols et navs), portrait/paysage. Hors-ligne par
                   service worker. Évolution possible : emballage Capacitor (APK Android gratuit).
                   Limites iOS (pas de GPS en arrière-plan, pas d'UDP) : voir `docs/stacks.md`.
                   Coque Android native (Capacitor 8, `apps/app/android`) : même application + plugins natifs,
                   dont le baromètre ; voir `docs/android.md` (non compilée à ce jour).
docs/              étude enroute, stacks, jalons, sources de données et licences.
```
Règle de dépendance : `apps/*` → `core`. `core` n'importe jamais React, DOM ni Node-only.
Le moteur de calcul est testable sans simulateur.

## Unités et angles (point le plus critique)
- **Stockage interne et `core`** : SI. Distances en mètres, vitesses en m/s, temps en secondes (UTC), pression en Pa, altitudes en mètres.
- **Affichage** : une unité **par information**, choisie par l'utilisateur dans Réglages (kt ou km/h, ft ou m, NM ou km, hPa ou inHg, l ou USG, °M ou °V…). Défaut : kt, ft, NM, hPa, magnétique. Conversion **uniquement** aux frontières (UI, import/export), via `packages/core/src/display.ts` ; jamais de conversion dispersée dans les composants.
- Types TS « brandés » obligatoires : `Meters`, `Feet`, `Knots`, `MetersPerSecond`, `NauticalMiles`, `Hectopascals`… Pas de `number` nu pour une grandeur physique dans une API publique.
- **Angles** : types distincts `TrueDeg` (vrai), `MagDeg` (magnétique), `RelDeg` (relatif). Conversion vrai↔magnétique seulement via `magneticVariation(lat, lon, alt, date)` (WMM). Convention : variation Est positive, `MAG = TRUE − VAR`.
- Vent : **direction d'où il vient**, en vrai pour les calculs ; les vents ATIS/METAR (magnétiques) sont convertis à l'entrée.
- Altitudes : toujours qualifier (`AMSL` ellipsoïde GPS / géoïde EGM96, `QNH`, `FL`, `AGL`). Le GPS fournit une hauteur ellipsoïdale : corriger par le géoïde avant affichage.
- Latitude/longitude en degrés décimaux WGS84, ordre `[lon, lat]` dans GeoJSON, `{lat, lon}` dans le code.

## Interface
UX proche de SDVFR Next (carte plein écran, bandeau de chiffres de vol, outils au pouce, onglets en bas), DA identique à L!M Debrief (papier/encre, filets, Archivo/Plex). Détail et règles dans `docs/design.md`. Jetons dans `apps/app/src/ui/tokens.css`, mêmes noms que Debrief ; aucun style en dur dans les composants.

## Données
- Sources prévues : SIA (France), openAIP (Europe), Copernicus DEM/SRTM, NGA EGM96, WMM NOAA. Détail et licences dans `docs/donnees.md` (à écrire en J0).
- Chaque jeu importé porte : `source`, `licence`, `airac_cycle`, `valid_from`, `valid_to`, `imported_at`, `checksum`. L'UI affiche la date de validité et alerte quand un cycle est périmé.
- Cartes IGN OACI de l'utilisateur : import MBTiles local, jamais redistribuées.

## Commandes (à confirmer à l'initialisation du dépôt)
```
npm install
npm run typecheck        # tsc --noEmit, strict, tous les workspaces
npm test                 # Vitest
npm run dev -w @lim/app  # PWA en local (http://localhost:5173)
npm run build -w @lim/app
# coque Android (JDK 21 + Android SDK, ou le workflow GitHub Actions) : npm run build -w @lim/app puis, dans apps/app, npx cap sync android
python tools/make-test-mbtiles.py   # régénère le MBTiles de test des tests du lecteur
# démo sans GPS : ajouter ?sim (ou ?sim=loss) à l'adresse de l'app
# à venir : lint, npm run data:airac (import + manifeste AIRAC)
```

## Stratégie de tests
- **Vitest** sur `core`, couverture élevée exigée sur géodésie, triangle des vitesses, déclinaison, conversions.
- Oracle géodésique : `geographiclib-geodesic` (Karney) comparé à nos formules sur des cas fixes **et** en tests de propriété (`fast-check`) : aller-retour, distance symétrique, cap inverse ≈ cap + 180.
- Triangle des vitesses : cas connus à la main (vent de face/arrière/traversier, TAS < vent → erreur explicite), propriétés (GS entre TAS−WS et TAS+WS, WCA signé correctement).
- Formats : fichiers réels en fixtures, tests aller-retour import→export→import.
- Tests de non-régression « golden » pour le log de nav (JSON de référence relu à la main).
- UI : tests de composants + démo manuelle sur iPad à chaque jalon (checklist dans `docs/jalons.md`).
- Aucun test ne touche le réseau ; les sources sont simulées par des fixtures datées.

## Conventions
- TypeScript `strict`, `noUncheckedIndexedAccess`, pas de `any`. Commentaires et docs en français, identifiants en anglais.
- Seuils et constantes métier dans `packages/core/src/config.ts` uniquement, chacun documenté (source ou jugement).
- Commits courts, en français ; trailer `Co-Authored-By` de Claude.
- Chaque jalon : démo testable sur iPad, tests verts, résumé court (fait / reste).
