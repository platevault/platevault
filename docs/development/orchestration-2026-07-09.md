# Orchestration log — 2026-07-09 (release-finish campaign)

Run id: `run-20260709-release`. Mission: drive PlateVault to a
release-finished state (backend tails closed, docs reconciled, stale issues
verified/closed, Windows validation clean) without touching the release
mechanism itself.

## Lane map

| Node | Scope |
|---|---|
| 0a | docs-networking (Windows/WSL bridge docs, mirrored networking) |
| 0b | CI wins (quick, safe CI fixes) |
| A | workspace-red (fix red `cargo test --workspace` / lint baseline) |
| B | spec044 (targets-planner-astronomy, Track B) |
| C | spec017 (cleanup-archive-review-plans remainder) |
| D | spec048 (per-frame-inventory) |
| E | spec037 (e2e-integration-testing tail) |
| F | spec049 (source-view-generation) |
| G | spec026 (generated-source-view-removal decision) |
| H1 | 033-tail (validation-bugfix-remediation remainder) |
| H2 | 025/012/008/021 tails |
| I | bookkeeping (this lane): orchestration log, SPEC_STATUS.md, stale-issue closure |
| J | Windows validation |
| K | hand-off |

## Recorded decisions

- **(a) Journey-doc lanes serialized behind 0a.** Docs touching the
  Windows/WSL bridge mechanics wait for 0a to land first to avoid rebase
  churn on the same doc files.
- **(b) Backend tail serialized D → F → G → H1 → H2** to avoid scope
  collisions across specs 048/049/026/033/025/012/008/021 that touch
  overlapping crates and UI surfaces.
- **(c) `tasks.md` ticks land as surgical edits, with mandatory independent
  `speckit-verify` audits**, because SpecKit skill invocations are
  cwd-pinned to the primary checkout and single-active-feature — unsafe to
  run concurrently across parallel worktree lanes. Coders tick their own
  tasks by hand; a separate audit lane re-verifies against code before any
  status is trusted.
- **(d) macOS Real-UI E2E is under active investigation.** The merge bar
  (Integration + mock-mode CI green, plus ubuntu/windows Real-UI green) may
  be tightened once macOS is fixed; until then macOS Real-UI stays
  best-effort/non-blocking (carried from the 2026-07-06 campaign, D6).
- **(e) Versioning is reset to 0.x** (see `cbd91378`); the release lane is
  owned elsewhere in this campaign. This lane and all bookkeeping work MUST
  NOT touch `.github/workflows/**`, tags, versions, or release PRs.

## Updates

- **Real-UI E2E audit (2026-07-09).** macOS leg is hard-broken upstream in
  `tauri-plugin-webdriver` 0.2.1 (embedded `:4445` server never starts on
  macOS runners; upstream's own CI is red on macOS, issue tracker disabled,
  no newer release; no `safaridriver` path for embedded WKWebView). ubuntu/
  windows legs verified reliable (only true product bugs caught in the last
  ~15 runs). **Decision:** new lane `nM` removes macOS from the PR matrix →
  `workflow_dispatch`-only, without `continue-on-error` (true signal for
  future upstream re-tests), adds job-level `timeout-minutes`, and adds
  `desktop_shell` stdout/stderr capture on launch failure in the e2e harness.
  Merge bar unchanged: Integration + mock + Real-UI ubuntu+windows required.
  Re-check `tauri-plugin-webdriver` releases periodically.
- **Pre-push typos hook false-positives (2026-07-09).** First push of any new
  branch trips a full-scan fallback that flags commit-hash substrings in
  release-please-generated `CHANGELOG.md`. **Decision:** surgical
  `SKIP=typos` authorized once for lane `n0b`; durable fix is excluding
  `CHANGELOG.md` from the typos config, landing in the `n0b` PR.
- **macOS Real-UI, no viable alternative found (2026-07-09).** Internal issue
  #489 filed ("Real-UI E2E: macOS leg blocked — tauri-plugin-webdriver
  upstream failure", labels `bug`/`spec:037`). A project-history search found
  no viable alternative: 037 `research.md` D4 already surveyed the field (the
  `danielraffel` webdriver-automation plugin was never adopted; CrabNebula
  Cloud rejected as paid; `safaridriver`/AXUI/CDP never explored); the
  `tauri-plugin-mcp-bridge` is architecturally macOS-capable but non-WebDriver,
  dev-only per D4, and unvalidated headless — a future spike, not a fix.
  **Owner directive applied:** lane `nM` disables the macOS Real-UI leg on
  PRs, keeping a `workflow_dispatch` re-test path without
  `continue-on-error`; macOS coverage relies on unit + integration + mock
  suites. Watch item: `tauri-plugin-webdriver` releases + the mcp-bridge
  spike idea live in #489.
- **Lane ownership clarification (2026-07-09).** Lanes J (Windows validation)
  and K (final hand-off) are externally owned by the campaign session, not
  by any coder lane in this run — feature-PR lanes author verify-on-windows
  scenario text but never execute it on Windows themselves.
- **041 verify-then-close outcome (2026-07-09, this lane).** Zero phantom
  completions found. Inverse drift instead: 6 tasks (T071/T072/T073/T076/
  T077/T081) were implemented-and-tested on `main` but left unticked in
  `tasks.md`; all 21 open issues in the #320–#340 range were stale-open
  (code already shipped). T079 (Windows E2E) remains genuinely open — left
  unticked, issue #340 left open.
- **Lane D / 048 concurrent-session conflict (2026-07-09).** A separate,
  fresh local worktree (branch `048-complete-per-frame-inventory`, created
  2026-07-09, no commits at check time) is independently working spec 048.
  **Owner directive:** lane D proceeds in reconcile-and-complete mode when
  it unlocks — rebase onto whatever the external session has landed (branch
  or merged PRs), run a fresh `speckit-verify mode:tasks` against real code
  first, then implement only the verified remainder. SPEC_STATUS 048 row
  updated accordingly.
- **T078 retroactive sync.conflicts run (2026-07-09).** Found a genuine
  041↔006 lifecycle contradiction: 041 FR-051/SC-018 mandate removing the
  session review lifecycle entirely, but a later shipped 006 iteration
  (2026-07-03, FR-010) deliberately retained the `ignored` canonical state
  and its Ignore/recover flow. Reconciled toward the later shipped 006
  decision via a dated amendment annotation on 041's FR-051/SC-018 (see
  `specs/041-inbox-plan-surface/sync-conflicts-2026-07-09.md` and the
  spec.md annotations) rather than reverting either side's shipped code.
  Flagged to the product owner for override if this reconciliation is
  wrong. T078 ticked; issue #339 closed citing the record.
- **Lane 0b + lane A merged (2026-07-09).** #487 (CI quick wins — dropped
  the redundant workspace build, Linux-only fmt/clippy/doctests + a
  Windows cargo-check backstop, tauri-webdriver binstall, CHANGELOG
  excluded from the typos config, `ccd2f490`) and #494 (2 flake
  stabilizations, `759a8907`) both merged. **Lane A finding: the
  historical "workspace-test red" baseline is now STALE** — `cargo test
  --workspace` is fully green on `main` (1980/1980, confirmed by #494's
  own run). This supersedes the long-standing
  `preexisting-workspace-test-breakage` note; future lanes may use
  `cargo test --workspace` directly again instead of per-crate `-p`
  workarounds.
- **Wave-2 lanes spawned (2026-07-09).** nD (048 reconcile-and-complete,
  per the concurrent-session directive above), nE (037 completion +
  coverage-matrix + `testing.md`), nM (macOS Real-UI descope per #489 +
  the reconcile-flake stabilization below).
- **CI triage (2026-07-09).** `reconcile_drops_externally_deleted_frame`
  confirmed an intermittent cross-PR flake (root-cause theory: reconcile
  completion racing UI polling lag, no query invalidation on completion —
  owned by lane nM's stabilization work). #499 (lane nB) carries a
  **separate real regression**,
  `targets_planner_real_astronomy_after_site_creation`, currently in a fix
  round — not the same failure class as the reconcile flake. **Resolved**:
  #499's fix round completed and merged (`1a0c4644`, see below).
- **Lane nC/nB/nD merged (2026-07-09).** #492 (017, `bbbd11ff` — destination
  path preview + retry-plan action + virtualized overlay +
  quickstart/a11y/perf-honest, 42/51), #499 (044 Track B, `1a0c4644` — real
  Moon geometry + dark-window awareness for future-night planning, plus the
  13k-row moon-geometry perf regression fix; Track B complete minus T017/
  T036 deferred, 36/40), #517 (048, `0463bbd2`, lane nD — reconcile wiring +
  a settings-edits-silently-reverted fix + a manual reconcile action, 048
  now 15/44, still shared with the external session's open #500/#503).
  SPEC_STATUS 017/044/048 rows updated accordingly.
- **macOS Real-UI descope superseded (2026-07-09).** Owner's own #533
  (`a1da9a20`) landed a simpler macOS-drop directly on `main` ahead of lane
  nM's version. Lane nM is rebasing to re-express its increment (the
  `workflow_dispatch` re-test input, job timeouts, launch-failure
  diagnostics, and the `reconcile_drops_externally_deleted_frame` flake fix)
  on top of #533 rather than duplicating the descope itself.
- **Lane nF spawned (2026-07-09).** 049 tail, reconcile-first against the
  external session's open #490/#500/#503 (same posture as nD/048: rebase +
  fresh `speckit-verify mode:tasks` before implementing only the verified
  remainder).
- **CI infra-red note (2026-07-09).** This session's CI reds were traced to
  runner crashes + linker OOM under heavy concurrent CI load, not code —
  no fix lane needed for those failures specifically; re-run rather than
  debug when the failure signature matches.
- **Lane nM/nE merged (2026-07-09).** #528 (`3e9203b1`, lane nM) re-expressed
  its macOS Real-UI increment on top of owner's #533 baseline: the
  `workflow_dispatch` re-test path, job timeouts, launch-failure
  diagnostics, and the `reconcile_drops_externally_deleted_frame` flake fix
  (see the CI triage entry above). #531 (`35f86be4`, lane nE) closed out
  spec 037: coverage-matrix refresh, `testing.md` Layer-2 rewrite, a new
  StepSite wizard mock spec (`tests/e2e/setup_wizard_site_step.spec.ts`),
  the dead `test:e2e:real` script fixed, and an offline-coverage claim
  corrected re `crates/targeting/resolver/tests/simbad_live.rs` (hits the
  real SIMBAD endpoint by design, not re-gated, flagged as a separate
  backlog item). SPEC_STATUS 037 row flipped to effectively complete
  (35/40; 5 open are deliberate SUPERSEDED decisions, not gaps).
- **Lane nF merged (2026-07-09).** #535 (`de28d844`) closed out spec 049's
  US4 verify chain end-to-end: contract + read-only `VerifySourceView` use
  case + DTOs + `sourceview_verify` command + UI action, a Settings →
  Source Views pane, per-project/per-generation destination overrides, and
  a Windows long-path warning. T031 (per-frame selection) parked with an
  honest blocked-on-external-048 note (048's `inventory.frame.*` contract
  isn't merged yet — #500/#503/#507 still open); the deferred
  materialization-summary UX item was confirmed already covered by #490.
  SPEC_STATUS 049 row updated to 41/46.
- **Lane nG spawned (2026-07-09).** Spec 026 (generated-source-view-removal)
  stale-detection + audit tail, building on #535's verify machinery
  (`source_view_verify.rs`).
- **Lane nG merged, spec 026 COMPLETE (2026-07-11).** #545 (`384398df`)
  closed the last 11 tasks (23/23): stale-detection sweep reusing #535's
  verify classification, per-item audit events + a UI audit history,
  `kind_diverged` data reconciliation, and real cross-platform per-item
  apply for view removal/regeneration — backed by a real-executor e2e test
  that found and fixed 2 latent bugs never exercised by an actual
  filesystem apply before (empty archive destination on view removal; raw
  DB id used as a filesystem path on regenerate). The PR survived a rebase
  over the concurrent external #544 sqlx-drain. SPEC_STATUS 026 row flipped
  to closed; the spec's long-standing "vestigial, product-decision-pending"
  status is resolved (049 already restored a live generation path).
- **Lane nH1 spawned (2026-07-11).** Spec 033 tail (validation-bugfix-
  remediation remainder) + a dead-code dossier.
- **DB-boundary baseline sealed at zero (2026-07-11, external #543/#544/
  #546/#547).** The raw-sqlx-outside-persistence_db baseline was drained to
  empty across desktop commands (#543), inbox app layer, and the projects
  app layer (#544), then sealed with a zero-tolerance guard (#546) and
  marked complete in `docs/development/persistence-layer-hardening.md`
  (#547). Any new raw `sqlx::` usage outside `crates/persistence/db` now
  fails CI immediately — no baseline drift budget remains. Not this lane's
  work; noted for downstream lanes touching persistence.
- **Lane nH1 merged, spec 033 closeout-ready (2026-07-11).** #561
  (`a504a7fc`) closed the real-backend e2e gaps (T015/T024/T025/T031/T036a
  — first real CI execution passed both required legs, run 29143485185),
  T085 (doc resolution sweep) and T087 (dead-code adjudication:
  `@tanstack/react-table` removed, `angularSeparationFromMoonDeg` kept +
  documented test-only, and a real `[object Object]` error-display bug
  fixed in `PlanReviewOverlay.tsx` by switching 3 catch blocks to the
  canonical `errMessage()` helper), and closed obsolete issue #1. 92/96
  tasks done; the 4 remaining (T006/T049/T083/T086) are honest `[~]`
  partials, not gaps — all blocked on the same real-backend-WebView-in-WSL
  limitation, superseded for automated evidence by spec 037's Layer-2
  harness; T086's literal human Windows walkthrough is the only piece
  needing a live pass. SPEC_STATUS 033 row updated (92/96, no longer
  blocked on 017).
- **Lane nH2 spawned (2026-07-11).** Final code lane: 025/012/008/021
  tails, a contract-test runner for spec 007, a paused-state minimal UI,
  and adjudication of the `simbad_live.rs` env-gate question flagged by
  lane nE (see the T078/037 entries above).
- **Lane nH2 merged, last code lane closed (2026-07-11).** #589
  (`f8cea5eb`) closed the campaign's remaining backend/frontend tails: 007
  contract-test gap fully closed (`packages/contracts/tests/conformance-harness.mjs`
  extended with real AJV validation, 8→0 open); 025 21→7 open (added a
  paused-state minimal UI with a `resumeStalled` state; the 7 remaining are
  either #575/#577-tracked real gaps or pre-existing docs/perf deferrals);
  012 8→2; 008 10→4; 021 re-verified (2 stay open with dev-tools evidence);
  `crates/targeting/resolver/tests/simbad_live.rs` gated behind
  `ALM_LIVE_SIMBAD=1` (opt-in, skips gracefully by default — the earlier
  lane nE finding that this suite runs unconditionally against the real
  SIMBAD endpoint is now resolved). 3 new real-gap issues filed: **#575**
  (`plan.resume` doesn't re-validate the pause condition or restart
  execution — spec 025 R-Pause-1 gap), **#577** (`move_op.rs` copy-then-
  delete rollback path has zero test coverage — spec 025 T025), **#586**
  (guided flow duplicates `CreateProjectDialog`'s validation logic instead
  of reusing it — spec 008). SPEC_STATUS 025/012/008/021/007 rows updated;
  the actionable frontier table rewritten for the post-campaign state.

## Campaign end state (2026-07-11)

**11 campaign PRs merged to `main`:** #487, #494, #492, #499, #517, #528,
#531, #535, #545, #561, #589 — plus this bookkeeping lane's own #486
(merged) and #498 (this PR, pending its closing review).

**~55 issues closed with evidence** (spec-003 #106–#136: 31; spec-041
#320–#339: 19; plus spec-related issues closed inline by feature lanes
during PR work — see each lane's own report for its specific count). Every
closure in this lane carried a file:line or commit-sha pointer, never a
bare assertion.

**4 new real-gap issues filed this campaign:** #489 (macOS
`tauri-plugin-webdriver` upstream limitation), #575 (resume-executor gap),
#577 (rollback coverage gap), #586 (guided-flow validation duplication).

**Open watch items handed to the campaign owner:**

- **(a) #575 resume-executor gap** — needs a product decision: release-
  blocker vs known limitation. `resume_plan` currently does not re-spawn
  the executor to continue `pending` items after a pause; the only
  production path that hits this is pause/resume (R-Pause-1).
- **(b) `tauri-plugin-webdriver` macOS upstream** (#489) — no fix owned by
  this campaign; the `workflow_dispatch` re-test path (#528) is in place
  so a future upstream release can be re-tried without code changes.
- **(c) 049 T031 + 048 remainder** — parked on the external session's open
  PRs #500/#503/#507 (per-frame inventory, not yet merged to `main`).
- **(d) 044 T017** — optional FITS-observer prefill, pending a
  session-observer IPC binding that doesn't exist yet.
- **(e) spec-050 publishable-crate-extractions** — all extraction tasks
  are unblocked but unstarted; a candidate amendment was offered to the
  owner during this campaign (the `workflow/profiles` observing-night
  blocker was found vestigial) — awaiting owner adjudication, not acted on
  here.
- **(f) Phases J (Windows validation) / K (hand-off)** — owned by the
  external campaign session, not by any lane spawned in this run (see the
  lane-ownership clarification above).
