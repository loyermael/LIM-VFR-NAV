import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Sous-dossier d'hébergement (GitHub Pages : /LIM-VFR-NAV/) via VITE_BASE ; "/" par défaut.
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "L!M VFR Nav",
        short_name: "L!M Nav",
        description: "Aide à la navigation VFR — pas un moyen primaire",
        display: "standalone",
        orientation: "any",
        background_color: "#15191d",
        theme_color: "#15191d",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      // La grille du géoïde (.bin, 2 Mo) doit être disponible hors-ligne : correction d'altitude en vol.
      workbox: { globPatterns: ["**/*.{js,mjs,css,html,svg,png,json,bin,woff2,pbf}"], maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
    }),
  ],
});
