import { resolve } from "node:path"
import { paraglideVitePlugin } from "@inlang/paraglide-js"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Relative base so the static build works from any preview path.
  base: "./",
  plugins: [
    // Compiles messages/*.json into src/paraglide/ on dev start and build.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["custom-preferences", "baseLocale"],
      emitTsDeclarations: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      // Generated shadcn files import `cn` from "cn"; keep this alias package-local.
      cn: resolve(import.meta.dirname, "./src/lib/utils.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
})
