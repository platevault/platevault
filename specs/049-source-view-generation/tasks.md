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

- [x] T001 [SETUP] Confirm reuse surfaces compile as baselines: `crates/project/structure` (`PreparedSourceView`), `crates/fs/planner` (`FilesystemPlan`), `crates/patterns` resolver, `crates/workflow/profiles`, `crates/calibration/core`. No code change — record entry points in a scratch note for the implementers.
- [ ] T002 [P] [SETUP] Add a `Source Views` settings section id to the settings section registry (frontend + `crates/domain/core` section map) so the new keys have a home. DEFERRED: only consumer is T030 (Phase 7 settings pane), out of scope for US1.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T003 [FND] Write migration `crates/persistence/db/migrations/0054_source_view_generation_origin.sql` (renumbered from 0061 — 0053 was the highest on disk; 0054 confirmed free): recreate `plans` (SQLite table-recreate technique per 0029/0053) expanding `origin` CHECK with `prepared_view_generation` and `plan_type` CHECK with `source_view_generation`; preserve all data. (Migration verdict: this is the ONLY migration — see data-model.md.)
- [x] T004 [FND] Touch `crates/persistence/db/src/lib.rs` (or the embed anchor) to force `sqlx::migrate!` re-embed of the new migration (project memory: stale-embed guard).
- [x] T005 [P] [FND] Add `PlanOrigin::PreparedViewGeneration` + `PlanType::SourceViewGeneration` variants — actually in `crates/contracts/core/src/plans.rs` (tasks.md guessed `crates/fs/planner`; that crate has no DB/enum plumbing) and mapped to the DB enum strings; unit-tested round-trip serialization.
- [x] T006 [P] [FND] Add the two settings fields to `SettingsState` in `crates/domain/core/src/settings.rs`: `source_view_link_kind_intra_drive` (default `hardlink`), `source_view_link_kind_cross_drive` (default `symlink`, enum excludes `hardlink`), with serde + defaults; unit-tested defaults + deserialization; wired into `crates/app/settings` descriptors/defaults/apply.
- [x] T007 [P] [FND] Add `DriveScope` classifier + volume-identity helper in `crates/fs/inventory::drive_scope` (same-volume detection for a source path vs a destination path, cross-platform); unit tests with mocked volume ids.
- [x] T008 [FND] Add the filesystem-capability probe in `crates/fs/inventory::capability` (symlink privilege, junction support, hardlink same-volume) returning a `FilesystemCapability`; unit-tested matrix (symlink-yes/no × junction × cross-volume). Depends on T007.
- [x] T009 [FND] Add the pure `LinkKind` resolver in `crates/domain/core::source_view::resolve_link_kind`: `(DriveScope, settings pair, FilesystemCapability) -> Result<Materialization, NoLinkKind>` implementing the deterministic rule (cross-drive never hardlink; capability-drift fallback; no achievable kind → error). Unit-tested every branch incl. drift fallback + refuse. Depends on T006, T007, T008.

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

- [x] T010 [P] [US1] Contract test validating `contracts/sourceview.generate.json` (request/response, success + failure shapes) in `packages/contracts/tests/sourceview.generate.test.mjs`.
- [x] T011 [P] [US1] Integration test: build a generation plan for a fixture project with selected lights + matched masters → assert per-item `link`+`mkdir` actions, all targets under destination, no action targets an inventory path, `origin=prepared_view_generation` (SC-001/SC-003) in `crates/app/projects/tests/source_view_generation_builder.rs` (builder lives in `app_core_projects`, not `fs/planner` — see T005/T014 note).
- [x] T012 [P] [US1] Integration test: applied plan (symlink-capable fixture) → one link per item resolving to canonical source, 0 copies, DB unchanged, `PreparedSourceView` state `current` with recorded `materialization` (US1 AS2/AS3) in `crates/app/core/tests/source_view_generation_us1.rs`.
- [x] T013 [P] [US1] Test: generated tree contains 0 tool-control files (no `.xpsm`/`.xosm`/process-icons) — SC-002/FR-011 (same test file as T012).

### Implementation for US1

- [x] T014 [US1] Add the generation-plan builder — actually in `crates/app/projects/src/source_view_generate.rs` (mirrors spec 026's `prepared_views::regenerate_prepared_view`; `crates/fs/planner` is a tiny pure-domain crate with no DB access and isn't where plan builders live): enumerate selected lights (session-level for MVP; per-frame in US-shared T031), resolve destination-relative paths (flat WBPP-ish default for MVP; full profile layout in US2), classify drive-scope (T007), pick recorded kind (T009), emit `mkdir`+`link` (or opt-in `copy`) actions. Depends on T005, T009.
- [x] T015 [US1] Collision guard: detect two sources → same destination path and refuse with `destination.collision` pointing at the pattern (FR-009a/FR-017); never suffix. Unit + integration test. Depends on T014.
- [x] T016 [US1] Destination-exists guard: refuse `destination.exists` when a destination path is an existing user-owned file/folder (FR-016); never overwrite. Depends on T014.
- [x] T017 [US1] Resolve default destination `<project>/source-views/<view>/` via `crates/project/structure` (spec 024 envelope). Depends on T014.
- [x] T018 [US1] Add `GenerateSourceView` use case in `crates/app/core` (`source_view_generate.rs`): validate project lifecycle (spec 026 FR-012 → `lifecycle.read_only`), consume selection + matches, invoke builder, return `planId` + warnings. Depends on T014, T017.
- [x] T019 [US1] First-materialization write `finalize_view_generation` in `crates/app/core/src/plan_apply.rs`: on successful apply of a `prepared_view_generation` plan, create `PreparedSourceView` (state `current`) + items with recorded `materialization`; wired into the apply-success hook. Depends on T018.
- [x] T020 [US1] Per-item audit: confirmed the spec 017/025 executor already emits attempted-action/outcome events origin-agnostically (FR-007) — no new routing code needed for the new origin. Depends on T005.
- [x] T021 [P] [US1] Contract DTOs in `crates/contracts/core/src/source_view_generate.rs` + generated TS in `packages/contracts`/`apps/desktop/src/bindings` for `sourceview.generate`; registered Tauri command `sourceview_generate` → `sourceview.generate` (invoke target unchanged — project memory). Depends on T018.
- [x] T022 [US1] Minimal generation dialog `apps/desktop/src/features/projects/GenerateSourceViewDialog.tsx`: pick profile (default), show resolved capability + kind, copy opt-in, submit → plan review surface, wired into `SourceViewsSection.tsx`. Depends on T021.

**Implementation note**: while restoring real materialization for `link` actions, discovered `plan_items.action = "link"` was mapped to a no-op in the executor (spec 026 never materialized real links either). Added real link/hardlink/copy materialization (`crates/fs/executor/src/ops/link_op.rs`) — in scope because US1's acceptance criteria require real links on disk, not simulated ones.

**Deferred (explicitly out of US1 scope, tracked for US2/US4/cross-cutting)**: masters-vs-raw calibration selection (T027), junction materialization (capability probe never advertises it so it's unreachable in practice), settings section registry id (T002/T030).

**Checkpoint**: US1 fully functional — generate → review → apply → recorded view, links only.

---

## Phase 4: User Story 2 — Per-tool profile structure (Priority: P2)

**Goal**: Tree layout follows the selected workflow profile's token pattern
(WBPP: session/night → filter → exposure) with calibration in the profile's
expected location; changing the pattern changes the tree, not canonical data.

**Independent Test**: Generate with WBPP profile → assert grouping; change the
profile pattern → regenerate → assert new structure, same canonical sources.

### Tests for US2

- [x] T023 [P] [US2] Test: WBPP profile pattern groups lights by session/night → filter → exposure and places calibration in the expected location (US2 AS1) — actually two layers: unit tests in `crates/workflow/profiles/src/seed.rs` (`#[cfg(test)]`, this crate has no `tests/` dir — all tests are inline modules) for the layout data itself, plus a builder-level test (`wbpp_layout_groups_lights_by_night_filter_exposure`) in `crates/app/projects/src/source_view_generate.rs` asserting the actual resolved destination path.
- [x] T024 [P] [US2] Test: changing the metadata that feeds the profile pattern (different session/night/filter/exposure) changes only the destination path, never the canonical `file_record`/`acquisition_session` rows — `changing_session_metadata_changes_destination_not_canonical_data` in `crates/app/projects/src/source_view_generate.rs`. (US2 AS2 as literally written — "change the profile pattern" — isn't independently testable yet: only one real per-tool layout exists (WBPP); a second, user-editable layout is T030/future scope. This test proves the mechanism the AS2 behavior depends on: pattern-driven paths, not the flat MVP tree, with no DB mutation.)

### Implementation for US2

- [x] T025 [US2] Expose each profile's layout token pattern + calibration-placement rule in `crates/workflow/profiles` (WBPP first); default project profile resolution. Depends on Foundational. Added `SourceViewLayout` (`light_pattern`/`calibration_pattern`, `{token}` strings resolved via `crates/patterns::resolve_pattern_str`) + `ToolProfile.source_view_layout: Option<SourceViewLayout>` + `DEFAULT_SOURCE_VIEW_LAYOUT` (WBPP's `{date}/{filter}/{exposure}/` for lights, `calibration/{frame_type}/` for calibration) + `seed::resolve_source_view_layout(profile_ref)` (matches by id or display name, falls back to the default).
- [x] T026 [US2] Wire the builder to resolve destination-relative paths via `crates/patterns` from the active profile pattern, replacing the MVP flat layout (FR-008/FR-009); enforce the session/night/setup-token rule feeding T015's collision guard. Depends on T014, T025. `crates/app/projects/src/source_view_generate.rs`: resolves `req.profile_id` (falling back to `projects.tool`) via `workflow_profiles::seed::resolve_source_view_layout`, builds a `patterns::MetadataBundle` per session (`filter`/`exposure` from `project_sources` snapshots, `date` = the observing night parsed out of `session_key`, spec 002 T033a format), and resolves the light directory once per session via `patterns::resolve_pattern_str`. The session/night/setup-token rule is satisfied because `{date}` (session night) is part of the light pattern by construction, and every calibration set still gets its own `master_id` subdirectory (T015's guard unchanged).
- [x] T027 [US2] Calibration placement + selection: link masters when the resolved match is masters, else matched raw sets (FR-010/CL-4), into the profile's calibration location. Depends on T026. Placement: calibration now resolves via `layout.calibration_pattern` (`calibration/{frame_type}/<master_id>/`) instead of the US1 MVP's hardcoded `Calibration/<type>/<master_id>/`. Selection: investigated the schema — `calibration_assignment.master_id` always resolves to exactly one `calibration_session` row; this codebase's calibration matching engine (`calibration_core::MasterInfo`) has no raw-vs-master branch at that level (the spec-040 `is_master` flag lives only on `inbox_classification_evidence`, pre-ingest, and isn't carried onto `calibration_session`/`calibration_assignment`). So "masters when resolved masters, else raw" already holds trivially — there's exactly one frame set per assignment and it's linked as-is; documented this finding in the module doc comment as the place to add masters-preferred branching if a future schema change introduces a real both-available case.
- [x] T028 [US2] `no_calibration_applied` warning: when lights have no/partial matches, still generate and attach the warning listing unmatched groups (FR-010a/CL-7). Depends on T027, T018. Extended beyond the existing zero-assignment case: tracks each session's matched calibration types and compares against the project's own observed calibration types (not a hardcoded dark/flat/bias list, since not every setup uses every type); a session missing a type the project otherwise uses is flagged as partial via the same `NoCalibrationApplied` warning code. Test: `partial_calibration_coverage_is_flagged`.
- [x] T029 [US2] Surface capability + resolved per-drive-scope kind and the settings pair in the generation dialog; grey out unachievable kinds with Developer Mode guidance (FR-004a/FR-004c). Depends on T022. Partial: no live per-drive-scope filesystem-capability *preview* command/contract exists yet for the frontend (adding one is a materially larger change — new Tauri command + contract — out of this dialog's edit scope), so true pre-submit greying-out is not implemented. What shipped: a new `"sourceViews"` `settings.get`/`.update` scope (`sourceViewLinkKindIntraDrive`/`sourceViewLinkKindCrossDrive`, `apps/desktop/src-tauri/src/commands/settings.rs`) and `GenerateSourceViewDialog.tsx` now fetches and displays the two *configured* kinds on open plus a note explaining that an unachievable kind falls back automatically and is reported as a `capability_drift` plan warning after generation. The editable Settings pane (T030) and a real capability-preview endpoint remain open follow-ups for full FR-004a/FR-004c compliance.

**Checkpoint**: layout is profile-driven; calibration placed; warnings surfaced.

---

## Phase 5: User Story 3 — Regenerate after a selection/match change (Priority: P2)

**Goal**: Reflect the current canonical selection by regenerating — **reusing
spec 026's regeneration machinery**, not re-implementing it.

**Independent Test**: Generate, change selected lights or matches, regenerate,
confirm the plan adds/removes exactly the changed items and flags unresolved refs.

### Tests for US3

- [x] T032 [P] [US3] Integration test: after a selection/match change, spec 026 `preparedview.regenerate` produces a plan matching the new canonical selection with 0 dangling links applied and unresolved refs flagged (SC-005 / US3 AS1/AS2). `crates/app/core/tests/source_view_generation_us3_regenerate.rs::regenerate_reflects_removed_selection_with_zero_dangling_links` (mirrors US1's `source_view_generation_us1.rs` harness): generate + approve + apply via `sourceview.generate`, drop the frame from `file_record` (simulated selection/match change), regenerate, assert `unresolved_item_count == 1` and 0 `link` items in the regenerated plan. Surfaced and fixed a real bug while writing this test — see T033 note.
- [ ] ~~T032b~~ n/a — no separate "adds" case: spec 026's `regenerate_prepared_view` only ever re-emits/drops items already recorded on the view (it doesn't re-derive selection from `project_sources`/`calibration_assignment`), so there is no "added item" path to test without changing spec-026-owned regen logic, which is explicitly out of scope here (FR-012/FR-013 reuse-only).

### Implementation for US3

- [x] T033 [US3] Ensure a `current` view produced by US1/US2 is a valid input to spec 026's `preparedview.regenerate` (same entity/membership); add any missing wiring so regeneration reads generation-produced membership. Reuse only — no new regen logic (FR-012/FR-013). Depends on T019. Confirmed by construction: `finalize_view_generation` (`crates/app/core/src/plan_apply.rs`) and `regenerate_prepared_view` (`crates/app/projects/src/prepared_views.rs`) both read/write the identical `persistence_db::repositories::prepared_source_views` tables — no adapter was needed. **Found and fixed a real bug while proving this** (not new regen logic — a settings-read gap from Foundational T006): `persistence_db::repositories::settings::apply_key_to_state` (used by `load_settings`, which `sourceview.generate` calls directly) had no match arm for `sourceViewLinkKindIntraDrive`/`sourceViewLinkKindCrossDrive` — only the Tauri `settings.update` command path (`crates/app/settings`) applied them. A stored override was silently ignored and generation always used the in-code default (`hardlink` intra-drive), which meant a `current` view could never actually be produced with a non-default kind through the real settings path. Fixed in `crates/persistence/db/src/repositories/settings.rs` + regression test `load_settings_honors_stored_source_view_link_kind_overrides`.
- [x] T034 [US3] Confirm unresolved-source flagging (FR-019) is shared between generation warnings (T028 path) and regeneration warnings; deduplicate the warning model. Depends on T033. Reviewed, not changed (regen logic is spec-026-owned and out of scope per FR-012/FR-013 reuse-only): the two paths are **not** fully unified. Generation (`GenerationWarning[]` with `UnresolvedSource` code + itemized refs) treats a `file_record` row with `state IN ('missing','rejected')` as unresolved even though the row still exists; regeneration (`unresolved_item_count: u32`, no itemized refs) only checks row existence (`SELECT COUNT(*) > 0 FROM file_record WHERE id = ?`), so a row present but `missing`/`rejected` is (incorrectly) still counted as resolved. Also the response shapes differ (itemized list vs. a bare count) — genuinely deduplicating them means changing spec 026's `PreparedViewRegenerateResponse` contract (TS bindings, `packages/contracts`, `SourceViewsSection.tsx`), which is a spec-026 contract change, not something to make unilaterally from a spec-049 lane. Documented here as a follow-up for whoever owns spec 026 next.
- [x] T035 [US3] Frontend: expose "Regenerate" on a generated view routing to the spec 026 regenerate command (no duplicate UI machinery). Depends on T033. Already present and unmodified: `SourceViewsSection.tsx` calls `regeneratePreparedView(viewId)` for any view id regardless of origin (`data-testid="regenerate-view-${view.id}"`), and `canRegenerateView` gates on view *state* (`stale`/`removed`), not origin — a generation-produced view becomes eligible exactly like a spec-026-produced one once it diverges. No new UI code needed.

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
