# Stack — décision révisée (09/11/2026)

Contraintes : iPhone, iPad, Android (téléphone/tablette) et ordinateur ; 100 % hors-ligne en vol ; carte vectorielle fluide ; **zéro coût** (pas de compte Apple Developer à 99 €/an).

## Pourquoi on abandonne Expo / React Native
Installer une app native sur iPhone/iPad sans payer = signature gratuite qui **expire tous les 7 jours** (réinstallation hebdomadaire, 3 apps max), ou outils de contournement (AltStore) fragiles. Pour un usage perso puis club, c'est inacceptable. L'App Store et TestFlight exigent les 99 €/an.

## Décision : PWA TypeScript (React + Vite + MapLibre GL JS) — un seul code pour tout
- **iPhone / iPad** : ouverture dans Safari → « Sur l'écran d'accueil » : l'app s'installe, plein écran, hors-ligne, **gratuit, sans compte Apple, sans expiration**.
- **Android** : même PWA installable depuis Chrome, gratuite. Un APK natif (Capacitor, gratuit) reste possible plus tard pour ce que le web ne sait pas faire.
- **Ordinateur** : la même app dans le navigateur, mise en page large, pour préparer vols et navs.
- **Moteur** : `packages/core` (TypeScript pur) partagé avec L!M Debrief.
- **Carte** : MapLibre GL JS, tuiles vectorielles locales (PMTiles/MBTiles lus en local), styles jour/nuit.
- **Hors-ligne** : service worker (code) + stockage local (SQLite WASM / IndexedDB / OPFS) pour cartes et données.

## Limites honnêtes de ce choix (surtout sur iPhone/iPad)
1. **GPS en arrière-plan : impossible sur iOS** pour une PWA. La navigation fonctionne écran allumé, app au premier plan (Wake Lock supporté depuis iOS 16.4) — c'est l'usage normal d'une nav en vol, mais l'enregistrement de trace (J6) s'arrête si l'écran se verrouille ou si on change d'app.
2. **Trafic Wi-Fi GDL90/FLARM (J8)** : un navigateur ne reçoit pas l'UDP. Sur iOS, seuls les boîtiers qui exposent un WebSocket/HTTP seraient compatibles ; sur Android, un APK Capacitor avec plugin UDP règle le problème. À revalider en J8.
3. **Stockage** : Safari peut purger les données d'un site peu utilisé ; une PWA installée est mieux protégée, et on demande le stockage persistant. Un gros jeu de cartes (centaines de Mo) reste à tester sur appareil réel dès J1.
4. **Précision GPS/capteurs** : l'API Géolocalisation web donne position, vitesse, cap ; pas de données satellites brutes. Suffisant pour une aide à la nav.
5. **Mises à jour** : le service worker permet de mettre à jour l'app ; il faut prévoir un écran « version installée » pour ne pas voler avec une version incohérente.

## Alternatives écartées
- **Expo / React Native** : meilleur GPS natif et UDP, mais payant pour iOS (voir plus haut).
- **Flutter** : même problème de signature iOS, et pas de partage de code avec Debrief.
- **Natif Swift/Kotlin** : même coût iOS, deux bases de code.

## Évolution possible sans tout refaire
Si un jour tu paies le compte Apple (ou le club le fait), on emballe **la même PWA** avec Capacitor pour iOS : GPS arrière-plan et UDP deviennent possibles sans réécrire l'interface ni le moteur.
