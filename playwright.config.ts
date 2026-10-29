import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5174", locale: "en-US" },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    env: { X_LOCAL_EXPLORER: "false" },
    command:
      "node node_modules/wrangler/bin/wrangler.js dev --ip 127.0.0.1 --port 5174 --inspector-port 0",
    url: "http://127.0.0.1:5174/api/health",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
