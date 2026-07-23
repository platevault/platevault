#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Locale drift gate (spec 061 T029, research D5).
 *
 * Compares every shipped locale's key set against the base locale and FAILS
 * THE BUILD on any gap.
 *
 * This reverses the original FR-013 position that partial translation is an
 * accepted shipping state (owner ruling, 2026-07-21). Reporting alone did not
 * hold the line: pt-BR silently accumulated 19 missing keys and 3 orphans
 * within a day of shipping, all from inbox work that landed after the
 * translation did. A report nobody fails on is a report nobody reads.
 *
 * The tradeoff is deliberate: adding a user-facing string now obliges you to
 * translate it in the same change. That is the cost of keeping every shipped
 * locale whole.
 *
 * Exit code is 1 on drift, and 1 on a genuine malfunction (unreadable or
 * malformed catalogue) — staying silent there would be the worse failure: a
 * drift gate that cannot read its inputs must not look like a clean run.
 *
 * Reports two kinds of drift per locale:
 *   1. missing — in the base catalogue, absent here. The translation lags.
 *   2. orphaned — present here, absent from the base catalogue. Usually a key
 *      renamed or deleted in the source without the translation following;
 *      dead weight that will never render.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = path.join(repoRoot, 'apps/desktop');
const settingsPath = path.join(projectDir, 'project.inlang/settings.json');

function fail(message) {
  console.error(`locale drift report: ${message}`);
  process.exit(1);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`could not read ${label} (${filePath}): ${err.message}`);
  }
}

/** Message keys only — `$schema` is metadata, not a translatable message. */
function messageKeys(catalog) {
  return new Set(Object.keys(catalog).filter((k) => k !== '$schema'));
}

function main() {
  const settings = readJson(settingsPath, 'inlang settings');
  const baseLocale = settings.baseLocale;
  const locales = settings.locales ?? [];

  if (!baseLocale || locales.length === 0) {
    fail('inlang settings declare no baseLocale or no locales');
  }

  // Resolve catalogue paths through the plugin's own pathPattern rather than
  // hardcoding `messages/{locale}.json`, so this does not silently break the
  // way check-i18n-catalog.mjs's hardcoded en.json path did when the base
  // catalogue was renamed to en-GB.json.
  const pattern =
    settings['plugin.inlang.messageFormat']?.pathPattern ??
    './messages/{locale}.json';
  const catalogPath = (locale) =>
    path.join(projectDir, pattern.replace('{locale}', locale));

  const baseKeys = messageKeys(
    readJson(catalogPath(baseLocale), `base catalogue (${baseLocale})`),
  );

  console.log(
    `locale drift report — base ${baseLocale}, ${baseKeys.size} keys, ${locales.length} locale(s):\n`,
  );

  let anyDrift = false;

  for (const locale of locales) {
    if (locale === baseLocale) {
      console.log(`  ${locale}  base catalogue (${baseKeys.size} keys)`);
      continue;
    }

    const keys = messageKeys(
      readJson(catalogPath(locale), `catalogue (${locale})`),
    );
    const missing = [...baseKeys].filter((k) => !keys.has(k)).sort();
    const orphaned = [...keys].filter((k) => !baseKeys.has(k)).sort();
    const translated = baseKeys.size - missing.length;
    const pct = ((translated / baseKeys.size) * 100).toFixed(1);

    if (missing.length === 0 && orphaned.length === 0) {
      console.log(`  ${locale}  complete (${keys.size} keys, 100%)`);
      continue;
    }

    anyDrift = true;
    // Lead with coverage only when coverage is the problem. An orphan-only
    // locale is at 100% translated, and printing that next to a failure reads
    // as a contradiction — so say what is actually wrong instead.
    const faults = [
      missing.length > 0 ? `${missing.length} missing` : null,
      orphaned.length > 0 ? `${orphaned.length} orphaned` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const coverage =
      missing.length > 0
        ? `${translated}/${baseKeys.size} keys (${pct}%)`
        : `all ${baseKeys.size} keys translated`;
    console.log(`  ${locale}  ${coverage} — ${faults}`);
    if (missing.length > 0) {
      console.log(`    missing (${missing.length}):`);
      for (const k of missing.slice(0, 20)) console.log(`      - ${k}`);
      if (missing.length > 20) {
        console.log(`      … and ${missing.length - 20} more`);
      }
    }
    if (orphaned.length > 0) {
      console.log(
        `    orphaned (${orphaned.length}) — no longer in the base catalogue:`,
      );
      for (const k of orphaned.slice(0, 20)) console.log(`      - ${k}`);
      if (orphaned.length > 20) {
        console.log(`      … and ${orphaned.length - 20} more`);
      }
    }
  }

  if (!anyDrift) {
    console.log('\nNo drift: every locale matches the base catalogue.');
    return;
  }

  console.error(
    '\nLocale drift fails the build. Every shipped locale must carry exactly the\n' +
      "base catalogue's key set: translate the missing keys, and delete the\n" +
      'orphaned ones — they are absent from the base and can never render.\n' +
      'Re-check with `pnpm --filter @astro-plan/desktop run lint:i18n-drift`.',
  );
  process.exitCode = 1;
}

main();
