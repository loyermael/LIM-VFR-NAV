import type { ButtonHTMLAttributes } from "react";

/**
 * Bouton par rôle. Un seul `primary` par écran ou panneau (jaune de marque, réservé à cet usage).
 * - primary : l'action qui fait avancer le parcours ; secondary : utile mais pas principale (neutre) ;
 * - tertiary : rare ou de confort (lien fantôme) ; critical : critique en vol, toujours visible (64 px) ;
 * - danger : destructif (rouge, à l'écart du primaire). Utiliser `ConfirmButton` pour la double confirmation.
 * Tailles : `flight` 64 px, `prep` 48 px (défaut), `touch` 44 px (actions de ligne serrées), `compact` 40 px (jamais en vol). Un primaire fait 56 px, un critique 64 px.
 */
export type ButtonRole = "primary" | "secondary" | "tertiary" | "critical" | "danger";
export type ButtonSize = "flight" | "prep" | "touch" | "compact";

export function buttonClass(role: ButtonRole, size?: ButtonSize, extra?: string): string {
  return [`btn-${role}`, size ? `btn-${size}` : "", extra ?? ""].filter(Boolean).join(" ");
}

export function Button({ role = "secondary", size, className, ...rest }: { role?: ButtonRole; size?: ButtonSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} className={buttonClass(role, size, className)} />;
}
