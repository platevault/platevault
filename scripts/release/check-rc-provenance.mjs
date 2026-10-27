#!/usr/bin/env node
// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
//
// Release provenance check (docs/release/release-candidates.md).
//
// A stable release vX.Y.Z may ship only from a release candidate that passed:
// the newest rc/vX.Y.Z-rc.N tag must carry a successful `release/rc` commit
// status, which release-candidate.yml posts when every release suite and the
// candidate's installer build passed, and the commit being released may differ
// from that candidate only in release metadata. That is what release-please
// writes: the changelog, the manifest, and the version in the three files it
// stamps. Anything else, a new commit on main included, needs a new candidate.
//
// Usage:
//   node scripts/release/check-rc-provenance.mjs --version X.Y.Z --commit SHA [--repo OWNER/NAME]
//
// Needs the candidate tags fetched (git fetch --tags) and GH_TOKEN for the
// commit-status read. Exits non-zero, naming every problem, when the check
// fails.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const STATUS_CONTEXT = 'release/rc';

const VERSION = /^\d+\.\d+\.\d+$/;

/** The newest candidate tag for `version` among `tags`, or undefined. */
export function latestCandidate(tags, version) {
  const prefix = `rc/v${version}-rc.`;
  let best;
  for (const tag of tags) {
    if (!tag.startsWith(prefix)) continue;
    const suffix = tag.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const number = Number(suffix);
    if (best === undefined || number > best.number) best = { tag, number };
  }
  return best?.tag;
}

/** The next candidate tag for `version` among `tags`: rc.1, then rc.N+1. */
export function nextCandidate(tags, version) {
  const latest = latestCandidate(tags, version);
  const number = latest === undefined ? 1 : Number(latest.split('-rc.').pop()) + 1;
  return `rc/v${version}-rc.${number}`;
}

function withoutKey(json, key) {
  const value = JSON.parse(json);
  delete value[key];
  return JSON.stringify(value);
}

/** `text` with the version line `pattern` matches replaced by a placeholder. */
function maskFirst(text, pattern) {
  return text.replace(pattern, (_line, prefix) => `${prefix}<version>"`);
}

// What release-please may change in each file it writes. Each rule returns
// the file with the version masked out, so equal results mean the file
// changed in its version only.
const METADATA_RULES = {
  'CHANGELOG.md': null,
  '.release-please-manifest.json': (text) => withoutKey(text, '.'),
  'apps/desktop/package.json': (text) => withoutKey(text, 'version'),
  'apps/desktop/src-tauri/tauri.conf.json': (text) => withoutKey(text, 'version'),
  // The first `version = "…"` in the file is [package]'s.
  'apps/desktop/src-tauri/Cargo.toml': (text) => maskFirst(text, /^(version = ")[^"]*"/m),
  // The lockfile entry of the package whose version release-please bumps.
  'Cargo.lock': (text) => maskFirst(text, /^(name = "desktop_shell"\nversion = ")[^"]*"/m),
};

/**
 * Why the change of `path` from `before` to `after` is not release metadata
 * for `version`, or an empty list when it is.
 */
export function metadataProblems(path, before, after, version) {
  if (!(path in METADATA_RULES)) {
    return [`${path} changed since the candidate, and it is not release metadata`];
  }
  const mask = METADATA_RULES[path];
  if (mask === null) return [];
  if (before === undefined || after === undefined) {
    return [`${path} was added or deleted since the candidate`];
  }
  const problems = [];
  if (mask(before) !== mask(after)) {
    problems.push(`${path} changed in more than its version since the candidate`);
  }
  if (path === '.release-please-manifest.json' && JSON.parse(after)['.'] !== version) {
    problems.push(`${path} is for ${JSON.parse(after)['.']}, not ${version}`);
  }
  return problems;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fileAt(commit, path) {
  try {
    return git('show', `${commit}:${path}`);
  } catch {
    return undefined;
  }
}

function candidateStatus(repo, commit, tag) {
  const statuses = JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/commits/${commit}/statuses`], {
      encoding: 'utf8',
    }),
  ).flat();
  // Newest first: the latest status this tag's run posted decides.
  return statuses.find((status) => status.context === STATUS_CONTEXT && status.description === tag)?.state;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--version', '--commit', '--repo'].includes(key) || argv[i + 1] === undefined) {
      throw new Error(`usage: check-rc-provenance.mjs --version X.Y.Z --commit SHA [--repo OWNER/NAME]`);
    }
    args[key.slice(2)] = argv[i + 1];
  }
  if (!VERSION.test(args.version ?? '')) throw new Error(`--version must be X.Y.Z, got ${args.version}`);
  if (!args.commit) throw new Error('--commit is required');
  args.repo ??= process.env.GITHUB_REPOSITORY;
  if (!args.repo) throw new Error('--repo is required outside GitHub Actions');
  return args;
}

function main() {
  const { version, commit, repo } = parseArgs(process.argv.slice(2));
  const tags = git('tag', '--list', `rc/v${version}-rc.*`).split('\n').filter(Boolean);
  const tag = latestCandidate(tags, version);
  if (tag === undefined) {
    console.error(`::error::no release candidate rc/v${version}-rc.N exists; cut one with the Cut release candidate workflow`);
    process.exit(1);
  }
  const candidate = git('rev-list', '-n', '1', tag).trim();
  console.log(`Newest candidate for ${version}: ${tag} at ${candidate}`);

  const problems = [];
  const state = candidateStatus(repo, candidate, tag);
  if (state !== 'success') {
    problems.push(`${tag} has no successful ${STATUS_CONTEXT} status (found: ${state ?? 'none'}); its release candidate run did not pass`);
  }
  const changed = git('diff', '--name-only', candidate, commit).split('\n').filter(Boolean);
  for (const path of changed) {
    problems.push(...metadataProblems(path, fileAt(candidate, path), fileAt(commit, path), version));
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    console.error(`${commit} may not ship as v${version}: cut a new release candidate from it, or release ${tag}'s commit.`);
    process.exit(1);
  }
  console.log(`${commit} differs from ${tag} only in release metadata (${changed.length} file(s)); provenance holds.`);
}

// Guarded so the test can import the functions without running the CLI (see
// assemble-updater-manifest.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
