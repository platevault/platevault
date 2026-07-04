---
description: "Task list for Source View Generation (spec 049)"
---

# Tasks: Source View Generation

**Input**: Design documents from `specs/049-source-view-generation/`

**Prerequisites**: plan.md, spec.md (user stories), data-model.md, contracts/, research.md

**Tests**: Included — this feature performs constitution-critical filesystem
mutation (reviewable plans, no silent overwrite, no silent copy), so per-story
tests are treated as required, not optional.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: US1..US4 (or FND/SETUP/POLISH)
- All paths are repository-root absolute within the workspace.

---

## Phase 1: Setup (Shared)

- [ ] T001 [SETUP] Confirm reuse surfaces compile as baselines: `crates/project/structure` (`PreparedSourceView`), `crates/fs/planner` (`FilesystemPlan`), `crates/patterns` resolver, `crates/workflow/profiles`, `crates/calibration/core`. No code change — record entry points in a scratch note for the implementers.
- [ ] T002 [P] [SETUP] Add a `Source Views` settings section id to the settings section registry (frontend + `crates/domain/core` section map) so the new keys have a home.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [ ] T003 [FND] Write migration `crates/persistence/db/migrations/0061_source_view_generation_origin.sql`: recreate `plans` (SQLite table-recreate technique per 0029/0053) expanding `origin` CHECK with `prepared_view_generation` and `plan_type` CHECK with `source_view_generation`; preserve all data; re-create `plan_items` FK + index. (Migration verdict: this is the ONLY migration — see data-model.md.)
- [ ] T004 [FND] Touch `crates/persistence/db/src/lib.rs` (or the embed anchor) to force `sqlx::migrate!` re-embed of the new migration (project memory: stale-embed guard).
- [ ] T005 [P] [FND] Add `PlanOrigin::PreparedViewGeneration` + `PlanType::SourceViewGeneration` variants in `crates/fs/planner` and map them to the DB enum strings; unit-test round-trip serialization.
- [ ] T006 [P] [FND] Add the two settings fields to `SettingsState` in `crates/domain/core/src/settings.rs`: `source_view_link_kind_intra_drive` (default `hardlink`), `source_view_link_kind_cross_drive` (default `symlink`, enum excludes `hardlink`), with serde + defaults; unit-test defaults + deserialization.
- [ ] T007 [P] [FND] Add `DriveScope` classifier + volume-identity helper in `crates/fs/inventory` (same-volume detection for a source path vs a destination path, cross-platform); unit tests with mocked volume ids.
- [ ] T008 [FND] Add the filesystem-capability probe in `crates/fs/inventory` (symlink privilege, junction support, hardlink same-volume) returning a `FilesystemCapability`; unit-test the matrix (symlink-yes/no × junction × cross-volume). Depends on T007.
- [ ] T009 [FND] Add the pure `LinkKind` resolver in `crates/domain/core`: `(DriveScope, settings pair, FilesystemCapability) -> Result<Materialization, NoLinkKind>` implementing the deterministic rule (cross-drive never hardlink; capability-drift fallback; no achievable kind → error). Unit-test every branch incl. drift fallback + refuse. Depends on T006, T007, T008.

**Checkpoint**: origin enum, settings, drive-scope, capability probe, and kind resolver exist and are unit-tested.

---

## Phase 3: User Story 1 — Generate a WBPP-ready source view (Priority: P1) 🎯 MVP

**Goal**: For a project with selected lights + matched calibration, produce a
reviewable generation plan of link actions; on apply, materialize the tree with
zero copies and write the `PreparedSourceView`.

**Independent Test**: Request generation for such a project, review the plan,
approve+apply on a symlink-capable FS, and confirm one link per selected/matched
item resolving to canonical sources, zero originals copied, DB unchanged, and a
`current` `PreparedSourceView` recorded with per-item materialization.

### Tests for US1

- [ ] T010 [P] [US1] Contract test validating `contracts/sourceview.generate.json` (request/response, success + failure shapes) in `packages/contracts/tests`.
- [ ] T011 [P] [US1] Integration test: build a generation plan for a fixture project with selected lights + matched masters → assert per-item `link`+`mkdir` actions, all targets under destination, no action targets an inventory path, `origin=prepared_view_generation` (SC-001/SC-003) in `crates/fs/planner/tests`.
- [ ] T012 [P] [US1] Integration test: applied plan (symlink-capable fixture) → one link per item resolving to canonical source, 0 copies, DB unchanged, `PreparedSourceView` state `current` with recorded `materialization` (US1 AS2/AS3).
- [ ] T013 [P] [US1] Test: generated tree contains 0 tool-control files (no `.xpsm`/`.xosm`/process-icons) — SC-002/FR-011.

### Implementation for US1

- [ ] T014 [US1] Add the generation-plan builder in `crates/fs/planner`: enumerate selected lights (session-level for MVP; per-frame in US-shared T031), resolve destination-relative paths (flat WBPP-ish default for MVP; full profile layout in US2), classify drive-scope (T007), pick recorded kind (T009), emit `mkdir`+`link` (or opt-in `copy`) actions. Depends on T005, T009.
- [ ] T015 [US1] Collision guard: detect two sources → same destination path and refuse with `destination.collision` pointing at the pattern (FR-009a/FR-017); never suffix. Unit + integration test. Depends on T014.
- [ ] T016 [US1] Destination-exists guard: refuse `destination.exists` when a destination path is an existing user-owned file/folder (FR-016); never overwrite. Depends on T014.
- [ ] T017 [US1] Resolve default destination `<project>/source-views/<view>/` via `crates/project/structure` (spec 024 envelope). Depends on T014.
- [ ] T018 [US1] Add `GenerateSourceView` use case in `crates/app/core`: validate project lifecycle (spec 026 FR-012 → `lifecycle.read_only`), consume selection + matches, invoke builder, return `planId` + warnings. Depends on T014, T017.
- [ ] T019 [US1] First-materialization write in `crates/project/structure`: on successful apply of a `prepared_view_generation` plan, create `PreparedSourceView` (state `current`) + items with recorded `materialization`; wire the apply-success hook. Depends on T018.
- [ ] T020 [US1] Per-item audit: ensure the spec 017/025 executor emits attempted-action/outcome events for the new origin (FR-007) — add the `prepared_view_generation` origin to the audit routing. Depends on T005.
- [ ] T021 [P] [US1] Contract DTOs in `crates/contracts/core` + generated TS in `packages/contracts` for `sourceview.generate`; register Tauri command `sourceview_generate` → `sourceview.generate` (do NOT rename invoke target — project memory). Depends on T018.
- [ ] T022 [US1] Minimal generation dialog in `apps/desktop`: pick profile (default), show resolved capability + kind, copy opt-in, submit → plan review surface. Depends on T021.

**Checkpoint**: US1 fully functional — generate → review → apply → recorded view, links only.

---

## Phase 4: User Story 2 — Per-tool profile structure (Priority: P2)

**Goal**: Tree layout follows the selected workflow profile's token pattern
(WBPP: session/night → filter → exposure) with calibration in the profile's
expected location; changing the pattern changes the tree, not canonical data.

**Independent Test**: Generate with WBPP profile → assert grouping; change the
profile pattern → regenerate → assert new structure, same canonical sources.

### Tests for US2

- [ ] T023 [P] [US2] Test: WBPP profile pattern groups lights by session/night → filter → exposure and places calibration in the expected location (US2 AS1) in `crates/workflow/profiles/tests`.
- [ ] T024 [P] [US2] Test: changing the layout pattern changes destination paths only (canonical DB untouched, no processing) — US2 AS2.

### Implementation for US2

- [ ] T025 [US2] Expose each profile's layout token pattern + calibration-placement rule in `crates/workflow/profiles` (WBPP first); default project profile resolution. Depends on Foundational.
- [ ] T026 [US2] Wire the builder to resolve destination-relative paths via `crates/patterns` from the active profile pattern, replacing the MVP flat layout (FR-008/FR-009); enforce the session/night/setup-token rule feeding T015's collision guard. Depends on T014, T025.
- [ ] T027 [US2] Calibration placement + selection: link masters when the resolved match is masters, else matched raw sets (FR-010/CL-4), into the profile's calibration location. Depends on T026.
- [ ] T028 [US2] `no_calibration_applied` warning: when lights have no/partial matches, still generate and attach the warning listing unmatched groups (FR-010a/CL-7). Depends on T027, T018.
- [ ] T029 [US2] Surface capability + resolved per-drive-scope kind and the settings pair in the generation dialog; grey out unachievable kinds with Developer Mode guidance (FR-004a/FR-004c). Depends on T022.

**Checkpoint**: layout is profile-driven; calibration placed; warnings surfaced.

---

## Phase 5: User Story 3 — Regenerate after a selection/match change (Priority: P2)

**Goal**: Reflect the current canonical selection by regenerating — **reusing
spec 026's regeneration machinery**, not re-implementing it.

**Independent Test**: Generate, change selected lights or matches, regenerate,
confirm the plan adds/removes exactly the changed items and flags unresolved refs.

### Tests for US3

- [ ] T032 [P] [US3] Integration test: after a selection/match change, spec 026 `preparedview.regenerate` produces a plan matching the new canonical selection with 0 dangling links applied and unresolved refs flagged (SC-005 / US3 AS1/AS2).

### Implementation for US3

- [ ] T033 [US3] Ensure a `current` view produced by US1/US2 is a valid input to spec 026's `preparedview.regenerate` (same entity/membership); add any missing wiring so regeneration reads generation-produced membership. Reuse only — no new regen logic (FR-012/FR-013). Depends on T019.
- [ ] T034 [US3] Confirm unresolved-source flagging (FR-019) is shared between generation warnings (T028 path) and regeneration warnings; deduplicate the warning model. Depends on T033.
- [ ] T035 [US3] Frontend: expose "Regenerate" on a generated view routing to the spec 026 regenerate command (no duplicate UI machinery). Depends on T033.

**Checkpoint**: regeneration works via spec 026; generation and regeneration share one membership model.

---

## Phase 6: User Story 4 — Verify a generated view before processing (Priority: P2)

**Goal**: Read-only check that every link resolves to a present source; report
broken items; no mutation, no auto-repair.

**Independent Test**: Generate, move/remove one source outside the app, verify →
broken item reported, no filesystem mutation, no auto-repair.

### Tests for US4

- [ ] T036 [P] [US4] Contract test validating `contracts/sourceview.verify.json` in `packages/contracts/tests`.
- [ ] T037 [P] [US4] Integration test: all-present view verifies clean (0 false alarms, SC-006); a moved/removed source is reported with its reference, 0 filesystem mutations, no auto-repair (US4 AS1/AS2/FR-015).

### Implementation for US4

- [ ] T038 [US4] Add `VerifySourceView` use case in `crates/app/core` leaning on spec 026 stale-detection resolution (read-only), returning clean + broken items. Depends on T019.
- [ ] T039 [US4] Contract DTOs + TS + Tauri command `sourceview_verify` → `sourceview.verify`. Depends on T038.
- [ ] T040 [US4] Frontend: "Verify before processing" action on a generated view showing the broken-item report; no mutation affordance. Depends on T039.

**Checkpoint**: verification is a read-only pre-processing gate.

---

## Phase 7: Cross-cutting (shared by stories)

- [ ] T030 [P] [US-shared] Settings pane (frontend + `settings.update`/`get`): render the two link-kind selectors under `Source Views`, capability-constrained (cross-drive omits `hardlink`; symlink greyed with Developer Mode guidance) — FR-004a/FR-004c. Depends on T006, T008.
- [ ] T031 [US-shared] Per-frame selection integration: consume spec 048 per-frame inventory where present (exclude missing frames per 048 FR-009), else session-level fallback (CL-9). Wire into the builder (T014/T026). Depends on T014.
- [ ] T041 [US-shared] Per-project + per-generation destination override (FR-021b): persist per-project override (KV key `source_view.<project_id>.destination`), accept per-generation `destinationOverride`, apply precedence (per-generation > per-project > envelope default). Depends on T017.
- [ ] T042 [US-shared] Long-path (Windows >260) + capability-drift (`capability_drift`) warnings emitted by the builder (FR-018/FR-004b). Depends on T014, T009.

---

## Phase 8: Polish & Verification

- [ ] T043 [P] [POLISH] `just lint` + `just typecheck` clean; `cargo test -p fs-planner -p project-structure -p app-core -p domain-core` green (workspace-wide test is red on main — use `-p`, project memory).
- [ ] T044 [P] [POLISH] Docs: note the restored generation path + FR-008 amendment cross-links in spec 026 tasks (finish deferred P3 stale/audit now that a live generation path exists).
- [ ] T045 [POLISH] Windows real-app verification (verify-on-windows skill): generate on a symlink-capable path, on a no-privilege path (fallback notice), and cross-drive (per-scope kind); confirm zero copies, zero tool-control files.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no deps.
- **Foundational (P2)**: after Setup — **BLOCKS all user stories**. T003→T004; T007→T008→T009 (T009 also needs T006); T005/T006/T007 parallel.
- **US1 (P3, MVP)**: after Foundational. Core builder chain T014→(T015,T016,T017)→T018→T019→T020; contract/UI T021→T022.
- **US2 (P4)**: after Foundational; integrates with US1 builder (T014). T025→T026→T027→T028; T029 after T022.
- **US3 (P5)**: after US1 (needs T019 membership). Reuses spec 026 — minimal new code.
- **US4 (P6)**: after US1 (needs T019). Independent of US2/US3.
- **Cross-cutting (P7)**: T030/T031/T041/T042 attach to US1/US2 builders; T030 needs Foundational only.
- **Polish (P8)**: after all targeted stories.

### User story independence

- **US1** is the MVP and stands alone (session-level layout acceptable).
- **US2** layers profile layouts onto US1's builder; testable independently by
  swapping patterns.
- **US3** delegates to spec 026; testable once a `current` view exists (US1).
- **US4** is a read-only check over a `current` view (US1); independent of US2/US3.

### Parallel opportunities

- Foundational: T005, T006, T007 in parallel; then T008, T009.
- US1 tests T010–T013 in parallel before implementation.
- Across stories after Foundational + US1 core: US2, US3, US4 can proceed by
  different implementers (US3/US4 need T019).

## Implementation Strategy

1. Setup + Foundational (migration 0061, settings, capability, resolver).
2. **US1 → STOP and validate** (MVP: generate → review → apply → recorded view,
   links only, zero copies, zero tool-control files).
3. US2 (profile layout + calibration placement + warnings).
4. US3 (regeneration via spec 026) and US4 (verify) — parallelizable.
5. Cross-cutting settings/per-frame/destination/long-path, then Polish + Windows
   verification.

## Notes

- Reuse-first: US3 adds **no** new removal/regeneration/stale logic (FR-013);
  US1 adds **no** new plan executor (spec 017/025 owns apply).
- Migration verdict: exactly one migration (`0061`) — enum expansion only.
- Never rename Tauri invoke targets (project memory: tauri-specta mismatch).
- Commit after each task or logical group; push continuously.
