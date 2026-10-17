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
 * components. An entry is a name in one of the `components: [...]` arrays of
 * app/catalogue/registry.ts. A name the registry, or a page around it, only
 * imports or mentions is no entry.
 *
 * Usage:
 *   node scripts/check-catalogue.mjs            # exit 1 on a missing entry
 *   node scripts/check-catalogue.mjs --list     # the missing exports, by file
 *   node scripts/check-catalogue.mjs --json     # counts as JSON
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { APP_ROOT } from "./i18n-project.mjs"

const SRC = path.join(APP_ROOT, "src")
const LAYERS = ["components/ui", "components/app", "components/domain", "components/templates"]
const REGISTRY = "app/catalogue/registry.ts"

/** PascalCase, not SCREAMING_CASE: `STATUS_CLASS` is a constant, not a component. */
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/

/** PascalCase runtime exports of one module. */
export function exportsOf(source) {
  const names = new Set()
  for (const match of source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g)) names.add(match[1])
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(",")) {
      if (!item.trim().startsWith("type ")) names.add(item.trim().split(/\s+as\s+/).pop()?.trim() ?? "")
    }
  }
  return [...names].filter((name) => COMPONENT_NAME.test(name))
}

/** The names the registry's entries cover: every string in a `components: [...]` array. */
export function registeredNames(registry) {
  const names = new Set()
  for (const list of registry.matchAll(/\bcomponents:\s*\[([^\]]*)\]/g)) {
    for (const name of list[1].matchAll(/["']([^"']+)["']/g)) names.add(name[1])
  }
  return names
}

/** Each module with exports: its component exports, and those no registry entry covers. */
export function catalogueGaps(registry, modules) {
  const registered = registeredNames(registry)
  // A registry the parser cannot read must fail the gate, not pass it.
  if (registered.size === 0) throw new Error(`no entry found: expected \`components: [...]\` arrays in src/${REGISTRY}`)
  return modules
    .map(({ file, source }) => {
      const names = exportsOf(source)
      return { file, names, missing: names.filter((name) => !registered.has(name)) }
    })
    .filter((module) => module.names.length > 0)
}

function main() {
  const registryPath = path.join(SRC, REGISTRY)
  if (!existsSync(registryPath)) throw new Error(`no catalogue: expected src/${REGISTRY}`)
  const sources = []
  for (const layer of LAYERS) {
    const dir = path.join(SRC, layer)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name)).sort()) {
      sources.push({ file: `${layer}/${file}`, source: readFileSync(path.join(dir, file), "utf8") })
    }
  }
  const modules = catalogueGaps(readFileSync(registryPath, "utf8"), sources)
  const exported = modules.reduce((sum, m) => sum + m.names.length, 0)
  const missing = modules.reduce((sum, m) => sum + m.missing.length, 0)

  if (process.argv.includes("--list")) {
    for (const m of modules.filter((x) => x.missing.length > 0)) console.log(`${m.file}\t${m.missing.join(", ")}`)
    return
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ catalogue: `src/${REGISTRY}`, exported, catalogued: exported - missing, missing }, null, 2))
    return
  }
  console.log(`catalogue check: ${exported - missing} of ${exported} component exports catalogued in src/${REGISTRY}; ${missing} missing.`)
  if (missing > 0) {
    console.error("Run with --list for the missing exports.")
    process.exitCode = 1
  }
}

// Run as a script; imported (by its test), it only exports the checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
