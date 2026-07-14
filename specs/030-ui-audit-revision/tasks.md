# Tasks: UI Audit & Revision

**Input**: Design documents from `specs/030-ui-audit-revision/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks grouped by user story. Each phase is independently
testable and deployable. Paths relative to `apps/desktop/src/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1-US6 maps to spec user stories

---

## Phase 1: Setup

**Purpose**: Shared infrastructure and migrations before any UI work

- [ ] T001 Create `components/` directory at `apps/desktop/src/components/`
- [ ] T002 [P] Add `@uiw/react-md-editor` dependency in `apps/desktop/package.json`
- [ ] T003 [P] Add `@tanstack/react-virtual` dependency if not present in `apps/desktop/package.json`
- [ ] T004 [P] Create SQLite migration for equipment tables (Camera, Telescope, OpticalTrain, Filter) in `crates/persistence/db/migrations/`
- [ ] T005 [P] Create SQLite migration for cleanup_policy and calibration_tolerances tables in `crates/persistence/db/migrations/`
- [ ] T006 [P] Create SQLite migration for ingestion_settings table in `crates/persistence/db/migrations/`
- [ ] T007 [P] Create SQLite migration to expand source_folder_type enum from 4 to 6 types (light_frames, dark, flat, bias, project, inbox) in `crates/persistence/db/migrations/`
- [ ] T008 [P] Create SQLite migration to remove `prepared` lifecycle state, migrate existing `prepared` rows to `processing` in `crates/persistence/db/migrations/`
- [ ] T009 [P] Create SQLite migration to simplify source_view_strategy enum (remove manifest_only, hybrid) in `crates/persistence/db/migrations/`

---

## Phase 2: Foundational — Shared Components & Backend Commands

**Purpose**: Reusable components and backend contracts that all user stories depend on

### Shared UI Components

- [ ] T010 Create `ListSidebar` component with search, group, sort, filter controls in `components/ListSidebar.tsx`
- [ ] T011 [P] Create `FilterBar` component with text search, dropdown filters, state pills in `components/FilterBar.tsx`
- [ ] T012 [P] Create `TopActionBar` component with consistent button sizing and hotkey display in `components/TopActionBar.tsx`
- [ ] T013 [P] Create `PropertyTable` component supporting editable and read-only modes, source indicators, confirm checkboxes in `components/PropertyTable.tsx`
- [ ] T014 [P] Create `ConfirmOverlay` component for modal confirmation with property summary in `components/ConfirmOverlay.tsx`

### Backend — Equipment CRUD

- [ ] T015 [P] Create Equipment DTOs (Camera, Telescope, OpticalTrain, Filter) in `crates/contracts/core/src/equipment.rs`
- [ ] T016 [P] Create Equipment repository (CRUD for all 4 entities) in `crates/persistence/db/src/repositories/equipment.rs`
- [ ] T017 Create Equipment use cases in `crates/app/core/src/equipment.rs`
- [ ] T018 Create Equipment Tauri commands (equipment.cameras.*, equipment.telescopes.*, equipment.trains.*, equipment.filters.*) in `apps/desktop/src-tauri/src/commands/equipment.rs`

### Backend — Settings & Status

- [ ] T019 [P] Create Cleanup policy DTOs and repository in `crates/contracts/core/src/cleanup.rs` and `crates/persistence/db/src/repositories/cleanup.rs`
- [ ] T020 [P] Create Calibration tolerances DTOs and repository in `crates/contracts/core/src/calibration_tolerances.rs` and `crates/persistence/db/src/repositories/calibration_tolerances.rs`
- [ ] T021 [P] Create Ingestion settings DTOs and repository in `crates/contracts/core/src/ingestion.rs` and `crates/persistence/db/src/repositories/ingestion.rs`
- [ ] T022 Create StatusSummary DTO and aggregation query (inbox count, library stats, cleanup reclaimable, volume health, root health) in `crates/contracts/core/src/status.rs` and `crates/app/core/src/status.rs`
- [ ] T023 Create status.summary Tauri command in `apps/desktop/src-tauri/src/commands/status.rs`
- [ ] T024 [P] Create cleanup.policy.get/update Tauri commands in `apps/desktop/src-tauri/src/commands/cleanup.rs`
- [ ] T025 [P] Create calibration.tolerances.get/update Tauri commands in `apps/desktop/src-tauri/src/commands/calibration_tolerances.rs`
- [ ] T026 [P] Create ingestion.settings.get/update Tauri commands in `apps/desktop/src-tauri/src/commands/ingestion.rs`

### Backend — Contract Changes

- [ ] T027 Expand roots.register type enum to 6 types in `crates/contracts/core/src/first_run.rs` and update repository/use-case layers
- [ ] T028 [P] Create tools.list/update/validate_path Tauri commands in `apps/desktop/src-tauri/src/commands/tools.rs`

### Backend — Inbox Watcher & Session Operations

- [ ] T029 [P] Create filesystem watcher service using `notify` crate for inbox folder monitoring, emitting new-file events to the frontend via Tauri event system in `crates/fs/inventory/src/watcher.rs` and `apps/desktop/src-tauri/src/watcher.rs`
- [ ] T030 [P] Create inbox.scan Tauri command for on-demand inbox scan (startup + manual rescan) in `apps/desktop/src-tauri/src/commands/inbox.rs`
- [ ] T031 [P] Create session.split Tauri command: accepts session ID + split property, returns N new session IDs with reassigned file membership in `crates/app/core/src/sessions.rs` and `apps/desktop/src-tauri/src/commands/sessions.rs`
- [ ] T032 [P] Create session.merge Tauri command: accepts 2+ session IDs, validates merge compatibility, returns merged session ID in `crates/app/core/src/sessions.rs` and `apps/desktop/src-tauri/src/commands/sessions.rs`

### Backend — Project Support

- [ ] T033 [P] Create project notes disk-sync service: writes markdown notes to project `notes/` directory on save, reads on load, DB is authority in `crates/app/core/src/project_notes.rs`
- [ ] T034 [P] Create cleanup.scan Tauri command: aggregates cleanup-eligible files for a project (intermediaries, calibration subs with masters) and returns reviewable plan in `crates/app/core/src/cleanup.rs` and `apps/desktop/src-tauri/src/commands/cleanup.rs`

### Bindings

- [ ] T035 Regenerate TypeScript bindings after all new commands are registered in `apps/desktop/src/bindings/`

**Checkpoint**: All shared components built, all backend commands available. User story work can begin.

---

## Phase 3: User Story 1 — First-Run Setup (Priority: P1) 🎯 MVP

**Goal**: 4-step wizard replacing the 8-step wizard

**Independent Test**: Complete wizard from fresh install, verify all 6 source types registered, tools validated, catalogs downloaded, app advances to Inbox

### Implementation

- [ ] T036 [US1] Delete old wizard step components (StepWelcome, StepRaw, StepCalibration, StepProject, StepInbox, StepDetectTools) in `features/setup/steps/`
- [ ] T037 [US1] Rewrite `SetupWizard.tsx` for 4-step flow (Source Folders → Processing Tools → Catalogs → Confirm) in `features/setup/SetupWizard.tsx`
- [ ] T038 [US1] Create Step 1 — Source Folders component: welcome intro, add-folder button, native OS picker, type selector, emptiness check, validation summary in `features/setup/steps/StepSourceFolders.tsx`
- [ ] T039 [US1] Rewrite `sources-store.ts` to handle 6 source types with add/remove, emptiness validation, type tracking in `features/setup/sources-store.ts`
- [ ] T040 [US1] Create Step 2 — Processing Tools component: PI/Siril toggles, mock detection label, executable file browser, immediate path validation in `features/setup/steps/StepTools.tsx`
- [ ] T041 [US1] Create Step 3 — Catalogs component: catalog list with enable/disable toggles, Download All button, purpose description in `features/setup/steps/StepCatalogs.tsx`
- [ ] T042 [US1] Create Step 4 — Confirm component: folder summary with empty/not-empty badges, tool status, catalog status, blocked-finish logic in `features/setup/steps/StepConfirm.tsx`
- [ ] T043 [US1] Update `SetupPage.tsx` to remove reset-wizard button, update step count display in `features/setup/SetupPage.tsx`
- [ ] T044 [US1] Update wizard Vitest component tests for 4-step flow in `features/setup/SetupWizard.test.tsx`

**Checkpoint**: Wizard functional with 4 steps, all validation working

---

## Phase 4: User Story 2 — Inbox Session Review (Priority: P1)

**Goal**: Renamed Review Queue → Inbox with full session review, edit, confirm/reject/split/merge workflow

**Independent Test**: Drop FITS files in inbox folder, see sessions detected, edit properties, confirm one, verify it moves to Sessions

### Implementation

- [ ] T045 [US2] Rename `features/review/` directory to `features/inbox/` and update all imports
- [ ] T046 [US2] Create `InboxPage.tsx` replacing `ReviewPage.tsx` in `features/inbox/InboxPage.tsx`
- [ ] T047 [US2] Create `InboxList.tsx` with standard ListSidebar (target/date/filter/integration per entry, no confidence) in `features/inbox/InboxList.tsx`
- [ ] T048 [US2] Create `SessionReview.tsx` with unified PropertyTable (editable, source indicators, confirm checkboxes), header, frames summary in `features/inbox/SessionReview.tsx`
- [ ] T049 [US2] Create `ActionSidebar.tsx` with same-width Confirm/Reject/Split/Merge/Edit buttons and hotkeys in `features/inbox/ActionSidebar.tsx`
- [ ] T050 [US2] Implement conflict detection logic: flag sessions with mixed gains, filters, exposure times (beyond 2s margin), temperatures (beyond 5°C) in `features/inbox/conflict-detection.ts`
- [ ] T051 [US2] Create `SplitPreview.tsx` showing conflicting properties and resulting session count in `features/inbox/SplitPreview.tsx`
- [ ] T052 [US2] Create `MergeSearch.tsx` for searching/selecting merge-compatible sessions in `features/inbox/MergeSearch.tsx`
- [ ] T053 [US2] Create `ConfirmOverlay.tsx` for inbox confirmation: property summary + token pattern directory preview (integrates with spec 015 token pattern engine) in `features/inbox/ConfirmOverlay.tsx`
- [ ] T054 [US2] Implement filter dropdown with predefined categories (Narrowband: Ha/SII/OIII/NII, Broadband: L/R/G/B, Dual-band: HO/SO, Other: UV/IR Cut, Custom) in `features/inbox/FilterSelect.tsx`
- [ ] T055 [US2] Implement session naming rules: `{OBJECT} - {DATE} - {FILTER}` for lights, `{TYPE} - {DATE} - {SET-TEMP/FILTER}` for calibration in `features/inbox/session-naming.ts`
- [ ] T056 [US2] Delete old review components (DecisionPanel.tsx, EvidencePane.tsx, ReviewQueue.tsx) in `features/inbox/`

**Checkpoint**: Full inbox review workflow functional, sessions confirmable/rejectable

---

## Phase 5: User Story 3 — Project Lifecycle Workflow (Priority: P2)

**Goal**: Consolidated single-view project detail with lifecycle sidebar, 5-phase lifecycle, source map, compact pipeline stats

**Independent Test**: Create project, add sessions/calibration, generate views, mark complete, verify cleanup scan

### Implementation

- [ ] T057 [US3] Delete project tab components (CommandCenter.tsx, PipelineView.tsx, CombinedView.tsx) in `features/projects/`
- [ ] T058 [US3] Rewrite `ProjectDetail.tsx` as single consolidated view: header, pipeline stats bar, source map, source views status, notes, cleanup in `features/projects/ProjectDetail.tsx`
- [ ] T059 [US3] Create `LifecycleSidebar.tsx` with phase badge, phase-specific actions, quick stats in `features/projects/LifecycleSidebar.tsx`
- [ ] T060 [US3] Update `LifecycleStrip.tsx` to show 5 phases (remove Prepared) in `features/projects/LifecycleStrip.tsx`
- [ ] T061 [US3] Create `PipelineStatsBar.tsx` as compact single-row summary (Sources: N | Views: N | On disk: X | Outputs: N) in `features/projects/PipelineStatsBar.tsx`
- [ ] T062 [US3] Refactor `SourceMap.tsx` (keep column layout) to use lifecycle-gated add/remove actions from sidebar in `features/projects/SourceMap.tsx`
- [ ] T063 [US3] Create `SourceViewStatus.tsx` showing generated/not status, file counts, path, reveal button in `features/projects/SourceViewStatus.tsx`
- [ ] T064 [US3] Create `ProjectNotes.tsx` with inline markdown editor using @uiw/react-md-editor, create/edit/view in `features/projects/ProjectNotes.tsx`
- [ ] T065 [US3] Create `CleanupPlan.tsx` showing reviewable cleanup opportunities with per-item details in `features/projects/CleanupPlan.tsx`
- [ ] T066 [US3] Update `ProjectsList.tsx` to use standard ListSidebar component in `features/projects/ProjectsList.tsx`
- [ ] T067 [US3] Delete old project inspector (ProjectInspector.tsx, ProjectDetailPane.tsx, ArtifactsPage.tsx) in `features/projects/`

**Checkpoint**: Project lifecycle fully functional with 5 phases, single view, lifecycle sidebar

---

## Phase 6: User Story 4 — Consistent Navigation & Layout (Priority: P2)

**Goal**: App shell rewrite — 7 nav items, hybrid layout model, sidebar footer, router changes

**Independent Test**: Navigate all screens, verify consistent list controls, correct sidebar/top-bar per screen

### Implementation

- [ ] T068 [US4] Rewrite `Sidebar.tsx` with 7 nav items (Inbox, Sessions, Calibration, Targets, Projects, Archive, Settings) + sidebar footer (root health indicator) in `app/Sidebar.tsx`
- [ ] T069 [US4] Update `router.tsx`: rename `/review` to `/inbox`, remove `/plans` and `/audit` routes, add `/archive` route in `app/router.tsx`
- [ ] T070 [US4] Update `Shell.tsx` to route hybrid layout: right sidebar for Inbox/Projects, no sidebar for others in `app/Shell.tsx`
- [ ] T071 [US4] Refactor `SessionsPage.tsx` to use standard ListSidebar + TopActionBar (remove right sidebar) in `features/sessions/SessionsPage.tsx`
- [ ] T072 [US4] Rewrite `SessionDetail.tsx` as unified read-only PropertyTable, remove split columns, provenance, confirmed badges; implement project-membership check to disable "Move to Inbox" when session is used in a project in `features/sessions/SessionDetail.tsx`
- [ ] T073 [P] [US4] Create `CalendarScroll.tsx` vertical timeline view using @tanstack/react-virtual with sticky month headers in `features/sessions/CalendarScroll.tsx`
- [ ] T074 [US4] Update `CalendarView.tsx` with prominent session badges and hover tooltips in `features/sessions/CalendarView.tsx`
- [ ] T075 [US4] Refactor `CalibrationPage.tsx` to use standard ListSidebar + TopActionBar, show masters+subs grouped in `features/calibration/CalibrationPage.tsx`
- [ ] T076 [US4] Rewrite `CalibrationDetail.tsx` with highlighted Matching Fingerprint section, binary match display, 1-year aging badge in `features/calibration/CalibrationDetail.tsx`
- [ ] T077 [US4] Refactor `TargetsPage.tsx` to use standard ListSidebar + TopActionBar with 4 grouping options (type/constellation/catalog/project) in `features/targets/TargetsPage.tsx`
- [ ] T078 [US4] Update `TargetDetail.tsx`: add optical train dropdown to coverage chart, stacked project names in sessions table, remove outputs grid in `features/targets/TargetDetail.tsx`
- [ ] T079 [US4] Create `features/archive/ArchivePage.tsx` with standard ListSidebar, re-queue and delete actions, items from all sources
- [ ] T080 [US4] Create `features/archive/ArchiveList.tsx` with search/sort/group/filter controls

**Checkpoint**: All screens navigable, consistent layout model applied everywhere

---

## Phase 7: User Story 5 — Settings Reorganization (Priority: P3)

**Goal**: 11 logically grouped panes replacing 12 inconsistent panes

**Independent Test**: Navigate each Settings pane, verify controls work, data persists

### Implementation

- [ ] T081 [US5] Rewrite `SettingsPage.tsx` nav with 11 panes: Data Sources, Equipment, Ingestion, Naming & Structure, Processing Tools, Calibration Matching, Target Catalogs, Cleanup, General, Advanced, Audit Log in `features/settings/SettingsPage.tsx`
- [ ] T082 [US5] Rewrite `DataSources.tsx`: add/edit/remove/reveal table, no scan defaults, no restart wizard, no inbox text in `features/settings/DataSources.tsx`
- [ ] T083 [US5] Rewrite `Equipment.tsx`: inline-editable optical train table with dropdowns, cameras table, telescopes table (no mounts), filter library with categories in `features/settings/Equipment.tsx`
- [ ] T084 [US5] Create `Ingestion.tsx`: watcher toggle, scan on startup, rescan button, scan defaults (symlinks/junctions/hashing/metadata), grouping tolerances, default filter in `features/settings/Ingestion.tsx`
- [ ] T085 [US5] Rewrite `NamingStructure.tsx`: token insertion via dropdown, per-frame-type default patterns (lights use {object}, darks don't), live preview, no dark flat type in `features/settings/NamingStructure.tsx`
- [ ] T086 [US5] Rewrite `SourceViewStrategy.tsx`: dropdown with 4 options (junctions/symlinks/hardlinks/copy), brief descriptions, no table/matrix in `features/settings/SourceViewStrategy.tsx`
- [ ] T087 [US5] Create `ProcessingTools.tsx`: PI/Siril only, enable toggle, "Choose executable" browser, per-tool directory structure template with vendor defaults, processing/output dirs in `features/settings/ProcessingTools.tsx`
- [ ] T088 [US5] Create `CalibrationMatching.tsx`: tolerance settings (temperature 5°C, exposure 2s, aging 1yr, require same camera/gain/binning toggles) in `features/settings/CalibrationMatching.tsx`
- [ ] T089 [US5] Rewrite `Catalogs.tsx`: enable/disable toggle per catalog, Download All button, Messier/NGC-IC/Caldwell/Sharpless/Abell in `features/settings/Catalogs.tsx`
- [ ] T090 [US5] Create `Cleanup.tsx`: per-type action table (15 data types, Keep/Archive/Delete), manual vs auto-on-completion toggle, no per-tool matrix, no triggers, no source protection in `features/settings/Cleanup.tsx`
- [ ] T091 [US5] Create `General.tsx` replacing DisplayPane.tsx: theme (light/dark/system), font size, density, no guided tour in `features/settings/General.tsx`
- [ ] T092 [US5] Create `Advanced.tsx`: merge application log (from LogSettings.tsx) + database info + debug toggle + export diagnostics in `features/settings/Advanced.tsx`
- [ ] T093 [US5] Move `features/audit/` to `features/settings/AuditLog.tsx`: inline entity context, date range filter, pagination, search in `features/settings/AuditLog.tsx`
- [ ] T094 [US5] Delete obsolete settings files: Protection.tsx, CleanupPolicy.tsx, DisplayPane.tsx, LogSettings.tsx, RootRecovery.tsx, Tools.tsx in `features/settings/`
- [ ] T095 [US5] Delete obsolete feature directories: `features/audit/`, `features/plans/`, `features/tour/`

**Checkpoint**: All 11 Settings panes functional, old panes removed

---

## Phase 8: User Story 6 — Status Bar & Sidebar Footer (Priority: P3)

**Goal**: Operational status bar with inbox badge, library stats, cleanup available, storage health

**Independent Test**: Verify status bar shows correct counts, storage warnings at <10% free, sidebar footer shows root health

### Implementation

- [ ] T096 [US6] Rewrite `StatusBar.tsx`: inbox badge (clickable→Inbox), ingestion progress (when active), library stats, cleanup available, storage health per volume with warning at <10% free in `app/StatusBar.tsx`
- [ ] T097 [US6] Create status bar data hook using status.summary command in `app/useStatusSummary.ts`
- [ ] T098 [US6] Add sidebar footer to `Sidebar.tsx`: root health colored dot + offline root names, clickable→Data Sources settings in `app/Sidebar.tsx`
- [ ] T099 [US6] Remove directory path, "Idle" text, and "Last scan" timestamp from status bar
- [ ] T100 [US6] Add storage health warning threshold (10% default) to ingestion settings and wire to status bar

**Checkpoint**: Status bar and sidebar footer showing live operational data

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, consistency, and verification

- [ ] T101 [P] Delete all `.playwright-mcp/` screenshot artifacts from repo root
- [ ] T102 [P] Update mock data providers to match new component interfaces across all features
- [ ] T103 Run `just lint` and fix any formatting/clippy warnings
- [ ] T104 Run `just typecheck` and fix any TypeScript errors
- [ ] T105 Run `just test` and fix any broken tests
- [ ] T106 Update Playwright E2E scripts for new routes (/inbox, /archive, removed /plans, /audit)
- [ ] T107 [P] Update `data/preferences.ts` to add new preference keys for settings pane state
- [ ] T108 Verify all hotkeys are displayed on buttons across Inbox, Sessions, Calibration, Targets, Projects, Archive
- [ ] T109 Verify "Reveal in Explorer" action exists on all file-backed detail views (Inbox, Sessions, Calibration, Projects)

---

## Phase 10: Durable Audit Unification (Q15 / #647) — iteration 2026-07-14

**Purpose**: Every attempted mutation of durable state writes a durable
`audit_log_entry` row; the durable table is the single source of truth over
the ephemeral bus; the entry shape generalizes to a generic mutation record
(FR-130–FR-134, SC-009, spec §8.3).

- [ ] T120 Generalize the durable audit entry model in `crates/audit-types` from lifecycle-transition shape to generic mutation record (action, generic entity type beyond the lifecycle enum, first-class reason/code, optional before→after) with a compatible migration for `audit_log_entry`
- [ ] T121 Shared write-through helper: one path that writes the durable `audit_log_entry` row and emits the bus event, returning the durable `audit_id`
- [ ] T122 Settings mutations write durable audit rows with before→after (`crates/app/settings/src/lib.rs` bus-only publishes)
- [ ] T123 Protection overrides/acknowledgements write durable audit rows; returned `auditId` references the durable row (`crates/app/core/src/protection.rs`)
- [ ] T124 Equipment CRUD writes durable audit rows (`crates/app/calibration/src/equipment.rs` — currently no audit emission at all)
- [ ] T125 Source enable/disable/register/delete and rescans/root ops write durable audit rows (`crates/app/core/src/first_run.rs` bus-only publishes; Q5 delete-cascade audit lands here)
- [ ] T126 Activity/log panel reads durable audit for user-meaningful events + ephemeral bus for transient/internal noise (Q9 wiring point)
- [ ] T127 Refusal/failure coverage tests: refused and failed mutations produce durable rows with outcome + reason/code; reads/navigation/UI state produce none (FR-134)

---

## Phase 11: Missing-Value Semantics & Detail-as-Delta (Q16 / #620, #619) — iteration 2026-07-14

**Purpose**: Three distinguishable value states (real / unresolved /
not-applicable) modeled as null/None end-to-end with no numeric
zero-defaulting, rendered through one shared renderer with
presence-coupled source pills; detail panels add information over their
list rows (FR-135–FR-140, SC-010–SC-011, spec §12).

- [ ] T128 Make absence representable in contract DTOs: `CalibrationFingerprint.exposure_s`/`gain` (`crates/contracts/core/src/calibration.rs`) become `Option<f64>`; sweep other absence-capable non-optional numeric DTO fields; regenerate bindings and sweep DTO consumers
- [ ] T129 Remove zero-defaulting in the application layer: `crates/app/calibration/src/matching.rs` `unwrap_or(0.0)` on exposure/gain and `unwrap_or(0)` on size; repo-wide sweep for `unwrap_or(0`/`unwrap_or_default` collapsing absent metadata; carry `Option` through to the contract
- [ ] T130 Shared `renderValue(value, {source})` renderer + muted "unresolved" chip component: real → value + source pill; missing → unresolved chip, no source pill, never 0; n/a → blank/"—" without chip in `apps/desktop/src/components/`
- [ ] T131 `PropertyTable` adopts the shared renderer: couple source badge to value presence (no badge when value missing), distinguish not-applicable from missing in `PropertyDef` (explicit n/a marker, not null-overload) in `apps/desktop/src/components/PropertyTable.tsx`
- [ ] T132 Adopt the shared renderer across all metadata surfaces: Inbox review, Sessions detail, Calibration (incl. `MastersTable` meta lines/cells), Targets, Archive
- [ ] T133 Detail-as-delta rework: audit every detail panel against its list row; lead with new information (full metadata, provenance, related entities, history, actions); trim echoed columns to a small identifying summary; keep panels curated (FR-139, FR-140)
- [ ] T134 Tests: real 0 renders as "0" with source pill; missing numeric renders unresolved chip (never 0, no source pill); n/a renders blank/"—" without chip; contract round-trips null; each detail panel adds ≥1 non-row information class (SC-010, SC-011)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — migrations and deps first
- **Phase 2 (Foundational)**: Depends on Phase 1 — shared components + backend commands
- **Phase 3 (US1 Wizard)**: Depends on Phase 2 (uses expanded source types, tool commands)
- **Phase 4 (US2 Inbox)**: Depends on Phase 2 (uses shared components, property table)
- **Phase 5 (US3 Projects)**: Depends on Phase 2 (uses lifecycle sidebar, shared components)
- **Phase 6 (US4 Navigation)**: Depends on Phase 2 (uses ListSidebar, TopActionBar, shared components)
- **Phase 7 (US5 Settings)**: Depends on Phase 2 (uses backend settings commands)
- **Phase 8 (US6 Status Bar)**: Depends on Phase 2 (uses status.summary command)
- **Phase 9 (Polish)**: Depends on all previous phases
- **Phase 10 (Audit Unification)**: Depends only on existing audit plumbing (audit-types model, `audit_log_entry` table, event bus); independent of Phases 3–9. T120–T121 first; T122–T125 parallel after T121; T126–T127 last
- **Phase 11 (Missing-Value Semantics & Detail-as-Delta)**: Depends on shipped metadata/contract plumbing and shared components (Phase 2) only; independent of Phases 3–10. T128–T129 first (model), then T130–T131 (renderer), then T132–T133 in parallel, T134 last

### User Story Independence

- **US1 (Wizard)** and **US2 (Inbox)**: Fully independent, can run in parallel
- **US3 (Projects)** and **US4 (Navigation)**: Mostly independent; US4 touches the shell that US3 renders within, so US4's shell changes should land first or coordinate
- **US5 (Settings)** and **US6 (Status Bar)**: Fully independent, can run in parallel
- **US3-US6** can all start after Phase 2, in parallel with US1-US2

### Parallel Opportunities

Within Phase 2: T110-T111 (UI components) in parallel with T112-T113 (backend commands)

After Phase 2, three parallel tracks:
- **Track A**: US1 (Wizard) + US2 (Inbox) — core ingestion flow
- **Track B**: US3 (Projects) + US4 (Navigation) — layout overhaul
- **Track C**: US5 (Settings) + US6 (Status Bar) — configuration + status

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1: Setup (migrations)
2. Phase 2: Shared components + backend commands
3. Phase 3: Wizard (US1)
4. Phase 4: Inbox (US2)
5. **STOP and VALIDATE**: New user can complete setup and review first session

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (Wizard) → 4-step setup works
3. US2 (Inbox) → Full ingestion pipeline works
4. US3 (Projects) → Lifecycle workflow works
5. US4 (Navigation) → All screens consistent
6. US5 (Settings) → Configuration clean
7. US6 (Status Bar) → Operational visibility
8. Polish → Ship-ready

---

## Notes

- Total: 124 tasks across 11 phases (T120–T127 added by iteration
  2026-07-14, durable audit unification; T128–T134 added by iteration
  2026-07-14, missing-value semantics & detail-as-delta)
- US1 (Wizard): 9 tasks
- US2 (Inbox): 12 tasks
- US3 (Projects): 11 tasks
- US4 (Navigation): 13 tasks
- US5 (Settings): 15 tasks
- US6 (Status Bar): 5 tasks
- Setup: 9 tasks
- Foundational: 26 tasks (incl. watcher, split/merge, notes sync, cleanup scan)
- Polish: 9 tasks
- Backend tasks: ~24 (migrations + commands + services)
- Frontend tasks: ~75 (components + pages)
- [P] parallel tasks: 35+ identified
