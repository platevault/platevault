---
description: "Task list for 048-per-frame-inventory"
---

# Tasks: Per-Frame Inventory with Live Session Membership

**Input**: Design documents from `specs/048-per-frame-inventory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/operations.md

**Tests**: Included. This feature is safety-critical (MUST NEVER mutate files as a reconciliation side effect; correct disk-usage totals gate destructive cleanup), so targeted contract/integration/unit tests are part of each story.

**Organization**: Grouped by user story (US1–US5) for independent implementation and testing. Priorities from spec.md: US1 P1; US2, US3 P2; US4, US5 P3.

**Reconciliation note (this pass, `origin/main` only)**: this file previously showed 0/44 despite substantial work already merged via other PRs (#435, #442) without updating it. Ticks below are re-verified against real code on `origin/main` as of this pass — NOT against the further work in-flight on `048-complete-per-frame-inventory` (PR #500) and `048-us5-calibration-missing-flag` (PR #503), which add T017/T019/T021/T025 (auto-reconcile apply + relink) and T027–T031 (US3 cleanup) and T037–T039 (US5) respectively but are not yet on `main`. Those tasks are intentionally left unchecked here to avoid claiming unmerged work as done; they'll tick for real once those PRs merge.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- Paths are repo-relative and reference real crates from plan.md.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline on branch `048-per-frame-inventory` (worktree off `origin/redesign-ui-platevault`); run `just lint` and per-crate `cargo test -p app-core -p app-targets -p app-inbox -p fs-inventory` to record the green/red baseline (workspace-test baseline is known-red — validate per crate).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ No user-story work begins until this phase is complete.**

- [X] T002 [P] Add a shared per-frame writer helper `upsert_frame_record(root_id, relative_path, size_bytes, mtime, state)` (stat-based real size, no hash) reusable by light and calibration paths — factor from `crates/app/targets/src/ingest_sessions.rs::upsert_file_record` into a shared location both `app/targets` and `app/inbox` can call.
  <!-- done (main): crates/app/targets/src/frame_writer.rs:33 (stat_frame), upsert_frame_record; called from ingest_sessions.rs:206-217, crates/app/inbox/src/plan_listener.rs:348-360 -->
- [X] T003 [P] Create the raw-frame reconcile module skeleton mirroring `crates/workflow/artifacts/reconciler.rs`: a pass that walks a root, diffs recorded `file_record` rows vs disk, and emits state transitions — stub the walk + diff, no triggers yet. New module under `crates/fs/inventory/` or a new `crates/workflow/inventory-reconcile/` (decide per crate-split-by-domain rule).
  <!-- done (main): crates/fs/inventory/src/reconcile.rs:107 (reconcile_root), pure read-only walk+diff -->
- [X] T004 [P] Add per-root symlink/junction gating utility used by the walker and any watch (default: do not follow); wire the `detection.follow_symlinks` flag. Fixes the ungated `RecursiveMode::Recursive` in `crates/fs/inventory/src/watcher.rs` for raw roots.
  <!-- done (main): crates/fs/inventory/src/symlink_gate.rs:30 (is_link), :48 (real_dirs_under), :85 (real_files_under); used by reconcile.rs and watcher.rs:159 -->
- [X] T005 [P] Per-root config read/write over the spec-018 settings KV (`reconcile.mode`, `detection.{live,scheduled,on_open,follow_symlinks}`) with default-when-absent resolution, in `crates/app/settings/`.
  <!-- done (main): crates/app/settings/src/root_config.rs:67 (get_root_config), :112 (set_root_config); round-trip tests :169,:181 -->
- [ ] T006 Contract DTO scaffolding in `crates/contracts/core/` for `inventory.frame.list`, `inventory.reconcile.run`, `inventory.frame.relink`, `inventory.root_config.{get,set}`, and the `cleanup.candidates.scan`/`cleanup.plan.generate` extensions; register Tauri commands (fn name == invoke target — no specta rename) and regenerate `packages/contracts` bindings.
  <!-- partial (main): inventory.frame.list/reconcile.run/frame.relink/root_config.{get,set} DTOs + Tauri commands are real and registered (apps/desktop/src-tauri/src/commands/inventory_frame.rs, lib.rs:59-61,354-358). The cleanup.candidates.scan/cleanup.plan.generate raw-frame extension is NOT yet on main (in-flight on PR #500) — inventory_frame_relink itself is still a stub returning internal.error (apps/desktop/src-tauri/src/commands/inventory_frame.rs:63, "US2 T025 not yet implemented"). Left unchecked pending both landing. -->
- [X] T007 Add audit event types on the spec-002 bus: `frame.missing`, `frame.recovered`, `frame.size_backfilled`, `frame.relinked`, `calibration_match.source_missing`, `calibration_match.source_recovered` in `crates/audit/`.
  <!-- done (main): crates/audit/src/event_bus.rs:803-896, all six topic consts + payload structs present -->

**Checkpoint**: shared writer, reconcile skeleton, symlink gate, per-root config, contract surface, and events exist.

---

## Phase 3: User Story 1 — Accurate per-frame inventory for every session (P1) 🎯 MVP

**Goal**: Every applied frame (light + calibration) is a durable, correctly-sized inventory entry with correct session membership.
**Independent Test**: quickstart Scenario 1.

### Tests (US1)
- [ ] T008 [P] [US1] Integration test: inbox confirm → apply light frames → acquisition session lists all frames with non-zero total = Σ sizes (`tests/`).
  <!-- partial (main): crates/app/core/tests/sessions_integration.rs::list_sessions_sums_real_frame_sizes proves the Σ-sizes assertion via seeded rows, not the literal inbox.confirm→plan.apply→ingest pipeline (ingest_sessions_integration.rs exercises that pipeline but doesn't assert size_bytes). Left unchecked pending a true end-to-end test. -->
- [X] T009 [P] [US1] Integration test: apply calibration frames → calibration session lists member frames with real sizes (previously `'[]'`).
  <!-- done (main): crates/app/inbox/src/plan_listener.rs:651 (master_item_apply_writes_frame_record_and_frame_ids) — real tempdir file, drives the real apply path, asserts frame_ids.len()==1 and real size_bytes -->
- [ ] T010 [P] [US1] Unit test: catalogue-in-place frame recorded identically to a moved frame.
  <!-- not done (main): no test found asserting move vs catalogue-in-place produce identical file_record results. -->

### Implementation (US1)
- [X] T011 [US1] Capture real `size_bytes` (+ `mtime`) at apply in `crates/app/targets/src/ingest_sessions.rs` (replace `size_bytes = 0`), via the T002 helper.
  <!-- done (main): crates/app/targets/src/ingest_sessions.rs:206-217 (stat_frame + upsert_frame_record) -->
- [X] T012 [US1] Fix `crates/app/inbox/src/plan_listener.rs:~211-214`: write a `file_record` per applied calibration frame and append its id to `calibration_session.frame_ids` (set-deduped; keep the `source_inbox_item_id` idempotency guard) instead of `'[]'`.
  <!-- done (main): crates/app/inbox/src/plan_listener.rs:210-269 (real file_record write + frame_ids_json from real id) -->
- [X] T013 [US1] Ensure catalogue-in-place (organized source, no move) records a `file_record` with real size at apply, same as moved frames.
  <!-- done as implementation (main, see T010 for missing dedicated test): ingest_sessions.rs + plan_listener.rs share the same to/from resolution order -->
- [ ] T014 [US1] Implement `inventory.frame.list` (present count/size exclude `missing`) and wire session/inventory surfaces to show real counts + disk totals.
  <!-- partial (main): backend complete + tested — crates/app/core/src/frame_inventory.rs:199 (list_frames), present_count/present_size_bytes exclude missing (tested :526-546); session totals shown via a separate path (sessions.rs:309 active_frame_summary). `inventory.frame.list`/`inventory.reconcile.run` had ZERO frontend callers before this pass — this pass adds the first one (apps/desktop/src/features/settings/DataSources.tsx `handleReconcile`, wired to `inventoryReconcileRun` + sessions-query invalidation), closing the `inventory.reconcile.run` half of the gap; `inventory.frame.list` itself still has no UI consumer. Left unchecked — the frame.list wiring this task asks for is still missing. -->
- [X] T015 [US1] Size backfill on reconcile: correct present `file_record` rows with `size_bytes = 0` to the real size (also serves US2 walker). Emit `frame.size_backfilled`.
  <!-- done (main): crates/app/core/src/frame_inventory.rs::apply_present_outcome, tested :549-593 -->

**Checkpoint**: sessions show honest, correctly-sized membership for all frame types (SC-001, SC-002).

---

## Phase 4: User Story 2 — Sessions notice removed/moved frames (P2)

**Goal**: External deletes/moves are detected and reflected (flag or auto-reconcile) without ever mutating files.
**Independent Test**: quickstart Scenarios 2 & 3. **Depends on US1 (records exist) + T003 skeleton.**

### Tests (US2)
- [X] T016 [P] [US2] Integration test: delete a frame on disk → reconcile → `state = missing`, counts/totals drop, and assert **zero** filesystem mutations (spy/temp-dir snapshot before/after).
  <!-- done (main): crates/fs/inventory/src/reconcile.rs:175 (deleted_frame_reports_missing, pure read-only walk) + crates/app/core/src/frame_inventory.rs::reconcile_run_backfills_zero_size_and_reports_missing -->
- [ ] T017 [P] [US2] Integration test: auto-reconcile mode drops the frame from active membership while the record is retained as `missing` (queryable with `include_missing`).
  <!-- not on main: auto-reconcile mode application (T021) is in-flight on PR #500, not yet merged. -->
- [X] T018 [P] [US2] Integration test: recovered frame flips back to present; changed-size present frame is updated in place (not missing).
  <!-- done (main): crates/fs/inventory/src/reconcile.rs:199 (size_change_is_reported_present_with_corrected_size_not_missing) + frame_inventory.rs::reconcile_run_recovers_previously_missing_frame -->
- [ ] T019 [P] [US2] Unit test: relink succeeds on sha256 match; `hash.mismatch` on a same-size different file (proves size is not the key).
  <!-- not on main: relink (T025) still a stub on main; the sha256-match tests are in-flight on PR #500. -->

### Implementation (US2)
- [X] T020 [US2] Complete the reconcile walker (T003): present/`missing`/recovered transitions, `last_seen_at` update, size backfill; emit `frame.missing`/`frame.recovered`; report progress (SC-005, non-blocking).
  <!-- mostly done (main): crates/app/core/src/frame_inventory.rs::run_reconcile — transitions/backfill/events real and tested. REMAINING GAP: progress_pct hardcoded to 100 (terminal-only, no incremental reporting) — SC-005 not fully met, see T043a. -->
- [ ] T021 [US2] Apply per-root `reconcile.mode`: flag-missing (retain in membership, flagged) vs auto-reconcile (drop from active membership, retain record — NEVER hard-delete). Guarantee no filesystem mutation (INV-2).
  <!-- not on main: run_reconcile reads config.reconcile_mode but the auto-reconcile branch is a documented no-op (`let _ = matches!(...)`, frame_inventory.rs, "future US2 T021 patch"). In-flight on PR #500. -->
- [ ] T022 [US2] `inventory.reconcile.run` command (on-demand) + long-running status/progress.
  <!-- partial (main): on-demand command real (apps/desktop/src-tauri/src/commands/inventory_frame.rs:47); no progress-stream (see T020). This pass adds its FIRST frontend caller (apps/desktop/src/features/settings/DataSources.tsx, "Reconcile" button on raw/calibration roots + sessions-query invalidation on completion) — previously zero UI callers existed anywhere in the product. Left unchecked: no status/progress stream yet. -->
- [ ] T023 [US2] Per-root live watch: extend `crates/fs/inventory/src/watcher.rs` to raw/calibration roots with a per-root registry (model on `ArtifactWatcherRegistry` attach/detach); live events schedule a scoped reconcile, they don't mutate records directly. Respect symlink gate (T004).
  <!-- not done (main or in-flight branches): watcher.rs:7 still documents "only inbox folders are watched — raw/calibration/project roots are scanned on demand". No per-root raw/calibration watcher registry exists anywhere. -->
- [ ] T024 [US2] Removable/network opt-out + polling/rescan fallback when live is off/unreliable; on-open and scheduled triggers.
  <!-- not done: no polling scheduler or on-open/scheduled trigger exists; detection.scheduled/on_open config fields exist (T005) but nothing reads them. -->
- [ ] T025 [US2] `inventory.frame.relink`: sha256 computed on demand for the two files; re-home on match, `hash.mismatch` otherwise; emit `frame.relinked`; populate `content_hash` lazily.
  <!-- not on main: apps/desktop/src-tauri/src/commands/inventory_frame.rs:63 is still the always-erroring stub. In-flight on PR #500. -->
- [ ] T026 [US2] Wire raw-root reconciler/watcher lifecycle at startup in `apps/desktop/src-tauri/src/lib.rs` (near `start_inbox_plan_listener`) and to library/project open.
  <!-- not done: no such wiring in run_app; blocked on T023/T024 not existing. -->

**Checkpoint**: SC-003 met; no-mutation invariant proven by tests.

---

## Phase 5: User Story 3 — Raw sub-frame cleanup candidates (P2)

**Goal**: Cleanup review flow proposes individual raw sub-frames grouped by session with accurate reclaimable bytes.
**Independent Test**: quickstart Scenario 4. **Depends on US1; benefits from US2.**

All of US3 (T027–T031) is **in-flight on PR #500** (`048-complete-per-frame-inventory`, commit 48f76a26), not yet on `main` — left unchecked here rather than duplicated.

### Tests (US3)
- [ ] T027 [P] [US3] Integration test: `cleanup.candidates.scan { session_id }` returns raw sub-frames grouped by session; `total_reclaimable_bytes` = Σ present sizes; generation performs no filesystem mutation.
- [ ] T028 [P] [US3] Unit test: `missing` and `protected` frames excluded; inferred candidates carry confidence.

### Implementation (US3)
- [ ] T029 [US3] In `crates/app/core/src/cleanup_generator.rs`: remove the stale raw-refusal (`:~24-30`); enumerate present `file_record` rows for the scope, classify light/dark/flat, apply `resolve_protection` + confidence, group by session.
- [ ] T030 [US3] Reclaimable bytes = Σ selected present `size_bytes`; exclude `missing`/`protected` (FR-020..022).
- [ ] T031 [US3] Wire `cleanup.candidates.scan` / `cleanup.plan.generate` extensions to the per-frame candidate set; generated plans reuse the shared apply path (PR #408 overlap guard, `.astro-plan-archive/<planId>/`, archive|trash vocab). Read-only until Apply.

**Checkpoint**: SC-004 met — raw-sub cleanup is possible for the first time.

---

## Phase 6: User Story 4 — Per-root detection & reconcile config in the wizard (P3)

**Goal**: Users configure reconcile mode + detection triggers per root, in the wizard and settings.
**Independent Test**: quickstart Scenario 5. **Depends on T005/T006.**

### Tests (US4)
- [X] T032 [P] [US4] Contract test: `inventory.root_config.get` returns documented defaults when unset; `set` persists and round-trips.
  <!-- done (main): crates/app/settings/src/root_config.rs:169 (get_returns_documented_defaults_when_unset), :181 (set_reconcile_mode_round_trips) -->
- [ ] T033 [P] [US4] Integration test: changing mode to auto-reconcile takes effect on the next reconcile.
  <!-- not on main: depends on T021 (auto-reconcile mode application), which is in-flight on PR #500. -->

### Implementation (US4)
- [X] T034 [US4] `inventory.root_config.{get,set}` over the T005 KV.
  <!-- done (main): crates/app/settings/src/root_config.rs, wired to inventory_root_config_get/set (apps/desktop/src-tauri/src/commands/inventory_frame.rs:88,102) -->
- [ ] T035 [US4] Add the per-root config step to the real unified first-run wizard (verify current wizard shape in code first) with documented defaults pre-selected.
  <!-- not done: apps/desktop/src/features/setup/SetupWizard.tsx steps (SourceFolders/Tools/Catalogs/Site/Confirm/Scan) have no detection/reconcile step. -->
- [ ] T036 [US4] Surface the same controls in existing root settings (minimal hook — full settings-window redesign is the companion UI spec, references 043).
  <!-- not done: no settings component references root_config/reconcileMode/detection controls. This pass's DataSources.tsx change adds a manual reconcile TRIGGER (T022 gap), not the per-root MODE/detection config controls this task asks for — distinct, still open. -->

**Checkpoint**: SC per-root behavior configurable; wizard sets it.

---

## Phase 7: User Story 5 — Missing-frame awareness for calibration matches (P3)

**Goal**: Matches referencing a missing calibration frame are flagged, not invalidated.
**Independent Test**: quickstart Scenario 6. **Depends on US2 (missing detection).**

All of US5 (T037–T039) is **in-flight on PR #503** (`048-us5-calibration-missing-flag`, stacked on #500), not yet on `main` — left unchecked here rather than duplicated.

### Tests (US5)
- [ ] T037 [P] [US5] Integration test: referenced calibration frame goes missing → match flagged "source missing / unverifiable", still present; flag clears on recovery.

### Implementation (US5)
- [ ] T038 [US5] In `crates/calibration/core/`, derive a "source missing / unverifiable" flag from the referenced `file_record` presence; emit `calibration_match.source_missing`/`source_recovered`; never auto-invalidate/remove.
- [ ] T039 [US5] Surface the flag on the calibration match UI.

**Checkpoint**: SC-006 met.

---

## Phase 8: Polish & Verification

- [ ] T040 Constitution re-check (custody, reviewable mutation, PixInsight boundary, lazy hashing, portable contracts) against the built feature.
- [ ] T041 `just lint` / per-crate `cargo test` / `just typecheck` green; regenerate + commit bindings.
- [ ] T042 `speckit-verify` against FR-001..FR-025 and SC-001..SC-006; `speckit-verify-tasks` to catch phantom completions.
- [ ] T043 `verify-on-windows` scenario for Scenarios 1/2/4/5 on the real Tauri app; add the matching tauri-driver Layer-2 journey + coverage-matrix update.
- [ ] T043a [US2] Performance verification for SC-005: reconcile a synthetic ≥10,000-frame root and assert it completes without blocking the UI thread and reports progress throughout (integration/bench under `tests/`).

---

## Dependencies

- **Phase 2 (T002–T007)** blocks everything.
- **US1 (P3 phase)** depends on T002. → MVP.
- **US2** depends on US1 + T003/T004.
- **US3** depends on US1 (benefits from US2).
- **US4** depends on T005/T006 (largely independent of US1–US3 logic).
- **US5** depends on US2.
- **Phase 8** depends on all targeted stories.

### Dependency graph

```
T001 ─▶ T002 ┐
        T003 ┼─▶ US1(T008–T015) ─▶ US2(T016–T026) ─▶ US5(T037–T039)
        T004 ┤                └─▶ US3(T027–T031)
        T005 ┼─▶ US4(T032–T036)
        T006 ┤
        T007 ┘
US1..US5 ─▶ Phase 8 (T040–T043)
```

## Parallelization notes

- Foundational [P] tasks T002/T003/T004/T005 touch different crates → parallelizable; T006 depends on none of them structurally but should land before per-story contract wiring; T007 is independent.
- Within each story, [P] tests are independent; implementation tasks that touch the same file are serialized (e.g., T020→T021 both in the reconcile module).
- US4 can proceed in parallel with US2/US3 once Foundational is done.
