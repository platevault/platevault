#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for stamp-candidate-version.mjs (astro-plan-e1axw).
//
// A wrong form of the candidate's version either fails the candidate's build
// or makes an installed candidate look newer than its release, which then
// never replaces it. Each case pins the form one installer format orders
// below X.Y.Z.
//
// Pure Node, no Vitest (matches check-rc-provenance.test.mjs). Run via
// `node scripts/release/stamp-candidate-version.test.mjs`.

import { candidateVersions } from './stamp-candidate-version.mjs';

const failures = [];

function check(condition, msg) {
  if (!condition) failures.push(msg);
}

function refused(version, msg) {
  try {
    candidateVersions(version);
    failures.push(`${msg}: ${version} was accepted`);
  } catch {
    // refused, as it should be
  }
}

const first = candidateVersions('0.7.0-rc.1');
check(first.app === '0.7.0-rc.1', 'the app reports the candidate as semver');
check(first.msi === '0.7.0.1', 'the MSI version is numeric, with N as its fourth field');
check(first.macosBundleVersion === '0.7.0', 'CFBundleVersion stays numeric and never above the release');
check(first.deb === '0.7.0~rc.1', 'the deb version sorts below 0.7.0 with a tilde');
check(first.rpmVersion === '0.7.0', 'the rpm Version holds no hyphen');
check(first.rpmRelease === '0.rc.1', 'the rpm Release sorts below the release Release 1');

const tenth = candidateVersions('1.12.3-rc.10');
check(tenth.msi === '1.12.3.10', 'a two-digit candidate number stays one MSI field');
check(tenth.deb === '1.12.3~rc.10', 'a two-digit candidate number keeps its deb form');
check(tenth.rpmRelease === '0.rc.10', 'a two-digit candidate number keeps its rpm form');

check(candidateVersions('255.255.65535-rc.65535').msi === '255.255.65535.65535', 'the largest MSI version is accepted');

refused('0.7.0', 'a release version is not a candidate');
refused('v0.7.0-rc.1', 'the tag prefix is not part of the version');
refused('0.7.0-beta.1', 'only rc pre-releases are candidates');
refused('0.7.0-rc.01', 'a leading zero is not semver');
refused('0.7.0-rc.1+build', 'build metadata has no installer form here');
refused('256.0.0-rc.1', 'an MSI major version above 255 is refused');
refused('0.256.0-rc.1', 'an MSI minor version above 255 is refused');
refused('0.7.65536-rc.1', 'an MSI patch above 65535 is refused');
refused('0.7.0-rc.65536', 'a candidate number above 65535 is refused');
refused(undefined, 'a missing version is refused');

if (failures.length > 0) {
  console.error(`${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('stamp-candidate-version: all cases pass');
