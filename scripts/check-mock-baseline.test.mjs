#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for check-mock-baseline.mjs (#1221).
//
// The gate is regex-based over two source files, so its parsers are the part
// that can silently rot: if `mockedCommands` stops matching handler entries it
// reports every command as unmocked (loud), but if it over-matches — or if the
// `satisfies MockRegistry` terminator disappears — the gate can go quietly
// wrong. It also mirrors check-eslint-baseline.mjs's entry-point guard, which
// has its own history of no-opping green on Node 20.
//
// Pure Node — no Vitest (matches check-eslint-baseline.test.mjs). Run via
// `node scripts/check-mock-baseline.test.mjs`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { bindingCommands, mockedCommands } from './check-mock-baseline.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, 'check-mock-baseline.mjs');

const failures = [];
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    failures.push(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}
function assertThrows(fn, msg) {
  try {
    fn();
  } catch {
    return;
  }
  failures.push(msg);
}

// ── bindingCommands ────────────────────────────────────────────────────────
const bindingsSrc = `
	provenanceRead: (request: X) => typedError<Y, string>(__TAURI_INVOKE("provenance_read", { request })),
	inboxReclassifyV2: () => typedError<Y, string>(__TAURI_INVOKE("inbox_reclassify_v2")),
`;
const cmds = bindingCommands(bindingsSrc);
assertEqual(cmds.size, 2, 'bindingCommands finds both invocations');
assertEqual(
  cmds.has('inbox_reclassify_v2'),
  true,
  'bindingCommands keeps digits in wire names (inbox_reclassify_v2)',
);

// ── mockedCommands ─────────────────────────────────────────────────────────
const mocksSrc = [
  'export const mockHandlers = {',
  '  sessions_list: async () => {',
  '    return [{ nested_key: async (x) => x }];',
  '  },',
  '  plans_discard: async (_args) => {',
  '    return null;',
  '  },',
  '} satisfies MockRegistry;',
  '',
  'const unrelated = {',
  '  not_a_handler: async () => 1,',
  '};',
].join('\n');
const mocked = mockedCommands(mocksSrc);
assertEqual(mocked.size, 2, 'mockedCommands finds exactly the two handlers');
assertEqual(
  mocked.has('not_a_handler'),
  false,
  'mockedCommands ignores same-indent entries OUTSIDE the registry block',
);

// The `satisfies MockRegistry` anchor is what makes tsc check every payload.
// If it is ever dropped, all mock type-checking silently disappears — the gate
// must refuse to run rather than report a healthy count against an unchecked
// registry.
assertThrows(
  () =>
    mockedCommands(
      'export const mockHandlers = {\n  a: async () => 1,\n};\n',
    ),
  'mockedCommands must throw when the `satisfies MockRegistry` anchor is missing (otherwise losing the anchor reports green)',
);

assertThrows(
  () => mockedCommands('const somethingElse = {};'),
  'mockedCommands must throw when the registry declaration is absent',
);

// ── entry-point execution proof ────────────────────────────────────────────
// Same class of bug as check-eslint-baseline.mjs's `import.meta.main` no-op:
// an exit-0-with-no-output run reads as "step passed" to `pnpm lint`.
const run = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' });
const stdout = run.stdout ?? '';
if (stdout.trim().length === 0) {
  failures.push(
    `check-mock-baseline.mjs produced NO stdout when run directly (node ${SCRIPT_PATH}) — the entry-point guard did not fire, so main() never ran. status=${run.status} stderr=${run.stderr}`,
  );
} else if (!/^mock baseline: /.test(stdout) && !/^mock baseline FAILED/.test(stdout)) {
  failures.push(
    `check-mock-baseline.mjs produced unexpected stdout (entry-point guard may not have fired as expected):\n${stdout}`,
  );
}

if (failures.length > 0) {
  console.error(`check-mock-baseline.test.mjs FAILED:\n\n${failures.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log('check-mock-baseline.test.mjs: OK (7 assertions).');
}
