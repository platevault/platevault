/**
 * Playwright config for the real-backend e2e harness.
 *
 * This config drives the full Tauri application — real Rust backend, real
 * SQLite IPC, no mock layer. It is separate from the existing
 * `playwright.config.ts` (which uses `VITE_USE_MOCKS=true`).
 *
 * Prerequisites (all installed in WSL as of 2026-06-17):
 *   webkit2gtk-4.1, xvfb, tauri-driver, WebKitWebDriver
 *
 * Usage:
 *   cd apps/desktop
 *   pnpm exec playwright test --config e2e/playwright.real-backend.config.ts
 *
 * Or via the script alias:
 *   pnpm test:e2e:real
 *
 * The webServer block below starts a Vite dev server with mocks disabled.
 * Individual spec files start/stop the Tauri process themselves via
 * `tauri-driver` + `WebKitWebDriver` (W3C WebDriver), OR they connect to
 * the Vite-served shell directly via Playwright (Chromium/WebKit) when the
 * Tauri bridge is not required for the specific assertion.
 *
 * For tests that only need routing/render assertions against the real backend
 * env vars (VITE_USE_MOCKS=false), the chromium project is sufficient.
 * For tests that need real Tauri IPC (invoke calls), use the webkit project
 * which connects via WebKitWebDriver to the running tauri-driver instance.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// The Vite dev server for the real-backend mode runs on a different port
// than the mocks-UI server to allow both to coexist during development.
const REAL_BACKEND_PORT = 1420;
const BASE_URL =
  process.env.PLAYWRIGHT_REAL_BASE_URL ?? `http://127.0.0.1:${REAL_BACKEND_PORT}`;

export default defineConfig({
  // Real-backend tests live exclusively under e2e/real-backend/
  testDir: path.resolve(__dirname, "real-backend"),
  // Real-backend tests must run serially: SQLite cannot handle concurrent
  // writers, and the tauri-driver session is single-instance per process.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    // Longer navigation timeout for the real backend (cold-start + migrations).
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // Chromium project: exercises the Vite-served shell with VITE_USE_MOCKS=false.
      // No Tauri IPC available — use for routing, render, and env-flag assertions.
      name: "chromium-real-env",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // The webServer starts the Vite frontend with mocks disabled.
  // Individual tests that need the full Tauri binary must start tauri-driver
  // themselves via the helpers in e2e/helpers/tauri-app.ts.
  webServer: {
    command: [
      "pnpm --filter @astro-plan/desktop exec",
      `vite --host 127.0.0.1 --port ${REAL_BACKEND_PORT} --strictPort`,
    ].join(" "),
    cwd: repoRoot,
    env: {
      VITE_USE_MOCKS: "false",
    },
    url: BASE_URL,
    // Always spawn a fresh server for real-backend tests to ensure the
    // VITE_USE_MOCKS=false env is honoured (the mocks-UI server uses true).
    reuseExistingServer: false,
    timeout: 90_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
