import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName, type IconSize } from "./Icon";

/**
 * Bouton par rôle. Un seul `primary` par écran ou panneau (jaune de marque, réservé à cet usage).
 * - primary : l'action qui fait avancer le parcours ; secondary : utile mais pas principale (neutre) ;
 * - tertiary : rare ou de confort (lien fantôme) ; critical : critique en vol, toujours visible (64 px) ;
 * - danger : destructif (rouge, à l'écart du primaire). Utiliser `ConfirmButton` pour la double confirmation.
 * Tailles : `flight` 64 px, `prep` 48 px (défaut), `touch` 44 px (actions de ligne serrées), `compact` 40 px (jamais en vol).
 * Icône : `icon` + texte par défaut ; sans texte (icône seule) un `aria-label` est obligatoire, il sert aussi d'info-bulle.
 */
export type ButtonRole = "primary" | "secondary" | "tertiary" | "critical" | "danger";
export type ButtonSize = "flight" | "prep" | "touch" | "compact";

export function buttonClass(role: ButtonRole, size?: ButtonSize, extra?: string): string {
  return [`btn-${role}`, size ? `btn-${size}` : "", extra ?? ""].filter(Boolean).join(" ");
}

/** Taille d'icône d'un bouton : 16 px dans les petits boutons (touch, compact), 20 px ailleurs. */
export const iconSizeFor = (size?: ButtonSize): IconSize => (size === "compact" || size === "touch" ? 16 : 20);

export function Button({ role = "secondary", size, icon, className, children, ...rest }: { role?: ButtonRole; size?: ButtonSize; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = rest["aria-label"];
  const hasText = children !== undefined && children !== null && children !== false && children !== "";
  const cls = buttonClass(role, size, [icon ? "has-icon" : "", icon && !hasText ? "icon-only" : "", className ?? ""].filter(Boolean).join(" "));
  return (
    <button {...rest} title={rest.title ?? (icon && !hasText ? label : undefined)} className={cls}>
      {icon && <Icon name={icon} size={iconSizeFor(size)} />}
      {children}
    </button>
  );
}
