# J8 — Connectivité : état (10/11/2026)

Un navigateur ne sait pas écouter l'UDP, et il n'y a pas de serveur : la liaison passe donc par un **petit pont** (`node tools/bridge.mjs`, sur un ordinateur du réseau du récepteur) qui retransmet les datagrammes UDP à l'appli par WebSocket. Sans le pont, rien de ce qui suit ne fonctionne ; le reste de l'appli n'en dépend pas.

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **GDL90** (récepteurs ADS-B type Stratux/SkyEcho) : trames, CRC, échappement, heartbeat, ownship, trafic, altitude géométrique | CRC vérifié sur la **valeur de contrôle publique** de CRC-16/XMODEM ; aller-retour de rapports (propriété sur la position), trames coupées, doubles, CRC faux, valeurs invalides → `null`. **Aucun vrai récepteur essayé** |
| **FLARM** ($PFLAA trafic relatif, $PFLAU état) | checksum vérifié sur un exemple NMEA publié ; sentences refusées si checksum faux. **Aucun vrai boîtier essayé** |
| **X-Plane** : sortie GPS (`XGPS…`) comme position de l'avion | format publié, tests ; **jamais essayé avec X-Plane** |
| **Table de trafic** : péremption (grisé 10 s, supprimé 30 s), distance, relèvement, altitude relative (jamais « 0 » si inconnue), tri | tests |
| **Alertes** : niveau de l'émetteur repris tel quel ; proximité jugée (attention < 3 NM et < 1 000 ft ; alerte < 1 NM et < 500 ft) ; bandeau « TRAFIC … distance, heure, écart d'altitude » | tests de la logique ; **bandeau d'alerte jamais vu à l'écran** (le flux simulé ne passe qu'au niveau « attention ») |
| **Alerte de perte de flux** : cibles grisées, puis bandeau « Flux perdu » | **vu à l'écran** en coupant le pont (grisé à 7 s, bandeau à 17 s) |
| **Pont + appli de bout en bout** avec le mode `--simulate` (avion, 2 cibles GDL90, 1 cible FLARM) | **vu à l'écran** : connecté, 3 cibles, repères avec « +7 / −20 / +3 » (centaines de ft), position de l'avion = flux externe (90 kt), GPS de l'appareil non lancé |
| **Sauvegarde / restauration** (routes, avions, traces, réglages) : synchronisation entre appareils **sans serveur** | tests de validation ; aller-retour **vu à l'écran** (route et réglages effacés puis restaurés) |

## Pas fait / limites
- **Aucun matériel réel** : ni récepteur ADS-B, ni FLARM, ni X-Plane n'ont été essayés. Les formats viennent des spécifications, testés contre mes propres trames, sauf les deux valeurs de contrôle publiques (CRC, NMEA). **Les champs peuvent différer d'un récepteur à l'autre.**
- **Pas d'écoute UDP native** (coque Android) : elle n'aurait pas pu être compilée ni testée ici. Sur téléphone, le pont tourne sur un autre appareil (ordinateur, Raspberry Pi) du même réseau ; `--host 0.0.0.0` l'ouvre au réseau local (tout appareil du réseau pourrait lire le flux). Une page en `https://` ne peut pas se connecter à un `ws://` distant (contenu mixte) : utiliser `ws://localhost` ou servir l'appli en http local.
- **MSFS (SimConnect) et FlightGear : non pris en charge.** Seul X-Plane (XGPS) l'est.
- **SafeSky : non fait** (API et conditions non vérifiées, clé à demander).
- **Altitude** : le GDL90 donne une altitude pression, pas de l'AMSL : l'appli n'affiche l'altitude du flux externe que si l'altitude géométrique (ellipsoïde) est reçue. Sinon l'altitude est « --- ».
- **Pas un anticollision** : position instantanée seulement (pas de trajectoire projetée), seuls les aéronefs émetteurs sont visibles, seuils jugés. Pas de son d'alerte.
- **Synchronisation** : par fichier, pas automatique ; les documents, cartes MBTiles, données aéro et météo ne sont pas dans la sauvegarde. Pas de version web synchronisée (elle exigerait un serveur : **décision d'hébergement toujours à prendre**).
- Pas de plusieurs sources simultanées, pas de relais du trafic vers d'autres appareils.
