---
description: "Task list for 048-per-frame-inventory"
---

# Tasks: Per-Frame Inventory with Live Session Membership

**Input**: Design documents from `specs/048-per-frame-inventory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/operations.md

**Tests**: Included. This feature is safety-critical (MUST NEVER mutate files as a reconciliation side effect; correct disk-usage totals gate destructive cleanup), so targeted contract/integration/unit tests are part of each story.

**Organization**: Grouped by user story (US1–US5) for independent implementation and testing. Priorities from spec.md: US1 P1; US2, US3 P2; US4, US5 P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- Paths are repo-relative and reference real crates from plan.md.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline on branch `048-per-frame-inventory` (worktree off `origin/redesign-ui-platevault`); run `just lint` and per-crate `cargo test -p app-core -p app-targets -p app-inbox -p fs-inventory` to record the green/red baseline (workspace-test baseline is known-red — validate per crate).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ No user-story work begins until this phase is complete.**

- [ ] T002 [P] Add a shared per-frame writer helper `upsert_frame_record(root_id, relative_path, size_bytes, mtime, state)` (stat-based real size, no hash) reusable by light and calibration paths — factor from `crates/app/targets/src/ingest_sessions.rs::upsert_file_record` into a shared location both `app/targets` and `app/inbox` can call.
- [ ] T003 [P] Create the raw-frame reconcile module skeleton mirroring `crates/workflow/artifacts/reconciler.rs`: a pass that walks a root, diffs recorded `file_record` rows vs disk, and emits state transitions — stub the walk + diff, no triggers yet. New module under `crates/fs/inventory/` or a new `crates/workflow/inventory-reconcile/` (decide per crate-split-by-domain rule).
- [ ] T004 [P] Add per-root symlink/junction gating utility used by the walker and any watch (default: do not follow); wire the `detection.follow_symlinks` flag. Fixes the ungated `RecursiveMode::Recursive` in `crates/fs/inventory/src/watcher.rs` for raw roots.
- [ ] T005 [P] Per-root config read/write over the spec-018 settings KV (`reconcile.mode`, `detection.{live,scheduled,on_open,follow_symlinks}`) with default-when-absent resolution, in `crates/app/settings/`.
- [ ] T006 Contract DTO scaffolding in `crates/contracts/core/` for `inventory.frame.list`, `inventory.reconcile.run`, `inventory.frame.relink`, `inventory.root_config.{get,set}`, and the `cleanup.candidates.scan`/`cleanup.plan.generate` extensions; register Tauri commands (fn name == invoke target — no specta rename) and regenerate `packages/contracts` bindings.
- [ ] T007 Add audit event types on the spec-002 bus: `frame.missing`, `frame.recovered`, `frame.size_backfilled`, `frame.relinked`, `calibration_match.source_missing`, `calibration_match.source_recovered` in `crates/audit/`.

**Checkpoint**: shared writer, reconcile skeleton, symlink gate, per-root config, contract surface, and events exist.

---

## Phase 3: User Story 1 — Accurate per-frame inventory for every session (P1) 🎯 MVP

**Goal**: Every applied frame (light + calibration) is a durable, correctly-sized inventory entry with correct session membership.
**Independent Test**: quickstart Scenario 1.

### Tests (US1)
- [ ] T008 [P] [US1] Integration test: inbox confirm → apply light frames → acquisition session lists all frames with non-zero total = Σ sizes (`tests/`).
- [ ] T009 [P] [US1] Integration test: apply calibration frames → calibration session lists member frames with real sizes (previously `'[]'`).
- [ ] T010 [P] [US1] Unit test: catalogue-in-place frame recorded identically to a moved frame.

### Implementation (US1)
- [ ] T011 [US1] Capture real `size_bytes` (+ `mtime`) at apply in `crates/app/targets/src/ingest_sessions.rs` (replace `size_bytes = 0`), via the T002 helper.
- [ ] T012 [US1] Fix `crates/app/inbox/src/plan_listener.rs:~211-214`: write a `file_record` per applied calibration frame and append its id to `calibration_session.frame_ids` (set-deduped; keep the `source_inbox_item_id` idempotency guard) instead of `'[]'`.
- [ ] T013 [US1] Ensure catalogue-in-place (organized source, no move) records a `file_record` with real size at apply, same as moved frames.
- [ ] T014 [US1] Implement `inventory.frame.list` (present count/size exclude `missing`) and wire session/inventory surfaces to show real counts + disk totals.
- [ ] T015 [US1] Size backfill on reconcile: correct present `file_record` rows with `size_bytes = 0` to the real size (also serves US2 walker). Emit `frame.size_backfilled`.

**Checkpoint**: sessions show honest, correctly-sized membership for all frame types (SC-001, SC-002).

---

## Phase 4: User Story 2 — Sessions notice removed/moved frames (P2)

**Goal**: External deletes/moves are detected and reflected (flag or auto-reconcile) without ever mutating files.
**Independent Test**: quickstart Scenarios 2 & 3. **Depends on US1 (records exist) + T003 skeleton.**

### Tests (US2)
- [ ] T016 [P] [US2] Integration test: delete a frame on disk → reconcile → `state = missing`, counts/totals drop, and assert **zero** filesystem mutations (spy/temp-dir snapshot before/after).
- [ ] T017 [P] [US2] Integration test: auto-reconcile mode drops the frame from active membership while the record is retained as `missing` (queryable with `include_missing`).
- [ ] T018 [P] [US2] Integration test: recovered frame flips back to present; changed-size present frame is updated in place (not missing).
- [ ] T019 [P] [US2] Unit test: relink succeeds on sha256 match; `hash.mismatch` on a same-size different file (proves size is not the key).

### Implementation (US2)
- [ ] T020 [US2] Complete the reconcile walker (T003): present/`missing`/recovered transitions, `last_seen_at` update, size backfill; emit `frame.missing`/`frame.recovered`; report progress (SC-005, non-blocking).
- [ ] T021 [US2] Apply per-root `reconcile.mode`: flag-missing (retain in membership, flagged) vs auto-reconcile (drop from active membership, retain record — NEVER hard-delete). Guarantee no filesystem mutation (INV-2).
- [ ] T022 [US2] `inventory.reconcile.run` command (on-demand) + long-running status/progress.
- [ ] T023 [US2] Per-root live watch: extend `crates/fs/inventory/src/watcher.rs` to raw/calibration roots with a per-root registry (model on `ArtifactWatcherRegistry` attach/detach); live events schedule a scoped reconcile, they don't mutate records directly. Respect symlink gate (T004).
- [ ] T024 [US2] Removable/network opt-out + polling/rescan fallback when live is off/unreliable; on-open and scheduled triggers.
- [ ] T025 [US2] `inventory.frame.relink`: sha256 computed on demand for the two files; re-home on match, `hash.mismatch` otherwise; emit `frame.relinked`; populate `content_hash` lazily.
- [ ] T026 [US2] Wire raw-root reconciler/watcher lifecycle at startup in `apps/desktop/src-tauri/src/lib.rs` (near `start_inbox_plan_listener`) and to library/project open.

**Checkpoint**: SC-003 met; no-mutation invariant proven by tests.

---

## Phase 5: User Story 3 — Raw sub-frame cleanup candidates (P2)

**Goal**: Cleanup review flow proposes individual raw sub-frames grouped by session with accurate reclaimable bytes.
**Independent Test**: quickstart Scenario 4. **Depends on US1; benefits from US2.**

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
- [ ] T032 [P] [US4] Contract test: `inventory.root_config.get` returns documented defaults when unset; `set` persists and round-trips.
- [ ] T033 [P] [US4] Integration test: changing mode to auto-reconcile takes effect on the next reconcile.

### Implementation (US4)
- [ ] T034 [US4] `inventory.root_config.{get,set}` over the T005 KV.
- [ ] T035 [US4] Add the per-root config step to the real unified first-run wizard (verify current wizard shape in code first) with documented defaults pre-selected.
- [ ] T036 [US4] Surface the same controls in existing root settings (minimal hook — full settings-window redesign is the companion UI spec, references 043).

**Checkpoint**: SC per-root behavior configurable; wizard sets it.

---

## Phase 7: User Story 5 — Missing-frame awareness for calibration matches (P3)

**Goal**: Matches referencing a missing calibration frame are flagged, not invalidated.
**Independent Test**: quickstart Scenario 6. **Depends on US2 (missing detection).**

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
