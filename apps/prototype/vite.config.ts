import { resolve } from "node:path"
import { paraglideVitePlugin } from "@inlang/paraglide-js"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Relative base so the static build works from any preview path.
  base: "./",
  plugins: [
    // Compiles messages/*.json into src/paraglide/ (git-ignored) on dev start
    // and build, with HMR when a message changes. The strategy chain must match
    // the `i18n:compile` script: the saved preference ("custom-preferences",
    // src/app/preferences.ts), then the en-GB base locale.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["custom-preferences", "baseLocale"],
      // .d.ts beside the compiled .js, so `tsc` (which does not run Vite) finds the declarations.
      emitTsDeclarations: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      // Generated shadcn files import `cn` from "cn"; it resolves to the local
      // clsx + tailwind-merge helper so `shadcn add` output stays unmodified.
      cn: resolve(import.meta.dirname, "./src/lib/utils.ts"),
    },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
  // A local desktop app loads one bundle from disk; route splitting buys nothing here.
  build: { chunkSizeWarningLimit: 1500 },
})
