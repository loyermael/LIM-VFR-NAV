export type Lang = "fr" | "en";

const dict = {
  fr: {
    "warning.title": "Aide à la navigation",
    "warning.body":
      "L!M VFR Nav est une aide à la navigation. Ce n'est pas un moyen de navigation primaire. Les données peuvent être absentes, périmées ou erronées. Le pilote reste seul responsable de la sécurité du vol et doit utiliser les cartes et documents officiels à jour.",
    "warning.accept": "J'ai compris",
    "map.day": "Jour",
    "map.night": "Nuit",
    "map.empty": "Aucune carte installée",
    "lang.switch": "English",
  },
  en: {
    "warning.title": "Navigation aid",
    "warning.body":
      "L!M VFR Nav is a navigation aid. It is not a primary means of navigation. Data may be missing, outdated or wrong. The pilot remains solely responsible for flight safety and must use current official charts and documents.",
    "warning.accept": "I understand",
    "map.day": "Day",
    "map.night": "Night",
    "map.empty": "No chart installed",
    "lang.switch": "Français",
  },
} as const;

export type Key = keyof (typeof dict)["fr"];

export const KEYS = Object.keys(dict.fr) as Key[];

export function detectLang(): Lang {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr")
    ? "fr"
    : "en";
}

export const t = (lang: Lang, key: Key): string => dict[lang][key];
