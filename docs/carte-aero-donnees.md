# Carte aéro « type OACI » : inventaire des données ouvertes

Objectif : une carte vectorielle aéronautique inspirée de l'OACI (couleurs et symboles de la légende publique), nommée à part, jamais présentée comme la carte officielle.
État : inventaire par recherche web (une recherche par thème). **Rien n'est encore vérifié sur les fichiers réels** ; chaque ligne « à vérifier » doit l'être avant de coder.

| Élément de la carte | Source candidate | Licence annoncée | État |
|---|---|---|---|
| Espaces aériens | openAIP (déjà utilisé) ; SIA (AIXM 4.5 / xml SIA, 28 jours) | openAIP : CC BY-NC (NC-SA selon une source) ; SIA : Licence Ouverte, source + date | openAIP OK dans l'appli ; SIA à vérifier (format, accès) |
| Terrains, pistes, fréquences | openAIP (déjà utilisé) | idem | OK |
| Balises (VOR, NDB), points de report VFR | openAIP (selon une source) ; SIA AIP ENR 4 / VFR | à vérifier | à vérifier fichier par fichier |
| Obstacles | SIA AIP ENR 5.4.1 (obstacles hors servitudes) ; fichiers obstacles DIRCAM (tirés de l'AIP) ; openAIP (type de donnée mentionné) | licence non lue | à vérifier : format et licence |
| Servitudes aéronautiques | data.gouv.fr « servitude aéronautique de dégagement » | Licence Ouverte (à confirmer) | enveloppe seulement, pas des obstacles individuels |
| Zones UAS / géovigilance | SIA / DGAC (guide « UAS ») | Licence Ouverte ; géovigilance, pas pour décisions de sécurité seules | hors périmètre OACI |
| Cartographies VFR/IFR GeoJSON/OpenAir | data.gouv.fr (dérivées SIA + Eurocontrol) | à lire | piste à vérifier |
| Routes, villes, hydrographie, bâtiments | IGN BD TOPO ; OpenStreetMap | BD TOPO : Licence Ouverte Etalab 2.0 (selon wiki OSM) ; OSM : ODbL | à vérifier sur le site IGN |
| Relief ombré | IGN LiDAR HD (déjà utilisé) | Licence Ouverte | OK |
| Plan de fond | IGN Plan V2 (déjà utilisé) | Licence Ouverte | OK |

## Points ouverts
1. openAIP : licence non commerciale ; sa page autorise l'embarquement dans une appli payante tant qu'on ne vend pas la donnée seule : à clarifier avec openAIP.
2. Obstacles : aucune base nationale ouverte unique trouvée ; passer par le SIA/DIRCAM, sinon OSM (pylônes, éoliennes).
3. Mentions obligatoires : SIA = source + date de mise à jour ; IGN = © IGN ; OSM = © contributeurs.
4. Dessin et symboles : légendes OACI publiques sur Géoportail ; le dessin exact de la carte IGN/SIA relève du droit d'auteur : ne pas copier, s'en inspirer.
5. SDVFR : sa carte SDOACI est propre à SkyDreamSoft, « comparable » à l'OACI et non identique.

## Suite proposée
Ouvrir les vrais fichiers (SIA AIXM, DIRCAM obstacles, BD TOPO, openAIP obstacles/balises), noter format, volume et licence lue sur place, puis décider du premier lot (espaces + terrains + balises + obstacles).
