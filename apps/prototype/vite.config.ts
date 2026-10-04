import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  // Relative base so the static build works from any preview path.
  base: "./",
  plugins: [react(), tailwindcss()],
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
