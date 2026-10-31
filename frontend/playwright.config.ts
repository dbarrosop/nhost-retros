import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 30_000,
  // Let a test timeout report and tear down before the outer process cap.
  globalTimeout: 480_000,
  use: {
    baseURL: "http://localhost:5173",
    actionTimeout: 10_000,
    // Auth material must never enter traces, videos or persisted storage states.
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: { args: ["--host-resolver-rules=MAP *.local.nhost.run 127.0.0.1"] },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm exec vite --host localhost --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
