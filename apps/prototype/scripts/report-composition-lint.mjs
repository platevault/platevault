#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Composition lint report (design/R9-COMPOSITION-PLAN.md §8.1-§8.2).
 *
 * Runs ESLint with the gate's eslint.config.js over src/ and counts the
 * composition findings per rule id ([L1]…, [I1]…) and area (features, app,
 * components), next to the counts saved in design/R10-CENSUS-BASELINE.json
 * (`lint.rules`). Since W4 the rules are errors: any finding fails, and so
 * does anything else ESLint reports (a parse error, a base-rule error),
 * because the counts would be wrong.
 *
 * Usage:
 *   node scripts/report-composition-lint.mjs            # table with the baseline delta
 *   node scripts/report-composition-lint.mjs --json     # counts only, the baseline's `lint.rules` shape
 *   node scripts/report-composition-lint.mjs --list L6  # every location of one rule
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import { COMPOSITION_SYNTAX } from "../eslint-rules/composition.js"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE = path.join(root, "design", "R10-CENSUS-BASELINE.json")
const AREAS = ["features", "app", "components"]
const TAG = /\[([LI]\d+)\]/
/** The layer and area import rules (eslint.config.js, eslint-rules/composition.js), after the syntax rules. */
const IMPORT_IDS = ["I1", "I2", "I3", "I4", "I5", "I6"]

/** Rule ids in rule order, so a rule that reports nothing still shows as 0. */
function ruleIds() {
  return [...new Set([...COMPOSITION_SYNTAX.map((rule) => rule.message.match(TAG)?.[1] ?? ""), ...IMPORT_IDS])]
}

function areaOf(filePath) {
  const top = path.relative(path.join(root, "src"), filePath).split(path.sep)[0]
  return AREAS.includes(top) ? top : "other"
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")).lint?.rules ?? null
  } catch {
    return null
  }
}

async function main() {
  const eslint = new ESLint({ cwd: root })
  const results = await eslint.lintFiles(["src/"])
  const ids = ruleIds()
  const counts = Object.fromEntries(ids.map((id) => [id, { total: 0, ...Object.fromEntries(AREAS.map((a) => [a, 0])) }]))
  const locations = Object.fromEntries(ids.map((id) => [id, []]))
  const unexpected = []
  for (const result of results) {
    for (const message of result.messages) {
      const id = message.message.match(TAG)?.[1]
      const where = `${path.relative(root, result.filePath)}:${message.line}:${message.column}`
      if (!id || !counts[id]) {
        unexpected.push(`${where} ${message.ruleId ?? "fatal"}: ${message.message}`)
        continue
      }
      counts[id].total += 1
      const area = areaOf(result.filePath)
      if (area in counts[id]) counts[id][area] += 1
      locations[id].push(where)
    }
  }

  const listIndex = process.argv.indexOf("--list")
  if (listIndex !== -1) {
    const id = process.argv[listIndex + 1]
    if (!id || !locations[id]) throw new Error(`--list needs a rule id: ${ids.join(", ")}`)
    for (const where of locations[id]) console.log(where)
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(counts, null, 2))
  } else {
    const baseline = readBaseline()
    const total = Object.values(counts).reduce((sum, c) => sum + c.total, 0)
    console.log(`composition lint: ${total} finding(s) in ${results.length} files${baseline ? "" : "; no baseline in design/R10-CENSUS-BASELINE.json"}\n`)
    console.log(["rule", "total", ...AREAS, "baseline", "delta"].map((h) => h.padStart(12)).join(""))
    for (const id of ids) {
      const base = baseline?.[id]?.total
      const delta = base === undefined ? "–" : counts[id].total - base
      console.log([id, counts[id].total, ...AREAS.map((a) => counts[id][a]), base ?? "–", delta > 0 ? `+${delta}` : delta].map((v) => String(v).padStart(12)).join(""))
    }
  }

  const findings = Object.values(counts).reduce((sum, c) => sum + c.total, 0)
  if (findings > 0) {
    console.error(`\n${findings} composition finding(s): run with --list <rule> for their locations.`)
    process.exitCode = 1
  }
  if (unexpected.length > 0) {
    console.error(`\n${unexpected.length} problem(s) outside the composition rules; the counts above are incomplete:`)
    for (const line of unexpected) console.error(`  ${line}`)
    process.exitCode = 1
  }
}

await main()
