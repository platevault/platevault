# Tasks: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Branch**: `041-inbox-plan-surface`
**Inputs**: spec.md, plan.md, research.md (R-1…R-8), data-model.md (migration 0045), contracts/operations.md, quickstart.md

**Conventions**: Generated `bindings/index.ts` is authoritative (define DTOs in Rust contracts → regenerate → frontend reads camelCase). Validate Rust per-crate (`-p <crate>`; workspace test is red on main). Windows verify loop for UI. `[P]` = parallelizable (distinct files, no incomplete deps). Story labels [US1]–[US7] map to spec user stories.

---

## Phase 1: Setup

- [X] T001 Confirm baseline on branch `041-inbox-plan-surface`: `cargo check -p persistence_db -p app_core -p fs_planner -p fs_executor` green and `cd apps/desktop && npx tsc --noEmit` clean (ignore pre-existing baseUrl deprecation).

## Phase 2: Foundational (blocking prerequisites)

- [X] T002 Create migration `crates/persistence/db/migrations/0045_inbox_plan_surface.sql`: (a) `ALTER TABLE registered_sources ADD COLUMN organization_state TEXT NOT NULL DEFAULT 'unorganized' CHECK (organization_state IN ('organized','unorganized'))`; (b) backfill existing rows (inbox→unorganized, others→organized); (c) `CREATE TABLE inbox_file_metadata (...)` per data-model.md with `UNIQUE(inbox_item_id, relative_file_path)`; (d) add `override_filter`/`override_exposure_s`/`override_binning`/`override_stale` to `inbox_classification_evidence`; (e) extend `plan_items.action` CHECK to include `'catalogue'` (SQLite table-rebuild pattern).
- [X] T003 Add a migration test in `crates/persistence/db/` asserting 0045 applies cleanly on a fresh DB and on a 0044-seeded DB (backfill values correct). Validate `cargo test -p persistence_db`.
- [X] T004 [P] Extend source contracts in `crates/contracts/core/src/first_run.rs`: add `organization_state` to register (single + batch) request DTOs and to the source summary; add a `SetSourceOrganizationState` request/response. Add validation error code `source.invalid_organization_state`.
- [X] T005 [P] Extend inbox contracts in `crates/contracts/core/src/inbox.rs`: add per-file metadata DTO (`InboxFileMetadata`), extend reclassify override DTO with optional `filter`/`exposure_s`/`binning`, add `InboxStats` DTO, add in-context plan DTOs (`InboxPlanView`, plan action with `catalogue`), add `organization_state` + `actions_summary` to confirm response, add `is_master`/`override_stale` to per-file view.
- [X] T006 Add planner `Catalogue` action in `crates/fs/planner/src/lib.rs` (no source→dest move; `from_*` == `to_*`; `requires_destructive_confirm=false`) and thread it through plan-item construction.
- [X] T007 Add executor catalogue op in `crates/fs/executor/src/ops/catalogue_op.rs` (no filesystem mutation; emits the apply signal for app/core to upsert `file_record` + audit), wire into `run.rs` dispatch. Validate `cargo test -p fs_planner -p fs_executor`.
- [X] T008 Regenerate Tauri bindings (`apps/desktop/src/bindings/index.ts`) from the updated contracts; verify the new DTO fields appear in camelCase. `cd apps/desktop && npx tsc --noEmit`.

**Checkpoint**: schema + contracts + planner/executor catalogue scaffolding compile; bindings regenerated.

## Phase 3: User Story 1 — Reviewable plan in-context (P1) 🎯 MVP

**Goal**: confirming an item yields a reviewable plan shown in the inbox surface; planned items stay greyed/visible; explicit Apply/Cancel + apply-all; staleness refusal; no Archive nav.
**Independent test**: confirm an item → item stays as "planned", in-context plan panel lists actions, files not moved; Apply moves + audits; Cancel discards.

- [X] T009 [US1] In `crates/app/core/src/inbox/confirm.rs`, ensure confirm creates a plan, links it via `inbox_plan_links`, sets item state `plan_open`, and returns plan id + `actions_summary`. Keep the item listed (don't resolve until applied).
- [X] T010 [US1] Add Tauri commands `inbox.plan` (list plan for item via `inbox_plan_links`), `inbox.plan.apply`, `inbox.plan.apply_all`, reusing the existing executor/audit/CAS apply path; map `plans.discard` for cancel. Files: `apps/desktop/src-tauri/src/commands/inbox.rs` (+ app/core use-cases).
- [X] T011 [US1] Staleness: surface CAS/`plan.stale` as a refuse-and-prompt-regenerate outcome from apply (FR-007); add app/core handling + error code.
- [X] T012 [US1] Regenerate bindings; add `commands.ts` wrappers for the new inbox.plan operations in `apps/desktop/src/api/commands.ts`.
- [X] T013 [P] [US1] Frontend: add an in-context plan panel component at the bottom of the inbox central area (`apps/desktop/src/features/inbox/PlanPanel.tsx`) listing actions + destination previews, with Apply / Cancel / Apply-all and a stale state.
- [X] T014 [US1] Frontend: render planned items greyed with a "planned" badge in the list; keep them selectable (`InboxList.tsx`, `InboxPage.tsx`); remove the confirm→`/archive` navigation (`InboxPage.tsx:~106`), replacing it with the in-context panel.
- [X] T015 [P] [US1] Tests: app/core confirm-produces-plan + apply/cancel/apply-all + staleness (`-p app_core`); Vitest for PlanPanel + planned-state rendering (`apps/desktop/src/features/inbox/__tests__/`).

**Checkpoint**: US1 independently demoable (move-only plans, in-context).

## Phase 4: User Story 2 — Structured groupable list + metadata (P1)

**Goal**: structured no-pill list with multi-level grouping; detail shows persisted per-file metadata + explicit mixed composition; masters resolve.
**Independent test**: list shows structured rows without overflow; group by target→type→filter nests; detail lists per-file metadata; master resolves.

- [X] T016 [US2] Persist per-file metadata: in `crates/app/core/src/inbox/classify.rs` (and reclassify), upsert `inbox_file_metadata` rows (filter/exposure/gain/binning/temp/object/date/instrume/telescop/naxis/stack_count/size/mtime) during classification. Repo writes in `crates/persistence/db/src/repositories/inbox.rs`.
- [X] T017 [US2] Add `inbox.item.metadata` command + app/core use-case returning per-file effective metadata (override-if-present). Files: app/core inbox + `commands/inbox.rs`.
- [X] T018 [US2] Populate `inbox_classification_breakdown.destination_preview` at classify/confirm using `resolve_v1(active_pattern, effective_metadata)` (FR-024) instead of `None`.
- [X] T019 [US2] Regenerate bindings; `commands.ts` wrapper for `inbox.item.metadata`.
- [X] T020 [P] [US2] Frontend: restructure `InboxList.tsx` to a structured (no-pill) row layout following the standard sidebar layout (verify 1100×720, no overflow).
- [X] T021 [US2] Frontend: multi-level grouping control + nested collapsible groups over target/frame-type/filter/exposure/date/source in `InboxList.tsx` (+ a small grouping state module); items missing a dimension under a "none" group.
- [X] T022 [P] [US2] Frontend: `InboxDetail.tsx` — per-file metadata table (image type, filter, exposure, binning, gain, temperature, object, date) and explicit mixed-folder composition (per-type counts) instead of a bare "mixed".
- [X] T023 [P] [US2] Tests: persistence metadata upsert (`-p persistence_db`); Vitest for grouping + metadata table + composition rendering.

**Checkpoint**: US1 + US2 = usable reviewable inbox (MVP complete).

## Phase 5: User Story 3 — Overrides beyond type + multi-select apply-all (P2)

**Goal**: override frame type/filter/exposure/binning per file; multi-select apply-to-all with accurate count; breakdown stays; overrides persist across rescan (size+mtime) and surface stale.
**Independent test**: multi-select filter override updates all selected, count matches, breakdown stays; persists across rescan; stale on file change.

- [X] T024 [US3] Extend `crates/app/core/src/inbox/reclassify.rs` to apply non-type overrides (`override_filter`/`override_exposure_s`/`override_binning`) per file, recompute effective values, rebuild breakdown (already rebuilds type breakdown — extend to metadata), and return accurate `applied_count`.
- [X] T025 [US3] Override persistence: on classify/rescan, re-apply overrides whose `(path,size,mtime)` is unchanged; mark `override_stale=1` when changed (R-4). Repo + classify logic.
- [X] T026 [US3] Regenerate bindings; extend `commands.ts` reclassify wrapper for the multi-field, multi-file override shape.
- [X] T027 [P] [US3] Frontend: multi-select of files (within item + across grouped list) and an "apply override to selection" affordance for type/filter/exposure/binning in `InboxDetail.tsx`/`InboxList.tsx`; accurate "Apply N overrides" count; stale-override indicator.
- [X] T028 [P] [US3] Tests: reclassify non-type + multi-file (`-p app_core`); override persistence/stale (`-p persistence_db`); Vitest for multi-select apply-all.

## Phase 6: User Story 4 — Move vs catalogue-in-place by organization state (P2)

**Goal**: per-source organization state drives move (unorganized) vs catalogue-in-place (organized), per-file for mixed provenance; explicit choice + explainer at source-add.
**Independent test**: organized source → catalogue (no move); unorganized → move plan; mixed item → both; master follows the same rule; add-source forces the choice.

- [X] T029 [US4] Persistence: read/write `organization_state` in `crates/persistence/db/src/repositories/first_run.rs`; enforce inbox⇒unorganized.
- [X] T030 [US4] App/core: `set_source_organization_state` use-case + Tauri command; include `organization_state` in source register handling and list.
- [X] T031 [US4] `confirm.rs`: decide per file by its source's `organization_state` — `Move` (unorganized) vs `Catalogue` (organized); a single confirm may emit both. Remove the master "registered directly" side-channel so masters follow the same rule (master from unorganized → move plan + register; from organized → catalogue + register).
- [X] T032 [US4] Catalogue apply in app/core: master registration relocated to apply-completion in `plan_listener.rs` (calibration_session + fingerprint, idempotent); no FS move (executor no-ops). NOTE: no `file_record` table exists in the codebase — catalogue matches Move's apply behavior (no file_record upsert on either path).
- [X] T033 [US4] Regenerate bindings; `commands.ts` wrappers for source organization-state set + register changes.
- [X] T034 [P] [US4] Frontend setup: source-add flow requires an explicit organized/unorganized choice for non-inbox sources (inbox auto), with an explainer and a small flow diagram (`apps/desktop/src/features/setup/...`); editable later in source settings.
- [X] T035 [P] [US4] Tests: confirm organized→catalogue / unorganized→move / mixed→both / master parity (`-p app_core`); register rejects inbox+organized; Vitest for the add-source choice UX.

## Phase 7: User Story 5 — Confirm auto-splits mixed folders (P3)

**Goal**: confirming a multi-type folder auto-produces one action group per frame type; no separate Split step.
**Independent test**: confirm a light+dark folder → distinct per-type actions; single-type → one action.

- [x] ~~T036~~ (RETIRED in iteration 2026-06-23 — US5 auto-split obsolete; superseded by single-type sub-items at ingest, US10/Phase 12. Original: [US5] In `confirm.rs`, group the item's files by effective frame type and emit a distinct plan action group per type (each with its own pattern-resolved destination), composing with US4's per-file move/catalogue decision. Ensure no separate "split" command path is required.)
- [x] ~~T037~~ (RETIRED in iteration 2026-06-23 — US5 auto-split obsolete; the `confirm_mixed_emits_per_type_action_groups` test is deleted under single-type sub-items, US10/Phase 12. Original: [P] [US5] Tests: confirm mixed-type → per-type action groups; single-type → one group (`-p app_core`).)

## Phase 8: User Story 6 — Per-type queue stats (P3)

**Goal**: queue summary shows folders/masters/images per type.
**Independent test**: seeded mix → summary counts match.

- [X] T038 [US6] Add `inbox.stats` aggregate query in `crates/persistence/db/src/repositories/inbox.rs` (folders/masters/images per type from breakdown + `is_master_item`) + app/core use-case + Tauri command.
- [X] T039 [US6] Regenerate bindings; `commands.ts` wrapper; frontend queue summary renders the per-type breakdown (`InboxPage.tsx`).
- [X] T040 [P] [US6] Tests: stats query against a seeded fixture (`-p persistence_db`); Vitest for the summary.

## Phase 9: User Story 7 — Archive-vs-Trash destructive control (P3)

**Goal**: clearly labelled, well-placed destructive-destination control in the plan surface, default Archive.
**Independent test**: plan with a destructive action shows the labelled control defaulting to Archive; switching to Trash routes destructive files to system trash, audited.

- [X] T041 [US7] Frontend: move the destructive-destination (Archive/System-Trash) control into the in-context plan panel (`PlanPanel.tsx`), clearly labelled with an at-point-of-use explanation, default Archive; remove the orphaned radios from the dropped right sidebar (`ActionSidebar.tsx`).
- [X] T042 [US7] Ensure `inbox.confirm`/plan carries the chosen `destructive_destination` through to plan items and audit; default archive; never permanent-delete without a recoverable step.
- [X] T043 [P] [US7] Tests: destructive-destination selection flows into plan items + audit (`-p app_core`); Vitest for the control default/labels.

## Phase 10: Polish & cross-cutting

- [X] T044 Remove the now-dead right `ActionSidebar` and any `/archive`-navigation remnants from the inbox confirm flow; ensure the inbox follows the page layout convention (no overflow at 1100×720).
- [X] T045 [P] Full gates: cargo test (app_core/persistence_db/fs_planner/fs_executor) green; clippy `--workspace --all-targets -D warnings` clean; `cargo fmt --check` clean; `tsc --noEmit` clean; vitest inbox/setup/calibration 160/160. (eslint step of `just lint` has pre-existing repo-wide failures unrelated to this spec — see handover.)
- [X] T046 Windows E2E verification per quickstart.md, driven on the real app via the tauri MCP bridge (7 sources: organized+unorganized × lights/calibration/projects + inbox; 37 FITS fixtures). Verified US4 org-state, US2 structured list/grouping/per-file metadata/composition/master-resolve, US6 stats, US1 reviewable plan + cancel + apply + catalogue-in-place. Found + fixed a merge-blocker (move-apply resolved root_id against the empty legacy `library_root` instead of `registered_sources` → every move failed `source.missing`; commit 1d0aed9 + regression test) and two UI/preview bugs (breakdown column reflow, move-preview double-slash; c589cea). Deferred to a follow-up iteration: calibration-specific folder structure, destination-root selection (default move-in-place; inbox must target a root; multi-root → user selects), full-path preview, mandatory missing path-attribute capture (date etc., like missing IMAGETYP). US3 multi-select overrides / US5 split-apply / US7 archive-vs-trash not exhaustively re-driven post-fix.
- [X] T047 N/A — this work did not change the calibration master-listing path, so the calibration "no data" follow-up is left for its own fix.

## Phase 11 — Iteration 2026-06-21: Destination model (US8, US9, FR-025–FR-033)

- [X] T048 [P] research.md: document the per-type destination patterns (light/flat/master-flat/bias/master-bias/dark/master-dark) with default patterns + rationale, the shared path-token vocabulary, and the path-load-bearing attribute matrix per frame type (raw vs master). Drives FR-025/FR-026 and FR-032/FR-033.
- [X] T049 Pattern resolver (`crates/patterns`): support a per-type pattern + a selector that picks the pattern by the file's resolved type (incl. master-vs-raw), with built-in default fallback. (FR-025/FR-026/FR-026a)
- [X] T050 Settings persistence (`crates/persistence/db` + settings use-case): store/read the per-type patterns with built-in defaults; invalid/empty → default. (FR-026b)
- [X] T051 [P] Settings UI (`apps/desktop`): edit per-type patterns using the token vocabulary, validate tokens, reset-to-default per type. (FR-026b)
- [X] T052 `confirm.rs`: select the destination pattern by resolved type; calibration types carry no target segment. (FR-026a)
- [X] T053 `confirm.rs`: destination-root resolution — in-place default for non-inbox; inbox MUST target a chosen library root; enumerate candidate roots by frame type; ambiguity (>1 candidate) requires a caller-supplied `root_id`. (FR-027–FR-030)
- [X] T054 Contracts/bindings: `inbox_confirm` request gains optional destination `root_id`; classify/plan responses carry candidate roots + the absolute destination path. (FR-029/FR-031)
- [X] T055 [P] Frontend (`InboxDetail`/`PlanPanel`): destination-root picker (shown only when ambiguous / for inbox) + full absolute-path display per action. (FR-029/FR-031)
- [X] T056 `classify.rs`/`confirm.rs` (+contracts): compute per-file `missing_path_attributes`; reject plan generation with a typed error when any path-load-bearing attribute is missing. (FR-032/FR-033)
- [X] T057 [P] Frontend: missing-attribute input gate mirroring the missing-IMAGETYP needs-review flow; clears on input and updates the destination. (FR-032)
- [X] T058 [P] Layer-1 tests: per-type pattern resolution + calibration structure; root resolution (in-place / inbox-target / single-auto / multi-require); missing-attribute gate. (cargo)
- [X] T059 [P] vitest: root picker, absolute-path display, missing-attribute input gate.
- [~] T060 Windows E2E (quickstart) via tauri MCP: calibration destination structure, inbox root selection, multi-root prompt vs single-root auto, missing-date gate; update `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`. **coverage-matrix updated + quickstart scenarios documented; Layer-1 (confirm.rs root/gate + patterns) and vitest (PlanPanel picker/abs-path, InboxDetail missing-attr) gate the merge. Live tauri-MCP Windows run is the recommended post-merge verification loop (`tauri-mcp-windows-verify-mechanics`).**

## Phase 12 — Single-type ingest & extended extraction (Iteration 2026-06-23)

**Goal**: change the inbox unit of work from one-item-per-leaf-folder to single-type sub-items materialized at classify time (item↔plan 1:1); add extended header extraction; make the reclassifier field-agnostic over a typed property registry; generalize the missing-mandatory gate with a needs-review bucket and a split-before-confirm loop; expose source-group provenance.

**Foundational**: T061 (migration 0048) + T062 (extended extraction) block T063–T073/T080. T072 (contracts/binding regen) precedes the frontend portions of T073.

- [X] T061 [P] [US10] Migration **0049** (`0049_inbox_single_type.sql`; **0046 + 0047 already taken** by `0046_session_canonical_target.sql` + `0047_target_constellation_magnitude.sql` — the latter renamed by PR #317 to resolve the dual-0046): `inbox_source_groups`; `inbox_items` +source_group_id/group_key/group_label/frame_type + composite UNIQUE; `inbox_file_overrides`; collapse `inbox_classifications.result` to classified|unclassified; data re-derivation (FR-034/FR-042/FR-046/FR-054).
- [X] T062 [P] [US16] Extend FITS+XISF extraction (FR-053): offset/temps/pointing/rotation/readout/focal/**pixel-size (`XPIXSZ`/`PIXSIZE`, XISF `Image:PixelSize`)**/observer/local-time + XISF unit conversions.
- [X] T063 [US11] Property registry module + `inbox.property_registry` contract (FR-044).
- [X] T064 [US10] Grouping engine: per-type recipe + bucketing + tolerances (pointing/rotation/temp) + per-dimension config (FR-035/FR-036/FR-037/FR-038/FR-039/FR-040).
- [X] T065 [US10] scan.rs: emit source-group rows, stay lazy (FR-041).
- [X] T066 [US10] classify.rs: materialize single-type sub-items (classify-then-split) + per-sub-group signature (FR-041/FR-042).
- [X] T067 [P] [US10] Composite identity + signature stability tests (FR-042).
- [X] T068 [US11] reclassify.rs: field-agnostic property map + bulk; fill-missing-only; index-only; source-group-scoped; re-split (FR-044/FR-045/FR-049).
- [X] T069 [US11] Override persistence (`inbox_file_overrides`) + staleness; migrate old override_* columns (FR-046). Read/write wiring (list_evidence JOINs + set_overrides upsert), old-column→table data migration, and size+mtime staleness on `inbox_file_overrides` all landed; `app_core_inbox` override tests green (57 passed).
- [X] T070 [US12] Generalized missing-mandatory gate + needs-review bucket + split-before-confirm enforcement (FR-047/FR-048/FR-049). NOTE: the derived mandatory set treats `target` as a hard light key satisfiable by coordinate auto-resolution (T074) OR user pick; a light with no pointing and no set target → needs-review.
- [ ] T071 [US10] confirm.rs: delete split/mixed branch; one rootId/item; retire per-type grouping (FR-050).
- [ ] T072 [US13] Contracts + binding regen: inbox.list (groupId/groupKey/groupLabel/frameType/sourceGroup/missingMandatory), inbox.confirm (drop action), inbox.reclassify (property map+bulk), metadata DTO new fields (FR-043/FR-044/FR-050).
- [ ] T073 [P] [US10] Layer-1 + vitest tests for Phase 12.
- [X] T080 [US16/US10] Flat↔light rotation matching (FR-040): compare a flat group's `ROTATANG` against the light group's `ROTATANG` (near-exact, float-epsilon), emit the metadata-quality warning on any deviation, honour `flat_rotation_required` (default off) when `ROTATANG` is absent, and surface the warning in the UI. Depends on T062 (extraction) + T064 (grouping). Tests: Layer-1 (match/warn/absent) + vitest (warning surface).
- [ ] T081 [US10/US16] Wire the extended T062 fields through `build_frame_metadata` into `FrameMetadata` so grouping actually uses them (FR-035–FR-040). FOUND during Wave C: `build_frame_metadata` (classify.rs) hardcodes offset/set-temp/ccd-temp/pointing(ra/dec)/rotation(ROTATANG)/focal-length/date-loc to `None`, so T062's extracted values never reach the grouping engine — every recipe dimension beyond the core falls to the "(unknown)" sentinel. Map RawFileMetadata's T062 fields → FrameMetadata; also map the corresponding `inbox_file_overrides` keys (offset/temperatureC) so reclassify can fill them. Tests: darks at two set-temps → two sub-items; lights at two pointings → two sub-items.

**Checkpoint**: mixed folders materialize as N single-type items; reclassify is field-agnostic; needs-review bucket gates plan creation; provenance + extended metadata surface.

## Phase 13 — Target resolution, lifecycle drop, cross-spec (Iteration 2026-06-23)

**Goal**: coordinate-based target resolution at light ingestion with project propagation; drop the session review lifecycle (sessions become derived, already-confirmed inventory); migrate legacy plan_open items; reconcile cross-spec impact.

**Depends on Phase 12** (single-type items + extended pointing/focal extraction). T078 (`sync.conflicts`) runs after the spec/data-model/contract artifacts land.

- [X] T074 [US15] Coordinate target resolution (FOV-aware NN) + `inbox.target_recommendations` op; OBJECT naming-only (FR-052). NOTE: the FOV-aware radius uses `FOCALLEN` + pixel size (T062) + `NAXIS1/2`; when pixel size is unavailable, fall back to a configurable fixed radius (R-17).
- [ ] T075 [US15] Target propagation to projects (FR-052).
- [ ] T076 [US14] Drop session review lifecycle (states + Confirm/Re-open/Reject); sessions derived; editable metadata view (FR-051).
- [ ] T077 [US14] Migration handling for plan_open legacy items (FR-054).
- [ ] T078 [US14] `/speckit.sync.conflicts` vs 045/006/035; mark spec 045 superseded.
- [ ] T079 [US15] quickstart scenarios + Windows E2E (tauri MCP) verification.

**Checkpoint**: light ingestion resolves targets by coordinates; sessions expose no review action; cross-spec conflicts (045/006/035) reconciled.

---

## Dependencies & order

- **Phase 2 (Foundational)** blocks all stories (schema, contracts, catalogue action, bindings).
- **US1 (P1)** and **US2 (P1)** are the MVP and are largely independent (US1 = plan surface; US2 = list/metadata); do US1 first (it defines the plan panel US7 later reuses).
- **US3 (P2)** depends on US2 (metadata surface).
- **US4 (P2)** depends on Phase 2 (organization_state + catalogue) and composes with **US5 (P3)** in `confirm.rs` (do US4 before/with US5).
- **US6, US7 (P3)** depend on US1's plan surface / list.
- **Polish** last.
- **Phase 12 (Iteration 2026-06-23, foundational)**: T061 (migration 0048) + T062 (extended extraction) are foundational and block T063–T073/T080. T072 (contracts/binding regen) precedes the frontend portions of T073. T080 (flat↔light rotation match) depends on T062+T064. Phase 12 supersedes the retired US5 auto-split (T036/T037).
- **Phase 13 (Iteration 2026-06-23)**: depends on Phase 12 (single-type items + pointing/focal extraction). T078 (`sync.conflicts` vs 045/006/035) runs after the spec/data-model/contract artifacts land.

## Parallel opportunities

- T004/T005 (contracts) parallel; T013/T020/T022 (independent frontend files) parallel; test tasks marked [P] parallel within their story.
- Phase 12: T061/T062 (migration + extraction, distinct files) parallel; T067/T073 (tests) [P]. T063–T066/T068–T071 follow the two foundational tasks; T072 precedes Phase-12 frontend tests. T080 (flat↔light rotation) follows T062+T064.

## Implementation strategy

MVP = Phase 2 + US1 + US2 (a structured, metadata-rich inbox with in-context reviewable move plans). Then US3 (overrides), US4+US5 (organization-state + auto-split — the custody model), then US6/US7 (stats, destructive control), then polish + Windows E2E.

**Iteration 2026-06-23**: Phase 12 first lands the foundational migration (T061) + extended extraction (T062), then the grouping/classify/reclassify/confirm rework (T063–T071) and contracts (T072), gated by Phase-12 tests (T073). Phase 13 follows: coordinate target resolution + project propagation (T074/T075), session lifecycle drop + legacy migration (T076/T077), cross-spec reconciliation (T078), and quickstart/Windows E2E (T079). US5 auto-split is retired (T036/T037) — single-type sub-items make it obsolete.
