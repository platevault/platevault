import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

// Keep test resolution, generated messages, and CSS on the same package-local Vite config as the app.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      // Above the setup's 10 s Testing Library wait, so a find that times out reports its own error.
      testTimeout: 20_000,
      globalSetup: ["./vitest.globalSetup.ts"],
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
)
