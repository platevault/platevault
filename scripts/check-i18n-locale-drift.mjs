#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Locale drift report (spec 061 T029, research D5).
 *
 * Compares every shipped locale's key set against the base locale and reports
 * the gap. It DELIBERATELY DOES NOT FAIL THE BUILD: FR-013 accepts partial
 * translation as a shipping state, so a missing key is news, not an error.
 * Shipping a half-translated locale is better than shipping none, provided
 * the gap is visible — which is this script's entire job.
 *
 * Exit code is always 0 except for a genuine malfunction (unreadable or
 * malformed catalogue), where staying silent would be the worse failure: a
 * drift report that cannot read its inputs must not look like a clean run.
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
    const missing = [...baseKeys].filter((k) => !keys.has(k));
    const orphaned = [...keys].filter((k) => !baseKeys.has(k));
    const translated = baseKeys.size - missing.length;
    const pct = ((translated / baseKeys.size) * 100).toFixed(1);

    if (missing.length === 0 && orphaned.length === 0) {
      console.log(`  ${locale}  complete (${keys.size} keys, 100%)`);
      continue;
    }

    anyDrift = true;
    console.log(`  ${locale}  ${translated}/${baseKeys.size} keys (${pct}%)`);
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

  console.log(
    anyDrift
      ? '\nPartial translation is an accepted shipping state (FR-013) — reporting only, not failing.'
      : '\nNo drift: every locale matches the base catalogue.',
  );
}

main();
