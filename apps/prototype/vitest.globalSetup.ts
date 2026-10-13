import { execFileSync } from "node:child_process"

/**
 * Compiles the Paraglide catalogue before any suite loads. `src/paraglide/` is generated and git-ignored, and
 * `@/lib/i18n` imports it, so on a tree that never compiled it every suite fails at import. A global setup runs
 * once per vitest process, whichever way vitest starts (`pnpm test`, watch mode, one file). It runs the
 * package's own `i18n:compile` script, so the compile options stay in one place.
 */
export default function setup(): void {
  try {
    execFileSync("pnpm", ["i18n:compile"], { cwd: import.meta.dirname, encoding: "utf8", stdio: "pipe" })
  } catch (error) {
    // pnpm and Paraglide report on both streams; vitest shows only this error.
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string }
    throw new Error(`pnpm i18n:compile failed:\n${stdout}${stderr}`, { cause: error })
  }
}
