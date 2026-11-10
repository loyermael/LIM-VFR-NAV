# J6 — Traces : état (10/11/2026)

## Fait et vérifié
| Fonction | Vérification |
|---|---|
| **Enregistrement automatique** : démarre au décollage (vitesse sol ≥ 25 kt pendant 3 s), garde 30 s de roulage avant, s'arrête 30 s après être repassé sous 15 kt ; démarrage et arrêt manuels | 7 tests de la machine à états (vol complet, roulage rapide trop court, vitesse inconnue, ralentissement bref en vol, mode manuel, reprise) ; **vu à l'écran** avec le simulateur (démarrage seul à 3 s, compteur de points) |
| **Boîte noire** : la trace est écrite sur l'appareil toutes les 15 s ; après fermeture ou coupure elle est récupérée et marquée « interrompue » | **vu à l'écran** : rechargement de la page en plein enregistrement → trace récupérée (24 s sur 37 s : la perte jusqu'à 15 s est réelle et annoncée) |
| Statistiques : durée, temps de vol (décollage → atterrissage), distance, altitude et vitesse maximales | tests (1 111 m pour 0,01° de latitude) ; vu à l'écran (37 s à 90 kt = 0,9 NM) |
| **Export GPX, KML (gx:Track), IGC** | XML relu par un analyseur dans les tests ; **IGC relu par le vrai lecteur de L!M Debrief** : 600 points, date, immatriculation, altitude GNSS exacts, aucun avertissement. *Un premier essai avec des fixes « V » a été ignoré en bloc par Debrief : corrigé en « A »* |
| **Rejeu 2D** sur la carte (lecture/pause, ×1 à ×32, curseur) + profils altitude et vitesse avec curseur | vu à l'écran (tracé en pointillés, avion rejoué, barre sur la carte) ; avance et bornes testées |
| **Chronomètre et compte à rebours** avec alarme sonore et vibration, bannière | logique testée (7 tests) ; compte à rebours **non attendu jusqu'à l'alarme à l'écran**, son et vibration non vérifiés |

## Pas fait / limites
- **Rejeu 3D : non fait** (le rejeu 2D et les profils existent).
- **Suivi en direct (live track) : non fait** : il exige un serveur ; c'est la décision d'hébergement attendue avant J8.
- **Enregistrement en arrière-plan** : une page web est suspendue par le navigateur écran éteint ou appli en arrière-plan (surtout iOS). L'écran est maintenu allumé, mais **non testé en vol réel** ; une vraie solution sur Android passera par la coque native (service de localisation), non écrite.
- **Seuils JUGÉS** (25 kt / 3 s, 15 kt / 30 s, 30 s de pré-enregistrement) : un planeur ou un ULM lent peut ne pas déclencher ; le démarrage manuel existe pour ça.
- **IGC** : non signé (pas d'enregistrement G) donc **non homologable** ; pas d'altitude pression ; la date de l'en-tête est celle du premier point (un vol qui franchit minuit UTC sera mal daté dans les lecteurs IGC).
- **Stockage** : la trace entière est réécrite toutes les 15 s ; non mesuré sur un vol de plusieurs heures (≈ 10 000 points).
- Pas d'import de trace (GPX/IGC) pour la rejouer ; pas de renommage automatique par terrain ; pas de plusieurs traces simultanées.
- Les chronos s'arrêtent si l'appli est fermée.
