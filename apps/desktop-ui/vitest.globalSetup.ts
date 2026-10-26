import { execFileSync } from "node:child_process"

/** Compile the package's message catalogue before any test imports generated messages. */
export default function setup(): void {
  execFileSync("pnpm", ["i18n:compile"], {
    cwd: import.meta.dirname,
    encoding: "utf8",
    stdio: "pipe",
  })
}
