# Delivery challenge report

Model exposed by the harness: openai-codex/gpt-6-astra. A separate @max role indicator is unavailable. This is a source-only holistic snapshot review, not a patch-introduction review. No files were written and no validation, tests, builds, installations, workflow execution, database operations or publication were performed. An empty git diff established no local patch; findings were nevertheless assessed against existing source as requested.

## DEL-01 — ACCEPT, P1

The omitted-input defect is substantiated. `.github/workflows/e2e.yml:262-295` does not activate E2E for message-catalogue JSON, Inlang-settings JSON or splash-HTML-only changes. The dist key at `e2e.yml:316-343` excludes these same inputs and a cache hit bypasses the build. Actual input consumers are `apps/desktop/vite.config.ts:35-51,68-76` and `apps/desktop/project.inlang/settings.json:2-10`; the latter connects the message path to the plugin. This is not merely a possible unused configuration file.

Consumer trace: the workflow uploads restored dist at `e2e.yml:348-352`; smoke downloads it at `:793-796`, serves it through Vite preview at `:806-816`, and executes the archived journeys at `:818-838`. `apps/desktop/package.json:8-9` makes preview a static-dist server, not a rebuilding dev server. `apps/desktop/src-tauri/src/lib.rs:398-432` applies the E2E dev-URL override. Thus dispatching E2E does not repair a stale cache.

Counterevidence: main CI explicitly activates frontend/full tests for catalogues (`ci.yml:165-177,211-219`) and builds the frontend at `:699-703`. Those artifacts are not what the independent E2E workflow consumes. Keep the claim about an omitted input, not a claim that localization is wholly untested. Remaining proof: one warmed-cache smoke run for a catalogue edit, plus independent path-classification checks for all three omitted input families.

## DEL-02 — ACCEPT, P1

`.github/workflows/e2e-alert.yml:35-82` contains no checkout and uses explicit repository paths only for the API request. Its subsequent label and issue operations (`:84-110,116-154`) have neither `--repo` nor `GH_REPO`; their environments supply only authentication and message fields. Default `GITHUB_REPOSITORY` is not the CLI's repository-selection override. Label and lookup errors are suppressed, causing the lookup to report no existing incident before the unqualified create command fails. Consequently the workflow cannot perform its intended GitHub-issue alert on a fresh hosted runner.

Counterevidence: the failure/main-branch condition at `:34` is appropriate, and the job-metadata API path is correctly repository-qualified. Neither supplies repository context to later independent shell steps. A failed alert workflow may still generate normal GitHub workflow-failure notifications; the defensible impact is failure of the promised issue channel, not literally that nobody can receive any notification.

The secondary body-encoding defect is also real: `:81`, `:126-130` and `:145-149` retain JSON encoding rather than producing raw Markdown. It is subordinate to DEL-02, not a new numbered finding. Remaining proof: inspect/mock argv and environment without making API changes, then test create-versus-comment routing in an authorized disposable repository.

## DEL-03 — DOWNGRADE, P2 latent signing defect

The cryptographic ordering concern is valid: `release-please.yml:161-170` publishes updater metadata before the optional SignPath chain; `:291-304` obtains newly signed installers; `:322-329` replaces only installers, with no updater-sidecar or latest.json regeneration. `apps/desktop/src-tauri/tauri.conf.json:43-45,59-65` enables updater artifacts and configures the public update endpoint. Attestations at `release-please.yml:310-317` do not replace updater signatures.

However, enabling the variable alone does not establish the report's proposed end-to-end failure. A preceding collection defect at `release-please.yml:243-251` requests app-local target paths, whereas `Cargo.toml:1-4` makes the app part of the root workspace. The action resolves the workspace target directory; see https://raw.githubusercontent.com/tauri-apps/tauri-action/v1/src/build.ts (buildProject, workspacePath/artifactsPath) and https://raw.githubusercontent.com/tauri-apps/tauri-action/v1/src/utils.ts (getWorkspaceDir/getTargetDir, default workspacePath/target). No target override is supplied in this workflow. The present local `.cargo/config.toml` is untracked, as confirmed by git show HEAD:.cargo/config.toml failing, and cannot establish a hosted-runner override. Collection therefore fails before `sign-windows`, whose needs include build (`:265`).

Corrected scope: this is a latent signature-invalidating design that becomes reachable after the collector is repaired and signing enabled, not proof that current downloadable Windows updates fail. Keep it visible and require final-byte signing before enabling that lane; downgrade present severity to P2. Remaining proof: stage the complete lane with test credentials, establish the actual installer referenced by latest.json, and verify its final bytes against the advertised updater signature. The upstream v1 sources are mutable-tag corroboration, not a pinned record of a historical action execution.

## DEL-04 — ACCEPT, P1

Publication has no executable dependency on the hard release verdict or complete platform set. `release-please.yml:63-74` creates the release first, and platform builds depend only on release-please. `:75-78` permits independent matrix outcomes; `:161-170` publishes to a non-draft release and uploads updater metadata. `release-gate.yml:24-53` runs separately on release PRs/tags/dispatch, with no publisher waiting for it. The release configuration contains no draft-release override (`release-please-config.json:1-48`). The client uses releases/latest/download/latest.json (`tauri.conf.json:61-65`). A successful platform can therefore expose assets while a sibling fails, independently of the hard verdict.

Counterevidence inspected: the gate itself treats missing hard-check results as failure (`release-gate.yml:245-260`); ordinary CI exists; checked-in required contexts omit Release Gate (`scripts/branch-protection-main.json:2-11`); Homebrew waits for Release Please workflow success (`homebrew-bump.yml:15-27`). These reduce some exposure, particularly Homebrew, but none gates the public release transition. Live branch rules were not inspected, so do not claim the checked-in policy proves current server-side enforcement. Remaining proof: isolated failure injection for a hard gate and a platform leg; a passing local release build would not verify publication ordering.

## DEL-05 — ACCEPT, P2

The actual perf consumer contradicts its full-workspace comment. `ci.yml:855-873` looks only for three crate names. `scripts/ci-affected-crates.sh:24-31` ignores Cargo.lock, and `:64-82` emits ALL for a root Cargo.toml change. Neither empty output nor ALL matches the consumer. Both inputs activate the Rust lane (`ci.yml:155-158,204-207`), so the job starts but its ratchet is skipped. The same consumer also overlooks a baseline/checker-only change despite scripts activating CI.

Counterevidence: normal Rust tests handle ALL and empty output conservatively (`ci.yml:551-557`); reverse-dependency traversal exists (`scripts/ci-affected-crates.sh:92-114`). The helper self-tests (`:119-162`) cover ordinary mapping, reverse-dependency presence, docs, orphan Rust and mixed docs/crate paths, but not this perf caller or lockfile/sentinel interpretation. Remaining proof: evaluate the exact caller over root manifest, lockfile, measured/unrelated crate and perf-baseline/checker path cases before running the focused performance workload.

## DEL-06 — ACCEPT, P2

The fail-closed fallback at `ci.yml:231-243` asks whether any recognized filter matched the entire change set, not whether every changed path was classified. `deny.toml` matches no explicit security/Rust driver in `:140-195`; alone it falls back to both lanes. Add README.md and docs becomes true (`:196-204`), disabling fallback while leaving Rust false. Supply-chain execution is gated on that Rust output (`:816-827`). Thus an unrelated recognized file reduces coverage for the identical policy edit.

Counterevidence: scripts and Cargo manifests/lockfiles have explicit force-full routes, and frontend-full inputs are correctly incorporated into frontend activation. Those guards do not cover deny.toml or arbitrary unmatched files mixed with recognized ones. The checked-in required cargo-deny context does not establish that the underlying security check executed. Remaining proof: a table-driven classification test should compare deny.toml alone, deny.toml plus README.md, deny.toml plus frontend source, and docs-only. Test monotonicity, not just isolated representative paths.

## DEL-07 — DOWNGRADE, P3

The wiring gap is substantiated: `.config/nextest.toml:144-157` writes JUnit; `apps/desktop/playwright.config.ts:29-47` uses the list reporter and retains failure traces; `apps/desktop/package.json:13` invokes Playwright. CI executes these at `ci.yml:540-588,883-907` but has no upload-artifact step. An exact upload-artifact search across ci.yml returned only its explanatory permissions comment. The remaining integration steps through `:758` also contain no diagnostic-upload path.

Counterevidence: nextest explicitly prints failures immediately and in its final summary (`nextest.toml:150-152`), and Playwright's list reporter gives text output. Failures still fail CI. Missing trace/JUnit retention materially weakens debugging, but the report does not demonstrate a correctness or release-blocking failure caused by it. Treat as P3 observability improvement, not P2 gate failure. Remaining proof: one controlled failing browser attempt and one Rust failure in a disposable CI run, verifying downloadable bounded artifacts and their privacy/retention policy.

## Material omissions and unsupported expansions

One additional source-supported release-readiness defect was omitted: the optional Windows collector uses the wrong target directory (`release-please.yml:249-251` versus root workspace membership `Cargo.toml:1-4` and the action's workspace-target resolution). This blocks the signing job before DEL-03's signature mismatch becomes reachable. Keep it separate from the seven original verdicts; it deserves a P2 readiness fix before enabling signing. Also verify preservation of nsis/msi subdirectories when handing artifacts through SignPath: current signed/*.exe and signed/*.msi assumptions were not validated, so this is a verification item, not an additional finding.

No deprecated dependency/version claim is justified here. No full advisory-feed, transitive-lockfile, immutable-action-pin, platform parity, full-suite quality or live branch-protection audit was performed. Source cannot establish rendered visual behavior. The original report correctly avoids treating intentionally ignored real-UI journeys, soft release tests or the local fixture placeholder as universal test bypasses; this challenge did not independently audit every original strength/inventory statement.

## Prioritized roadmap and focused parent validation

1. Make publication wait for hard release checks, all required artifacts and final-byte signatures. Fix the Windows artifact handoff before testing its post-signing signature flow; use staging and test credentials only.
2. Repair E2E input activation/cache identity and issue-alert repository context. Prove artifact freshness with one warmed-cache smoke run, not the whole platform matrix.
3. Repair perf sentinel handling and per-path classification. Cheap decision tables should precede expensive suites.
4. Retain bounded failure diagnostics; then separately assess lock enforcement and privileged-action pinning without alleging known vulnerabilities.

Suggested commands, NOT RUN: `actionlint .github/workflows/ci.yml .github/workflows/e2e.yml .github/workflows/e2e-alert.yml .github/workflows/release-please.yml .github/workflows/release-gate.yml` for syntax only; `printf 'Cargo.toml\n' | bash scripts/ci-affected-crates.sh` and the Cargo.lock equivalent for helper outputs, followed by the exact perf consumer rather than assuming helper success proves routing; `bash scripts/ci-affected-crates.sh --self-test` for existing helper coverage; after routing is repaired, `PERF_N=500 bash scripts/check-perf-baseline.sh`. The helper invokes cargo metadata and requires a provisioned disposable checkout. For read-only CLI repository routing, with separately authorized remote access: `gh issue list --repo "$REPOSITORY" --limit 1`. Do not run create/comment merely to validate this report. Pure filter/cache-key and alert-argv checks require a small disposable harness; no existing command inspected here tests these full contracts. Publication/signature guarantees require controlled workflow staging, not a local compilation command.

## Verdict table

| ID | Verdict | Corrected severity |
|---|---|---|
| DEL-01 | ACCEPT | P1 |
| DEL-02 | ACCEPT | P1 |
| DEL-03 | DOWNGRADE | P2, latent |
| DEL-04 | ACCEPT | P1 |
| DEL-05 | ACCEPT | P2 |
| DEL-06 | ACCEPT | P2 |
| DEL-07 | DOWNGRADE | P3 |

Totals: 5 accepted, 2 downgraded, 0 rejected. All seven original findings remain visible; the additional collector omission is not counted as an eighth original finding.
