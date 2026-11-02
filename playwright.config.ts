import { defineConfig, devices } from "@playwright/test";
import { promoIdentityPath } from "./scripts/preview-config.mjs";

export default defineConfig({
  testDir: "tests/browser",
  globalSetup: "./tests/browser/verify-promo.ts",
  fullyParallel: false,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:5174",
    locale: "en-US",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5174",
          localStorage: [{ name: "places-account-choice", value: "done" }],
        },
      ],
    },
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      env: { X_LOCAL_EXPLORER: "false" },
      command:
        "node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to .artifacts/browser-test-db && node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 5174 --inspector-port 0 --var SITES_NATIVE_AUTH:true --persist-to .artifacts/browser-test-db",
      url: "http://127.0.0.1:5174/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "node scripts/serve-promo.mjs",
      url: `http://127.0.0.1:5175${promoIdentityPath}`,
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
