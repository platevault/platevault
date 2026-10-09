#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ESLint gate with a baseline for the i18n rules (port of the legacy
 * scripts/check-eslint-baseline.mjs).
 *
 * eslint.config.js runs alm/no-user-string and alm/no-js-plural at error
 * severity on migrated folders and at warn severity on the rest of src/,
 * which is not migrated yet. This wrapper runs that config and:
 *
 *   - fails on every error, so a migrated folder stays clean;
 *   - holds each unmigrated file's warning count, per rule, to
 *     scripts/eslint-i18n-baseline.json. More warnings than recorded (new
 *     hardcoded copy, or a new file) fails. Fewer also fails until the
 *     baseline is regenerated, so the recorded debt only ever shrinks and
 *     cannot silently make room for new strings;
 *   - fails on a warning from any other rule (the config should raise none).
 *
 * Counts per file rather than the legacy line-keyed entries: unmigrated
 * files are still being edited, and a moved line is not new debt.
 *
 * Usage:
 *   node scripts/check-eslint-baseline.mjs              # enforce
 *   node scripts/check-eslint-baseline.mjs --generate   # rewrite the baseline to the current warnings
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"

const here = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(here, "..")
const LINT_TARGET = "src/"
const BASELINE_PATH = path.join(here, "eslint-i18n-baseline.json")
const BASELINED_RULES = new Set(["alm/no-user-string", "alm/no-js-plural"])

/**
 * The file's path relative to the app, forward slashes on every platform:
 * path.relative() returns backslashes on Windows, which would never match the
 * checked-in baseline (a literal backslash replace, not path.sep, which is
 * "/" on POSIX and would hide the bug there).
 */
function relativePath(filePath) {
  return path.relative(APP_ROOT, filePath).replaceAll("\\", "/")
}

/** A run over zero files reports nothing to fix, so the gate would pass while measuring nothing. */
function lintedFileFloorError(count, target) {
  if (count > 0) return null
  return `eslint linted ${count} file(s) under ${target}: the lint target moved or the config excludes everything, so this gate measures nothing until that is fixed.`
}

/** { [file]: { [rule]: count } } from the checked-in baseline; empty when there is none. */
function loadBaseline() {
  let raw
  try {
    raw = readFileSync(BASELINE_PATH, "utf8")
  } catch {
    return {}
  }
  return JSON.parse(raw).files ?? {}
}

/** One line per file, sorted, so parallel migrations touch separate lines. */
function writeBaseline(counts) {
  const files = Object.keys(counts).sort()
  const rows = files.map((file) => {
    const rules = Object.fromEntries(Object.entries(counts[file]).sort(([a], [b]) => a.localeCompare(b)))
    return `    ${JSON.stringify(file)}: ${JSON.stringify(rules)}`
  })
  const body = [
    "{",
    '  "description": "Unmigrated i18n debt: alm/no-user-string and alm/no-js-plural warnings per file. scripts/check-eslint-baseline.mjs fails when a count differs. Only ever shrinks; see design/I18N.md.",',
    '  "regenerate": "pnpm lint:baseline --generate",',
    `  "files": {${rows.length > 0 ? `\n${rows.join(",\n")}\n  ` : ""}}`,
    "}",
    "",
  ]
  writeFileSync(BASELINE_PATH, body.join("\n"))
}

function totals(counts) {
  const sum = {}
  for (const rules of Object.values(counts)) for (const [rule, n] of Object.entries(rules)) sum[rule] = (sum[rule] ?? 0) + n
  return Object.entries(sum)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, n]) => `${n} ${rule}`)
    .join(", ")
}

async function main() {
  const eslint = new ESLint({ cwd: APP_ROOT })
  const results = await eslint.lintFiles([LINT_TARGET])

  const floorError = lintedFileFloorError(results.length, LINT_TARGET)
  if (floorError !== null) {
    console.error(floorError)
    process.exitCode = 1
    return
  }

  const blocking = []
  /** Current warnings per file and rule, and the messages behind them for the report. */
  const counts = {}
  const warnings = {}
  for (const result of results) {
    const file = relativePath(result.filePath)
    for (const message of result.messages) {
      if (message.severity === 1 && BASELINED_RULES.has(message.ruleId)) {
        counts[file] ??= {}
        counts[file][message.ruleId] = (counts[file][message.ruleId] ?? 0) + 1
        ;(warnings[`${file}\t${message.ruleId}`] ??= []).push(message)
        continue
      }
      blocking.push(`${file}:${message.line}:${message.column}  [${message.ruleId ?? "eslint"}]  ${message.message}`)
    }
  }

  if (process.argv.includes("--generate")) {
    if (blocking.length > 0) {
      for (const line of blocking) console.error(line)
      console.error(`\nbaseline NOT regenerated: ${blocking.length} error(s) must be fixed first; only warnings are baselined.`)
      process.exitCode = 1
      return
    }
    writeBaseline(counts)
    console.log(`eslint-i18n-baseline.json regenerated: ${Object.keys(counts).length} file(s); ${totals(counts) || "no warnings"}.`)
    return
  }

  const baseline = loadBaseline()
  const grown = []
  const shrunk = []
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    for (const rule of BASELINED_RULES) {
      const now = counts[file]?.[rule] ?? 0
      const recorded = baseline[file]?.[rule] ?? 0
      if (now > recorded) grown.push({ file, rule, now, recorded })
      else if (now < recorded) shrunk.push({ file, rule, now, recorded })
    }
  }

  for (const line of blocking) console.error(line)
  for (const { file, rule, now, recorded } of grown) {
    console.error(`${file}  [${rule}]  ${now} warning(s), baseline ${recorded}:`)
    for (const message of warnings[`${file}\t${rule}`] ?? []) console.error(`    ${message.line}:${message.column}  ${message.message}`)
  }
  for (const { file, rule, now, recorded } of shrunk) console.error(`${file}  [${rule}]  ${now} warning(s), baseline ${recorded}: the debt shrank, lock it in with --generate`)

  if (blocking.length === 0 && grown.length === 0 && shrunk.length === 0) {
    console.log(`eslint: OK (${results.length} files linted; baselined warnings: ${totals(counts) || "none"}).`)
    return
  }
  console.error(
    `\neslint FAILED: ${blocking.length} error(s), ${grown.length} file(s) above the baseline, ${shrunk.length} below it.` +
      "\nMove new copy into messages/en-GB.json and messages/pt-BR.json and use m.<key>() (design/I18N.md); for a genuinely" +
      "\nnon-user-facing string, use `// eslint-disable-next-line alm/no-user-string -- <reason>`. Run `pnpm lint:baseline --generate`" +
      "\nonly to record a shrink, or once after merging branches that were cut before the gate existed.",
  )
  process.exitCode = 1
}

await main()
