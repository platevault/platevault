# Delivery slice review

## Scope and evidence

Model identity exposed by the harness: `openai-codex/gpt-6-astra`. A separate `@max` role indicator is not exposed to this agent.

Review is source-only against the assigned snapshot. No validation was run and nothing was written. Inventory above distinguishes complete small-file inspection from selected sections of large files. Workflow comments and historical incident descriptions were treated as unverified context; findings below follow executable configuration and source relationships.

## Concrete strengths

- Real-UI testing is not merely a collection of ignored stubs. The sampled catalogue-in-place journey operates the UI, applies a plan, and checks both original file location and byte preservation (`crates/e2e-tests/tests/inbox_ui_journeys.rs:930–1031`). The E2E runner explicitly opts ignored tests back in and fails empty selections (`.github/workflows/e2e.yml:818–838`). A stale scaffold comment found elsewhere was not mistaken for current implementation.
- Windows shard coverage compares the archive's complete test set with the union of the three shard selectors, rejects an empty archive, and fails uncovered tests (`.github/workflows/e2e.yml:1145–1179`). This is a meaningful defense against silently losing newly added journeys.
- The frontend related-test path falls back to the full suite when no applicable files/specs are found (`.github/workflows/ci.yml:641–687`). Rust selection traverses reverse workspace dependencies rather than testing only the directly edited crate (`scripts/ci-affected-crates.sh:92–114`).
- Production dev-surface checks cover both the Rust feature graph and the built frontend bundle, with missing hard-check outputs interpreted as failure (`.github/workflows/release-gate.yml:110–175,245–260`).
- CI installs JavaScript dependencies with a frozen lockfile; Node and pnpm are explicitly selected in the workflows. Both ecosystem lockfiles exist, and the pnpm workspace restricts allowed dependency build scripts to esbuild (`pnpm-workspace.yaml:1–6`).
- Supply-chain policy is explicit rather than implicit: license allow-list, recorded duplicate-version exceptions, and named RustSec exceptions exist in `deny.toml`. These are evidence of acknowledged maintenance debt, not evidence that current upstream versions have or lack fixes.
- Coverage is honestly report-only and uploads LCOV (`.github/workflows/coverage.yml:1–16,120–136`). Platform limits are explicit: Linux/Windows real UI, opt-in macOS re-evaluation, and macOS Rust integration. No unsupported claim of full macOS UI coverage is warranted.
- Homebrew waits for the release workflow to complete successfully rather than consuming the initial release-created event (`.github/workflows/homebrew-bump.yml:15–27`). That protects the tap consumer from part of the publication race described below.

## Findings

### DEL-01 — P1 — Real-UI input filters and frontend cache omit actual build inputs
**Confidence:** High. **Type:** Defect.

**Evidence:** `.github/workflows/e2e.yml:262–295` only recognizes the listed Rust/frontend/force-full paths. The dist cache key at `.github/workflows/e2e.yml:316–343` includes `index.html`, Vite config, source/public/package trees and selected manifests, but omits `apps/desktop/messages/**`, `apps/desktop/project.inlang/**`, and `apps/desktop/splash.html`. Those are real inputs: the Paraglide build plugin reads `project.inlang` and message catalogues (`apps/desktop/vite.config.ts:35–51`), and the build explicitly has a splash HTML entry (`apps/desktop/vite.config.ts:68–76`).

**Causal trace / proposed reproducer:** A catalogue-only or splash-HTML-only change sets E2E `run=false`. A manual dispatch or mixed change that does activate E2E can nevertheless restore the old dist because the changed input is outside the cache key. Cache hits skip dependency installation and the frontend build, then upload the restored dist for real-UI execution. The tests can therefore either not run or test a frontend predating the change.

**Counterevidence:** Main CI does explicitly recognize catalogue changes for full frontend testing. That protects unit/mock paths but does not repair the independent real-UI workflow or its cached artifacts.

**Impact:** False confidence in localization, first-run/splash behavior, and any build configuration controlled by the omitted Inlang project inputs.

**Recommended fix:** Define a complete frontend-build input set and use it consistently for E2E activation and artifact invalidation. Include both HTML entries, message/project inputs, and other supported build-affecting configuration. Keep deliberate docs-only exemptions explicit.

**Verification still needed:** In a disposable validation branch, exercise each omitted input independently and inspect both the `run` output and cache key. Prime the cache, alter a catalogue/splash input, and prove the resulting served artifact contains the new content rather than relying only on a cache-miss log.

### DEL-02 — P1 — Main E2E regression alerts lack a repository context
**Confidence:** High. **Type:** Defect.

**Evidence:** `.github/workflows/e2e-alert.yml:35–82` starts from a fresh runner without checkout and successfully addresses API endpoints with an explicit repository. The subsequent `gh label create`, `gh issue list`, `gh issue comment`, and `gh issue create` calls omit `--repo`, and their environments omit `GH_REPO` (`.github/workflows/e2e-alert.yml:84–105,116–154`).

**Causal trace / proposed reproducer:** These repository-scoped CLI commands have neither a checked-out Git remote nor the explicit repository context supplied to the earlier API calls. Label creation and issue lookup suppress the resulting errors; lookup becomes empty; the create branch then fails rather than opening the promised incident. `GITHUB_REPOSITORY` is not the GitHub CLI's `GH_REPO` override.

**Impact:** A main-branch real-UI failure can produce a failed alert workflow but no triage issue—the exact notification this workflow is intended to provide.

**Recommended fix:** Set `GH_REPO: ${{ github.repository }}` at job scope or pass `--repo` on every repository-scoped CLI call. Do not silently turn repository/authentication errors into “no existing incident.” Also use raw `jq -r` output when building issue/comment text; current `jq -n` emits a JSON-quoted string, though that is secondary to the routing failure.

**Verification still needed:** Validate command argument/environment construction without publishing anything, then exercise a controlled alert in an authorized test repository. Confirm label creation, create-versus-comment deduplication, and human-readable Markdown.

### DEL-03 — P1 — Optional Windows Authenticode signing invalidates published updater signatures
**Confidence:** High; conditional on enabling the documented signing lane. **Type:** Defect.

**Evidence:** Tauri creates updater artifacts (`apps/desktop/src-tauri/tauri.conf.json:43–45`). The release action publishes updater metadata and prefers NSIS (`.github/workflows/release-please.yml:161–170`). Windows installers are subsequently submitted to SignPath and the signed `.exe`/`.msi` files replace the uploaded assets (`.github/workflows/release-please.yml:291–329`). There is no subsequent updater signing or `latest.json` signature update. The workflow itself correctly accounts for Authenticode changing file bytes when deciding when to attest them (`.github/workflows/release-please.yml:177–187,306–316`).

**Causal trace / proposed reproducer:** Enable `ENABLE_WINDOWS_SIGNING`, build an NSIS updater artifact, generate its updater signature, then Authenticode-sign it. The release retains the earlier updater signature but serves different bytes at the same URL after `--clobber`. Provenance is regenerated for the final bytes; the updater signature is not.

**Counterevidence:** The lane is opt-in; this is not evidence that current unsigned releases already fail. Provenance generation after signing is correctly ordered, but attestations do not replace Tauri updater signatures.

**Impact:** Turning on platform signing can break Windows automatic updates even though manual installation and provenance checks succeed.

**Recommended fix:** Perform platform signing before updater signing/metadata generation, or regenerate both updater signatures and their metadata from the final signed installers before publication. Avoid replacing live assets between signing phases.

**Verification still needed:** In an isolated signing pipeline, verify the exact final downloadable NSIS bytes against the signature advertised in `latest.json`, then perform an update from the previous installed version. Never use production signing keys for an ad hoc reproducer.

### DEL-04 — P1 — Release publication is not gated by the release verdict or a complete artifact set
**Confidence:** High for repository configuration; live branch rules were not inspected. **Type:** Defect.

**Evidence:** `.github/workflows/release-please.yml:61–74` creates a release and makes platform builds depend only on release-please. The Tauri action uploads to a non-draft release with `releaseDraft: false` (`.github/workflows/release-please.yml:161–170`). The separate release gate runs on release PRs, tags and dispatch (`.github/workflows/release-gate.yml:24–53`); no publishing job depends on its verdict. The checked-in required-status policy does not include Release Gate (`scripts/branch-protection-main.json:2–11`).

**Causal trace / proposed reproducer:** Release Please creates the public release/tag; that tag can start the separate gate while platform builders independently upload assets. A hard gate failure or a single failed platform build does not withdraw the already-public release or prevent another matrix leg from publishing its assets/updater data. On the PR side, the checked-in protection configuration does not make the release verdict mandatory.

**Counterevidence:** Ordinary CI provides several required checks, and the release gate's own hard verdict is fail-closed. Homebrew waits for the release workflow's success. Neither establishes a dependency from the public release transition to the hard release verdict and complete installers.

**Impact:** Users/updaters may see a release that is still incomplete or has failed a declared release invariant. This is a sequencing defect rather than merely a missing status badge.

**Recommended fix:** Build, sign, verify signatures/provenance, and check platform completeness against a draft/staged release; publish once a coordinating job sees all required results. Make the hard release checks executable dependencies of that finalization step. Reconcile the intended PR policy with live branch protection separately.

**Verification still needed:** Model/fault-inject a failed hard gate and a failed platform build in an isolated release repository. Confirm neither produces a public release or advances updater metadata. Read live protection before making claims about present enforcement.

### DEL-05 — P2 — Performance ratchet skips full-workspace and lockfile changes
**Confidence:** High. **Type:** Defect.

**Evidence:** The perf gate runs only if affected-crate output contains one of three crate names (`.github/workflows/ci.yml:855–873`). The helper explicitly emits `ALL` for an unscopable Rust-relevant path (`scripts/ci-affected-crates.sh:64–82`), and `Cargo.lock` is not Rust-relevant to that helper's classifier (`scripts/ci-affected-crates.sh:24–31`).

**Causal trace / proposed reproducer:** A root `Cargo.toml` change produces `ALL`, which fails the three-name grep. A `Cargo.lock`-only change produces an empty string and also fails it. Both changes activate CI's Rust lane, but the actual performance ratchet is skipped. A perf-baseline/script-only edit likewise does not become an affected crate. This contradicts the nearby executable intent that dependency-wide changes cover the measured hot paths.

**Counterevidence:** The normal Rust test step correctly interprets both `ALL` and empty output as a full-workspace fallback (`.github/workflows/ci.yml:551–557`). The defect is the perf caller's divergent handling, not the reverse-dependency traversal itself.

**Impact:** Dependency and workspace-wide regressions—the broadest-impact changes—can bypass the performance budget. Changes to the budget mechanism may not exercise it either.

**Recommended fix:** Consume a shared explicit scope contract: full-workspace must activate perf; recognized irrelevant changes may skip. Add direct triggers for the baseline and its checker, and test the sentinel/lockfile cases.

**Verification still needed:** First inspect helper outputs for `Cargo.toml`, `Cargo.lock`, a measured crate, an unrelated crate, and `scripts/perf-baseline.json`; then evaluate the caller's selection logic. Only after routing is correct run the focused perf checker.

### DEL-06 — P2 — CI's unknown-path fail-closed policy fails for mixed changes
**Confidence:** High. **Type:** Defect.

**Evidence:** The catch-all tests whether *none* of the recognized filters matched anywhere in the change (`.github/workflows/ci.yml:231–243`). In particular, any docs match disables the fallback. The supply-chain job executes only when the resulting Rust lane is true (`.github/workflows/ci.yml:816–827`).

**Causal trace / proposed reproducer:** A `deny.toml`-only change is unrecognized and therefore triggers both lanes. Add a `README.md` change to the same PR: the docs flag becomes true, the catch-all does not run, and no domain flag recognizes `deny.toml`. The supply-chain check and substantive integration work can then be skipped. Similarly, an unrecognized build configuration change combined with a recognized frontend-only file need not activate Rust checks.

**Impact:** Adding an unrelated recognized file can reduce validation coverage for the same build/security-affecting edit. The claimed conservative unknown-path behavior is non-monotonic.

**Recommended fix:** Classify each changed path, compute the unmatched set, and fail closed whenever that set is nonempty; do not infer that every path is understood because one path matched. Add explicit classifications for known build/security configuration.

**Verification still needed:** A pure table-driven filter/decision check should compare `deny.toml` alone versus `deny.toml + README.md`, unknown configuration plus frontend source, and ordinary docs-only changes. Adding an unrelated path must never remove required coverage.

### DEL-07 — P2 — Configured failure diagnostics are not retained by CI
**Confidence:** High. **Type:** Observability opportunity with a concrete wiring gap.

**Evidence:** Nextest's CI profile writes `junit.xml` (`.config/nextest.toml:151–170`); Playwright retains traces on failure (`apps/desktop/playwright.config.ts:43–48`). `.github/workflows/ci.yml:540–588,883–907` runs those suites but does not upload their result directories. The artifact-upload search in this workflow found only an explanatory comment, not an upload step. Coverage, in contrast, explicitly uploads its report.

**Causal trace / proposed reproducer:** A failing mock-browser test creates a retained local trace on the ephemeral runner. Once the job is gone, the trace is gone too; the list reporter log is not an equivalent debugging artifact. The generated machine-readable Rust report is similarly discarded.

**Impact:** Slower investigation of browser retries, transient failures, and platform-specific integration failures; “retain-on-failure” does not translate into remotely retrievable evidence.

**Recommended fix:** Upload bounded, access-appropriate result directories using `if: always()` or a failure-specific condition. Include JUnit and browser traces with explicit retention and missing-file behavior. Review artifact privacy rather than uploading arbitrary app-data directories.

**Verification still needed:** Cause one controlled failing browser assertion and one Rust test failure in an isolated CI run; verify artifacts remain downloadable and contain the specific failing attempt.

## Dependency, platform, and test-policy assessment

- No deprecation or “upgrade to latest” finding is made. `deny.toml` records concrete advisory IDs; current applicability and upstream remediation were not checked externally. Manifest RC versions alone are not a defect.
- Rust is pinned consistently in the inspected toolchain file and workflow invocations. Local Node/LSP tools in `mise.toml` float at `latest`, while CI selects Node 24. Cargo build/test invocations generally omit `--locked`; reproducibility therefore relies on the committed lock remaining satisfiable, rather than failing if Cargo needs to update it. These are worthwhile follow-on hardening items, not proof that this snapshot resolves differently.
- Many release actions use mutable version tags; the provenance action is SHA-pinned. Signing/publication jobs deserve prioritized immutable-action pinning because they hold secrets and write release assets. No action-compromise claim is made.
- The release gate deliberately treats workspace tests as soft (`.github/workflows/release-gate.yml:43,253`). Ordinary CI is counterevidence against calling this a universal test bypass; the more concrete problem is DEL-04's missing publication dependency.
- `fixtures:check` merely echoes a pending message (`package.json:17`), and `just fixtures-check` delegates to it (`justfile:194–196`). It is not part of the inspected aggregate CI checks, so this is a misleading local placeholder, not an established merge-gate bypass.
- Test-suite searches found intentionally ignored real-UI tests and one explicitly skipped mock lifecycle scenario. The real-UI runner opts ignored journeys back in; the sampled journey has substantive assertions. This review does not claim comprehensive test quality from one sample.

## Prioritized roadmap

1. **Trust release/update bytes:** DEL-03 and DEL-04 before enabling Windows signing or treating the release verdict as a publication guarantee.
2. **Restore truthful verification and alerting:** DEL-01 and DEL-02; real-UI tests must consume the current build and failures must reach their incident channel.
3. **Close routing gaps cheaply:** DEL-05 and DEL-06 through pure input-selection checks before running expensive suites.
4. **Preserve evidence:** DEL-07, then unify toolchain/lock enforcement and pin privileged actions.

## Efficient validation plan for the coordinator — NOT RUN

Run only in an authorized provisioned validation environment; no need to begin with full builds or all tests.

- Static workflow validation, if already available: `actionlint .github/workflows/ci.yml .github/workflows/e2e.yml .github/workflows/e2e-alert.yml .github/workflows/release-please.yml .github/workflows/release-gate.yml`. This can find syntax issues, not prove gating semantics or cache completeness.
- Scope helper examples: `printf 'Cargo.toml\n' | bash scripts/ci-affected-crates.sh`; repeat for `Cargo.lock`, `crates/app/inbox/src/lib.rs`, and `scripts/perf-baseline.json`. Then table-test the exact consumer logic. The existing `bash scripts/ci-affected-crates.sh --self-test` alone does not cover the perf caller.
- Cache/filter regression checks: evaluate catalogue-only, splash-only, and Inlang-only path sets; compare hash inputs before/after each edit in a disposable branch. Only one warmed-cache E2E smoke run is needed to demonstrate current artifact consumption.
- Alert routing: use `gh issue list --repo "$REPOSITORY" --limit 1` only when authorized for remote read access; do not create/comment on production issues merely to validate this review. Mock CLI calls for the pure flow check, then use an authorized test repository for end-to-end notification.
- After correcting performance routing: `PERF_N=500 bash scripts/check-perf-baseline.sh` is the focused workload, rather than the full workspace suite.
- Existing bounded real-UI selection: `cargo nextest list -p e2e_tests --run-ignored all --message-format oneline` checks discovery without launching the app, though it may compile. Execute the three-journey smoke workflow only after artifact/input checks; do not start with the full Linux/Windows matrix.
- Release validation requires an isolated staging/signing environment: test final-byte updater verification and failed-platform/failed-gate publication behavior. A successful local `cargo build` cannot prove those properties.

## Exclusions and limitations

No runtime, screenshots, visual/accessibility assertions, vulnerability feeds, live workflow history, live repository settings, signing secrets, user data, or databases were accessed. No validation commands above were executed. Lockfiles were sampled rather than fully audited. Long E2E workflows were inspected around the relevant filters/cache/build/smoke/shard sections, not every duplicated platform provisioning step. General application correctness and exhaustive tests belong to the other review slices. The defects are grounded in source reachability; CI behavior, signatures, and published release state remain to be demonstrated by the coordinator's permitted follow-up.

## Inspection inventory

- `.github/workflows/ci.yml`: Inspected change classification, Rust/frontend gates, scoped tests, performance ratchet, supply-chain job, idle contexts, and mock-mode browser execution.
- `.github/workflows/e2e.yml`: Inspected event/platform policy, input filters, frontend cache, Ubuntu build/cache setup, smoke selection, and Windows shard coverage/execution.
- `.github/workflows/release-please.yml`: Inspected release creation, platform builds, signing, updater publication, provenance, and Windows post-signing replacement.
- `.github/workflows/release-gate.yml`: Inspected hard/soft policies, version synchronization, release build, dev-surface checks, and final verdict.
- `.github/workflows/e2e-alert.yml`: Inspected complete main-branch E2E alert flow and GitHub CLI repository selection.
- `.github/workflows/coverage.yml`: Inspected source gating, coverage collection, tool/dependency provisioning, and LCOV retention.
- `.github/workflows/homebrew-bump.yml`: Inspected completion-triggered release consumption, digest selection, and tap PR automation.
- `scripts/ci-affected-crates.sh`: Inspected complete member mapping, reverse dependency closure, ALL sentinel, and self-tests.
- `scripts/branch-protection-main.json`: Inspected checked-in required contexts; live branch protection was not accessed.
- `.config/nextest.toml`: Inspected CI/E2E profiles, retry and concurrency policy, JUnit configuration, and platform constraints.
- `apps/desktop/playwright.config.ts`: Inspected browser scope, retries, retained traces, dedicated server port, and server isolation.
- `apps/desktop/vitest.config.ts`: Inspected test discovery, generated catalogue setup, release-mode constants, environment, and timeout policy.
- `apps/desktop/vite.config.ts`: Inspected real build inputs, Paraglide generation, both HTML entries, and environment defines.
- `crates/e2e-tests/tests/inbox_ui_journeys.rs`: Sampled catalogue-in-place real-UI journey and filesystem byte-preservation assertions at lines 929–1031; searched test trees for skips and vacuous assertions.
- `justfile`: Inspected local test/lint/build entrypoints, generated drift and architectural ratchets, and placeholder fixture command.
- `package.json`: Inspected root scripts, engines, package-manager pin, and fixture-check no-op.
- `apps/desktop/package.json`: Inspected desktop build/test/lint/typecheck scripts and direct dependency declarations.
- `packages/contracts/package.json`: Inspected schema generation, explicitly enumerated contract tests, and package dependencies.
- `Cargo.toml`: Inspected workspace members, dependency policy, feature choices, release profile, and lints.
- `Cargo.lock`: Inspected lock format and registry checksum entries; no complete transitive dependency audit.
- `pnpm-lock.yaml`: Inspected lock settings and initial desktop importer resolutions; no complete transitive dependency audit.
- `pnpm-workspace.yaml`: Inspected workspace membership and install-script allow-list.
- `deny.toml`: Inspected license policy, duplicate-version exceptions, and explicitly recorded unmaintained-advisory exceptions.
- `rust-toolchain.toml`: Inspected Rust 1.98.0 toolchain pin and components.
- `mise.toml`: Inspected floating local Node and language-tool selections.
- `release-please-config.json`: Inspected release type, changelog policy, and desktop version update targets.
