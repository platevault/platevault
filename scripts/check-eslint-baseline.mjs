#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ESLint baseline gate for the alm/* i18n rules (spec 046 follow-up,
 * run-jc0717 i18n-guard hardening). `eslint src/` on its own would go red
 * the moment the alm/no-user-string / alm/no-js-plural gap-corpus hardening
 * finds a PRE-EXISTING violation — but draining that debt is a separate
 * refactor-sweep task, not this gate's job. This wrapper runs the real
 * ESLint config, lets every OTHER rule fail the build exactly as `eslint
 * src/` does today (any error-severity message outside the baselined alm/*
 * rules still fails immediately), and grandfathers only the alm/*
 * violations recorded in scripts/eslint-alm-baseline.txt. A NEW alm/*
 * violation (not already in the baseline) fails the build.
 *
 * Repo precedent: scripts/check-db-boundary.sh + db-boundary-baseline.txt.
 * Unlike that guard (sealed at zero), this baseline intentionally starts
 * non-empty (the alm/* hardening's own gap-audit findings) and shrinks as
 * the i18n refactor sweep drains it — do NOT add entries for rules other
 * than alm/no-user-string / alm/no-js-plural; those must be fixed for real.
 *
 * Usage:
 *   node scripts/check-eslint-baseline.mjs             # enforce (CI mode)
 *   node scripts/check-eslint-baseline.mjs --generate   # rewrite the baseline to match current alm/* violations
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..');
const DESKTOP_ROOT = path.join(REPO_ROOT, 'apps/desktop');
const BASELINE_PATH = path.join(here, 'eslint-alm-baseline.txt');

// `eslint` is a devDependency of apps/desktop, not the repo root — resolve it
// from there (this script lives at the repo-root scripts/, matching the
// check-db-boundary.sh / check-tokens.sh convention of running from `..`).
const desktopRequire = createRequire(path.join(DESKTOP_ROOT, 'package.json'));
const { ESLint } = await import(
  pathToFileURL(desktopRequire.resolve('eslint')).href
);

const BASELINED_RULES = new Set(['alm/no-user-string', 'alm/no-js-plural']);

// Key = file (repo-relative to apps/desktop) + line + rule. Line-based, so a
// baseline entry goes stale (and the check fails loudly, prompting a
// --generate) if the surrounding code shifts — that's a feature: it forces a
// human to re-look at the violation rather than let it silently ride along.
function baselineKey(relPath, message) {
  return `${relPath}\t${message.line}\t${message.ruleId}`;
}

function loadBaseline() {
  let raw = '';
  try {
    raw = readFileSync(BASELINE_PATH, 'utf8');
  } catch {
    return new Set();
  }
  return new Set(
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
  );
}

function writeBaseline(keys) {
  const lines = [
    '# alm/* i18n-rule baseline — grandfathered PRE-EXISTING violations.',
    '# scripts/check-eslint-baseline.mjs fails CI on any alm/* error NOT',
    '# listed here; every other rule still fails eslint normally. Entries',
    '# drain via the i18n refactor sweep — do not add rules other than',
    '# alm/no-user-string / alm/no-js-plural (fix those for real, or use the',
    "# rule's own `// eslint-disable-next-line alm/no-user-string -- <reason>`",
    '# for a genuinely non-user-facing string).',
    '# Regenerate with: node scripts/check-eslint-baseline.mjs --generate',
    ...[...keys].sort(),
    '',
  ];
  writeFileSync(BASELINE_PATH, lines.join('\n'));
}

async function main() {
  const eslint = new ESLint({ cwd: DESKTOP_ROOT });
  const results = await eslint.lintFiles(['src/']);

  const baseline = loadBaseline();
  const currentAlmKeys = new Set();
  const blocking = [];
  let grandfathered = 0;

  for (const result of results) {
    const relPath = path.relative(DESKTOP_ROOT, result.filePath);
    for (const message of result.messages) {
      if (message.severity !== 2) continue; // warnings are not this gate's concern (matches plain `eslint src/`)
      if (BASELINED_RULES.has(message.ruleId)) {
        const key = baselineKey(relPath, message);
        currentAlmKeys.add(key);
        if (baseline.has(key)) {
          grandfathered++;
        } else {
          blocking.push({ relPath, message, isNewAlm: true });
        }
        continue;
      }
      blocking.push({ relPath, message, isNewAlm: false });
    }
  }

  if (process.argv.includes('--generate')) {
    writeBaseline(currentAlmKeys);
    console.log(
      `eslint-alm-baseline.txt regenerated: ${currentAlmKeys.size} entries.`,
    );
    return;
  }

  if (blocking.length === 0) {
    console.log(
      `eslint: OK (${results.length} files linted; ${grandfathered} baselined alm/* violation(s) grandfathered).`,
    );
    return;
  }

  for (const { relPath, message, isNewAlm } of blocking) {
    const tag = isNewAlm ? 'NEW alm violation, not in baseline' : message.ruleId;
    console.error(
      `${relPath}:${message.line}:${message.column}  [${tag}]  ${message.message}`,
    );
  }
  console.error(
    `\neslint FAILED: ${blocking.length} error(s). New alm/* violations must be fixed for real, or (if genuinely non-user-facing) use the rule's own eslint-disable escape hatch — do not add them to the baseline.`,
  );
  process.exitCode = 1;
}

main();
