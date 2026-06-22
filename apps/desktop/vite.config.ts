import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { resolve } from "path";

export default defineConfig(({ mode, command }) => {
  // Precedence: real OS env var > .env file > default ("false" = real backend).
  // NOTE: a `define` on import.meta.env.VITE_USE_MOCKS is merged into the env
  // object and OVERRIDES .env, so it must reflect the resolved value.
  // Browser-only dev (no Tauri host) must opt into mocks: VITE_USE_MOCKS=true.
  const fileEnv = loadEnv(mode, resolve(__dirname), "");
  const useMocks =
    process.env.VITE_USE_MOCKS ?? fileEnv.VITE_USE_MOCKS ?? "false";
  // VITE_DEV_TOOLS: set to "true" only in dev-tools builds (mirrors the
  // Cargo `dev-tools` feature). Release builds omit the flag so the entire
  // dev surface is tree-shaken by the bundler. Default is "false".
  const devTools =
    process.env.VITE_DEV_TOOLS ?? fileEnv.VITE_DEV_TOOLS ?? "false";
  if (command === "serve") {
    // eslint-disable-next-line no-console
    console.log(`[vite] VITE_USE_MOCKS="${useMocks}" VITE_DEV_TOOLS="${devTools}" (mode=${mode})`);
  }

  return {
    plugins: [
      // Compile the message catalog (messages/*.json → src/paraglide/) on dev
      // start + build, with HMR when a message changes. English is hard-pinned
      // via the baseLocale strategy: no locale detection, no switcher (spec 046
      // FR-004). The generated src/paraglide/ output is git-ignored.
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/paraglide",
        strategy: ["baseLocale"],
        // Emit .d.ts alongside the compiled .js so a bare `tsc --noEmit` (which
        // does not run Vite) always finds declarations for `@/paraglide/*` —
        // keeps every compile path (dev, build, vitest, typecheck) consistent.
        emitTsDeclarations: true,
      }),
      react(),
    ],
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_USE_MOCKS": JSON.stringify(useMocks),
      "import.meta.env.VITE_DEV_TOOLS": JSON.stringify(devTools),
    },
  };
});
