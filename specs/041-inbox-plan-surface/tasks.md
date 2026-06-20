# Tasks: Inbox Confirmation & Reviewable Plan Surface

**Feature**: 041-inbox-plan-surface | **Branch**: `041-inbox-plan-surface`
**Inputs**: spec.md, plan.md, research.md (R-1…R-8), data-model.md (migration 0045), contracts/operations.md, quickstart.md

**Conventions**: Generated `bindings/index.ts` is authoritative (define DTOs in Rust contracts → regenerate → frontend reads camelCase). Validate Rust per-crate (`-p <crate>`; workspace test is red on main). Windows verify loop for UI. `[P]` = parallelizable (distinct files, no incomplete deps). Story labels [US1]–[US7] map to spec user stories.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline on branch `041-inbox-plan-surface`: `cargo check -p persistence_db -p app_core -p fs_planner -p fs_executor` green and `cd apps/desktop && npx tsc --noEmit` clean (ignore pre-existing baseUrl deprecation).

## Phase 2: Foundational (blocking prerequisites)

- [ ] T002 Create migration `crates/persistence/db/migrations/0045_inbox_plan_surface.sql`: (a) `ALTER TABLE registered_sources ADD COLUMN organization_state TEXT NOT NULL DEFAULT 'unorganized' CHECK (organization_state IN ('organized','unorganized'))`; (b) backfill existing rows (inbox→unorganized, others→organized); (c) `CREATE TABLE inbox_file_metadata (...)` per data-model.md with `UNIQUE(inbox_item_id, relative_file_path)`; (d) add `override_filter`/`override_exposure_s`/`override_binning`/`override_stale` to `inbox_classification_evidence`; (e) extend `plan_items.action` CHECK to include `'catalogue'` (SQLite table-rebuild pattern).
- [ ] T003 Add a migration test in `crates/persistence/db/` asserting 0045 applies cleanly on a fresh DB and on a 0044-seeded DB (backfill values correct). Validate `cargo test -p persistence_db`.
- [ ] T004 [P] Extend source contracts in `crates/contracts/core/src/first_run.rs`: add `organization_state` to register (single + batch) request DTOs and to the source summary; add a `SetSourceOrganizationState` request/response. Add validation error code `source.invalid_organization_state`.
- [ ] T005 [P] Extend inbox contracts in `crates/contracts/core/src/inbox.rs`: add per-file metadata DTO (`InboxFileMetadata`), extend reclassify override DTO with optional `filter`/`exposure_s`/`binning`, add `InboxStats` DTO, add in-context plan DTOs (`InboxPlanView`, plan action with `catalogue`), add `organization_state` + `actions_summary` to confirm response, add `is_master`/`override_stale` to per-file view.
- [ ] T006 Add planner `Catalogue` action in `crates/fs/planner/src/lib.rs` (no source→dest move; `from_*` == `to_*`; `requires_destructive_confirm=false`) and thread it through plan-item construction.
- [ ] T007 Add executor catalogue op in `crates/fs/executor/src/ops/catalogue_op.rs` (no filesystem mutation; emits the apply signal for app/core to upsert `file_record` + audit), wire into `run.rs` dispatch. Validate `cargo test -p fs_planner -p fs_executor`.
- [ ] T008 Regenerate Tauri bindings (`apps/desktop/src/bindings/index.ts`) from the updated contracts; verify the new DTO fields appear in camelCase. `cd apps/desktop && npx tsc --noEmit`.

**Checkpoint**: schema + contracts + planner/executor catalogue scaffolding compile; bindings regenerated.

## Phase 3: User Story 1 — Reviewable plan in-context (P1) 🎯 MVP

**Goal**: confirming an item yields a reviewable plan shown in the inbox surface; planned items stay greyed/visible; explicit Apply/Cancel + apply-all; staleness refusal; no Archive nav.
**Independent test**: confirm an item → item stays as "planned", in-context plan panel lists actions, files not moved; Apply moves + audits; Cancel discards.

- [ ] T009 [US1] In `crates/app/core/src/inbox/confirm.rs`, ensure confirm creates a plan, links it via `inbox_plan_links`, sets item state `plan_open`, and returns plan id + `actions_summary`. Keep the item listed (don't resolve until applied).
- [ ] T010 [US1] Add Tauri commands `inbox.plan` (list plan for item via `inbox_plan_links`), `inbox.plan.apply`, `inbox.plan.apply_all`, reusing the existing executor/audit/CAS apply path; map `plans.discard` for cancel. Files: `apps/desktop/src-tauri/src/commands/inbox.rs` (+ app/core use-cases).
- [ ] T011 [US1] Staleness: surface CAS/`plan.stale` as a refuse-and-prompt-regenerate outcome from apply (FR-007); add app/core handling + error code.
- [ ] T012 [US1] Regenerate bindings; add `commands.ts` wrappers for the new inbox.plan operations in `apps/desktop/src/api/commands.ts`.
- [ ] T013 [P] [US1] Frontend: add an in-context plan panel component at the bottom of the inbox central area (`apps/desktop/src/features/inbox/PlanPanel.tsx`) listing actions + destination previews, with Apply / Cancel / Apply-all and a stale state.
- [ ] T014 [US1] Frontend: render planned items greyed with a "planned" badge in the list; keep them selectable (`InboxList.tsx`, `InboxPage.tsx`); remove the confirm→`/archive` navigation (`InboxPage.tsx:~106`), replacing it with the in-context panel.
- [ ] T015 [P] [US1] Tests: app/core confirm-produces-plan + apply/cancel/apply-all + staleness (`-p app_core`); Vitest for PlanPanel + planned-state rendering (`apps/desktop/src/features/inbox/__tests__/`).

**Checkpoint**: US1 independently demoable (move-only plans, in-context).

## Phase 4: User Story 2 — Structured groupable list + metadata (P1)

**Goal**: structured no-pill list with multi-level grouping; detail shows persisted per-file metadata + explicit mixed composition; masters resolve.
**Independent test**: list shows structured rows without overflow; group by target→type→filter nests; detail lists per-file metadata; master resolves.

- [ ] T016 [US2] Persist per-file metadata: in `crates/app/core/src/inbox/classify.rs` (and reclassify), upsert `inbox_file_metadata` rows (filter/exposure/gain/binning/temp/object/date/instrume/telescop/naxis/stack_count/size/mtime) during classification. Repo writes in `crates/persistence/db/src/repositories/inbox.rs`.
- [ ] T017 [US2] Add `inbox.item.metadata` command + app/core use-case returning per-file effective metadata (override-if-present). Files: app/core inbox + `commands/inbox.rs`.
- [ ] T018 [US2] Populate `inbox_classification_breakdown.destination_preview` at classify/confirm using `resolve_v1(active_pattern, effective_metadata)` (FR-024) instead of `None`.
- [ ] T019 [US2] Regenerate bindings; `commands.ts` wrapper for `inbox.item.metadata`.
- [ ] T020 [P] [US2] Frontend: restructure `InboxList.tsx` to a structured (no-pill) row layout following the standard sidebar layout (verify 1100×720, no overflow).
- [ ] T021 [US2] Frontend: multi-level grouping control + nested collapsible groups over target/frame-type/filter/exposure/date/source in `InboxList.tsx` (+ a small grouping state module); items missing a dimension under a "none" group.
- [ ] T022 [P] [US2] Frontend: `InboxDetail.tsx` — per-file metadata table (image type, filter, exposure, binning, gain, temperature, object, date) and explicit mixed-folder composition (per-type counts) instead of a bare "mixed".
- [ ] T023 [P] [US2] Tests: persistence metadata upsert (`-p persistence_db`); Vitest for grouping + metadata table + composition rendering.

**Checkpoint**: US1 + US2 = usable reviewable inbox (MVP complete).

## Phase 5: User Story 3 — Overrides beyond type + multi-select apply-all (P2)

**Goal**: override frame type/filter/exposure/binning per file; multi-select apply-to-all with accurate count; breakdown stays; overrides persist across rescan (size+mtime) and surface stale.
**Independent test**: multi-select filter override updates all selected, count matches, breakdown stays; persists across rescan; stale on file change.

- [ ] T024 [US3] Extend `crates/app/core/src/inbox/reclassify.rs` to apply non-type overrides (`override_filter`/`override_exposure_s`/`override_binning`) per file, recompute effective values, rebuild breakdown (already rebuilds type breakdown — extend to metadata), and return accurate `applied_count`.
- [ ] T025 [US3] Override persistence: on classify/rescan, re-apply overrides whose `(path,size,mtime)` is unchanged; mark `override_stale=1` when changed (R-4). Repo + classify logic.
- [ ] T026 [US3] Regenerate bindings; extend `commands.ts` reclassify wrapper for the multi-field, multi-file override shape.
- [ ] T027 [P] [US3] Frontend: multi-select of files (within item + across grouped list) and an "apply override to selection" affordance for type/filter/exposure/binning in `InboxDetail.tsx`/`InboxList.tsx`; accurate "Apply N overrides" count; stale-override indicator.
- [ ] T028 [P] [US3] Tests: reclassify non-type + multi-file (`-p app_core`); override persistence/stale (`-p persistence_db`); Vitest for multi-select apply-all.

## Phase 6: User Story 4 — Move vs catalogue-in-place by organization state (P2)

**Goal**: per-source organization state drives move (unorganized) vs catalogue-in-place (organized), per-file for mixed provenance; explicit choice + explainer at source-add.
**Independent test**: organized source → catalogue (no move); unorganized → move plan; mixed item → both; master follows the same rule; add-source forces the choice.

- [ ] T029 [US4] Persistence: read/write `organization_state` in `crates/persistence/db/src/repositories/first_run.rs`; enforce inbox⇒unorganized.
- [ ] T030 [US4] App/core: `set_source_organization_state` use-case + Tauri command; include `organization_state` in source register handling and list.
- [ ] T031 [US4] `confirm.rs`: decide per file by its source's `organization_state` — `Move` (unorganized) vs `Catalogue` (organized); a single confirm may emit both. Remove the master "registered directly" side-channel so masters follow the same rule (master from unorganized → move plan + register; from organized → catalogue + register).
- [ ] T032 [US4] Catalogue apply in app/core: when an applied plan item is `catalogue`, upsert `file_record` (+ session/target/master links) in place and write audit; no FS move.
- [ ] T033 [US4] Regenerate bindings; `commands.ts` wrappers for source organization-state set + register changes.
- [ ] T034 [P] [US4] Frontend setup: source-add flow requires an explicit organized/unorganized choice for non-inbox sources (inbox auto), with an explainer and a small flow diagram (`apps/desktop/src/features/setup/...`); editable later in source settings.
- [ ] T035 [P] [US4] Tests: confirm organized→catalogue / unorganized→move / mixed→both / master parity (`-p app_core`); register rejects inbox+organized; Vitest for the add-source choice UX.

## Phase 7: User Story 5 — Confirm auto-splits mixed folders (P3)

**Goal**: confirming a multi-type folder auto-produces one action group per frame type; no separate Split step.
**Independent test**: confirm a light+dark folder → distinct per-type actions; single-type → one action.

- [ ] T036 [US5] In `confirm.rs`, group the item's files by effective frame type and emit a distinct plan action group per type (each with its own pattern-resolved destination), composing with US4's per-file move/catalogue decision. Ensure no separate "split" command path is required.
- [ ] T037 [P] [US5] Tests: confirm mixed-type → per-type action groups; single-type → one group (`-p app_core`).

## Phase 8: User Story 6 — Per-type queue stats (P3)

**Goal**: queue summary shows folders/masters/images per type.
**Independent test**: seeded mix → summary counts match.

- [ ] T038 [US6] Add `inbox.stats` aggregate query in `crates/persistence/db/src/repositories/inbox.rs` (folders/masters/images per type from breakdown + `is_master_item`) + app/core use-case + Tauri command.
- [ ] T039 [US6] Regenerate bindings; `commands.ts` wrapper; frontend queue summary renders the per-type breakdown (`InboxPage.tsx`).
- [ ] T040 [P] [US6] Tests: stats query against a seeded fixture (`-p persistence_db`); Vitest for the summary.

## Phase 9: User Story 7 — Archive-vs-Trash destructive control (P3)

**Goal**: clearly labelled, well-placed destructive-destination control in the plan surface, default Archive.
**Independent test**: plan with a destructive action shows the labelled control defaulting to Archive; switching to Trash routes destructive files to system trash, audited.

- [ ] T041 [US7] Frontend: move the destructive-destination (Archive/System-Trash) control into the in-context plan panel (`PlanPanel.tsx`), clearly labelled with an at-point-of-use explanation, default Archive; remove the orphaned radios from the dropped right sidebar (`ActionSidebar.tsx`).
- [ ] T042 [US7] Ensure `inbox.confirm`/plan carries the chosen `destructive_destination` through to plan items and audit; default archive; never permanent-delete without a recoverable step.
- [ ] T043 [P] [US7] Tests: destructive-destination selection flows into plan items + audit (`-p app_core`); Vitest for the control default/labels.

## Phase 10: Polish & cross-cutting

- [ ] T044 Remove the now-dead right `ActionSidebar` and any `/archive`-navigation remnants from the inbox confirm flow; ensure the inbox follows the page layout convention (no overflow at 1100×720).
- [ ] T045 [P] Full gates: `cargo test -p app_core -p persistence_db -p fs_planner -p fs_executor`; `just lint`; `cd apps/desktop && npx tsc --noEmit && npx vitest run src/features/inbox src/features/setup src/features/calibration`.
- [ ] T046 Windows E2E verification per quickstart.md (US1–US7 acceptance scenarios) on the real app; capture results.
- [ ] T047 Update calibration "no data" follow-up (task #7 in the working list) if the organization-state/catalogue rework affects master listing; otherwise leave for its own fix.

---

## Dependencies & order

- **Phase 2 (Foundational)** blocks all stories (schema, contracts, catalogue action, bindings).
- **US1 (P1)** and **US2 (P1)** are the MVP and are largely independent (US1 = plan surface; US2 = list/metadata); do US1 first (it defines the plan panel US7 later reuses).
- **US3 (P2)** depends on US2 (metadata surface).
- **US4 (P2)** depends on Phase 2 (organization_state + catalogue) and composes with **US5 (P3)** in `confirm.rs` (do US4 before/with US5).
- **US6, US7 (P3)** depend on US1's plan surface / list.
- **Polish** last.

## Parallel opportunities

- T004/T005 (contracts) parallel; T013/T020/T022 (independent frontend files) parallel; test tasks marked [P] parallel within their story.

## Implementation strategy

MVP = Phase 2 + US1 + US2 (a structured, metadata-rich inbox with in-context reviewable move plans). Then US3 (overrides), US4+US5 (organization-state + auto-split — the custody model), then US6/US7 (stats, destructive control), then polish + Windows E2E.
