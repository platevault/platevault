import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  define: {
    "import.meta.env.VITE_USE_MOCKS": JSON.stringify(
      process.env.VITE_USE_MOCKS ?? "false",
    ),
  },
});
