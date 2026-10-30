import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { startupDevices, startupName } from "./scripts/branding.mjs";
import { previewIdentity, previewIdentityPath, previewPort } from "./scripts/preview-config.mjs";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "places-preview-identity",
      configureServer(server) {
        server.middlewares.use(previewIdentityPath, (_request, response) => {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(previewIdentity));
        });
      },
    },
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
        description: "Save GPS places with photos. Find them offline and share with groups.",
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
  server: {
    host: "127.0.0.1",
    port: previewPort,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:5174" },
  },
});
