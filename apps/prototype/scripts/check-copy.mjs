#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy lint (design/R9-COMPOSITION-PLAN.md §6.1, §6.4) over the base
 * catalogue. It fails on any finding (W4), inside `pnpm lint:i18n` and
 * `pnpm build`.
 *
 *   1. slop-word: a W10 word ("we", "please", "simply", "just", "easily",
 *      "seamlessly", "powerful", "leverage", "Note that", "This will").
 *   2. prototype-word: a W9 word ("prototype", "simulated", "fixture",
 *      "harness") outside the `prototype_*` and `simulation_*` keys.
 *   3. title-case: a label or button in Title Case instead of sentence case
 *      (W2). Product and place names stay capitalised (PROPER_NOUNS).
 *   4. label-period: a label key (`*_title`, `*_label`, `verb_*`,
 *      `*_action`) ending in a full stop.
 *   5. button-length: a button longer than 3 words (W2); a `{placeholder}`
 *      counts as one word. A button is a button key (`verb_*`, `*_action`,
 *      `*_button`) or a key an Action in src/ takes as its label.
 *   6. ellipsis: a value ending in "…" whose key does not end in `_ellipsis`,
 *      the convention for a control that opens a dialog (W2).
 *
 * Plural variant messages are checked through each variant's text. title-case
 * and button-length treat both kinds of button alike.
 *
 * Action labels are found statically: an object literal in src/ (tests and
 * fixtures aside) with a `run` property and a `label` that calls `m.<key>(…)`,
 * directly, in either branch of a `?:`, or through a `const` of the same file.
 * Not found: an Action whose `run` or `label` comes from a spread or a helper,
 * a label taken from a parameter or another file, and the `{ label, kind }`
 * confirm button of a ConfirmSpec, which has no `run`.
 *
 * Usage:
 *   node scripts/check-copy.mjs                    # exit 1 on any finding
 *   node scripts/check-copy.mjs --list title-case  # the keys of one check
 *   node scripts/check-copy.mjs --json             # counts as JSON
 */

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { APP_ROOT, inlangProject, readJson } from "./i18n-project.mjs"

const SLOP = /\b(we|please|simply|just|easily|seamlessly|powerful|leverage|note that|this will)\b/i
const PROTOTYPE = /\b(prototypes?|simulated|fixtures?|harness)\b/i
const PROTOTYPE_KEYS = /^(prototype|simulation)_/
const LABEL_KEY = /_title$|_label$|^verb_|_action$/
const BUTTON_KEY = /^verb_|_action$|_button$/
const DIALOG_KEY = /_ellipsis$/
/** Source outside the scan: tests and fixtures carry sample Actions, src/paraglide is generated. */
const NOT_SCANNED = /\.(test|spec)\.tsx?$|(^|\/)__fixtures__\/|^paraglide\//

/**
 * The catalogue keys a label expression calls directly: `m.key(…)`, through
 * `?:`, parentheses and `const` names of the same file.
 * @param {ts.Expression} expression
 * @param {Map<string, ts.Expression[]>} consts every `const` initializer of the file, by name
 * @param {Set<string>} seen
 * @returns {string[]}
 */
function calledKeys(expression, consts, seen = new Set()) {
  if (ts.isParenthesizedExpression(expression)) return calledKeys(expression.expression, consts, seen)
  if (ts.isConditionalExpression(expression)) return [...calledKeys(expression.whenTrue, consts, seen), ...calledKeys(expression.whenFalse, consts, seen)]
  if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
    seen.add(expression.text)
    return (consts.get(expression.text) ?? []).flatMap((init) => calledKeys(init, consts, seen))
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && ts.isIdentifier(expression.expression.expression) && expression.expression.expression.text === "m") {
    return [expression.expression.name.text]
  }
  return []
}

/** The property of an object literal named `name`, if it is written there. */
function property(object, name) {
  return object.properties.find((member) => member.name && ts.isIdentifier(member.name) && member.name.text === name)
}

/**
 * The catalogue keys one source file's Actions take as their label: object
 * literals with a `run` and a `label` (contracts.ts `Action`). A label names
 * its key directly (`label: m.<key>(…)`) or through a `const` of the file,
 * matched by name (`const removeLabel = m.<key>()`; `label: removeLabel`).
 * @param {string} fileName decides TSX parsing
 * @param {string} source
 */
export function actionLabelKeys(fileName, source) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  /** @type {Map<string, ts.Expression[]>} */
  const consts = new Map()
  /** @type {ts.Expression[]} */
  const labels = []
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isVariableDeclarationList(node.parent) && node.parent.flags & ts.NodeFlags.Const) {
      consts.set(node.name.text, [...(consts.get(node.name.text) ?? []), node.initializer])
    }
    if (ts.isObjectLiteralExpression(node) && property(node, "run")) {
      const label = property(node, "label")
      if (label && ts.isPropertyAssignment(label)) labels.push(label.initializer)
      if (label && ts.isShorthandPropertyAssignment(label)) labels.push(label.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return new Set(labels.flatMap((label) => calledKeys(label, consts)))
}

/** Every Action label key in src/. */
function sourceActionLabelKeys() {
  const src = path.join(APP_ROOT, "src")
  const keys = new Set()
  for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    const relative = file.split(path.sep).join("/")
    if (!/\.tsx?$/.test(relative) || relative.endsWith(".d.ts") || NOT_SCANNED.test(relative)) continue
    for (const key of actionLabelKeys(relative, readFileSync(path.join(src, file), "utf8"))) keys.add(key)
  }
  return keys
}

/** Lower-case in sentence case: articles, conjunctions, prepositions. */
const FUNCTION_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "per", "the", "to", "via", "vs", "with"])

/** Names that stay capitalised mid-sentence: the product's places and third-party products. */
const PROPER_NOUNS = new Set([
  "PlateVault", "Home", "Projects", "Project", "Sessions", "Session", "Targets", "Target", "Calibration", "Activity", "Settings", "Trash",
  "Library", "Plan", "Planner", "Equipment", "Output", "View", "Unclassified", "Moon", "Sun", "Messier", "Windows", "Developer", "Mode",
  "macOS", "Linux", "Finder", "Explorer", "PixInsight", "Siril",
])

/** The text a message renders: its value, or every variant of a plural message. */
function texts(value) {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((variant) => Object.values(variant?.match ?? {})).filter((text) => typeof text === "string")
  return []
}

function words(text) {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}{]/u.test(word))
}

function isTitleCase(text) {
  const content = words(text.replace(/\{[^}]*\}/g, "")).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter((word) => word && !FUNCTION_WORDS.has(word.toLowerCase()))
  // Acronyms and designations (FWHM, NGC, M31) carry no case signal.
  const cased = content.slice(1).filter((word) => !PROPER_NOUNS.has(word) && word !== word.toUpperCase())
  return cased.length > 0 && cased.every((word) => /^\p{Lu}/u.test(word))
}

/** Each check, given a key, one text it renders, and whether the key is a button. */
const CHECKS = {
  "slop-word": (key, text) => SLOP.test(text),
  "prototype-word": (key, text) => !PROTOTYPE_KEYS.test(key) && PROTOTYPE.test(text),
  "title-case": (key, text, button) => (LABEL_KEY.test(key) || button) && isTitleCase(text),
  "label-period": (key, text) => LABEL_KEY.test(key) && /[^.]\.$/.test(text.trim()),
  "button-length": (key, text, button) => button && words(text.replace(/[…·▸]/g, "")).length > 3,
  ellipsis: (key, text) => !DIALOG_KEY.test(key) && /(…|\.\.\.)$/.test(text.trim()),
}

/**
 * The keys each check flags over a catalogue.
 * @param {Record<string, unknown>} catalog
 * @param {Set<string>} actionKeys the keys Actions take as their label
 * @returns {Record<string, string[]>}
 */
export function copyFindings(catalog, actionKeys) {
  const findings = Object.fromEntries(Object.keys(CHECKS).map((name) => [name, []]))
  for (const [key, value] of Object.entries(catalog)) {
    if (key === "$schema") continue
    const variants = texts(value)
    const button = BUTTON_KEY.test(key) || actionKeys.has(key)
    for (const [name, check] of Object.entries(CHECKS)) {
      if (variants.some((text) => check(key, text, button))) findings[name].push(key)
    }
  }
  return findings
}

function main() {
  const { baseLocale, catalogPath } = inlangProject()
  const catalog = readJson(catalogPath(baseLocale), "base catalogue")
  const messages = Object.keys(catalog).filter((key) => key !== "$schema").length
  const findings = copyFindings(catalog, sourceActionLabelKeys())
  const counts = Object.fromEntries(Object.entries(findings).map(([name, keys]) => [name, keys.length]))

  const listIndex = process.argv.indexOf("--list")
  if (listIndex !== -1) {
    const name = process.argv[listIndex + 1]
    if (!name || !findings[name]) throw new Error(`--list needs a check: ${Object.keys(CHECKS).join(", ")}`)
    for (const key of findings[name]) console.log(`${key}\t${JSON.stringify(catalog[key])}`)
    return
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(counts, null, 2))
    return
  }
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  console.log(`copy lint: ${total} finding(s) over ${messages} messages: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(", ")}.`)
  if (total > 0) {
    console.error("Run with --list <check> for the keys; design/R9-COMPOSITION-PLAN.md §6.1 has the rules.")
    process.exitCode = 1
  }
}

// Run as a script; imported (by its test), it only exports the checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
