/**
 * Constantes de l'interface (pas de donnée aéronautique : celles-ci viennent de sources datées).
 */

/** Plage du filtre de plafond de la carte, en niveaux de vol (réglage utilisateur, pas une donnée aéro). */
export const CEILING_FILTER = { minFL: 0, maxFL: 195, stepFL: 5, defaultFL: 195 } as const;
