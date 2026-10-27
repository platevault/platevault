# Release candidates

A stable release ships only from a release candidate that passed. The order is always main, then a candidate, then the release:

```mermaid
flowchart LR
  main[commit on main] -->|Cut release candidate| rc["rc/vX.Y.Z-rc.N tag"]
  rc --> suites["Release candidate workflow:\nrelease suites + installers"]
  suites -->|release/rc = success| gate["Release Gate on the release PR\n(rc-provenance, hard)"]
  gate -->|merge| release["vX.Y.Z by release-please"]
  release -->|approve the release environment| build["rc-gate re-checks,\nthen build + latest.json"]
```

Release-please still owns versions and the changelog. It keeps an open release PR whose manifest names the next version, X.Y.Z. A candidate is a tag on a commit of main, `rc/vX.Y.Z-rc.N`. Release-please never counts it as a release: with `include-component-in-tag: false` it ignores any tag that has a component, and `rc/` is one.

## Cut a candidate

1. Run **Cut release candidate** (`cut-release-candidate.yml`) from the Actions tab. Leave `commit` empty to take main's tip, or give a commit of main.
2. The workflow reads X.Y.Z from the release PR's branch (`release-please--branches--main`), picks the next N and creates the tag with the release app's token.
3. The tag push starts **Release candidate** (`release-candidate.yml`) at the tagged commit. It:
   - posts a pending `release/rc` commit status on the commit;
   - runs the release suites: the full journey matrix on Ubuntu (4 shards) and Windows (3 shards), the window runtime checks on Windows at 1920x1080 and on Linux X11, the macOS journeys, and Rust coverage;
   - creates a GitHub prerelease for the tag and builds the installers on it with `build-installers.yml`, the same workflow a release uses, stamped with X.Y.Z;
   - posts `release/rc` as success only when every suite and the installer build passed, and as failure otherwise.

The macOS journeys run but don't block yet: `tauri-plugin-webdriver` has no working macOS WebDriver on GitHub runners (#489). A red macOS leg shows in the run without failing the candidate.

A prerelease never becomes GitHub's latest release, and installed copies poll `releases/latest/download/latest.json`. So no installed copy is offered a candidate, and only the stable release writes `latest.json`. Testers install a candidate from its prerelease page.

A failed candidate stays failed. Fix main, then cut the next candidate; N goes up by one.

## Release

1. When the candidate has passed, merge the release PR. Release Gate's `rc-provenance` check is hard. It passes only when the newest candidate for X.Y.Z has a successful `release/rc` status, and the release PR differs from the candidate's commit only in release metadata:
   - `CHANGELOG.md`, any change;
   - `.release-please-manifest.json`, `apps/desktop/package.json` and `apps/desktop/src-tauri/tauri.conf.json`, the version only;
   - `apps/desktop/src-tauri/Cargo.toml`, the package version only, and `Cargo.lock`, the `desktop_shell` entry's version only.

   Any other change since the candidate, such as a new commit on main, fails the check: cut a new candidate from main's new tip.
2. The merge makes release-please publish the `vX.Y.Z` release. Its `rc-gate` job waits for approval on the `release` environment, re-runs the same check on the released commit, and only then lets the installers build and `latest.json` publish.

`scripts/release/check-rc-provenance.mjs` is the one implementation of the check, used by both gates. `node scripts/release/check-rc-provenance.test.mjs` tests the metadata rules.

## What runs where

|Suite|PRs and merge queue|Push to main|Release candidate|Manual dispatch|
|---|---|---|---|---|
|L1+L2 tests (ci.yml), mock-mode Playwright, cargo-deny, perf baseline|yes|yes|no (already ran on main)|no|
|Real-UI smoke subset (3 journeys, Ubuntu)|yes, required|no|no|no|
|Full journey matrix, Ubuntu + Windows|no|no|yes|`e2e.yml`, `suite: release`|
|Window runtime checks, Windows + Linux X11|no|no|yes|`suite: release` or `window-runtime`|
|macOS journeys|no|no|yes, not blocking|`suite: release` or `macos`|
|Rust coverage|no|no|yes|`coverage.yml`|

## Owner setup

These settings live in the repository, not in the workflows:

1. **Settings, Environments: create `release` and add yourself as a required reviewer.** Without a reviewer the environment approves itself, and `rc-gate` runs straight away.
2. **Settings, Branches: add `Release Gate` to main's required status checks.** As of 2026-10-27 it is reported but not required. Release Gate is skipped on PRs that aren't release PRs, and a skipped required check counts as passing, so only the release PR waits on it. `scripts/branch-protection-main.sh` lists the required checks.
3. Optional: add a tag ruleset that limits who may create `rc/*` and `v*` tags. Anyone with write access can post a `release/rc` status or push a tag, so the gate protects against mistakes, not against someone with write access acting on purpose.
