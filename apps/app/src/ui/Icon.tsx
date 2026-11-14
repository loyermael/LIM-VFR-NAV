import { createElement } from "react";
import { ICON_NODES, type IconName } from "./iconData";

export type { IconName };
/** Trois tailles seulement : 16 (texte, badges, chevrons), 20 (boutons, bandeaux), 24 (commandes de carte, menu rond). */
export type IconSize = 16 | 20 | 24;

/**
 * Icône de l'interface (Lucide, copiée dans `iconData.ts`). Trait de 2 px constant à toute taille, extrémités et jointures carrées (DA : filets d'encre, rayon de 2 px).
 * Couleur = `currentColor` : celle du texte ou du rôle du bouton. Décorative (`aria-hidden`) : le sens est porté par le texte du bouton ou par son `aria-label`.
 */
export function Icon({ name, size = 20, filled = false, className }: { name: IconName; size?: IconSize; filled?: boolean; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_NODES[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
