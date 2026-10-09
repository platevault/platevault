#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * i18n catalogue lint (port of the legacy scripts/check-i18n-catalog.mjs).
 * Cheap, JSON-only checks over the base catalogue that the alm/no-user-string
 * ESLint rule cannot see (it inspects call sites, not the catalogue's own
 * values):
 *
 *   1. code-param: a message interpolates the raw error-code parameter
 *      "{code}" (e.g. "Update failed ({code})."). Error codes are machine
 *      identifiers; map them to a friendly message instead of showing one
 *      verbatim.
 *   2. dup-value: two or more keys carry the EXACT same value (after trim and
 *      lowercase). A duplicated single short word (a column header, "All") is
 *      the catalogue's per-screen convention and is never flagged: only values
 *      that are multi-word OR longer than DUP_MIN_LENGTH characters count.
 *      Reuse the existing key (often a verb_* or common_* one) instead of
 *      writing the same prose again. Exact match only, to keep the signal
 *      unambiguous.
 *
 * Plural variant messages are not compared: their variants are not plain
 * string values.
 *
 * Baseline: scripts/i18n-catalog-baseline.txt, one `<check>\t<signature>`
 * line per deliberately accepted violation. The catalogue starts clean, so
 * the file does not exist until `--generate` writes one; a violation NOT in it
 * fails the build. An entry that no longer reproduces does not fail; drop it
 * by hand or with --generate.
 *
 * Usage:
 *   node scripts/check-i18n-catalog.mjs              # enforce
 *   node scripts/check-i18n-catalog.mjs --generate   # rewrite the baseline to the current violations
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { inlangProject, readJson } from "./i18n-project.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const BASELINE_PATH = path.join(here, "i18n-catalog-baseline.txt")

// A duplicate value is noise (not flagged) unless it is multi-word or longer
// than this: short single-word duplicates are the per-screen convention.
const DUP_MIN_LENGTH = 12

/**
 * Zero entries means the catalogue shape changed (nested groups instead of
 * flat string values), not that the catalogue is clean: without this throw the
 * lint would report OK over a live violation and --generate would drain the
 * baseline.
 */
function loadCatalog(catalogPath) {
  const data = readJson(catalogPath, "base catalogue")
  const entries = Object.entries(data).filter(([key, value]) => key !== "$schema" && typeof value === "string")
  if (entries.length === 0) {
    throw new Error(`${catalogPath}: no string message values parsed; the catalogue layout changed, update scripts/check-i18n-catalog.mjs.`)
  }
  return entries
}

function findCodeParamViolations(entries) {
  return entries
    .filter(([, value]) => value.includes("{code}"))
    .map(([key]) => key)
    .sort()
}

function findDuplicateValueGroups(entries) {
  const groups = new Map()
  for (const [key, value] of entries) {
    const trimmed = value.trim()
    const isNoise = !/\s/.test(trimmed) && trimmed.length <= DUP_MIN_LENGTH
    if (isNoise) continue
    const norm = trimmed.toLowerCase()
    if (!groups.has(norm)) groups.set(norm, [])
    groups.get(norm).push(key)
  }
  // Signature = sorted, comma-joined key list. Adding a NEW key to an
  // accepted group changes its signature and therefore fails: choosing to
  // duplicate wording again is a new decision.
  return [...groups.values()].filter((keys) => keys.length >= 2).map((keys) => [...keys].sort().join(","))
}

function loadBaseline() {
  let raw = ""
  try {
    raw = readFileSync(BASELINE_PATH, "utf8")
  } catch {
    return { codeParam: new Set(), dupValue: new Set() }
  }
  const codeParam = new Set()
  const dupValue = new Set()
  for (const line of raw.split("\n")) {
    const l = line.trim()
    if (!l || l.startsWith("#")) continue
    const tab = l.indexOf("\t")
    if (tab === -1) continue
    const kind = l.slice(0, tab)
    const payload = l.slice(tab + 1)
    if (kind === "code-param") codeParam.add(payload)
    else if (kind === "dup-value") dupValue.add(payload)
  }
  return { codeParam, dupValue }
}

function writeBaseline(codeParam, dupValue) {
  const lines = [
    "# i18n catalogue lint baseline: deliberately accepted violations.",
    "# scripts/check-i18n-catalog.mjs fails on any code-param / dup-value",
    "# violation NOT listed here. Note why in the change that adds an entry.",
    "# Regenerate with: node scripts/check-i18n-catalog.mjs --generate",
    ...codeParam.map((k) => `code-param\t${k}`),
    ...dupValue.map((s) => `dup-value\t${s}`),
    "",
  ]
  writeFileSync(BASELINE_PATH, lines.join("\n"))
}

function main() {
  const { baseLocale, catalogPath } = inlangProject()
  const entries = loadCatalog(catalogPath(baseLocale))
  const codeParam = findCodeParamViolations(entries)
  const dupValue = findDuplicateValueGroups(entries)

  if (process.argv.includes("--generate")) {
    writeBaseline(codeParam, dupValue)
    console.log(`i18n-catalog-baseline.txt regenerated: ${codeParam.length} code-param, ${dupValue.length} dup-value.`)
    return
  }

  const baseline = loadBaseline()
  const newCodeParam = codeParam.filter((k) => !baseline.codeParam.has(k))
  const newDupValue = dupValue.filter((s) => !baseline.dupValue.has(s))

  if (newCodeParam.length === 0 && newDupValue.length === 0) {
    console.log(`i18n catalogue lint: OK (${entries.length} string messages; ${baseline.codeParam.size} code-param, ${baseline.dupValue.size} dup-value accepted).`)
    return
  }

  console.error("i18n catalogue lint FAILED:\n")
  if (newCodeParam.length > 0) {
    console.error('Message(s) interpolate the raw "{code}" parameter; map the error to a friendly message instead of showing it raw:')
    for (const k of newCodeParam) console.error(`  - ${k}`)
    console.error("")
  }
  if (newDupValue.length > 0) {
    console.error("Message(s) duplicate an existing catalogue value exactly; reuse the existing key instead of writing the same wording again:")
    for (const s of newDupValue) console.error(`  - ${s}`)
    console.error("")
  }
  console.error("If a violation is genuinely intentional, add it to scripts/i18n-catalog-baseline.txt (or run --generate) and say why in the change.")
  process.exitCode = 1
}

main()
