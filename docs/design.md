# Design : UX type SDVFR, direction artistique L!M Debrief

## Principe
- **UX** : celle d'une appli de nav VFR de référence (SDVFR Next) : la carte occupe tout l'écran, les chiffres de vol sont toujours visibles, les outils sont à portée de pouce, les gros modes sont en bas. Objectif : intuitif sans mode d'emploi.
- **DA** : celle de L!M Debrief, « carnet de vol sous un panneau d'instruments » : papier chaud `#F3F1EA`, encre `#15191D`, un seul rouge signal, jaune de marque `#FFD700` en touches, filets (3 px en tête, 1 px entre) au lieu d'ombres douces, rayon unique de 2 px, Archivo condensé en capitales pour les titres et boutons, IBM Plex Sans pour le texte, IBM Plex Mono pour toutes les valeurs mesurées. Variante nuit : encre en fond, papier en texte.
- **Cockpit** : cibles de 56 px minimum (Debrief va jusqu'à 44 px), chiffres du bandeau en 40 px, contraste fort, jamais de geste fin obligatoire.

## Source unique
`apps/app/src/ui/tokens.css` reprend les noms et valeurs de `L!M Debrief/src/ui/tokens.css`. Polices et licences OFL copiées dans `apps/app/src/ui/fonts/` (embarquées : aucun chargement réseau). Aucun style en dur dans les composants ; une couleur nouvelle se crée d'abord en jeton.

## Gabarit de l'écran principal (livré en J0, vide)
```
┌ bandeau d'instruments : VITESSE SOL | ROUTE | ALTITUDE | GPS ┐  cellules à filets, valeurs en mono
│                                                      [⌖]    │  colonne d'outils à droite
│                    CARTE plein écran                 [NUIT]  │  (centrer, jour/nuit, langue)
│                                                      [EN]    │
└ CARTE | NAV | MÉTÉO | DOCS | PLUS ────────────────────────────┘  onglets de 72 px, un par grand usage
```
Les valeurs affichent `---` tant qu'aucun GPS n'est branché : on n'invente jamais une valeur.

## Ce que je sais de SDVFR, et ce que je ne sais pas
Je construis ce gabarit à partir des conventions des applis de nav VFR, **pas à partir d'une inspection de SDVFR Next** (je n'y ai pas accès). Pour coller vraiment à SDVFR, le plus efficace : des captures d'écran de SDVFR (carte, création de route, log de nav, détails d'un terrain). Je reprendrai alors l'organisation et les gestes, pas leurs visuels ni leurs icônes.

## Règles à respecter pour chaque écran
1. Une action fréquente = un bouton visible, jamais derrière un menu.
2. Chaque écran s'utilise d'un pouce, en portrait comme en paysage, avec des gants.
3. Un chiffre = une unité affichée ; angle vrai ou magnétique toujours indiqué (`°M` / `°V`).
4. Rouge uniquement pour la position de l'avion et les alertes prioritaires.
5. Sur ordinateur : mêmes jetons, mise en page large (carte + panneau latéral de log de nav), clavier et souris.
