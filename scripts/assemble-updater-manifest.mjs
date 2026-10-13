#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Updater manifest gate (astro-plan-w3ybv, astro-plan-rw8uc).
 *
 * Writes the release's `latest.json`, the manifest every installed copy polls
 * at `releases/latest/download/latest.json`, after the whole release is built.
 * Before this, each build leg merged its own platform into `latest.json` as it
 * finished. Two failures went out that way:
 *
 *   - v0.6.0's macOS leg failed, so the published manifest had no `darwin-*`
 *     key. Every 0.5.0 Mac got `TargetsNotFound`, and nothing stopped the
 *     release. Now a missing platform is an error, so no manifest is published.
 *   - Authenticode signing (`sign-windows`) rewrites the `.exe` and `.msi`, and
 *     those files are the Windows updater payloads. A minisign signature made
 *     before that no longer matches the bytes clients download, so every
 *     Windows update would fail. Now each signature is verified, as
 *     `tauri-plugin-updater` does, against the asset that is really on the
 *     release, using the public key the app embeds.
 *
 * Each problem found is listed, and nothing is written unless the manifest is
 * complete and every signature verifies.
 *
 * The output matches what tauri-action wrote for v0.5.0 (same keys, order and
 * download URLs), so installed clients see no change apart from the timing.
 *
 * Usage (from the `updater-manifest` job in .github/workflows/release-please.yml):
 *   gh release view "$TAG" --json assets,body > release.json
 *   gh release download "$TAG" --dir release-assets
 *   node scripts/assemble-updater-manifest.mjs --release release.json \
 *     --assets release-assets --tauri-conf apps/desktop/src-tauri/tauri.conf.json \
 *     [--pubkey-conf previous-tauri.conf.json] --out latest.json
 */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/**
 * Every updater bundle a complete release carries. There is one row per
 * bundle the `build` matrix in release-please.yml produces, so the two change
 * together: a matrix leg with no row here leaves an unclaimed `.sig`, which is
 * reported, and a row with no matching asset is reported as missing.
 *
 * `suffix` matches the asset name in both tauri-action naming schemes:
 * `PlateVault_aarch64.app.tar.gz` (v0) and `PlateVault_0.7.0_aarch64.app.tar.gz`
 * (v1). `primary` marks the bundle that also fills the bare `{os}-{arch}` key,
 * which clients fall back to after `{os}-{arch}-{bundle}`
 * (tauri-plugin-updater `get_urls`). tauri-action uses the AppImage on Linux
 * and, with `updaterJsonPreferNsis`, the NSIS installer on Windows.
 */
export const UPDATER_BUNDLES = [
  { os: 'darwin', arch: 'aarch64', bundle: 'app', suffix: '_aarch64.app.tar.gz', primary: true },
  { os: 'linux', arch: 'x86_64', bundle: 'appimage', suffix: '_amd64.AppImage', primary: true },
  { os: 'linux', arch: 'x86_64', bundle: 'deb', suffix: '_amd64.deb' },
  { os: 'linux', arch: 'x86_64', bundle: 'rpm', suffix: '.x86_64.rpm' },
  { os: 'windows', arch: 'x86_64', bundle: 'nsis', suffix: '_x64-setup.exe', primary: true },
  { os: 'windows', arch: 'x86_64', bundle: 'msi', suffix: '_x64_en-US.msi' },
];

const TRUSTED_COMMENT_PREFIX = 'trusted comment: ';
const SIGNED_VERSION_FIELD = 'version:';

/** Decode one base64 line, rejecting the junk `Buffer.from` silently skips. */
function strictBase64(text) {
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed)) {
    throw new Error('not valid base64');
  }
  return Buffer.from(trimmed, 'base64');
}

/** Lines of a base64-wrapped minisign box, split as minisign-verify's `lines()` does. */
function boxLines(base64Box) {
  return strictBase64(base64Box).toString('utf8').split(/\r?\n/);
}

/**
 * Parse the `plugins.updater.pubkey` value from tauri.conf.json: base64 of a
 * minisign public key file, whose second line holds `Ed` + key id + key.
 */
export function parsePublicKey(base64Box) {
  const lines = boxLines(base64Box);
  const bin = strictBase64(lines[1] ?? '');
  if (bin.length !== 42 || bin.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error('not a minisign Ed25519 public key');
  }
  return {
    keyId: bin.subarray(2, 10),
    key: createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: bin.subarray(10, 42).toString('base64url') },
      format: 'jwk',
    }),
  };
}

/** Upper-case hex of a minisign key id, as `minisign` prints it. */
function keyIdHex(keyId) {
  return Buffer.from(keyId).reverse().toString('hex').toUpperCase();
}

/**
 * Verify a `.sig` file's contents over `data` for the release `version`, with
 * the checks tauri-plugin-updater 2.13 (`verify_signature`) runs before it
 * installs anything: minisign-verify's `PublicKey::verify(data, signature,
 * allow_legacy = true)`, then the signed-version check with
 * `requireSignedVersion` off, which is PlateVault's setting.
 * Returns null when the signature holds, or the reason it does not.
 */
export function verifySignature(data, base64Signature, publicKey, version) {
  let lines;
  let sig;
  let globalSig;
  try {
    lines = boxLines(base64Signature);
    sig = strictBase64(lines[1] ?? '');
    globalSig = strictBase64(lines[3] ?? '');
  } catch {
    return 'is not a minisign signature';
  }
  const trustedComment = lines[2] ?? '';
  if (sig.length !== 74 || globalSig.length !== 64 || !trustedComment.startsWith(TRUSTED_COMMENT_PREFIX)) {
    return 'is not a minisign signature';
  }
  const algorithm = sig.toString('latin1', 0, 2);
  if (algorithm !== 'ED' && algorithm !== 'Ed') {
    return `uses unsupported algorithm "${algorithm}"`;
  }
  const keyId = sig.subarray(2, 10);
  if (!keyId.equals(publicKey.keyId)) {
    return `was made with key ${keyIdHex(keyId)}, but the app trusts key ${keyIdHex(publicKey.keyId)}`;
  }
  // `ED` signs the BLAKE2b-512 digest of the file. Legacy `Ed` signs the file.
  const message = algorithm === 'ED' ? createHash('blake2b512').update(data).digest() : data;
  if (!verify(null, message, publicKey.key, sig.subarray(10, 74))) {
    return 'does not verify over the asset on the release (was the file changed after it was signed?)';
  }
  const comment = trustedComment.slice(TRUSTED_COMMENT_PREFIX.length);
  if (!verify(null, Buffer.concat([sig.subarray(10, 74), Buffer.from(comment, 'utf8')]), publicKey.key, globalSig)) {
    return 'has a trusted comment that does not verify';
  }
  // Tauri CLI 2.12 and later record the version they signed for as a
  // `version:` field of the trusted comment. The plugin rejects an update whose
  // signed version differs from latest.json's `version`, whatever
  // requireSignedVersion says; that setting only decides whether a signature
  // without the field is rejected. Older signatures carry none and are accepted.
  const signedVersion = comment
    .split('\t')
    .find((field) => field.startsWith(SIGNED_VERSION_FIELD))
    ?.slice(SIGNED_VERSION_FIELD.length);
  if (signedVersion !== undefined && signedVersion.replace(/^v/, '') !== version.replace(/^v/, '')) {
    return `was signed for version ${signedVersion}, but latest.json announces ${version}`;
  }
  return null;
}

/**
 * Build the manifest from the release's asset list (`gh release view --json
 * assets`, entries with `name` and `url`) and a directory holding those assets.
 * Returns `{ manifest, problems }`. `manifest` is null whenever `problems` is
 * non-empty.
 */
export function assembleManifest({ version, notes, pubDate, pubkey, assets, assetsDir }) {
  const problems = [];
  const platforms = {};
  const claimedSignatures = new Set();
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const publicKey = parsePublicKey(pubkey);

  for (const row of UPDATER_BUNDLES) {
    const key = `${row.os}-${row.arch}-${row.bundle}`;
    const matches = assets.filter((asset) => asset.name.endsWith(row.suffix));
    if (matches.length !== 1) {
      problems.push(
        matches.length === 0
          ? `${key}: no release asset ends with "${row.suffix}"`
          : `${key}: ${matches.length} release assets end with "${row.suffix}": ${matches.map((a) => a.name).join(', ')}`,
      );
      continue;
    }
    const bundle = matches[0];
    const signatureName = `${bundle.name}.sig`;
    claimedSignatures.add(signatureName);
    if (!byName.has(signatureName)) {
      problems.push(`${key}: ${bundle.name} has no ${signatureName} on the release`);
      continue;
    }
    const bundlePath = join(assetsDir, bundle.name);
    const signaturePath = join(assetsDir, signatureName);
    const absent = [bundlePath, signaturePath].filter((path) => !existsSync(path));
    if (absent.length > 0) {
      problems.push(`${key}: not downloaded: ${absent.join(', ')}`);
      continue;
    }
    // The `.sig` contents go into the manifest unchanged, as tauri-action did.
    const signature = readFileSync(signaturePath, 'utf8');
    const failure = verifySignature(readFileSync(bundlePath), signature, publicKey, version);
    if (failure) {
      problems.push(`${key}: the signature in ${signatureName} ${failure}`);
      continue;
    }
    const entry = { signature, url: bundle.url };
    if (row.primary) platforms[`${row.os}-${row.arch}`] = entry;
    platforms[key] = entry;
  }

  for (const asset of assets) {
    if (asset.name.endsWith('.sig') && !claimedSignatures.has(asset.name)) {
      problems.push(
        `${asset.name}: an updater signature no UPDATER_BUNDLES row claims. Add a row for the bundle in scripts/assemble-updater-manifest.mjs, or it is left out of latest.json`,
      );
    }
  }

  if (problems.length > 0) return { manifest: null, problems };
  return { manifest: { version, notes, pub_date: pubDate, platforms }, problems };
}

function main() {
  const { values } = parseArgs({
    options: {
      release: { type: 'string' },
      assets: { type: 'string' },
      'tauri-conf': { type: 'string' },
      'pubkey-conf': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const missingFlags = ['release', 'assets', 'tauri-conf', 'out'].filter((flag) => !values[flag]);
  if (missingFlags.length > 0) {
    console.error(`usage: missing --${missingFlags.join(', --')}`);
    process.exitCode = 2;
    return;
  }

  const release = JSON.parse(readFileSync(values.release, 'utf8'));
  // The version of the commit being released, which is where tauri-action
  // read it from and what the bundler signed into each trusted comment.
  const tauriConf = JSON.parse(readFileSync(values['tauri-conf'], 'utf8'));
  // The key installed clients trust, which is the released commit's key except
  // during a minisign key rotation: the release that embeds a new key is still
  // signed with the old one. For that one release pass --pubkey-conf with the
  // previous release's config, e.g. from `git show
  // v0.6.0:apps/desktop/src-tauri/tauri.conf.json`. The version still comes
  // from --tauri-conf.
  const pubkeyConf = values['pubkey-conf']
    ? JSON.parse(readFileSync(values['pubkey-conf'], 'utf8'))
    : tauriConf;
  const { manifest, problems } = assembleManifest({
    version: tauriConf.version,
    notes: release.body ?? '',
    pubDate: new Date().toISOString(),
    pubkey: pubkeyConf.plugins.updater.pubkey,
    assets: release.assets,
    assetsDir: values.assets,
  });

  if (problems.length > 0) {
    console.error(`latest.json NOT written: ${problems.length} problem(s).`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `OK: latest.json for ${manifest.version} with ${Object.keys(manifest.platforms).length} platform keys, every signature verified.`,
  );
}

// Guarded so assemble-updater-manifest.test.mjs can import the functions
// without running the CLI. `import.meta.main` is not usable: it needs Node
// >=22.18/24.2 (see check-mock-baseline.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
