import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";

/**
 * Spec 002 T025 — Playwright e2e config for the desktop browser mockup.
 *
 * The webServer block spawns the `@astro-plan/desktop` dev server from the
 * repo root via pnpm filter so it runs identically to `just dev`. Playwright
 * waits for the configured URL before launching specs and tears the server
 * down on exit.
 */
export default defineConfig({
  testDir: path.resolve(repoRoot, "tests", "e2e"),
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @astro-plan/desktop dev",
    cwd: repoRoot,
    // e2e runs in a headless browser with no Tauri host, so it must use the
    // mock layer. The app default is now real-backend (VITE_USE_MOCKS=false),
    // so pin mocks on explicitly here.
    env: { VITE_USE_MOCKS: "true" },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
