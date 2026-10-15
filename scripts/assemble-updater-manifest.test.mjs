#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Tests for assemble-updater-manifest.mjs (astro-plan-w3ybv, astro-plan-rw8uc).
//
// The gate is the only thing between a broken release and every installed
// copy's next update check. Both of its failure modes are silent in
// production: a manifest without a platform reads as "no update" to those
// users, and a stale signature reads as a failed download. So each case runs
// against a fixture release whose correct answer is known. The fixtures are
// signed in the minisign format tauri writes (`ED`: Ed25519 over BLAKE2b-512,
// base64-wrapped), with a throwaway key.
//
// Pure Node — no Vitest (matches check-mock-baseline.test.mjs). Run via
// `node scripts/assemble-updater-manifest.test.mjs`.

import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleManifest } from './assemble-updater-manifest.mjs';

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'assemble-updater-manifest.mjs');
const BASE_URL = 'https://github.com/platevault/platevault/releases/download/v0.7.0';

const failures = [];

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    failures.push(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

function assertProblem(problems, pattern, msg) {
  if (!problems.some((problem) => pattern.test(problem))) {
    failures.push(`${msg}\n  expected a problem matching ${pattern}\n  got: ${JSON.stringify(problems)}`);
  }
}

/** A minisign keypair, plus the tauri.conf.json `pubkey` form of its public half. */
function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const keyLine = Buffer.concat([Buffer.from('Ed', 'latin1'), keyId, raw]).toString('base64');
  const hexId = Buffer.from(keyId).reverse().toString('hex').toUpperCase();
  const pubkey = Buffer.from(`untrusted comment: minisign public key: ${hexId}\n${keyLine}\n`).toString('base64');
  return { privateKey, keyId, pubkey };
}

/**
 * The `.sig` contents `tauri signer sign` writes for `data`. With `version`,
 * the trusted comment records it as Tauri CLI 2.12 and later do.
 */
function signFile(data, fileName, key, version) {
  const digest = createHash('blake2b512').update(data).digest();
  const sig = sign(null, digest, key.privateKey);
  const trusted = `timestamp:1791820000\tfile:${fileName}${version === undefined ? '' : `\tversion:${version}`}`;
  const globalSig = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), key.privateKey);
  const sigLine = Buffer.concat([Buffer.from('ED', 'latin1'), key.keyId, sig]).toString('base64');
  const box = `untrusted comment: signature from tauri secret key\n${sigLine}\ntrusted comment: ${trusted}\n${globalSig.toString('base64')}\n`;
  return Buffer.from(box).toString('base64');
}

// One updater bundle per UPDATER_BUNDLES row, named as tauri-action v1 names them.
const BUNDLE_NAMES = [
  'PlateVault_0.7.0_aarch64.app.tar.gz',
  'PlateVault_0.7.0_amd64.AppImage',
  'PlateVault_0.7.0_amd64.deb',
  'PlateVault-0.7.0-1.x86_64.rpm',
  'PlateVault_0.7.0_x64-setup.exe',
  'PlateVault_0.7.0_x64_en-US.msi',
];
// Assets the gate must leave alone: installers that are not updater payloads.
const OTHER_ASSETS = ['PlateVault_0.7.0_aarch64.dmg'];

/**
 * Write a fixture release into a temp dir and run the gate over it.
 * `edit(files, key)` may change the `{ name: contents }` map before it is written.
 */
function assemble(edit = () => {}) {
  const key = makeKey();
  const files = {};
  for (const name of BUNDLE_NAMES) {
    files[name] = Buffer.from(`bundle bytes of ${name}`);
    files[`${name}.sig`] = signFile(files[name], name, key);
  }
  for (const name of OTHER_ASSETS) files[name] = Buffer.from(name);
  edit(files, key);

  const dir = mkdtempSync(join(tmpdir(), 'updater-manifest-'));
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
    const assets = Object.keys(files).map((name) => ({ name, url: `${BASE_URL}/${name}` }));
    const result = assembleManifest({
      version: '0.7.0',
      notes: 'notes',
      pubDate: '2026-10-12T00:00:00.000Z',
      pubkey: key.pubkey,
      assets,
      assetsDir: dir,
    });
    return { ...result, files };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── a complete release ──────────────────────────────────────────────────────
// Same keys in the same order as the published v0.5.0 manifest, each pointing
// at its own bundle and carrying that bundle's `.sig` contents verbatim.
{
  const { manifest, problems, files } = assemble();
  assertEqual(problems.length, 0, `a complete release has no problems: ${problems.join('; ')}`);
  assertEqual(
    Object.keys(manifest?.platforms ?? {}).join(','),
    [
      'darwin-aarch64',
      'darwin-aarch64-app',
      'linux-x86_64',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
      'linux-x86_64-rpm',
      'windows-x86_64',
      'windows-x86_64-nsis',
      'windows-x86_64-msi',
    ].join(','),
    'every platform key is present, in tauri-action order',
  );
  const expectations = {
    'darwin-aarch64': 'PlateVault_0.7.0_aarch64.app.tar.gz',
    'linux-x86_64': 'PlateVault_0.7.0_amd64.AppImage',
    'linux-x86_64-rpm': 'PlateVault-0.7.0-1.x86_64.rpm',
    'windows-x86_64': 'PlateVault_0.7.0_x64-setup.exe',
    'windows-x86_64-msi': 'PlateVault_0.7.0_x64_en-US.msi',
  };
  for (const [key, name] of Object.entries(expectations)) {
    assertEqual(manifest?.platforms[key]?.url, `${BASE_URL}/${name}`, `${key} points at ${name}`);
    assertEqual(manifest?.platforms[key]?.signature, files[`${name}.sig`], `${key} carries ${name}.sig verbatim`);
  }
  assertEqual(manifest?.version, '0.7.0', 'the manifest carries the app version');
  assertEqual(manifest?.pub_date, '2026-10-12T00:00:00.000Z', 'the manifest carries pub_date');
}

// ── tauri-action v0 naming ──────────────────────────────────────────────────
// v0.5.0 shipped `PlateVault_aarch64.app.tar.gz`, with no version in the name.
{
  const { manifest, problems } = assemble((files) => {
    for (const ext of ['', '.sig']) {
      files[`PlateVault_aarch64.app.tar.gz${ext}`] = files[`PlateVault_0.7.0_aarch64.app.tar.gz${ext}`];
      delete files[`PlateVault_0.7.0_aarch64.app.tar.gz${ext}`];
    }
  });
  assertEqual(problems.length, 0, `the unversioned macOS bundle name is accepted: ${problems.join('; ')}`);
  assertEqual(
    manifest?.platforms['darwin-aarch64']?.url,
    `${BASE_URL}/PlateVault_aarch64.app.tar.gz`,
    'the unversioned macOS bundle fills darwin-aarch64',
  );
}

// ── the v0.6.0 failure: a platform is missing ───────────────────────────────
{
  const { manifest, problems } = assemble((files) => {
    delete files['PlateVault_0.7.0_aarch64.app.tar.gz'];
    delete files['PlateVault_0.7.0_aarch64.app.tar.gz.sig'];
  });
  assertEqual(manifest, null, 'no manifest when a platform is missing');
  assertProblem(problems, /^darwin-aarch64-app: no release asset ends with "_aarch64\.app\.tar\.gz"/, 'the missing platform is named');
}

// ── the SignPath failure: the file changed after minisign signed it ─────────
// Authenticode rewrites the installer; a signature made before that is stale.
{
  const { manifest, problems } = assemble((files) => {
    const name = 'PlateVault_0.7.0_x64-setup.exe';
    files[name] = Buffer.concat([files[name], Buffer.from('authenticode signature block')]);
  });
  assertEqual(manifest, null, 'no manifest when a signature is stale');
  assertProblem(
    problems,
    /^windows-x86_64-nsis: the signature in PlateVault_0\.7\.0_x64-setup\.exe\.sig does not verify/,
    'the stale signature is named',
  );
  assertEqual(problems.length, 1, 'the other bundles still verify');
}

// ── a signature from a key the app does not trust ───────────────────────────
// e.g. TAURI_SIGNING_PRIVATE_KEY replaced without updating tauri.conf.json.
{
  const { problems } = assemble((files) => {
    const name = 'PlateVault_0.7.0_amd64.deb';
    files[`${name}.sig`] = signFile(files[name], name, makeKey());
  });
  assertProblem(problems, /^linux-x86_64-deb: .* was made with key [0-9A-F]{16}, but the app trusts key [0-9A-F]{16}$/, 'a foreign key is named');
}

// ── a signature made for another version ────────────────────────────────────
// tauri-plugin-updater 2.13 rejects it with SignedVersionMismatch, even with
// requireSignedVersion off: e.g. a 0.6.9 bundle under a 0.7.0 latest.json.
{
  const { manifest, problems } = assemble((files, key) => {
    const name = 'PlateVault_0.7.0_aarch64.app.tar.gz';
    files[`${name}.sig`] = signFile(files[name], name, key, '0.6.9');
  });
  assertEqual(manifest, null, 'no manifest when a signed version differs');
  assertProblem(
    problems,
    /^darwin-aarch64-app: the signature in .* was signed for version 0\.6\.9, but latest\.json announces 0\.7\.0$/,
    'the mismatched signed version is named',
  );
  assertEqual(problems.length, 1, 'only the mismatched bundle is reported');
}

// ── a signature made for this version ───────────────────────────────────────
// A leading `v` on either side is the same version, as the plugin compares it.
{
  const { problems } = assemble((files, key) => {
    files['PlateVault_0.7.0_aarch64.app.tar.gz.sig'] = signFile(
      files['PlateVault_0.7.0_aarch64.app.tar.gz'],
      'PlateVault_0.7.0_aarch64.app.tar.gz',
      key,
      '0.7.0',
    );
    files['PlateVault_0.7.0_amd64.deb.sig'] = signFile(files['PlateVault_0.7.0_amd64.deb'], 'PlateVault_0.7.0_amd64.deb', key, 'v0.7.0');
  });
  assertEqual(problems.length, 0, `a matching signed version is accepted: ${problems.join('; ')}`);
}

// ── a garbled signature ─────────────────────────────────────────────────────
{
  const { problems } = assemble((files) => {
    files['PlateVault-0.7.0-1.x86_64.rpm.sig'] = 'not base64 at all!';
  });
  assertProblem(problems, /^linux-x86_64-rpm: .* is not a minisign signature$/, 'a garbled signature is named');
}

// ── a legacy unhashed signature ─────────────────────────────────────────────
// The services-crate client streams the payload and only verifies prehashed
// `ED` signatures, so a legacy `Ed` one must not reach latest.json.
{
  const { manifest, problems } = assemble((files, key) => {
    const name = 'PlateVault_0.7.0_amd64.AppImage';
    const sig = sign(null, files[name], key.privateKey);
    const trusted = `timestamp:1791820000\tfile:${name}`;
    const globalSig = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), key.privateKey);
    const sigLine = Buffer.concat([Buffer.from('Ed', 'latin1'), key.keyId, sig]).toString('base64');
    const box = `untrusted comment: legacy signature\n${sigLine}\ntrusted comment: ${trusted}\n${globalSig.toString('base64')}\n`;
    files[`${name}.sig`] = Buffer.from(box).toString('base64');
  });
  assertEqual(manifest, null, 'no manifest with a legacy signature');
  assertProblem(problems, /^linux-x86_64-appimage: .* uses the legacy unhashed minisign format/, 'the legacy signature is named');
}

// ── a bundle without its signature ──────────────────────────────────────────
{
  const { problems } = assemble((files) => {
    delete files['PlateVault_0.7.0_x64_en-US.msi.sig'];
  });
  assertProblem(problems, /^windows-x86_64-msi: PlateVault_0\.7\.0_x64_en-US\.msi has no .*\.sig on the release$/, 'a missing signature is named');
}

// ── a new matrix leg with no table row ──────────────────────────────────────
// An Intel macOS leg would upload `_x64.app.tar.gz`; without a row it would
// silently be left out of latest.json.
{
  const { manifest, problems } = assemble((files, key) => {
    const name = 'PlateVault_0.7.0_x64.app.tar.gz';
    files[name] = Buffer.from(name);
    files[`${name}.sig`] = signFile(files[name], name, key);
  });
  assertEqual(manifest, null, 'no manifest while a signature is unclaimed');
  assertProblem(problems, /^PlateVault_0\.7\.0_x64\.app\.tar\.gz\.sig: an updater signature no UPDATER_BUNDLES row claims/, 'the unclaimed signature is named');
}

// ── two assets for one row ──────────────────────────────────────────────────
{
  const { problems } = assemble((files) => {
    files['Other_0.7.0_amd64.deb'] = Buffer.from('second deb');
  });
  assertProblem(problems, /^linux-x86_64-deb: 2 release assets end with "_amd64\.deb"/, 'an ambiguous match is named');
}

// ── the CLI ─────────────────────────────────────────────────────────────────
// Also the entry-point guard: an exit-0 run that wrote nothing would read as
// "manifest published" to the workflow (see check-mock-baseline.mjs).
function runCli(edit, { rotateKey = false } = {}) {
  const key = makeKey();
  const dir = mkdtempSync(join(tmpdir(), 'updater-manifest-cli-'));
  try {
    const assetsDir = join(dir, 'assets');
    const files = {};
    for (const name of BUNDLE_NAMES) {
      files[name] = Buffer.from(`bundle bytes of ${name}`);
      files[`${name}.sig`] = signFile(files[name], name, key);
    }
    edit?.(files);
    mkdirSync(assetsDir);
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(assetsDir, name), contents);
    const release = {
      body: 'release notes',
      assets: Object.keys(files).map((name) => ({ name, url: `${BASE_URL}/${name}` })),
    };
    writeFileSync(join(dir, 'release.json'), JSON.stringify(release));
    // In a key rotation the released config embeds the next key, and the
    // previous release's config holds the key the bundles are signed with.
    const writeConf = (file, version, pubkey) =>
      writeFileSync(join(dir, file), JSON.stringify({ version, plugins: { updater: { pubkey } } }));
    writeConf('tauri.conf.json', '0.7.0', rotateKey ? makeKey().pubkey : key.pubkey);
    const pubkeyFlags = [];
    if (rotateKey) {
      writeConf('previous.json', '0.6.0', key.pubkey);
      pubkeyFlags.push('--pubkey-conf', join(dir, 'previous.json'));
    }
    const out = join(dir, 'latest.json');
    const run = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        '--release',
        join(dir, 'release.json'),
        '--assets',
        assetsDir,
        '--tauri-conf',
        join(dir, 'tauri.conf.json'),
        ...pubkeyFlags,
        '--out',
        out,
      ],
      { encoding: 'utf8' },
    );
    return { run, written: existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { run, written } = runCli();
  assertEqual(run.status, 0, `the CLI exits 0 on a complete release (stderr: ${run.stderr})`);
  if (!/^OK: latest\.json for 0\.7\.0 with 9 platform keys/.test(run.stdout ?? '')) {
    failures.push(`the CLI did not report success; the entry-point guard may not have fired. stdout=${run.stdout} stderr=${run.stderr}`);
  }
  assertEqual(written?.notes, 'release notes', 'the CLI takes notes from the release body');
  assertEqual(written?.version, '0.7.0', 'the CLI takes the version from tauri.conf.json');
}

{
  const { run, written } = runCli((files) => {
    delete files['PlateVault_0.7.0_amd64.AppImage'];
  });
  assertEqual(run.status, 1, 'the CLI exits 1 when the release is incomplete');
  assertEqual(written, null, 'the CLI writes no latest.json when the release is incomplete');
  if (!/linux-x86_64-appimage: no release asset/.test(run.stderr ?? '')) {
    failures.push(`the CLI did not name the missing platform on stderr: ${run.stderr}`);
  }
}

// ── the CLI during a minisign key rotation ──────────────────────────────────
// --pubkey-conf supplies the trusted key; the version stays the released one.
{
  const { run, written } = runCli(undefined, { rotateKey: true });
  assertEqual(run.status, 0, `the CLI verifies against --pubkey-conf's key (stderr: ${run.stderr})`);
  assertEqual(written?.version, '0.7.0', 'the CLI takes the version from --tauri-conf, not --pubkey-conf');
}

if (failures.length > 0) {
  console.error(`assemble-updater-manifest self-test FAILED (${failures.length}):`);
  for (const f of failures) console.error(`\n  ${f}`);
  process.exitCode = 1;
} else {
  console.log('assemble-updater-manifest self-test: PASS');
}
