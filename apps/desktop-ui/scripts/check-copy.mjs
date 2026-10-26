#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy lint over the base catalogue. Findings fail `pnpm lint:i18n`.
 * It checks slop words, prototype-only language, title case, label periods,
 * overlong button labels and ellipses not designated as dialog controls.
 * Exempt only the prototype, simulation, seed and setup-demo key prefixes;
 * their corresponding prototype-only messages are removed from final catalogues.
 * Action labels are statically read from production source; tests and fixtures
 * are examples, not shipped copy.
 *
 * Usage: `node scripts/check-copy.mjs [--list CHECK|--json]`.
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { APP_ROOT, inlangProject, readJson } from "./i18n-project.mjs"

const SLOP = /\b(we|please|simply|just|easily|seamlessly|powerful|leverage|note that|this will)\b/i
const PROTOTYPE = /\b(prototypes?|simulated|fixtures?|harness)\b/i
const PRODUCT_ONLY_KEYS = /^(prototype|simulation|seed|setup_demo)_/
const LABEL_KEY = /_title$|_label$|^verb_|_action$/
const BUTTON_KEY = /^verb_|_action$|_button$/
const DIALOG_KEY = /_ellipsis$/
const NOT_SCANNED = /\.(test|spec)\.tsx?$|(^|\/)__fixtures__\/|^paraglide\//

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

function property(object, name) {
  return object.properties.find((member) => member.name && ts.isIdentifier(member.name) && member.name.text === name)
}

export function actionLabelKeys(fileName, source) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const consts = new Map()
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

const FUNCTION_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "per", "the", "to", "via", "vs", "with"])
const PROPER_NOUNS = new Set([
  "PlateVault", "Home", "Projects", "Project", "Sessions", "Session", "Targets", "Target", "Calibration", "Activity", "Settings", "Trash",
  "Library", "Plan", "Planner", "Equipment", "Output", "View", "Unclassified", "Moon", "Sun", "Messier", "Windows", "Developer", "Mode",
  "macOS", "Linux", "Finder", "Explorer", "PixInsight", "Siril",
])

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
  const cased = content.slice(1).filter((word) => !PROPER_NOUNS.has(word) && word !== word.toUpperCase())
  return cased.length > 0 && cased.every((word) => /^\p{Lu}/u.test(word))
}

export const SPEC_LONG_BUTTONS = Object.freeze({
  equipment_add_value_to_rig: "D-W127",
})

const CHECKS = {
  "slop-word": (_key, text) => SLOP.test(text),
  "prototype-word": (key, text) => !PRODUCT_ONLY_KEYS.test(key) && PROTOTYPE.test(text),
  "title-case": (key, text, button) => (LABEL_KEY.test(key) || button) && isTitleCase(text),
  "label-period": (key, text) => LABEL_KEY.test(key) && /[^.]\.$/.test(text.trim()),
  "button-length": (key, text, button) => button && !Object.hasOwn(SPEC_LONG_BUTTONS, key) && words(text.replace(/[…·▸]/g, "")).length > 3,
  ellipsis: (key, text) => !DIALOG_KEY.test(key) && /(…|\.\.\.)$/.test(text.trim()),
}

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
    console.error("Run with --list <check> for the keys.")
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
