#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Regression test for the Windows path-separator bug (run-jc0717 FIX):
// path.relative() returns backslash-separated paths on Windows, which never
// matched the forward-slash entries in the checked-in (cross-platform)
// eslint-alm-baseline.txt — every alm/* violation looked "new" on Windows CI
// even when it was already baselined.
//
// Pure Node — no Vitest (matches packages/contracts/tests/*.test.mjs). Run
// via `node scripts/check-eslint-baseline.test.mjs`.

import path from 'node:path';
import { baselineKey } from './check-eslint-baseline.mjs';

const failures = [];
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    failures.push(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

const message = { line: 101, ruleId: 'alm/no-user-string' };

// Forward-slash input (POSIX path.relative() output, and what's checked into
// the baseline file) must produce a stable key.
assertEqual(
  baselineKey('src/features/calibration/MastersTable.tsx', message),
  'src/features/calibration/MastersTable.tsx\t101\talm/no-user-string',
  'forward-slash relPath',
);

// Backslash input (what path.relative() returns on win32) must normalize to
// the SAME key as the forward-slash form above — this is the bug.
assertEqual(
  baselineKey('src\\features\\calibration\\MastersTable.tsx', message),
  'src/features/calibration/MastersTable.tsx\t101\talm/no-user-string',
  'backslash relPath (win32 path.relative() output) must match the forward-slash baseline entry',
);

// A relPath built with the CURRENT platform's path.sep must also normalize
// (covers the actual call site: path.relative(DESKTOP_ROOT, filePath)).
const platformRelPath = ['src', 'features', 'calibration', 'MastersTable.tsx'].join(
  path.sep,
);
assertEqual(
  baselineKey(platformRelPath, message),
  'src/features/calibration/MastersTable.tsx\t101\talm/no-user-string',
  'relPath joined with the current platform path.sep',
);

if (failures.length > 0) {
  console.error(`check-eslint-baseline.test.mjs FAILED:\n\n${failures.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log('check-eslint-baseline.test.mjs: OK (3 assertions).');
}
