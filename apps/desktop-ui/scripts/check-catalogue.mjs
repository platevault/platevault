#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Catalogue completeness (design/R9-COMPOSITION-PLAN.md §8.3): every
 * component exported from components/{ui,app,domain,templates}, subfolders
 * included, has an entry in the design-system catalogue, and every entry
 * names a real export. It runs in `pnpm lint`, which CI runs, and fails on a
 * missing entry (W4) or on a registered name that nothing exports: a stale
 * name would let a later export of that name pass with no specimen.
 *
 * Exports come from the TypeScript parser: functions (async ones too),
 * classes, const/let/var declarations, default exports, `export { … }` lists
 * (the shadcn files export that way), re-exports and `export * from` a
 * scanned module. Types are not components: interfaces, type aliases and
 * type-only exports are skipped. Only PascalCase names count. An entry is a
 * name in one of the `components: [...]` arrays of app/catalogue/registry.ts.
 * A name the registry, or a page around it, only imports or mentions is no
 * entry.
 *
 * Usage:
 *   node scripts/check-catalogue.mjs            # exit 1 on a missing or stale entry
 *   node scripts/check-catalogue.mjs --list     # the missing exports by file, then the stale names
 *   node scripts/check-catalogue.mjs --json     # counts as JSON
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { APP_ROOT } from "./i18n-project.mjs"

const SRC = path.join(APP_ROOT, "src")
const LAYERS = ["components/ui", "components/app", "components/domain", "components/templates"]
const REGISTRY = "app/catalogue/registry.ts"
const SOURCE_FILE = /\.tsx?$/
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]

/** PascalCase, not SCREAMING_CASE: `STATUS_CLASS` is a constant, not a component. */
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/

function hasModifier(node, kind) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
}

/** Every identifier a declaration binds, through destructuring patterns. */
function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)))
}

/** Names the module declares only as types, so a plain `export { X }` of one exports no value. */
function localTypeNames(statements) {
  const names = new Set()
  for (const statement of statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) names.add(statement.name.text)
    const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined
    if (!clause) continue
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
      if (clause.name) names.add(clause.name.text)
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) names.add(element.name.text)
    } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) if (element.isTypeOnly) names.add(element.name.text)
    }
  }
  return names
}

/** The scanned module an `export * from` specifier names: relative, or through the `@/` alias for src/. */
function resolveModule(from, specifier, byFile) {
  const base = specifier.startsWith("@/") ? specifier.slice(2) : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(from), specifier) : null
  const file = base === null ? undefined : RESOLVE_SUFFIXES.map((suffix) => base + suffix).find((candidate) => byFile.has(candidate))
  if (!file) throw new Error(`${from}: cannot list the exports of \`export * from "${specifier}"\`: it names no scanned module`)
  return byFile.get(file)
}

/**
 * The runtime exports of one module, by exported name, each mapped to the
 * name it is catalogued under: a default export counts under its local name.
 */
function runtimeExports(module, byFile, visiting) {
  const { file, source } = module
  if (visiting.has(file)) throw new Error(`${file}: \`export *\` cycle through ${[...visiting].join(", ")}`)
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const typeOnly = localTypeNames(sourceFile.statements)
  const names = new Map()
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (!clause) {
        // `export * from "./x"`: what x exports, less its default (ES re-exports no default through `*`).
        const target = resolveModule(file, statement.moduleSpecifier.text, byFile)
        for (const [exported, name] of runtimeExports(target, byFile, new Set([...visiting, file]))) if (exported !== "default") names.set(exported, name)
      } else if (ts.isNamespaceExport(clause)) {
        names.set(clause.name.text, clause.name.text)
      } else {
        for (const element of clause.elements) {
          const local = (element.propertyName ?? element.name).text
          if (element.isTypeOnly || (!statement.moduleSpecifier && typeOnly.has(local))) continue
          const exported = element.name.text
          names.set(exported, exported === "default" ? local : exported)
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      if (!ts.isIdentifier(statement.expression)) throw new Error(`${file}: an anonymous default export has no name to catalogue`)
      names.set("default", statement.expression.text)
    } else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (!statement.name) throw new Error(`${file}: an anonymous default export has no name to catalogue`)
        names.set(hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name.text, statement.name.text)
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) for (const name of bindingNames(declaration.name)) names.set(name, name)
      }
    }
  }
  return names
}

/**
 * PascalCase runtime exports of one module. `modules` are the other scanned
 * modules, which an `export * from` may name.
 */
export function exportsOf(module, modules = [module]) {
  const byFile = new Map(modules.map((candidate) => [candidate.file, candidate]))
  return [...new Set(runtimeExports(module, byFile, new Set()).values())].filter((name) => COMPONENT_NAME.test(name))
}

/** The names the registry's entries cover: every string in a `components: [...]` array. */
export function registeredNames(registry) {
  const names = new Set()
  for (const list of registry.matchAll(/\bcomponents:\s*\[([^\]]*)\]/g)) {
    for (const name of list[1].matchAll(/["']([^"']+)["']/g)) names.add(name[1])
  }
  return names
}

/**
 * Both directions of the gap: each module with component exports, with those
 * no registry entry covers, and the registered names no module exports.
 */
export function catalogueGaps(registry, modules) {
  const registered = registeredNames(registry)
  // A registry the parser cannot read must fail the gate, not pass it.
  if (registered.size === 0) throw new Error(`no entry found: expected \`components: [...]\` arrays in src/${REGISTRY}`)
  const exported = new Set()
  const gaps = modules
    .map((module) => {
      const names = exportsOf(module, modules)
      for (const name of names) exported.add(name)
      return { file: module.file, names, missing: names.filter((name) => !registered.has(name)) }
    })
    .filter((module) => module.names.length > 0)
  return { modules: gaps, unexported: [...registered].filter((name) => !exported.has(name)).sort() }
}

/** Every .ts/.tsx module under the layers, subfolders included, as paths relative to `src`. */
export function layerModules(src) {
  const modules = []
  for (const layer of LAYERS) {
    const dir = path.join(src, layer)
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) => SOURCE_FILE.test(name)).sort()) {
      modules.push({ file: `${layer}/${file.split(path.sep).join("/")}`, source: readFileSync(path.join(dir, file), "utf8") })
    }
  }
  return modules
}

function main() {
  const registryPath = path.join(SRC, REGISTRY)
  if (!existsSync(registryPath)) throw new Error(`no catalogue: expected src/${REGISTRY}`)
  const { modules, unexported } = catalogueGaps(readFileSync(registryPath, "utf8"), layerModules(SRC))
  const exported = modules.reduce((sum, m) => sum + m.names.length, 0)
  const missing = modules.reduce((sum, m) => sum + m.missing.length, 0)

  if (process.argv.includes("--list")) {
    for (const m of modules.filter((x) => x.missing.length > 0)) console.log(`${m.file}\t${m.missing.join(", ")}`)
    if (unexported.length > 0) console.log(`src/${REGISTRY}\tno export: ${unexported.join(", ")}`)
    return
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ catalogue: `src/${REGISTRY}`, exported, catalogued: exported - missing, missing, unexported }, null, 2))
    return
  }
  console.log(`catalogue check: ${exported - missing} of ${exported} component exports catalogued in src/${REGISTRY}; ${missing} missing; ${unexported.length} registered names export nothing.`)
  if (missing > 0 || unexported.length > 0) {
    console.error("Run with --list for the missing exports and the stale names.")
    process.exitCode = 1
  }
}

// Run as a script; imported (by its test), it only exports the checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
