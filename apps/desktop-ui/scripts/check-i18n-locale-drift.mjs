#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Locale drift gate (port of the legacy scripts/check-i18n-locale-drift.mjs).
 *
 * Compares every shipped locale's key set against the base locale and FAILS
 * on any gap. Reporting alone did not hold the line in the legacy app: pt-BR
 * silently accumulated missing keys and orphans within a day of shipping. A
 * report nobody fails on is a report nobody reads, so adding a user-facing
 * string obliges translating it in the same change.
 *
 * Exit code is 1 on drift, and 1 on an unreadable or malformed catalogue: a
 * drift gate that cannot read its inputs must not look like a clean run.
 *
 * Two kinds of drift per locale:
 *   1. missing: in the base catalogue, absent here. The translation lags.
 *   2. orphaned: present here, absent from the base catalogue. Usually a key
 *      renamed or deleted in the source without the translation following;
 *      dead weight that never renders.
 */

import { inlangProject, messageKeys, readJson } from "./i18n-project.mjs"

const LIST_LIMIT = 20

function listKeys(keys) {
  for (const k of keys.slice(0, LIST_LIMIT)) console.log(`      - ${k}`)
  if (keys.length > LIST_LIMIT) console.log(`      … and ${keys.length - LIST_LIMIT} more`)
}

function main() {
  const { baseLocale, locales, catalogPath } = inlangProject()
  const baseKeys = messageKeys(readJson(catalogPath(baseLocale), `base catalogue (${baseLocale})`))

  console.log(`locale drift report: base ${baseLocale}, ${baseKeys.size} keys, ${locales.length} locale(s):\n`)

  let anyDrift = false
  for (const locale of locales) {
    if (locale === baseLocale) {
      console.log(`  ${locale}  base catalogue (${baseKeys.size} keys)`)
      continue
    }
    const keys = messageKeys(readJson(catalogPath(locale), `catalogue (${locale})`))
    const missing = [...baseKeys].filter((k) => !keys.has(k)).sort()
    const orphaned = [...keys].filter((k) => !baseKeys.has(k)).sort()
    if (missing.length === 0 && orphaned.length === 0) {
      console.log(`  ${locale}  complete (${keys.size} keys, 100%)`)
      continue
    }

    anyDrift = true
    const translated = baseKeys.size - missing.length
    const pct = ((translated / baseKeys.size) * 100).toFixed(1)
    // Lead with coverage only when coverage is the problem: an orphan-only
    // locale is 100% translated, and printing that beside a failure reads as
    // a contradiction.
    const faults = [missing.length > 0 ? `${missing.length} missing` : null, orphaned.length > 0 ? `${orphaned.length} orphaned` : null].filter(Boolean).join(", ")
    const coverage = missing.length > 0 ? `${translated}/${baseKeys.size} keys (${pct}%)` : `all ${baseKeys.size} keys translated`
    console.log(`  ${locale}  ${coverage}: ${faults}`)
    if (missing.length > 0) {
      console.log(`    missing (${missing.length}):`)
      listKeys(missing)
    }
    if (orphaned.length > 0) {
      console.log(`    orphaned (${orphaned.length}), no longer in the base catalogue:`)
      listKeys(orphaned)
    }
  }

  if (!anyDrift) {
    console.log("\nNo drift: every locale matches the base catalogue.")
    return
  }

  console.error(
    "\nLocale drift fails the lint. Every shipped locale must carry exactly the\n" +
      "base catalogue's key set: translate the missing keys, and delete the\n" +
      "orphaned ones, which are absent from the base and can never render.\n" +
      "Re-check with `pnpm lint:i18n`.",
  )
  process.exitCode = 1
}

main()
