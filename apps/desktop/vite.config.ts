import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ mode, command }) => {
  // Precedence: real OS env var > .env file > default ("false" = real backend).
  // NOTE: a `define` on import.meta.env.VITE_USE_MOCKS is merged into the env
  // object and OVERRIDES .env, so it must reflect the resolved value.
  // Browser-only dev (no Tauri host) must opt into mocks: VITE_USE_MOCKS=true.
  const fileEnv = loadEnv(mode, resolve(__dirname), "");
  const useMocks =
    process.env.VITE_USE_MOCKS ?? fileEnv.VITE_USE_MOCKS ?? "false";
  if (command === "serve") {
    // eslint-disable-next-line no-console
    console.log(`[vite] VITE_USE_MOCKS="${useMocks}" (mode=${mode})`);
  }

  return {
    plugins: [react()],
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
    },
  };
});
