#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Stamps a release candidate's version into the files release-please
// versions, before build-installers.yml builds the candidate
// (docs/release/release-candidates.md).
//
// Main carries the last release's version until the release PR merges, so the
// candidate rc/vX.Y.Z-rc.N is built as X.Y.Z-rc.N. The app reports that
// version, and the in-app updater, which offers only a newer semver, offers
// X.Y.Z to an installed candidate once X.Y.Z is released. Each installer
// format orders versions its own way, so each gets the form of the version
// that sorts the candidate below X.Y.Z (candidateVersions).
//
// Usage:
//   node scripts/release/stamp-candidate-version.mjs X.Y.Z-rc.N
//
// Run from the repository root. With GITHUB_OUTPUT set, it also writes the
// deb and rpm versions as step outputs (deb_version, rpm_version,
// rpm_release) for the step that bundles the candidate's Linux packages.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TAURI_CONF = 'apps/desktop/src-tauri/tauri.conf.json';
const PACKAGE_JSON = 'apps/desktop/package.json';
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml';

// Numeric identifiers without leading zeros, as semver, and so Tauri and
// Cargo, require: this refuses `0.7.0-rc.01` before the build, not during it.
const NUMBER = '(0|[1-9]\\d*)';
const CANDIDATE = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}-rc\\.${NUMBER}$`);

/**
 * The version of the candidate `version` (X.Y.Z-rc.N) in each form it is
 * stamped or bundled in. Throws when `version` is not X.Y.Z-rc.N, or when
 * the MSI cannot carry it.
 */
export function candidateVersions(version) {
  const match = CANDIDATE.exec(version ?? '');
  if (!match) throw new Error(`the candidate version must be X.Y.Z-rc.N, got ${version}`);
  const [major, minor, patch, number] = match.slice(1).map(Number);
  // The bundler's limits for an MSI version (validate_wix_version in
  // tauri-bundler's windows/msi/mod.rs).
  if (major > 255 || minor > 255 || patch > 65535 || number > 65535) {
    throw new Error(`${version} does not fit an MSI version: major and minor go to 255, patch and N to 65535`);
  }
  const release = `${major}.${minor}.${patch}`;
  return {
    // Semver: tauri.conf.json (the app's own version, which the updater
    // compares), package.json and Cargo.toml. The NSIS installer, the
    // AppImage and the macOS CFBundleShortVersionString carry it as is, and
    // NSIS compares it as semver (nsis_tauri_utils::SemverCompare).
    app: version,
    // bundle.windows.wix.version. WiX takes only numeric
    // major.minor.patch.build, and the bundler refuses a pre-release that is
    // not a plain number (convert_version in windows/msi/mod.rs). Windows
    // Installer compares only the first three fields, so to it the release's
    // MSI has the candidate's version and replaces it: the bundler's
    // MajorUpgrade allows downgrades by default (bundle.windows
    // .allowDowngrades), and same-version upgrades otherwise (msi/main.wxs).
    msi: `${release}.${number}`,
    // bundle.macOS.bundleVersion, the CFBundleVersion, which is otherwise a
    // copy of `version`. Apple defines it as numbers and periods, and X.Y.Z
    // never ranks the candidate above its release.
    macosBundleVersion: release,
    // The deb's control Version. dpkg reads X.Y.Z-rc.N as upstream X.Y.Z
    // with Debian revision rc.N, which is newer than X.Y.Z; a tilde sorts
    // before the end of the version, so X.Y.Z~rc.N is older.
    deb: `${release}~rc.${number}`,
    // The rpm's Version and Release. rpm forbids `-` in Version and would
    // read X.Y.Z-rc.N as newer than X.Y.Z, and the bundler takes Version
    // from `version`, a semver that cannot hold `~`. Release 0.rc.N sorts
    // below the release's Release 1 (the bundle.linux.rpm.release default).
    rpmVersion: release,
    rpmRelease: `0.rc.${number}`,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('usage: stamp-candidate-version.mjs X.Y.Z-rc.N');
  const versions = candidateVersions(args[0]);

  const conf = readJson(TAURI_CONF);
  console.log(`${TAURI_CONF} version ${conf.version} -> ${versions.app}`);
  conf.version = versions.app;
  conf.bundle ??= {};
  conf.bundle.windows ??= {};
  conf.bundle.windows.wix ??= {};
  conf.bundle.windows.wix.version = versions.msi;
  console.log(`${TAURI_CONF} bundle.windows.wix.version -> ${versions.msi}`);
  conf.bundle.macOS ??= {};
  conf.bundle.macOS.bundleVersion = versions.macosBundleVersion;
  console.log(`${TAURI_CONF} bundle.macOS.bundleVersion -> ${versions.macosBundleVersion}`);
  writeJson(TAURI_CONF, conf);

  const pkg = readJson(PACKAGE_JSON);
  console.log(`${PACKAGE_JSON} version ${pkg.version} -> ${versions.app}`);
  pkg.version = versions.app;
  writeJson(PACKAGE_JSON, pkg);

  // The first `version = "…"` in the file is [package]'s.
  const toml = readFileSync(CARGO_TOML, 'utf8');
  const stamped = toml.replace(/^version = "[^"]*"/m, `version = "${versions.app}"`);
  if (stamped === toml) throw new Error(`${CARGO_TOML} has no package version line to stamp`);
  writeFileSync(CARGO_TOML, stamped);
  console.log(`${CARGO_TOML} version -> ${versions.app}`);

  console.log(`deb Version ${versions.deb}; rpm Version ${versions.rpmVersion}, Release ${versions.rpmRelease}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `deb_version=${versions.deb}\nrpm_version=${versions.rpmVersion}\nrpm_release=${versions.rpmRelease}\n`,
    );
  }
}

// Guarded so the test can import candidateVersions without stamping anything
// (see check-rc-provenance.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
