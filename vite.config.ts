import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { startupDevices, startupName } from "./scripts/branding.mjs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "places-apple-startup-images",
      transformIndexHtml() {
        return (
          startupDevices as { name: string; width: number; height: number; dpr: number }[]
        ).flatMap((device) =>
          ["dark", "light"].flatMap((theme) =>
            ["portrait", "landscape"].map((orientation) => ({
              tag: "link",
              attrs: {
                rel: "apple-touch-startup-image",
                href: `/startup-images/${startupName(device, theme, orientation)}`,
                media: `screen and (prefers-color-scheme: ${theme}) and (device-width: ${device.width}px) and (device-height: ${device.height}px) and (-webkit-device-pixel-ratio: ${device.dpr}) and (orientation: ${orientation})`,
              },
            })),
          ),
        );
      },
    },
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
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        globIgnores: ["startup-images/**", "social-*.png"],
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
