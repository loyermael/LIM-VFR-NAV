import type { ElementType, HTMLAttributes } from "react";

/** Six niveaux de texte (voir `styles.css`, « Échelle typographique »). Les chiffres de vol (`xxl`) sont tabulaires. */
export type TextVariant = "xxl" | "title" | "subtitle" | "body" | "label" | "caption";

const TAG: Record<TextVariant, ElementType> = { xxl: "div", title: "h2", subtitle: "h3", body: "p", label: "p", caption: "p" };

export function Text({ variant = "body", as, className, ...rest }: { variant?: TextVariant; as?: ElementType } & HTMLAttributes<HTMLElement>) {
  const Tag = as ?? TAG[variant];
  return <Tag {...rest} className={`t-${variant}${className ? ` ${className}` : ""}`} />;
}
