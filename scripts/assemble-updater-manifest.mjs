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
 *   - Authenticode signing on Windows rewrites the `.exe` and `.msi`, and
 *     those files are the Windows updater payloads. A minisign signature made
 *     before that no longer matches the bytes clients download, so every
 *     Windows update would fail. Now each signature is verified, as the
 *     clients do, against the asset that is really on the release, using the
 *     public key the app embeds.
 *
 * Each problem found is listed, and nothing is written unless the manifest is
 * complete and every signature verifies.
 *
 * One manifest serves every client (astro-plan-5wcib). The services-crate
 * updater (crates/desktop/services/src/update), which replaces
 * tauri-plugin-updater after 0.6.x, reads this same file, its keys and its
 * signatures, with the same minisign key as the plugin in 0.5.x and 0.6.x
 * installs. Every release keeps every UPDATER_BUNDLES key, so those installs
 * reach the first release with the new client, or any later one, through this
 * file, and there is no second manifest to retire.
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
 * (tauri-plugin-updater `get_urls`, and `Platform::manifest_keys` in the
 * services crate). tauri-action uses the AppImage on Linux
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
 * the checks every client runs before it installs anything, so a manifest
 * this gate writes is one they all accept:
 *   - the services-crate client (crates/desktop/services/src/update/signature.rs)
 *     streams the payload through minisign-verify's `verify_stream`, which
 *     takes prehashed `ED` signatures only;
 *   - tauri-plugin-updater 2.10 and 2.13 in 0.5.x and 0.6.x installs
 *     (`verify_signature`) also accept the legacy `Ed` form.
 * Both then run the signed-version check. The services-crate client also
 * refuses a signature that names no version, so the gate requires the field
 * (`tauri build` and `tauri signer sign --app-version` in CLI 2.12 and later
 * write it). `tauri build` only writes `ED` signatures, so requiring `ED`
 * here rejects nothing the release pipeline makes. Returns null when the
 * signature holds, or the reason it does not.
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
  if (algorithm === 'Ed') {
    return 'uses the legacy unhashed minisign format, which the in-app updater rejects (sign with `tauri signer sign`)';
  }
  if (algorithm !== 'ED') {
    return `uses unsupported algorithm "${algorithm}"`;
  }
  const keyId = sig.subarray(2, 10);
  if (!keyId.equals(publicKey.keyId)) {
    return `was made with key ${keyIdHex(keyId)}, but the app trusts key ${keyIdHex(publicKey.keyId)}`;
  }
  // `ED` signs the BLAKE2b-512 digest of the file.
  const message = createHash('blake2b512').update(data).digest();
  if (!verify(null, message, publicKey.key, sig.subarray(10, 74))) {
    return 'does not verify over the asset on the release (was the file changed after it was signed?)';
  }
  const comment = trustedComment.slice(TRUSTED_COMMENT_PREFIX.length);
  if (!verify(null, Buffer.concat([sig.subarray(10, 74), Buffer.from(comment, 'utf8')]), publicKey.key, globalSig)) {
    return 'has a trusted comment that does not verify';
  }
  // Tauri CLI 2.12 and later record the version they signed for as a
  // `version:` field of the trusted comment. latest.json is not signed, so
  // the field is what ties its `version` to the payload: the in-app updater
  // refuses a signature without it, and one made for another version, so an
  // older signed payload cannot be announced as a newer release. The
  // tauri-plugin-updater 2.13 in 0.5.x/0.6.x installs refuses the mismatch
  // too and accepts either with or without the field.
  const signedVersion = comment
    .split('\t')
    .find((field) => field.startsWith(SIGNED_VERSION_FIELD))
    ?.slice(SIGNED_VERSION_FIELD.length);
  if (signedVersion === undefined) {
    return 'does not name the version it was signed for (sign with `tauri signer sign --app-version`)';
  }
  if (signedVersion.replace(/^v/, '') !== version.replace(/^v/, '')) {
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

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CANDIDATE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/;

function compareVersions(left, right) {
  const leftMatch = CANDIDATE_VERSION.exec(left) ?? RELEASE_VERSION.exec(left);
  const rightMatch = CANDIDATE_VERSION.exec(right) ?? RELEASE_VERSION.exec(right);
  if (!leftMatch || !rightMatch) throw new Error(`invalid release version comparison: ${left} and ${right}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = BigInt(leftMatch[index]) - BigInt(rightMatch[index]);
    if (difference !== 0n) return difference < 0n ? -1 : 1;
  }
  const leftRc = CANDIDATE_VERSION.exec(left);
  const rightRc = CANDIDATE_VERSION.exec(right);
  if (!leftRc) return rightRc ? 1 : 0;
  if (!rightRc) return -1;
  const difference = BigInt(leftRc[4]) - BigInt(rightRc[4]);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function candidateBaseVersion(version) {
  const match = CANDIDATE_VERSION.exec(version);
  if (!match) throw new Error(`candidate version must be X.Y.Z-rc.N: ${version}`);
  return match.slice(1, 4).join('.');
}

function signedVersion(signature) {
  let lines;
  try {
    lines = boxLines(signature);
  } catch {
    throw new Error('is not a minisign signature');
  }
  const comment = lines[2] ?? '';
  if (!comment.startsWith(TRUSTED_COMMENT_PREFIX)) throw new Error('is not a minisign signature');
  return comment.slice(TRUSTED_COMMENT_PREFIX.length).split('\t')
    .find((field) => field.startsWith(SIGNED_VERSION_FIELD))?.slice(SIGNED_VERSION_FIELD.length);
}

export function mergeCandidate(priorManifest, candidate) {
  const baseVersion = candidateBaseVersion(candidate.version);
  if (compareVersions(candidate.version, priorManifest.version) <= 0) {
    throw new Error(`candidate ${candidate.version} must be newer than top-level ${priorManifest.version}`);
  }
  for (const [key, platform] of Object.entries(candidate.platforms ?? {})) {
    const version = signedVersion(platform.signature);
    if (!version || version.replace(/^v/, '') !== candidate.version) {
      throw new Error(`${key}: signature was signed for version ${version ?? '(no version)'}, but candidate announces ${candidate.version}`);
    }
  }
  const candidates = (priorManifest.candidates ?? []).filter((entry) => {
    const existingBase = candidateBaseVersion(entry.version);
    return existingBase !== baseVersion || compareVersions(candidate.version, entry.version) < 0;
  });
  return { ...priorManifest, candidates: [...candidates, candidate] };
}

export function carryForwardCandidates(previousManifest, manifest) {
  const candidates = (previousManifest.candidates ?? []).filter((candidate) => {
    candidateBaseVersion(candidate.version);
    return compareVersions(candidate.version, manifest.version) > 0;
  });
  return candidates.length ? { ...manifest, candidates } : manifest;
}

export function assembleCandidate({ version, notes, pubDate, pubkey, assets, assetsDir }) {
  candidateBaseVersion(version);
  const problems = [];
  const platforms = {};
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  const publicKey = parsePublicKey(pubkey);
  for (const row of UPDATER_BUNDLES) {
    const key = `${row.os}-${row.arch}-${row.bundle}`;
    const matches = assets.filter((asset) => asset.name.endsWith(row.suffix));
    if (matches.length !== 1) {
      problems.push(matches.length === 0
        ? `${key}: no release asset ends with "${row.suffix}"`
        : `${key}: ${matches.length} release assets end with "${row.suffix}": ${matches.map((asset) => asset.name).join(', ')}`);
      continue;
    }
    const bundle = matches[0];
    const signatureName = `${bundle.name}.sig`;
    if (!byName.has(signatureName)) {
      problems.push(`${key}: ${bundle.name} has no ${signatureName} on the release`);
      continue;
    }
    const bundlePath = join(assetsDir, bundle.name);
    const signaturePath = join(assetsDir, signatureName);
    if (![bundlePath, signaturePath].every((file) => existsSync(file))) {
      problems.push(`${key}: bundle or signature was not downloaded`);
      continue;
    }
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
  if (problems.length) return { candidate: null, problems };
  return { candidate: { version, notes, pub_date: pubDate, platforms }, problems };
}
function main() {
  const { values } = parseArgs({
    options: {
      release: { type: 'string' },
      assets: { type: 'string' },
      'tauri-conf': { type: 'string' },
      'pubkey-conf': { type: 'string' },
      'candidate-release': { type: 'string' },
      'candidate-version': { type: 'string' },
      'stable-manifest': { type: 'string' },
      'previous-manifest': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const candidateMode = Boolean(values['candidate-release']);
  const missingFlags = candidateMode
    ? ['candidate-version', 'stable-manifest', 'assets', 'tauri-conf', 'out'].filter((flag) => !values[flag])
    : ['release', 'assets', 'tauri-conf', 'out'].filter((flag) => !values[flag]);
  if (missingFlags.length > 0) {
    console.error(`usage: missing --${missingFlags.join(', --')}`);
    process.exitCode = 2;
    return;
  }
  const tauriConf = JSON.parse(readFileSync(values['tauri-conf'], 'utf8'));
  const pubkeyConf = values['pubkey-conf']
    ? JSON.parse(readFileSync(values['pubkey-conf'], 'utf8'))
    : tauriConf;
  let manifest;
  let problems;
  if (candidateMode) {
    const release = JSON.parse(readFileSync(values['candidate-release'], 'utf8'));
    const stableManifest = JSON.parse(readFileSync(values['stable-manifest'], 'utf8'));
    const result = assembleCandidate({
      version: values['candidate-version'],
      notes: release.body ?? '',
      pubDate: release.publishedAt ?? new Date().toISOString(),
      pubkey: pubkeyConf.plugins.updater.pubkey,
      assets: release.assets,
      assetsDir: values.assets,
    });
    problems = result.problems;
    manifest = result.candidate ? mergeCandidate(stableManifest, result.candidate) : null;
  } else {
    const release = JSON.parse(readFileSync(values.release, 'utf8'));
    ({ manifest, problems } = assembleManifest({
      version: tauriConf.version,
      notes: release.body ?? '',
      pubDate: new Date().toISOString(),
      pubkey: pubkeyConf.plugins.updater.pubkey,
      assets: release.assets,
      assetsDir: values.assets,
    }));
  }

  if (problems.length > 0) {
    console.error(`latest.json NOT written: ${problems.length} problem(s).`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (!manifest) {
    console.error('latest.json NOT written: candidate manifest could not be merged.');
    process.exitCode = 1;
    return;
  }
  if (!candidateMode && values['previous-manifest']) {
    const previousManifest = JSON.parse(readFileSync(values['previous-manifest'], 'utf8'));
    manifest = carryForwardCandidates(previousManifest, manifest);
  }
  writeFileSync(values.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`OK: latest.json for ${manifest.version} with ${Object.keys(manifest.platforms).length} platform keys, every signature verified.`);

}

// Guarded so assemble-updater-manifest.test.mjs can import the functions
// without running the CLI. `import.meta.main` is not usable: it needs Node
// >=22.18/24.2 (see check-mock-baseline.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
