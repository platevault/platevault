// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Compile the Paraglide message catalogue before any suite loads.
 *
 * `src/paraglide/` is generated and gitignored, and `src/lib/i18n.ts` imports
 * from it, so on a tree that has never compiled it EVERY suite fails at import
 * with `Failed to resolve import "@/paraglide/messages"`.
 *
 * package.json wires a `pretest` hook, which npm/pnpm run for `pnpm test` —
 * but NOT for `pnpm vitest run <file>`, `vitest --watch`, or an IDE runner
 * invoking vitest directly. Those are exactly the commands used to iterate on
 * one spec, so the papercut landed on the narrow inner loop while the
 * full-suite path stayed green.
 *
 * A globalSetup runs once per vitest process regardless of entrypoint, so it
 * covers every one of those paths. `pretest` is left in place: it costs
 * nothing, and it keeps `pnpm test` working if this file is ever removed.
 */
export default function setup(): void {
  const dir = resolve(__dirname, "src/paraglide");

  try {
    execFileSync(
      "pnpm",
      [
        "exec",
        "paraglide-js",
        "compile",
        "--project",
        "./project.inlang",
        "--outdir",
        "./src/paraglide",
        "--strategy",
        "custom-almSettings",
        "preferredLanguage",
        "baseLocale",
        "--emit-ts-declarations",
      ],
      { cwd: __dirname, stdio: "pipe" },
    );
    return;
  } catch (error) {
    // Only fatal if the catalogue is genuinely absent. If a previous compile
    // already produced it, a failure here (offline, transient CLI problem) is
    // not worth blocking a test run that would otherwise pass.
    if (existsSync(dir)) {
      console.warn(
        `[vitest] paraglide compile failed; reusing the existing ${dir}. ` +
          `Message changes may not be reflected.\n${String(error)}`,
      );
      return;
    }
    throw new Error(
      `Could not compile the Paraglide catalogue, and no previous output exists at ${dir}. ` +
        `Every suite that imports '@/paraglide/messages' will fail to load. ` +
        `Run \`pnpm i18n:compile\` in apps/desktop to diagnose.\n${String(error)}`,
    );
  }
}
