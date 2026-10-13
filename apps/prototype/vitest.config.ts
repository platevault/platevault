import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

// The app's own Vite config (aliases, React, the Paraglide plugin), plus the test runner.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // jsdom, not happy-dom: Base UI runs its own suite in jsdom, so its portals, focus management and
      // pointer handling are proven there. Vitest's jsdom runs with `pretendToBeVisual`, so
      // requestAnimationFrame exists for Base UI's open and close transitions.
      environment: "jsdom",
      // `pnpm i18n:compile` once per run, whichever way vitest starts (pnpm test, watch, one file).
      globalSetup: ["./vitest.globalSetup.ts"],
      // The jsdom gaps the app reads at import, jest-dom matchers, cleanup, and the test locale.
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
)
