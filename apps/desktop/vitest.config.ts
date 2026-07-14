// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  define: {
    // Tests do NOT enable dev-tools; the release gate checks this is "false".
    // VITE_USE_MOCKS is intentionally not set here — tests that need mocks
    // use vi.mock('@tauri-apps/api/core') directly (see recorder.test.ts,
    // source-views.test.ts). WizardPage tests use vi.mock for store/commands.
    "import.meta.env.VITE_DEV_TOOLS": JSON.stringify("false"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Exclude Playwright e2e specs and any node_modules.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", "../../tests/e2e/**"],
    passWithNoTests: true,
  },
});
