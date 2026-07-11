---
description: "Task list for spec 033 — Validation Bugfix & Remediation"
---

# Tasks: Validation Bugfix & Remediation

**Input**: Design documents from `specs/033-validation-bugfix-remediation/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D11), data-model.md (migrations 0031–0038), contracts/

**Tests**: REQUIRED. US9 makes a reproducible automated suite + an aligned interactive runbook first-class
deliverables. Per-story acceptance tests are written **red-first** against the FRs (the validation findings
already diagnosed the defects, so the red tests encode the *desired* behavior, not current behavior).

**Organization**: Grouped by user story (US1–US9) in build order. Backend stories share surfaces
(migrations, `contracts/core`, `run_app`, event bus) → implement **sequentially**, not in parallel.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different files, no incomplete deps)
- **[Story]**: US1…US9 maps to spec.md user stories

## Path conventions
Monorepo: `crates/<area>/`, `apps/desktop/src/`, `apps/desktop/e2e/`, `packages/contracts/`,
`docs/development/`, migrations under `crates/persistence/db/migrations/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependency changes from research.md (D4/D5/D6/D10)

- [X] T001 [P] Add `trash` 5.2.x (MIT) to `crates/fs/executor/Cargo.toml` + workspace deps (D4)
- [X] T002 [P] Add `minisign` 0.7.x (MIT) to `crates/targeting/catalogs/Cargo.toml` and workspace deps (D5) — note: used `minisign` crate (not `minisign-verify`; the former is the canonical MIT crate available in the registry with the full verify API required by D5)
- [X] T003 [P] In `apps/desktop/package.json`: adopt `react-joyride@^3.1.0`; **remove** unused `@tanstack/react-table` and `@uiw/react-md-editor` (D6, D10)
- [X] T004 [P] Add `notify-debouncer-full` 0.7.x (MIT/Apache-2.0) to `crates/fs/inventory/Cargo.toml` (D10; mark optional — fall back to in-loop debounce if unwelcome)
- [ ] T005 Verify deps resolve and gates stay green: `cargo build --workspace`, `pnpm install`, `just lint`, `just typecheck`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared verification infrastructure used by multiple stories. **⚠️ Must complete before story acceptance tests can run.**

- [~] T006 Finalize the real-backend e2e harness in `apps/desktop/e2e/` (scaffolded): `xvfb-run` works; `tauri-driver --port N` starts, `/status` → `{ready:true}`; `POST /session {browserName:wpe webkit}` launches `WebKitWebDriver` + `MiniBrowser` (WebKit process starts). BLOCKED: session attach requires a pre-built `desktop_shell` binary already running — not available headlessly in WSL sandbox. Driver scaffolding verified; binary gap documented in `apps/desktop/e2e/README.md` § Harness investigation; all real-backend specs remain `test.skip` with precise reasons. Real acceptance: Windows-native `pnpm tauri dev` (Layer 4 quickstart). (D11, FR-034)
- [X] T007 [P] Stand up the JSON-Schema conformance-test harness: load `packages/contracts` schemas and validate captured runtime payloads, failing on drift (FR-025 infra)

**Checkpoint**: harnesses ready — story phases can begin.

---

## Phase 3: User Story 1 - Safe filesystem plan application (Priority: P1) 🎯 MVP

**Goal**: every plan action resolves under the library root, refuses escape/symlink/stale/collision, audits every item (incl. bulk cancel), trashes via the OS bin. No real `plan.apply` ships before this.

**Independent Test**: apply a plan with normal + escaping + symlinked + colliding + stale items; safe one applies, others refused with correct reason, every item + bulk-cancel audited, library recoverable.

### Tests (red-first)
- [X] T008 [P] [US1] Rust integration test: root-escaping item refused **pre-mutation** + audit reason `root_escape`, in `crates/fs/executor/tests/` (FR-001)
- [X] T009 [P] [US1] Rust test: path traversing a symlink/junction component refused + audited (FR-002)
- [X] T010 [P] [US1] Rust test: destructive-confirm is independent of `is_protected`; destructive item blocked until confirmed (FR-003, D9)
- [X] T011 [P] [US1] Rust test: existing destination refused (no silent overwrite) + audit (FR-004)
- [X] T012 [P] [US1] Rust test: `batch_cancel_pending_items` writes a per-item audit row for each cancelled item (FR-005)
- [X] T013 [P] [US1] Rust test: item whose on-disk mtime/size ≠ approved baseline refused as `stale` (FR-007, D7)
- [X] T013a [P] [US1] Rust test: cross-device (EXDEV) move applies safely + audited (copy-then-delete with rollback), or refuses with a clear reason — never silent loss (Edge Case, FR-007)
- [X] T014 [P] [US1] Rust test: `trash` destination moves to OS bin; `archive` fallback recorded when unavailable; replace stub test `trash_returns_unavailable_in_v1` (FR-006, D4)
- [X] T015 [US1] Real-backend e2e: unskip `apps/desktop/e2e/real-backend/us1_plan_apply_safety.spec.ts` — apply mixed plan via real UI, assert refusals + audit rows via DB helper (FR-001..007). Superseded blocker: that Playwright spec/harness (WSL tauri-driver/WebKitWebDriver, blocked per T006) no longer exists — spec 037 replaced it with the `crates/e2e-tests` thirtyfour/`tauri-plugin-webdriver` Layer-2 harness, run in CI (`.github/workflows/e2e.yml`, Linux+Windows), not the WSL sandbox. `journeys.rs::plan_review_apply_with_audit` covers this exact acceptance: real UI registers a root, scans/classifies/confirms a real FITS file, applies via `inbox.plan.apply` (the channel-free equivalent of `plans.apply_real`), polls the real durable `plan_apply_events` trail via `plans.apply.status`, and asserts the real file moved. CI evidence: run 29143485185 (2026-07-11) — `PASS [34.990s] plan_review_apply_with_audit` on ubuntu-latest, `PASS [8.499s]` on windows-latest.

### Implementation
- [X] T016 [US1] Migration `0031`: plan-item safety fields (`source_id`, `category`, `requires_destructive_confirm`, `approved_mtime`, `approved_size_bytes`, `resolved_pattern`) in `crates/persistence/db/migrations/` (data-model)
- [X] T017 [US1] Migration `0032`: destructive-destination normalization `os_trash→trash`, drop `none`, CHECK `IN ('archive','trash')` (D1, FR-038)
- [X] T018 [US1] Implement the lexical path-resolution gate (root-join + normalize + escape refusal + per-component `lstat`, **no `canonicalize`**) and route every executor op through it; replace raw relative-path use at `plan_apply.rs:173` (D8, FR-001/002)
- [X] T019 [US1] Capture approval-time staleness baseline (resolved path + mtime + size + resolved pattern) in `approve_plan`; enforce stale check at apply; fills spec-017 `approved_mtime`/`approved_size_bytes` gap (D7, FR-007)
- [X] T020 [US1] Add `requires_destructive_confirm` signal derived from action type; replace the `confirm_required = is_protected` inversion at `plan_apply.rs:199` (D9, FR-003)
- [X] T021 [US1] Emit a per-item audit row on every transition including bulk cancel in `crates/fs/executor` + `crates/audit` (FR-005)
- [X] T022 [US1] Implement `trash_op` via the `trash` crate with recorded `archive` fallback in `crates/fs/executor/src/ops/trash_op.rs` (D4, FR-006)
- [X] T023 [US1] Ensure rollback / clearly-audited partial completion on failure — no silent loss (FR-007)
- [X] T023a [US1] **BLOCKING (gate currently inert on real data):** resolve `from_root_id` → absolute library root in `item_row_to_executor_item` (`crates/app/core/src/plan_apply.rs`) so `library_root` is set and the path gate (T018) actually fires on real plan items — today it's `None` so real items bypass the escape/symlink/staleness checks. Also persist `approved_mtime`/`approved_size_bytes` + `destructive_confirmed` as real DB columns (currently `#[sqlx(default)]`). US1 is NOT done until this lands. (FR-001/002/003/007)

**Checkpoint**: real `plan.apply` is safe and audited. US1 testable independently. ⚠️ Gate only active once T023a resolves the library root onto real items + T015 e2e proves it.

---

## Phase 4: User Story 2 - Background features actually run (Priority: P1)

**Goal**: one `run_app` wiring pass activates manifest generation, artifact detection+classification, and guided auto-advance.

**Independent Test**: real backend — workflow completes → manifest persists; artifact appears → detected+classified events fire; complete a guided step's action → coach advances.

### Tests (red-first)
- [X] T024 [P] [US2] Real-backend e2e: unskip `apps/desktop/e2e/real-backend/us2_subscriber_startup.spec.ts` — workflow completion auto-generates a manifest (FR-008). Superseded blocker: that Playwright spec file no longer exists (spec 037 replaced the real-backend-Playwright strategy with the `crates/e2e-tests` thirtyfour/WebDriver Layer-2 harness — README.md's `real-backend/` tree is a stale scaffold reference, no such directory exists on `main`). Done via `crates/app/core/tests/workflow_run_manifest_e2e.rs::real_tool_launch_completion_persists_a_workflow_run_manifest`: real SQLite + real `EventBus`, drives the REAL production trigger (`artifact::complete_run`, called on tool-launch outcome resolution — Constitution III forbids a real PixInsight spawn) into the REAL production consumer (`project_manifests::spawn_workflow_run_subscriber`, wired the same way in `run_app`), asserting a `workflow_run` manifest is persisted to a real file on disk. Closes the gap between T027's two individually-tested halves (trigger-only and consumer-only).
- [X] T025 [P] [US2] Real-backend e2e: artifact dropped into a watched root emits `artifact.detected` AND `artifact.classified` with contract-valid payloads (FR-009). Done: `apps/desktop/src-tauri/tests/artifact_watcher_live_drop.rs::live_file_drop_after_attach_emits_detected_and_classified` — real SQLite + real `EventBus` + real OS `notify` watcher via `attach_project_watcher`, file created strictly AFTER attach (so it exercises the live `forward_task` loop, not the attach-time reconciliation pass `crates/e2e-tests/tests/journeys.rs::cleanup_plan_review` already covers). No Tauri binary/WebView needed — this is real backend + real filesystem, not UI-driven, closing the gap without the T006 WebView blocker.
- [X] T026 [P] [US2] vitest: guided bridge advances on `inventory.confirmed`/`project.created`/`tool.opened`, ignores `source="restore"`, in `apps/desktop/src/features/guided/` (FR-010)

### Implementation
- [X] T027 [US2] Redesign `spawn_workflow_run_subscriber` with an async DB project-root resolver; spawn it in `run_app` in `crates/app/core` (FR-008)
- [X] T028 [US2] Artifact watcher: notify loop + debounce + watch-paths-from-registered-roots; spawn in `run_app`; add `artifact.classified` to the event bus; fix `artifact.classify` response to the flat contract shape — `crates/fs/inventory` + `crates/contracts/core` + `packages/contracts` (FR-009, contracts/artifact-events.md)
- [X] T029 [US2] Build the guided event→step bridge modeled on `apps/desktop/src/data/logSubscription.ts`; subscribe to domain events, filter `source != "restore"`, call `completeGuidedStep` (FR-010)
- [X] T030 [US2] Replace the `GuidedOverlay` render layer with a controlled `<Joyride>` (react-joyride 3.1), `spotlightClicks:true`, keep state machine/anchors/store; drop the dead inline `@media` at `GuidedOverlay.tsx:188` (FR-011, D6)

**Checkpoint**: the five previously-inert features fire at runtime (SC-003).

---

## Phase 5: User Story 3 - Real data flows end to end (Priority: P1)

**Goal**: sessions group by root, calibration suggests real masters, targets link to sessions/projects, Cmd+K searches real data.

**Independent Test**: ingest a real folder → sessions grouped → calibration suggestions from real rows → target detail populated → Cmd+K finds a real target.

### Tests (red-first)
- [X] T031 [P] [US3] Real-backend e2e: unskip `apps/desktop/e2e/real-backend/us3_ingestion_plumbing.spec.ts` — ingest → sessions grouped under their root (FR-012). Superseded blocker (same as T015: dead Playwright/WSL harness). `journeys.rs::ingestion_sessions_search` covers this: real UI inbox pipeline (scan → classify → confirm → `inbox.plan.apply`) triggers the real async `plan_listener` → `ingest_light_frames` session-grouping pipeline (spec 035 US4), then asserts via `sessions.list`, `calibration.match.suggest`, and `search.global` against real data. CI evidence: run 29143485185 (2026-07-11) — `PASS [35.286s] ingestion_sessions_search` on ubuntu-latest, `PASS [8.091s]` on windows-latest. This journey asserts target-grouping/resolution, not `root_id` grouping specifically — T036a's real-backend regression test (`upsert_session_persists_root_id_from_a_really_registered_source`) is the direct proof for the `root_id` half of FR-012 (both are now closed; see T036a below).
- [X] T032 [P] [US3] Rust test: calibration suggestions come from real master rows on populated fingerprints (FR-013)
- [X] T033 [P] [US3] Rust test: target detail returns linked sessions/projects via `target_id` (FR-014)
- [X] T034 [P] [US3] Rust test: `search.global` runs a real cross-entity query reflecting the query string (FR-015)

### Implementation
- [X] T035 [US3] Migrations `0033`/`0034`: fingerprints queryable + indexed; session `root_id`; `target_id` FKs (data-model)
- [X] T036 [US3] Inbox confirm/apply sets session `root_id` — superseded by T036a's fix landing directly in `upsert_session` (below); the originally-added `update_*_session_root_id` helpers are no longer the mechanism. (FR-012)
- [X] T036a [US3] **FR-012 completeness:** DONE — already landed on `main` (issue #470 "round 6", commit `c526dc10`, well before this pass), verified against real code (not spec prose). The fix differs from this task's original plan (calling the standalone `update_*_session_root_id` repo helpers post-hoc) — instead, `crates/app/targets/src/ingest_sessions.rs::upsert_session` now takes `root_id` directly and sets it on every INSERT and `COALESCE`-backfills it on every append, closing the exact same gap the original helpers were meant to close (their doc comment said "called when the inbox confirm pipeline resolves the root for a session" but nothing ever called them — see `upsert_session`'s doc comment, `ingest_sessions.rs:351-366`, for the full incident writeup). Real-backend regression test: `ingest_sessions.rs::upsert_session_persists_root_id_from_a_really_registered_source` — registers a root via the REAL `roots.register` repo path, mirrors it via the real `ensure_library_root` call the production `ingest_light_frame` pipeline makes, and asserts `acquisition_session.root_id` equals the real registered source id. (FR-012, SC-001)
- [X] T037 [US3] Populate calibration/acquisition fingerprints from metadata; back masters `list`/`get` with real rows (replace `calibration.rs:27-134` fixtures) (FR-013)
- [X] T038 [US3] Persist `target_id` from ingestion so target detail shows real links — `crates/targeting` (FR-014)
- [X] T039 [US3] Replace the `search.global` fixture stub (`commands/search.rs:14-50`) with a real cross-entity query over targets/aliases/sessions/projects (FR-015)
- [X] T039a [US3] Target detail loads without error for a real persisted target — fix the "Failed to load target" path in the `target.get` aggregate/UI once `target_id` is plumbed (FR-044); test against an ingested DB with a real target
- [X] T039b [P] [US3] Targets list: expose grouping (type, constellation) + sorting (name, session count, integration hours) with clear labels, consistent with other list surfaces (FR-041), in `apps/desktop/src/features/targets/`

**Checkpoint**: the core value is visible on a real library; US4 precondition (source_id/category) met.

---

## Phase 6: User Story 4 - Protected sources actually block cleanup (Priority: P2)

**Goal**: real cleanup/archive plans over protected sources are blocked + audited.

**Independent Test**: protect a source; generate a real plan including it → blocked, protected items carry real `source_id`, block audited; default change persists + audited.

### Tests (red-first)
- [X] T040 [P] [US4] Rust test: real cleanup/archive plan over a protected source is blocked; items carry real `source_id`; block emits an audit event (FR-016/017)
- [X] T041 [P] [US4] Rust test: changing the global default persists and emits `protection.default.changed` (FR-018)
- [X] T042 [P] [US4] Rust test: a plan over a non-protected source applies (gate is real, not always-on)

### Implementation
- [X] T043 [US4] Migration `0035`: `protection_defaults` table + ensure `protected_plan_items.source_id` populated (data-model)
- [X] T044 [US4] Make cleanup/archive generators tag items with real `source_id` + `category` and call `resolve_protection` (replace hardcoded `protection:"normal"` at `prepared_views.rs:222`, `project_setup.rs:219`, `plans.rs:550`) (FR-016)
- [X] T045 [US4] Populate `source_id` on `ProtectedPlanItem` (`protection.rs:287`); wire global-defaults persistence + `protection.default.changed` audit event (FR-017/018)

**Checkpoint**: Constitution §II protection gate fires on real plans.

---

## Phase 7: User Story 5 - Trustworthy project lifecycle (Priority: P2)

**Goal**: one canonical lifecycle table, typed blocked reason in the banner, audited auto-transitions.

**Independent Test**: drive user + auto transitions → one consistent state; block by a real condition → banner shows typed kind; auto transitions audited.

### Tests (red-first)
- [X] T046 [P] [US5] Rust test: user-IPC and automatic transitions read the same canonical `projects.lifecycle` row (FR-019, D2)
- [X] T047 [P] [US5] vitest: `BlockedBanner` shows the typed `kind` from `project_health`, not hardcoded `user` (FR-020)
- [X] T048 [P] [US5] Rust test: auto block/ready/unarchive write audit rows; `project.unarchived` emitted (FR-021)
- [~] T049 [P] [US5] Real-backend lifecycle round-trip: mocks-UI Playwright tests (`lifecycle_detail` + `lifecycle_transitions`) pass; `apps/desktop/e2e/real-backend/us5_lifecycle_integrity.spec.ts` authored with 5 `test.skip` stubs covering 009-4 through 009-8 (canonical lifecycle, typed blocked reason, audit rows, unarchived event, multi-select filter). Real-backend execution blocked on T006 running Tauri binary. Rust unit tests (lifecycle_canonical.rs, transition_apply.rs) pass and are the authoritative signal for US5 backend correctness.

### Implementation
- [X] T050 [US5] Migration `0036`: backfill `projects.lifecycle` from `project.state`, map states, **drop** `project.state` (D2)
- [X] T051 [US5] Migration `0037`: typed `blocked_reason_kind` + `blocked_reason_note` (data-model)
- [X] T052 [US5] Re-point the user-IPC transition use-case (`transition_use_case.rs`) to the canonical `projects.lifecycle` (FR-019)
- [X] T053 [US5] Persist the typed blocked reason and surface it in the `BlockedBanner` DTO (replace `ProjectDetail.tsx:185` hardcode) (FR-020)
- [X] T054 [US5] Audit auto block/ready/unarchive transitions + emit `project.unarchived` (FR-021)
- [X] T055 [US5] Make the lifecycle filter multiselect (FR-022)

**Checkpoint**: lifecycle is single-sourced and audited.

---

## Phase 8: User Story 6 - Settings persist and contracts hold (Priority: P2)

**Goal**: no silent settings drop; contract conformance enforced.

**Independent Test**: change aging threshold → persists + consumer reads it; conformance tests pass for previously-drifted operations.

### Tests (red-first)
- [X] T056 [P] [US6] Test: calibration aging threshold persists across reload and a consumer reads it (no hardcoded `m.age_days>90`) — vitest + Rust (FR-023)
- [X] T057 [P] [US6] Rust test: settings snapshot/debounce `emit_snapshot` actually fires (FR-024)
- [X] T058 [P] [US6] Conformance tests: log-viewer `contractVersion`/`dia:` cursor/export `status`; `artifact.classify` shape; `project.create` lifecycle value (FR-025, contracts/log-viewer.md)

### Implementation
- [X] T059 [US6] Fix the aging-threshold control to save to a real scope/key (not `calibration_matching`) and have the calibration view read it; same fix for spec-007's control (FR-023)
- [X] T060 [US6] Wire the snapshot/debounce timer caller for `emit_snapshot` (FR-024)
- [X] T061 [US6] Move the Cleanup per-type action table off fixtures (FR-024 area)
- [X] T062 [US6] Reconcile contracts in `packages/contracts` + `crates/contracts/core`: align `contractVersion` to schema const, parse `dia:` cursor, add export `status` + file picker, fix `project.create` stale `lifecycle const` (FR-025)
- [X] T063 [US6] Add the JSON-Schema conformance tests to the automated suite (FR-025)

**Checkpoint**: settings round-trip; contracts enforced by tests.

---

## Phase 9: User Story 7 - Catalog integrity and authenticity (Priority: P3)

**Goal**: verify signatures, reject unknown licenses/slugs, atomic writes. Verified on fixtures (downloads externally blocked).

**Independent Test**: valid sig accepted; tampered rejected; unknown license/slug rejected; interrupted write leaves nothing partial.

### Tests (red-first)
- [X] T064 [P] [US7] Rust test: valid minisign signature accepted; tampered/invalid rejected (`ManifestSignatureInvalid`) (FR-026, D5)
- [X] T065 [P] [US7] Rust test: unknown license code hard-fails (no `PublicDomain` downgrade) (FR-027)
- [X] T066 [P] [US7] Rust test: unknown slug rejected; canonical slugs `{common,openngc,abell_pn}` resolve (FR-029, D3)
- [X] T067 [P] [US7] Rust test: interrupted catalog upsert leaves no partial catalog/attribution (FR-028)

### Implementation
- [X] T068 [US7] Implement minisign verification with embedded trusted key in `crates/targeting/catalogs/src/download.rs` (replace the no-op at `:374`) (FR-026, D5)
- [X] T069 [US7] Hard-fail unknown license codes at `catalogs.rs:166` (FR-027)
- [X] T070 [US7] Canonical slug enum reconcile: fix 014 strings (`opengc→openngc`) to the 013 closed enum; hard-fail unknown (FR-029, D3)
- [X] T071 [US7] Migration `0038` (catalog signature-status column + license CHECK + unique constraints); make catalog upsert + attribution transactional using those constraints; wire the `origin.not_implemented` guard to be reachable (FR-028, data-model)

**Checkpoint**: catalog authenticity holds (on fixtures).

---

## Phase 10: User Story 8 - Developer surface and remaining affordances (Priority: P3)

**Goal**: dev diagnostics capture + compiled out of release; small UI affordances work.

**Independent Test**: dev build auto-captures + exports to chosen path; release build has no dev surface; toggle/show-ignored/frame-type/inventory-refs behave.

### Tests (red-first)
- [X] T072 [P] [US8] Test: a release build (no `dev-tools` feature) has no reachable developer route or commands (FR-031, SC-009)
- [X] T073 [P] [US8] Test: a dev build auto-captures an operation via the recording proxy and exports to a chosen path (FR-030)
- [X] T074 [P] [US8] vitest/e2e: inbox destructive-destination toggle is surfaced and the chosen value is honored (FR-032)
- [X] T074a [P] [US8] vitest/e2e: "Show ignored items" Cmd+K entry exists and works; mixed frame-type is derived dynamically (not a fixture string); per-item inventory refs render in `SourceViewsSection` (FR-033)

### Implementation
- [X] T075 [US8] Wrap the Tauri dispatcher at boot for recording-proxy auto-capture; fix `dev_export` relative-path bug; gate the dev frontend bundle out of release (T031/T036) (FR-030/031)
- [X] T076 [US8] Surface the destructive-destination toggle in inbox confirm (`ActionSidebar`/`InboxPage.tsx:56`); decide/implement-or-remove the `repair` scheduler reference; snapshot the resolved pattern onto the plan (FR-032)
- [X] T077 [US8] Add the "Show ignored items" Cmd+K entry; derive `mixed` frame-type dynamically (FR-033)
- [X] T078 [US8] Drop stale "Status: NOT IMPLEMENTED" contract descriptions (026); show per-item inventory refs in `SourceViewsSection` (FR-033)
- [X] T078a [P] [US8] Inbox grouping: support group-by date / classification-state / capture-type and rename the "lane" label to a user-meaningful term (image vs video) in `apps/desktop/src/features/inbox/InboxList.tsx` (FR-040)
- [X] T078b [P] [US8] Projects list: add sort options consistent with other list surfaces (beyond name/updated) in `apps/desktop/src/features/projects/ProjectsList.tsx` (FR-042)
- [X] T078c [US8] New-project flow: render inside the main window with design-v4 layout, wire the existing `features/projects/wizard/WizardPage.tsx` (session + calibration selection) as the reachable create flow, ensure create succeeds end-to-end, and open it from the target "new project" action (FR-043); add a vitest/e2e covering session+calibration selection and successful creation

**Checkpoint**: dev surface correct; UI affordances complete.

---

## Phase 11: User Story 9 - Aligned automated suite + interactive runbook (Priority: P1)

**Goal**: the acceptance instrument — a reproducible headless suite and an aligned manual runbook, bound by a zero-gap traceability matrix.

**Independent Test**: suite runs headless deterministically with no manual steps; runbook items each state action→observable result; matrix shows no one-sided coverage.

- [X] T079 [US9] Add the R-4 regression test: `NamingStructure.tsx` token refs are valid and `scripts/check-tokens.sh` is wired into `just lint` / CI (FR-037). Done: (a) fixed 6 files using bare `var(--alm-radius)` → `var(--alm-radius-md)` (CalibrationMatchPanel, PlanProtectionGate, DataSources, Advanced, SchemaViewer + NamingStructure already fixed); (b) added check 4 to `scripts/check-tokens.sh` that fails on bare `var(--alm-radius)` in TSX/TS; (c) authored `src/features/settings/NamingStructure.r4.test.ts` (4 vitest tests using `?raw` import — passes in `pnpm test` and `just typecheck`).
- [X] T080 [US9] Confirm R-1/R-2/R-3 regression tests are present and passing (authored already) and add a CI job that runs them (FR-037). Done: R-1 (`tests/e2e/regression_r1_index_redirect.spec.ts`) ✓, R-2 (`src/features/calibration/MastersList.regression.test.tsx` — 5 tests) ✓, R-3 (`crates/app/core/tests/startup_wiring_regression.rs` — 3 tests) ✓. CI workflow created at `.github/workflows/ci.yml` with jobs: rust-lint, rust-test (incl. R-3), frontend-lint (incl. token guard R-4), frontend-test (incl. R-2 + R-4 vitest), e2e-mocks (incl. R-1). Real-backend job scaffold retained with `if: false` gate and documented rationale.
- [X] T081 [US9] Author the interactive runbook `docs/development/runbook-033-interactive.md` — per-screen "do X → see Y", each item tagged with its FR id, exercising the SC-001 core journey on the Windows-native binary (FR-035)
- [X] T082 [US9] Build the traceability matrix `docs/development/traceability-033.md` mapping every FR/use-case → automated test(s) → runbook step(s); assert zero one-sided coverage (FR-036, SC-005)
- [~] T083 [US9] Full automated suite runs headless to completion with no manual steps (FR-034, SC-004). Done: `cargo test --workspace` → 302+ tests pass; `pnpm test` (vitest) → 544 tests pass (56 files); `pnpm test:e2e:real` → 19 skipped, 0 failed (harness structurally valid); `just lint` → exit 0; `just typecheck` → exit 0. Real-backend specs remain `test.skip` (honest: Tauri binary gap documented in e2e/README.md). NOT marked [X]: task says "unskip all real-backend acceptance specs" — that requires T006 running binary, not achievable headlessly in WSL sandbox. The suite IS deterministic and runs completely headless; the real-backend portion is honestly skipped, not missing.
- [X] T084 [US9] Verify 100% of FRs/user stories have ≥1 passing automated test AND ≥1 runbook step (close the matrix) (SC-004/005) — done in traceability-033.md: all 44 FRs mapped both ways; only meta/infra FRs (034/035/036/039) are the instruments themselves; partial coverage (FR-012/T036a, RB-layer skipped) is documented, not hidden.

**Checkpoint**: the app is provably working and the two verification artifacts are aligned.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [ ] T085 [P] Update docs: mark resolved items in `docs/development/autonomous-run-2026-06-validation-findings.md` "Remaining"; refresh `PRODUCT.md`/native-dev docs as needed
- [ ] T086 Run the full gate suite + `quickstart.md` core-journey validation on the real backend (SC-001/SC-008)
- [ ] T087 [P] Remove dead code left by the removed deps/stubs (react-table, md-editor, trash stub, search fixtures)

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)** → no deps.
- **Foundational (P2)** → after Setup; blocks story acceptance tests (needs the harnesses).
- **US1 (P3)** → after Foundational. **Gates real `plan.apply`.** Produces the source_id/category plumbing US4 needs.
- **US2 (P4)** → after Foundational; largely independent (startup wiring).
- **US3 (P5)** → after Foundational; precondition for **US4** (source_id/category) and real **US6** calibration consumer.
- **US4 (P6)** → after **US1** (cleanup-plan generator + source_id) and **US3** (real source data).
- **US5 (P7)** → after Foundational; depends on the D2 reconciliation decision (done in research).
- **US6 (P8)** → after **US3** (calibration consumer) + the contract decisions (research).
- **US7 (P9)** → after Foundational; independent.
- **US8 (P10)** → after Foundational; independent.
- **US9 (P11)** → spans all; R-1..R-4 regressions authorable anytime; per-story acceptance tests live in their phases; matrix/runbook close at the end.
- **Polish (P12)** → after all desired stories.

### Sequential constraint
Backend stories share migrations / `contracts/core` / `run_app` / event bus → implement **sequentially** to avoid migration-ordering and invoke-handler conflicts. Migrations are strictly ordered 0031→0038.

### Within each story
Red tests → migration → backend → contract → UI wiring → e2e unskip. Models before services before commands before UI.

---

## Parallel opportunities
- Setup T001–T004 all [P].
- Within a story, the red tests marked [P] run in parallel (different files).
- US2, US7, US8 are independent of US1/US3/US4 and could be staffed in parallel **if** the shared-surface sequential constraint is respected (coordinate migrations + `run_app` edits).

## Implementation strategy

### MVP (P1 stories)
Setup → Foundational → **US1 (safety)** → **US2 (activation)** → **US3 (real data)** → **US9 close** = a working, provably-verified core journey (SC-001). Stop and validate against the real backend after US3.

### Incremental
Add US4 → US5 → US6 (P2) → US7 → US8 (P3), each independently testable, each keeping gates green and adding its acceptance tests + runbook rows to the matrix.

## Notes
- Commit per task or logical group, directly on `main`, no AI attribution (repo hook).
- Implementation runs via the agent-assign flow (`/speckit.agent-assign.assign` → `validate` → `execute`), NOT `/speckit.implement`.
- "Verify before closing": a task is done only with passing automated evidence + (for user-facing behavior) a runbook step — never a checkbox alone (FR-039).
- 94 tasks total: Setup 5, Foundational 2, US1 17, US2 7, US3 11 (incl. T039a/b targets detail+grouping), US4 6, US5 10, US6 8, US7 8, US8 11 (incl. T074a, T078a/b/c inbox/projects/create-flow), US9 6, Polish 3.
- Interactive-run findings (2026-06-17): FR-040..FR-044 added from real-backend testing; see `runtime-findings-2026-06-17.md`. Stale-binary items (#2/#4/#7-create) pending retest on a freshly-built binary before being treated as bugs.
- Migrations are numbered in build/creation order (0031–0038): US1 0031/0032, US3 0033/0034, US4 0035, US5 0036/0037, US7 0038.
