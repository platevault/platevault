#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Catalogue completeness (design/R9-COMPOSITION-PLAN.md §8.3): every
 * component exported from components/{ui,app,domain,templates} has an entry
 * in the design-system catalogue. It fails on a missing entry (W4), inside
 * `pnpm lint` and `pnpm build`.
 *
 * Exports are PascalCase names from `export function|const|class X` and
 * `export { X, … }` lists (the shadcn files export that way); types are not
 * components. The catalogue is app/catalogue/registry.ts plus the reference
 * page that renders it, app/design-system-page.tsx. A name the catalogue
 * mentions as a word counts as an entry.
 *
 * Usage:
 *   node scripts/check-catalogue.mjs            # exit 1 on a missing entry
 *   node scripts/check-catalogue.mjs --list     # the missing exports, by file
 *   node scripts/check-catalogue.mjs --json     # counts as JSON
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { APP_ROOT } from "./i18n-project.mjs"

const SRC = path.join(APP_ROOT, "src")
const LAYERS = ["components/ui", "components/app", "components/domain", "components/templates"]
const CATALOGUES = ["app/catalogue/registry.ts", "app/design-system-page.tsx"]

/** PascalCase, not SCREAMING_CASE: `STATUS_CLASS` is a constant, not a component. */
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/

/** PascalCase runtime exports of one module. */
function exportsOf(source) {
  const names = new Set()
  for (const match of source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g)) names.add(match[1])
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(",")) {
      if (!item.trim().startsWith("type ")) names.add(item.trim().split(/\s+as\s+/).pop()?.trim() ?? "")
    }
  }
  return [...names].filter((name) => COMPONENT_NAME.test(name))
}

function main() {
  // The registry lists the entries; the reference page around them demonstrates the tokens and older samples.
  const catalogues = CATALOGUES.filter((file) => existsSync(path.join(SRC, file)))
  if (catalogues.length === 0) throw new Error(`no catalogue: expected one of ${CATALOGUES.map((f) => `src/${f}`).join(", ")}`)
  const catalogue = catalogues.join(" + src/")
  const listed = catalogues.map((file) => readFileSync(path.join(SRC, file), "utf8")).join("\n")
  const modules = []
  for (const layer of LAYERS) {
    const dir = path.join(SRC, layer)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name)).sort()) {
      const names = exportsOf(readFileSync(path.join(dir, file), "utf8"))
      if (names.length > 0) modules.push({ file: `${layer}/${file}`, names, missing: names.filter((name) => !new RegExp(`\\b${name}\\b`).test(listed)) })
    }
  }
  const exported = modules.reduce((sum, m) => sum + m.names.length, 0)
  const missing = modules.reduce((sum, m) => sum + m.missing.length, 0)

  if (process.argv.includes("--list")) {
    for (const m of modules.filter((x) => x.missing.length > 0)) console.log(`${m.file}\t${m.missing.join(", ")}`)
    return
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ catalogue: `src/${catalogue}`, exported, catalogued: exported - missing, missing }, null, 2))
    return
  }
  console.log(`catalogue check: ${exported - missing} of ${exported} component exports catalogued in src/${catalogue}; ${missing} missing.`)
  if (missing > 0) {
    console.error("Run with --list for the missing exports.")
    process.exitCode = 1
  }
}

main()
