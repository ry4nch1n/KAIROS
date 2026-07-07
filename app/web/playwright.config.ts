import { defineConfig, devices } from "@playwright/test";

// E2E for the KAIROS SPA. Runs against the full dev stack — Express API (:8787)
// + Vite web (:5173), same as `npm run dev`. Smoke specs exercise real seeded
// data; resilience specs mock /api/* at the browser layer (Playwright route
// interception) to reproduce error/slow states no DB seed can produce.
//
// Prerequisite: a seeded DB (`npm run db:seed`). Locally, Playwright reuses an
// already-running dev server; in CI it boots one (seed first — see ci.yml note).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    cwd: "..",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
