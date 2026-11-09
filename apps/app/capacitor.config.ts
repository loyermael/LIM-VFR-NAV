import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Coque native Android de L!M VFR Nav : la même application web (dossier `dist`) dans une WebView,
 * plus des plugins natifs (baromètre ici ; GPS en arrière-plan et trafic Wi-Fi plus tard).
 * L'application fonctionne sans réseau : tout est embarqué dans l'APK.
 */
const config: CapacitorConfig = {
  appId: "fr.lim.vfrnav",
  appName: "L!M VFR Nav",
  webDir: "dist",
  android: {
    // Les cartes MBTiles sont lues par notre protocole « lim:// » dans la page, pas par le réseau.
    allowMixedContent: false,
  },
};

export default config;
