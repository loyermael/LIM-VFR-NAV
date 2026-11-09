# Coque Android native (Capacitor) — état au 10/11/2026

## Pourquoi
Un navigateur n'a pas accès au baromètre d'un téléphone (aucune API web). Les appareils Android en ont presque tous un ; XCSoar l'exploite de la même façon (API publique `Sensor.TYPE_PRESSURE`). La coque est **la même application web** dans une WebView, plus des plugins natifs. L'iPhone et l'iPad restent en PWA (sans baromètre) tant qu'il n'y a pas de compte Apple payant.

## Ce qui est fait
| Élément | Où | État |
|---|---|---|
| Altitude barométrique, QNH depuis l'altitude d'un terrain, filtre de pression | `packages/core/src/baro.ts` | **testé** (15 tests) |
| Choix de la source GPS / baromètre, repli sur le GPS si le capteur se tait | `packages/core/src/altitudeSource.ts` | **testé** (9 tests) |
| Pont TypeScript vers le capteur + simulateur (`?sim`) | `apps/app/src/pressureSource.ts` | **vu à l'écran** avec le simulateur |
| Fiche d'altitude : source, calage du QNH sur le terrain, état du capteur | `apps/app/src/CellSheets.tsx` | **vu à l'écran** avec le simulateur |
| Projet Android généré (Capacitor 8), plugin baromètre en Java, écran allumé, permissions GPS | `apps/app/android/` | **écrit, jamais compilé ni lancé** |
| Compilation de l'APK dans le nuage | `.github/workflows/android.yml` | **écrit, jamais exécuté** |

## Ce qui n'est PAS vérifié (important)
Cet ordinateur n'a ni Android SDK ni JDK 17+ : **ni le code Java, ni le projet Gradle, ni le workflow n'ont été compilés**. Il peut y avoir des erreurs de compilation à corriger au premier essai. Le baromètre réel n'a jamais été lu : seule la chaîne « pression simulée → altitude → affichage » a été vérifiée.

## Compiler l'APK (trois voies)
1. **GitHub Actions (le plus simple, sans rien installer)** : pousser ce dépôt sur GitHub, onglet *Actions* → « APK Android » → *Run workflow*, télécharger l'artefact `lim-vfr-nav-debug-apk`. Les dépôts privés ont un quota gratuit de minutes.
2. **Android Studio** (gratuit) : ouvrir `apps/app/android`, laisser Gradle synchroniser, *Build > Build APK*. Avant : `npm run build -w @lim/app` puis `npx cap sync android` dans `apps/app`.
3. **Ligne de commande** : JDK 21 + Android SDK, puis `cd apps/app/android && ./gradlew assembleDebug`.

Installer : copier `app-debug.apk` sur le téléphone, autoriser les « sources inconnues ». L'APK est signé avec une clé de développement (pas de Play Store).

## À tester sur le téléphone, dans l'ordre
1. L'application s'ouvre, l'avertissement s'affiche, la localisation est demandée et acceptée.
2. Ouvrir la case altitude : une section « Source de l'altitude » avec **GPS / Baromètre** doit apparaître (sinon : le téléphone n'a pas de baromètre, ou le plugin n'est pas chargé).
3. Choisir Baromètre : « Baromètre de l'appareil actif ». L'altitude doit réagir quand on monte un escalier (≈ 3 m par étage).
4. Au sol sur un terrain d'altitude connue : saisir l'altitude puis *Caler le QNH* ; comparer le QNH obtenu à celui du METAR du jour (écart de 1 à 2 hPa : normal ; au-delà : capteur à vérifier).
5. En vol : comparer à l'altimètre de bord. Le baromètre d'un téléphone est sensible à la ventilation du cockpit et à la température ; **l'altimètre de bord reste la référence**.

## Limites connues
- Le capteur est libéré quand l'application passe en arrière-plan (économie de batterie) : pas de baromètre écran éteint.
- Pas encore de variomètre (la vitesse verticale se déduit du baromètre ; prévu plus tard).
- Aucune donnée de qualité du capteur n'est exploitable : Android annonce une précision peu fiable selon les modèles.
- Pas de code repris de XCSoar (GPL) : uniquement l'API publique d'Android.
