# Données et sources (état au 09/11/2026)

Règle : aucune donnée aéronautique en dur ; chaque jeu garde sa source, sa licence et sa date.

| Donnée | Source | Licence | Où | Cycle |
|---|---|---|---|---|
| Géoïde EGM96 (ondulation) | NGA, fichier `WW15MGH.DAC` (grille 15') | domaine public | `apps/app/public/data/egm96.bin`, SHA-256 `9dcaf4ef…5acc` | statique |
| Variation magnétique | World Magnetic Model WMM2025 (NOAA/BGS) via le paquet npm `geomagnetism` 0.2.0 | domaine public (modèle) ; Apache-2.0 (paquet) | `packages/core/src/magnetic.ts` | valable jusqu'au 31/12/2029 ; l'app prévient au-delà |
| Cartes raster (IGN OACI…) | fichiers MBTiles **de l'utilisateur** | licence propre à chaque carte ; jamais redistribuées | stockage privé du navigateur (OPFS) | à la charge de l'utilisateur |
| Couches perso | fichiers GeoJSON / KML / Shapefile de l'utilisateur | idem | IndexedDB | idem |
| Espaces, terrains, balises, SUP AIP | SIA (France), openAIP (Europe) | à vérifier en J3 (openAIP : CC BY-NC) | J3 | AIRAC, 28 jours |

## Schéma de couche pour le filtre de plafond
Pour qu'un espace soit masqué par le filtre de plafond, ses propriétés doivent contenir :
- `floorRef` : `"AMSL"` (mètres), `"AGL"` ou `"FL"` (niveau de vol) ;
- `floorValue` : nombre (mètres pour AMSL/AGL, niveau de vol pour FL).

Sans ces propriétés, l'entité est toujours affichée. Les imports SIA/openAIP de J3 produiront ce schéma.

## MBTiles pris en charge
Table `tiles` (zoom_level, tile_column, tile_row, tile_data) avec ligne en TMS, tuiles raster PNG/JPEG/WebP. **Non pris en charge** : tables WITHOUT ROWID, MBTiles dédupliqués (`tiles` en vue sur `map` + `images`), tuiles vectorielles (pbf). Un MBTiles refusé donne un message d'erreur explicite.
