#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Copy lint (design/R9-COMPOSITION-PLAN.md §6.1, §6.4) over the base
 * catalogue. Report mode until W4: it prints the count per check and exits 0;
 * `--enforce` (W4) fails on any finding.
 *
 *   1. slop-word: a W10 word ("we", "please", "simply", "just", "easily",
 *      "seamlessly", "powerful", "leverage", "Note that", "This will").
 *   2. prototype-word: a W9 word ("prototype", "simulated", "fixture",
 *      "harness") outside the `prototype_*` and `simulation_*` keys.
 *   3. title-case: a label or button in Title Case instead of sentence case
 *      (W2). Product and place names stay capitalised (PROPER_NOUNS).
 *   4. label-period: a label key (`*_title`, `*_label`, `verb_*`,
 *      `*_action`) ending in a full stop.
 *   5. button-length: a button key (`verb_*`, `*_action`, `*_button`) longer
 *      than 3 words (W2); a `{placeholder}` counts as one word.
 *   6. ellipsis: a value ending in "…" whose key does not end in `_ellipsis`,
 *      the convention for a control that opens a dialog (W2).
 *
 * Plural variant messages are checked through each variant's text.
 *
 * Usage:
 *   node scripts/check-copy.mjs                    # counts per check
 *   node scripts/check-copy.mjs --list title-case  # the keys of one check
 *   node scripts/check-copy.mjs --json             # counts as JSON
 *   node scripts/check-copy.mjs --enforce          # exit 1 on any finding (W4)
 */

import { inlangProject, readJson } from "./i18n-project.mjs"

const SLOP = /\b(we|please|simply|just|easily|seamlessly|powerful|leverage|note that|this will)\b/i
const PROTOTYPE = /\b(prototypes?|simulated|fixtures?|harness)\b/i
const PROTOTYPE_KEYS = /^(prototype|simulation)_/
const LABEL_KEY = /_title$|_label$|^verb_|_action$/
const BUTTON_KEY = /^verb_|_action$|_button$/
const DIALOG_KEY = /_ellipsis$/

/** Lower-case in sentence case: articles, conjunctions, prepositions. */
const FUNCTION_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "per", "the", "to", "via", "vs", "with"])

/** Names that stay capitalised mid-sentence: the product's places and third-party products. */
const PROPER_NOUNS = new Set([
  "PlateVault", "Home", "Projects", "Project", "Sessions", "Session", "Targets", "Target", "Calibration", "Activity", "Settings", "Trash",
  "Library", "Plan", "Moon", "Sun", "Messier", "Windows", "Developer", "Mode", "macOS", "Linux", "Finder", "Explorer", "PixInsight", "Siril",
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

const CHECKS = {
  "slop-word": (key, text) => SLOP.test(text),
  "prototype-word": (key, text) => !PROTOTYPE_KEYS.test(key) && PROTOTYPE.test(text),
  "title-case": (key, text) => (LABEL_KEY.test(key) || BUTTON_KEY.test(key)) && isTitleCase(text),
  "label-period": (key, text) => LABEL_KEY.test(key) && /[^.]\.$/.test(text.trim()),
  "button-length": (key, text) => BUTTON_KEY.test(key) && words(text.replace(/[…·▸]/g, "")).length > 3,
  ellipsis: (key, text) => !DIALOG_KEY.test(key) && /(…|\.\.\.)$/.test(text.trim()),
}

function main() {
  const { baseLocale, catalogPath } = inlangProject()
  const catalog = readJson(catalogPath(baseLocale), "base catalogue")
  const entries = Object.entries(catalog).filter(([key]) => key !== "$schema")
  const findings = Object.fromEntries(Object.keys(CHECKS).map((name) => [name, []]))
  for (const [key, value] of entries) {
    const variants = texts(value)
    for (const [name, check] of Object.entries(CHECKS)) {
      if (variants.some((text) => check(key, text))) findings[name].push(key)
    }
  }
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
  const enforce = process.argv.includes("--enforce")
  console.log(`copy lint (${enforce ? "enforced" : "report mode"}): ${total} finding(s) over ${entries.length} messages: ${Object.entries(counts).map(([name, n]) => `${name} ${n}`).join(", ")}.`)
  if (enforce && total > 0) {
    console.error("Run with --list <check> for the keys; design/R9-COMPOSITION-PLAN.md §6.1 has the rules.")
    process.exitCode = 1
  }
}

main()
