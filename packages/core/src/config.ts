/**
 * Seuils métier du moteur. Chaque valeur dit d'où elle vient : MESURÉ, ESTIMÉ ou JUGÉ.
 * Aucune donnée aéronautique ici (elles viennent de sources datées).
 */

/** Une position GPS plus vieille que ça est « périmée » : l'affichage est grisé. JUGÉ : un GPS donne 1 fix/s. */
export const GPS_STALE_AFTER_S = 5;

/** Au-delà, le signal est « perdu » : alerte au pilote. JUGÉ : 15 fixes manqués d'affilée. */
export const GPS_LOST_AFTER_S = 15;

/** Précision horizontale au-delà de laquelle la position est jugée trop imprécise pour naviguer. JUGÉ. */
export const GPS_MAX_USABLE_ACCURACY_M = 200;

/** En dessous de cette vitesse sol, la route GPS n'a pas de sens (bruit) et n'est pas affichée. JUGÉ. */
export const MIN_SPEED_FOR_TRACK_MPS = 1.0;

/** Bulles du vecteur vitesse : positions prévues à ces échéances, en minutes. JUGÉ (réglable plus tard). */
export const SPEED_VECTOR_MINUTES = [1, 2, 5] as const;
