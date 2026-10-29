import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        id: "/",
        name: "Voltura Places",
        short_name: "Places",
        description: "Save a place. Find your way back.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#111b17",
        theme_color: "#111b17",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/signin-with-chatgpt/,
          /^\/signout-with-chatgpt/,
          /^\/callback/,
        ],
        runtimeCaching: [],
      },
    }),
  ],
  build: { outDir: ".artifacts/client", emptyOutDir: true, sourcemap: false },
  server: { proxy: { "/api": "http://127.0.0.1:5174" } },
});
