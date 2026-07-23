// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

// Dedicated e2e port, distinct from the interactive dev-server port (5173,
// hardcoded+strictPort in vite.config.ts). Concurrent worktrees on this host
// routinely leave a `pnpm dev`/`just dev` server bound to 5173; sharing that
// port let Playwright's reuseExistingServer probe treat a FOREIGN worktree's
// unrelated server as "the" server, producing silent phantom failures
// (deterministic 0-row assertions) instead of a clear connection error.
const E2E_PORT = process.env.PLAYWRIGHT_E2E_PORT ?? "5183";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;

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
  // The mock-mode suite has grown from a handful of files to 50+ tests across
  // a dozen spec files as batches merged; on CI's fixed-core runners this
  // makes the occasional single-worker-starved assertion (a synchronous React
  // state update that should reflect well under the 5s expect timeout, but
  // doesn't when every worker's CPU is oversubscribed) miss its deadline.
  // Locally there is no such contention, so this only retries on CI —
  // keeping 0 retries locally preserves a hard failure signal for genuine
  // regressions during development.
  retries: process.env.CI ? 2 : 0,
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
    // Invoke vite directly (not the `dev` package script via `pnpm --filter
    // … dev -- …`): pnpm's `--` arg-forwarding re-inserts a literal `--`
    // ahead of the forwarded flags, which vite's CLI then treats as "end of
    // options" and silently ignores — `--port`/`--strictPort` never applied,
    // defeating the whole dedicated-port fix. `pnpm exec vite` passes flags
    // straight through. --port/--strictPort override vite.config.ts's
    // hardcoded 5173: this spawns on the dedicated e2e port and fails loudly
    // (EADDRINUSE) rather than silently falling back to a different port a
    // stray process left occupied — the same fail-loud contract
    // vite.config.ts already applies to the interactive dev port.
    command: `pnpm exec vite --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    cwd: __dirname,
    // e2e runs in a headless browser with no Tauri host, so it must use the
    // mock layer. The app default is now real-backend (VITE_USE_MOCKS=false),
    // so pin mocks on explicitly here.
    env: { VITE_USE_MOCKS: "true" },
    url: BASE_URL,
    // Always spawn a fresh server for this dedicated port — never reuse.
    // CI already ran with reuseExistingServer:false (via !process.env.CI);
    // this keeps CI behavior identical while closing the local foreign-
    // worktree-server hazard the dedicated port alone doesn't fully prevent
    // (e.g. a second concurrent local e2e run on the same override port).
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
