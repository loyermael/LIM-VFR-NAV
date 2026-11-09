# J3 — Sources de données : étude et limites (10/11/2026)

Règle du projet : aucune donnée aéronautique en dur, tout vient d'une source **datée**, avec sa licence. Ce document dit ce qui est disponible, ce qui ne l'est pas, et ce qu'on fait.

## Résumé
| Donnée | Source retenue | Accès | Licence | Statut |
|---|---|---|---|---|
| **Espaces aériens** France/Europe | **openAIP** (exports publics) | anonyme, sans clé, mis à jour chaque nuit ; **pas de CORS** → pas de téléchargement direct depuis un navigateur | **CC BY-NC 4.0** : non commercial, attribution « openAIP », pas de redistribution avec le dépôt | **retenue pour J3** |
| **Terrains** (position, altitude, fréquences, pistes) | openAIP (`fr_apt.json`) | idem | idem | **retenue pour J3** |
| **Espaces aériens officiels SIA** (cycle AIRAC) | SIA, données numériques (XML-SIA, AIXM 4.5 ; migration vers AIXM 5.1) | URL de téléchargement **non vérifiée** (je n'ai pas pu ouvrir le site) | « Licence ouverte » du SIA : réutilisation libre, **mention de la date de mise à jour obligatoire** | **à brancher plus tard** (voir plus bas) |
| **SUP AIP** | numéro dans les remarques d'openAIP (« AIP SUP 084/26 ») ; texte officiel sur le site du SIA | pas d'API | — | numéro affiché, **texte non intégré** |
| **Activations RTBA / AZBA** | site du SIA (carte dynamique + PDF) | **aucune API ni jeu de données ouvert trouvé** ; en cas de doute le SIA renvoie aux NOTAM | — | **impossible à automatiser proprement aujourd'hui** |
| **NOTAM** | SIA (NOTAMweb), SOFIA-Briefing, EAD | **aucune API gratuite officielle trouvée** | — | **non intégré** (limites ci-dessous) |
| Relief (profil de nav) | Copernicus DEM / SRTM | volumineux, tuiles à préparer | libre | **pas encore fait** |

## openAIP : ce qu'on sait (vérifié sur le fichier réel du 23/10/2026 : 1 765 espaces, 1 503 terrains)
- Export : `https://storage.openaip.net/openaip-system-exports/fr_asp.json` (espaces) et `fr_apt.json` (terrains), 3,9 Mo et 2,3 Mo. Réponse avec `last-modified` (date de l'export, utilisée comme date de validité affichée) ; mise à jour nocturne. **Aucun en-tête CORS** : un navigateur ne peut pas les télécharger directement.
- Codes : `type` (4 CTR, 7 TMA, 26 CTA, 1 zone réglementée/ZRT, 2 danger, 3 interdit, 5 TMZ, 6 RMZ, 21 transit planeur, 28 activité (parachutage…), 29 parcs, 32 secteur VFR, 33 SIV, 34 LTA, 10 FIR, 15 voie aérienne, 0 autre) **recoupés avec les noms réels** ; `icaoClass` 0–6 = A à G, 8 = sans classe ; limites `unit` 0 m / 1 ft / 6 niveau de vol, `referenceDatum` 0 sol / 1 niveau de la mer / 2 pression standard.
- Contenu utile : polygone, plancher et plafond, **fréquences**, horaires, activation « sur demande » / « par NOTAM », dates d'activation, remarques (numéros de SUP AIP).
- **Limite majeure : ce n'est pas la donnée officielle.** openAIP est une base communautaire, mise à jour en continu, **pas alignée sur le cycle AIRAC** ni validée par le SIA. Un écart avec la publication officielle est possible. L'application l'affiche, et toute décision se prend sur les documents officiels.
- Licence **non commerciale** : compatible avec ton usage perso puis club gratuit ; **incompatible avec une revente**. Les fichiers ne sont pas dans le dépôt.

## Comment les données arrivent dans l'application
Le navigateur ne pouvant pas télécharger l'export (CORS) :
1. **Ordinateur** : `npm run data:openaip` (script Node) télécharge les deux fichiers dans `data/openaip/` (ignoré par git, avec un manifeste daté) ; dans l'application, **Cartes → Importer les données aéronautiques** lit ces fichiers.
2. **Téléphone / tablette** : même import de fichiers (ouvrir le `.json` depuis l'application Fichiers).
3. **Coque Android** : le téléchargement direct sera possible (requête native, sans CORS) ; non fait.
Les données sont ensuite stockées sur l'appareil (hors-ligne) avec leur source, leur licence et leur date.

## AIRAC
Cycle de 28 jours ; le cycle courant est calculé (le 10/11/2026 : cycle 2611, entré en vigueur le 29/10/2026, suivant le 26/11/2026). L'application affiche le cycle courant **et** la date de l'export openAIP, et **prévient** que l'export n'est pas un jeu AIRAC officiel ; elle signale un export de plus de 28 jours.

## NOTAM : sources possibles et limites
- **SIA (NOTAMweb)** : consultation sur le site, pas d'interface programmatique documentée.
- **SOFIA-Briefing** : service officiel de préparation de vol, avec compte.
- **EAD (Eurocontrol)** : le SIA y crée ses NOTAM ; l'accès automatisé (« MyEAD ») est commercial ; « EAD Basic » est gratuit mais interactif.
- **Agrégateurs** (notambriefing.com et autres) : gratuits, mais **non officiels** et pouvant omettre des NOTAM « locaux » non diffusés à l'international.
- Conclusion : **pas d'automatisation fiable et gratuite aujourd'hui.** Pistes réalistes : lien vers le NOTAMweb du SIA depuis la fiche d'un terrain, et saisie/collage de NOTAM par le pilote. Rien n'est inventé.

## RTBA / AZBA
Aucun jeu ouvert : le SIA publie une carte dynamique et des PDF de créneaux, et précise qu'en cas de panne les **NOTAM** font foi. Les zones RTBA existent dans les données (zones réglementées) mais **leur activation du jour ne peut pas être connue par l'application**. On affiche donc « activation à vérifier (SIA / NOTAM) », jamais « active » ou « inactive ».

## SIA / AIXM : prochaine source
Pour un jeu **officiel et daté par cycle AIRAC**, il faudra lire l'AIXM du SIA (XML-SIA en AIXM 4.5 aujourd'hui, AIXM 5.1 à terme). Il me faut pour cela l'URL exacte du téléchargement (non vérifiée) ou un fichier d'exemple. La structure `Airspace` de l'application est pensée pour recevoir cette source sans changer l'interface.
