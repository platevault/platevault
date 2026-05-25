# Tasks: Desktop Frontend Implementation

**Input**: Design documents from `/specs/027-frontend-implementation/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. User stories are ordered by dependency (shell before pages) then priority (P1 → P2 → P3).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Desktop app**: `apps/desktop/src/` (Tauri + React frontend)
- **Styles**: `apps/desktop/src/styles/`
- **Shared UI**: `apps/desktop/src/ui/`
- **Features**: `apps/desktop/src/features/<feature>/`
- **API layer**: `apps/desktop/src/api/`
- **Data layer**: `apps/desktop/src/data/`
- **App shell**: `apps/desktop/src/app/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, build tooling

- [x] T001 Create directory structure per plan.md project layout in apps/desktop/src/ (app/, api/, data/, styles/, ui/, features/)
- [x] T002 Initialize apps/desktop/package.json with dependencies: react 19, @base-ui-components/react, @tanstack/react-router, @tanstack/react-table, cmdk, react-resizable-panels, lucide-react, react-joyride, @tauri-apps/api v2, clsx
- [x] T003 [P] Configure apps/desktop/vite.config.ts with React plugin, path aliases, and USE_MOCKS env flag
- [x] T004 [P] Configure apps/desktop/tsconfig.json with strict mode, path aliases, React 19 JSX transform
- [x] T005 [P] Configure apps/desktop/vitest.config.ts with jsdom environment and path aliases
- [x] T006 Create apps/desktop/index.html entry point with root div and font preloads (Inter, JetBrains Mono)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Design tokens, API layer, data layer, router, and all shared primitives that multiple user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Styles & Tokens

- [x] T007 Create apps/desktop/src/styles/reset.css with base reset (box-sizing, margin, font-family inheritance)
- [x] T008 Create apps/desktop/src/styles/tokens.css with full design token set from DESIGN.md §3: colors (grayscale palette, semantic), typography (Inter 11.5-22px, JetBrains Mono), spacing (4/6/8/10/12/14/16/18px), density vars (--alm-density, --alm-row-height: 24/32/40px, --alm-cell-padding), radii, shadows, z-indices
- [x] T009 Create apps/desktop/src/styles/components.css with shared alm-* class utilities (alm-pill, alm-btn, alm-kv, etc.)

### API Layer

- [x] T010 [P] Create apps/desktop/src/api/types.ts with all DTO types from contracts/tauri-commands.md: Session, CalibrationMaster, Target, Project, FilesystemPlan, PlanItem, AuditEntry, MetaValue, AppPreferences, OperationHandle, ProgressEvent, SearchResult, ReviewItem, and all enumerations (SessionState, ProjectState, PlanState, ConfidenceLevel, ProvenanceOrigin, ViewMode, PlanKind)
- [x] T011 [P] Create apps/desktop/src/api/commands.ts with typed Tauri invoke wrappers for all 20 query + 11 mutation commands from contracts, with USE_MOCKS conditional routing
- [x] T012 Create apps/desktop/src/api/mocks.ts with mock implementations for all commands returning fixture data, respecting the same response shapes as real backend

### Data Layer

- [x] T013 [P] Create apps/desktop/src/data/store.ts with useSyncExternalStore-based pub/sub for command response caching and event-driven invalidation
- [x] T014 [P] Create apps/desktop/src/data/preferences.ts with localStorage-backed AppPreferences (sidebarCollapsed, density, projectViewModes, defaultProjectView, sessionsGroupBy, sessionsView, tourCompleted, setupCompleted)
- [x] T015 Create apps/desktop/src/data/fixtures/ with static mock data: sessions.ts (10 sessions with varied states/confidence), calibration.ts (masters by kind), targets.ts (5 targets with coverage), projects.ts (3 projects with varied lifecycle), plans.ts (plans with mixed destructiveness), audit.ts (20 events), equipment.ts, settings.ts

### Entry & Router

- [x] T016 Create apps/desktop/src/app/router.tsx with TanStack Router config (hash mode), route tree for all 16 pages, layout routes for shell wrapper
- [x] T017 Create apps/desktop/src/main.tsx entry point importing tokens.css + reset.css, mounting RouterProvider with density class on root

### Shared Primitives (ui/)

- [x] T018 [P] Create apps/desktop/src/ui/Pill.tsx with 6 variants (neutral/ghost/ok/warn/danger/info), density-aware sizing
- [x] T019 [P] Create apps/desktop/src/ui/Confidence.tsx with horizontal bar + label for 6 levels (unknown/low/medium/high/confirmed/rejected)
- [x] T020 [P] Create apps/desktop/src/ui/Provenance.tsx rendering provenance glyphs (●reviewed/◐inferred/○observed/◇generated/▢planned/▣applied) with tooltip labels
- [x] T021 [P] Create apps/desktop/src/ui/Lock.tsx rendering 🔒 glyph with optional protection reason tooltip
- [x] T022 [P] Create apps/desktop/src/ui/KV.tsx key-value row with inline provenance glyph + confidence indicator
- [x] T023 [P] Create apps/desktop/src/ui/Box.tsx bordered card container with optional heading
- [x] T024 [P] Create apps/desktop/src/ui/Section.tsx titled content block with collapse support
- [x] T025 [P] Create apps/desktop/src/ui/Btn.tsx button with primary/danger/small/active variants, density-aware
- [x] T026 [P] Create apps/desktop/src/ui/DirPicker.tsx native OS directory picker: folder icon + read-only path + "Choose folder…" button invoking Tauri dialog.open({ directory: true })
- [x] T027 [P] Create apps/desktop/src/ui/FilterBar.tsx chip-based filter display with add/remove/clear actions
- [x] T028 [P] Create apps/desktop/src/ui/Toolbar.tsx thin horizontal bar with optional sub-bar, density-aware
- [x] T029 Create apps/desktop/src/ui/DataTable.tsx TanStack Table wrapper with sortable columns, row selection (checkbox + shift-click range), group-by rendering, density-aware row heights, virtual scrolling for 250+ rows
- [x] T030 Create apps/desktop/src/ui/ThreePane.tsx three-pane layout container using react-resizable-panels: list pane (220px default) + content pane (flex) + detail pane (320px default), with min/max constraints
- [x] T031 Create apps/desktop/src/ui/WizardShell.tsx step rail (top, with current/completed/future indicators) + content area + persistent right-rail summary panel
- [x] T032 Create apps/desktop/src/ui/index.ts barrel export for all shared primitives

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 2 — App Shell and Navigation (Priority: P1)

**Goal**: Desktop frame with collapsible sidebar, status bar, log panel, and command palette — the container for all pages.

**Independent Test**: Sidebar renders all 8 nav items, collapse/expand persists in localStorage, status bar shows idle state, Cmd+K opens command palette, log panel expands/collapses.

### Implementation

- [x] T033 [US2] Create apps/desktop/src/app/Shell.tsx AppFrame layout: title bar (28px) + sidebar slot + main content (RouterOutlet) + status bar (22px), reading density from preferences
- [x] T034 [US2] Create apps/desktop/src/app/Sidebar.tsx collapsible navigation rail: expanded (184px) with labels/badges, collapsed (44px) with single-letter glyphs. Items: Review queue, Sessions, Calibration, Targets, Projects, Plans, Audit log, Settings. Badge counts from store. Collapse state persisted via preferences.
- [x] T035 [US2] Create apps/desktop/src/app/StatusBar.tsx thin bar showing current app state (Idle/scanning/applying), click-to-expand trigger for LogPanel
- [x] T036 [US2] Create apps/desktop/src/app/LogPanel.tsx expandable panel showing active operations with progress bars, recent events, warnings. Subscribes to Tauri ProgressEvent via event.listen()
- [x] T037 [US2] Create apps/desktop/src/app/CommandPalette.tsx using cmdk: Cmd+K/Ctrl+K trigger, search sessions/targets/projects by name, page navigation, common actions (new project, start scan). 200ms response target.

**Checkpoint**: App shell renders with sidebar navigation, status bar, and command palette functional

---

## Phase 4: User Story 1 — Navigate and Browse Sessions (Priority: P1) 🎯 MVP

**Goal**: Sessions page as the primary landing surface with sortable table, group-by modes, calendar view, and session detail with full provenance display.

**Independent Test**: Table renders 10 mock sessions with all columns, group-by changes visual grouping without navigation, calendar shows sessions on correct nights, session detail displays metadata with provenance glyphs.

### Implementation

- [x] T038 [US1] Create apps/desktop/src/features/sessions/SessionsPage.tsx: sortable DataTable with columns (warning glyph, target, filter, night, frames, integration, optical train, state pill, confidence bar, projects pills), toolbar with bulk actions (Confirm/Split/Merge/Use in project), group-by chip row, calendar toggle
- [x] T039 [US1] Create apps/desktop/src/features/sessions/GroupByBar.tsx chip row for 4 group-by modes (target/month/filter/optical train), active chip filled, triggers DataTable re-grouping without navigation
- [x] T040 [US1] Create apps/desktop/src/features/sessions/CalendarView.tsx 3-month calendar grid showing session cards on night cells, click-day filters list to that night, empty cells show gaps
- [x] T041 [US1] Create apps/desktop/src/features/sessions/SessionDetail.tsx tabbed content (Overview/Framesets/Calibration matches/Linked projects/History): KV rows with provenance glyphs, confidence indicators, provenance summary tile (reviewed/inferred/observed/missing counts), read-only after confirmation with "Re-open to review" action
- [x] T042 [US1] Wire sessions route in router.tsx: /sessions as default landing, /sessions/:id for detail, integrate SessionsPage with Shell layout

**Checkpoint**: Sessions MVP — user can browse, group, filter, and drill into session detail

---

## Phase 5: User Story 3 — Review Sessions and Unclassified Files (Priority: P1)

**Goal**: Three-pane review queue with keyboard-driven workflow for confirming/rejecting sessions and reviewing unclassified files.

**Independent Test**: Three-pane renders with queue items sorted by confidence ascending, J/K navigates, Cmd+1/2/3 triggers confirm/reject/skip, blocking-reason banner shows for incomplete provenance, filter toggles between sessions/all/unclassified.

### Implementation

- [x] T043 [US3] Create apps/desktop/src/features/review/ReviewPage.tsx three-pane layout (ThreePane): queue list (left 220px), evidence pane (center flex), decision panel (right 320px). Register keyboard shortcuts (Cmd+1/2/3, J/K).
- [x] T044 [US3] Create apps/desktop/src/features/review/ReviewQueue.tsx left-pane queue list sorted by confidence ascending, filter tabs (Sessions only / All items / Unclassified files), active item highlight, auto-advance after decision
- [x] T045 [US3] Create apps/desktop/src/features/review/EvidencePane.tsx center pane showing focused session evidence: metadata with provenance, why it needs review, yellow blocking-reason banner when missing reviewed fields
- [x] T046 [US3] Create apps/desktop/src/features/review/DecisionPanel.tsx right pane with Confirm/Reject/Skip buttons (Confirm disabled when blocking reasons exist), keyboard shortcut hints, decision history for current item
- [x] T047 [US3] Wire review route in router.tsx: /review, integrate with Shell layout

**Checkpoint**: Review workflow — keyboard-driven session confirmation at speed

---

## Phase 6: User Story 4 — Create and Manage Projects (Priority: P2)

**Goal**: Project list with lifecycle pills, project detail with 3-way view toggle, and 6-step creation wizard with plan review.

**Independent Test**: Wizard completes all 6 steps with mock data, plan review shows filesystem operations, project detail renders all 3 view modes (Command center/Pipeline/Combined).

### Implementation

- [x] T048 [US4] Create apps/desktop/src/features/projects/ProjectsPage.tsx: DataTable with columns (name, lifecycle pill, verification, integration hours, on-disk size, cleanup eligibility, last updated, workflow profile), "+ New project" button, footer aggregates (total integration, size, cleanup-eligible). Blocked projects visible with ⚠ + reason.
- [x] T049 [US4] Create apps/desktop/src/features/projects/ProjectDetail.tsx: 3-way view toggle (Command center/Pipeline/Combined) in header, persisted per-project via preferences with global fallback default
- [x] T050 [P] [US4] Create apps/desktop/src/features/projects/CommandCenter.tsx: source map kit grid (4 columns: Lights/Darks/Flats/Bias) with cards for each session or master
- [x] T051 [P] [US4] Create apps/desktop/src/features/projects/PipelineView.tsx: horizontal flow (Sources → Source views → Processing → Outputs) with state pills per stage
- [x] T052 [US4] Create apps/desktop/src/features/projects/CombinedView.tsx: compact kit grid on top with "feeds into" connector, pipeline strip below, lifecycle/cleanup/manifests row
- [x] T053 [US4] Create apps/desktop/src/features/projects/wizard/WizardPage.tsx: 6-step orchestrator using WizardShell, step state management, draft persistence (resume from projects list), right-rail summary (selected counts, estimated footprint, coming-up list)
- [x] T054 [P] [US4] Create apps/desktop/src/features/projects/wizard/StepName.tsx: project name input + workflow profile selection (PixInsight/Siril/Planetary)
- [x] T055 [P] [US4] Create apps/desktop/src/features/projects/wizard/StepSources.tsx: light session selection with filter/target grouping, multi-select with integration totals
- [x] T056 [US4] Create apps/desktop/src/features/projects/wizard/StepCalibration.tsx: per-filter flat mapping (each light filter → own master flat), shared darks/bias/dark-flats below, inline scores and soft mismatch indicators
- [x] T057 [US4] Create apps/desktop/src/features/projects/wizard/StepViews.tsx: settings default strategy as prominent chip with reasoning, "Use different strategy" disclosure expanding to strategy radio table
- [x] T058 [US4] Create apps/desktop/src/features/projects/wizard/StepLayout.tsx: naming pattern preview using plan.md token builder concepts, directory structure preview
- [x] T059 [US4] Create apps/desktop/src/features/projects/wizard/StepReview.tsx: complete filesystem plan table with 3-tier approval gate (reuses ApprovalGate from US5), safety banner, "Approve & create" button
- [x] T060 [P] [US4] Create apps/desktop/src/features/projects/ArtifactsPage.tsx: per-project artifacts view with outputs section first (filename, kind, size, date, verification pill, lock, "Verify…" action), then artifacts grouped by type (registered/calibrated/drizzle/logs) with counts and total sizes. "Observed, not owned" banner (FR-053) at top.
- [x] T061 [US4] Wire projects routes in router.tsx: /projects, /projects/:id, /projects/:id/artifacts, /projects/new (wizard)

**Checkpoint**: Project creation end-to-end — wizard produces reviewable plan, detail shows all views

---

## Phase 7: User Story 5 — Review and Approve Filesystem Plans (Priority: P2)

**Goal**: Dedicated plan review page with Table/Diff views and 3-tier approval system.

**Independent Test**: Table view shows operations with status pills and dry-run results, Diff view shows before/after with glyphs, approval gates match plan destructiveness level, disabled approve when dry-run fails.

### Implementation

- [x] T062 [US5] Create apps/desktop/src/features/plans/PlansPage.tsx: DataTable listing plans with state pills, kind, item count, reclaim bytes, created date
- [x] T063 [US5] Create apps/desktop/src/features/plans/PlanReview.tsx: header with Table/Diff pill toggle, summary bar (item count, reclaim bytes, trash/archive/delete/protected counts), ApprovalGate at bottom
- [x] T064 [P] [US5] Create apps/desktop/src/features/plans/PlanTable.tsx: per-row action pill, source, destination, status pill (pending/protected/applied/failed/skipped), dry-run result (✓/✕), provenance origin
- [x] T065 [P] [US5] Create apps/desktop/src/features/plans/PlanDiff.tsx: two-column before/after filesystem view with glyphs (− removed red, + added green, → archived yellow, ✕ deleted red, 🔒 protected grey)
- [x] T066 [US5] Create apps/desktop/src/features/plans/ApprovalGate.tsx: 3-tier approval logic — (1) simple Approve for non-destructive, (2) Approve + confirmation dialog for trash/archive, (3) Approve + "I understand and accept" checkbox for permanent delete. Disabled when any dry-run fails with explanation text.
- [x] T067 [US5] Wire plans routes in router.tsx: /plans, /plans/:id

**Checkpoint**: Plan safety gate — all filesystem mutations go through reviewable approval

---

## Phase 8: User Story 6 — Browse Targets with Coverage (Priority: P2)

**Goal**: Three-pane targets page with coverage-at-a-glance bars and "New project" shortcut.

**Independent Test**: Three-pane renders targets with session count badges, coverage bars show per-filter hours with ⚠ below threshold, "New project →" opens wizard with target context.

### Implementation

- [x] T068 [US6] Create apps/desktop/src/features/targets/TargetsPage.tsx: ThreePane layout with TargetList (left) and TargetDetail (right)
- [x] T069 [P] [US6] Create apps/desktop/src/features/targets/TargetList.tsx: target list with name, session count badge, integration badge, kind indicator, search/filter
- [x] T070 [US6] Create apps/desktop/src/features/targets/TargetDetail.tsx: coverage-at-a-glance (CoverageChart), linked sessions table, linked projects with lifecycle pills, "New project →" button pre-filling wizard target context
- [x] T071 [US6] Create apps/desktop/src/features/targets/CoverageChart.tsx: horizontal bars per filter showing accumulated hours, ⚠ warning when below recommended thresholds, visual scale reference
- [x] T072 [US6] Wire targets route in router.tsx: /targets, /targets/:id

**Checkpoint**: Target planning — "do I have enough Ha yet?" answered at a glance

---

## Phase 9: User Story 7 — Configure Settings (Priority: P3)

**Goal**: Settings with left-rail navigation across 10 configuration panes, auto-save, and specialized editors (token builder, policy matrix).

**Independent Test**: Each pane renders, DirPickers invoke native dialog, token builder produces preview, cleanup matrix reflects per-tool actions.

### Implementation

- [x] T073 [US7] Create apps/desktop/src/features/settings/SettingsPage.tsx: left-rail category sidebar (10 items) + right content pane, auto-save with lightweight status indicator
- [x] T074 [P] [US7] Create apps/desktop/src/features/settings/DataSources.tsx: roots table with DirPickers, category pills, online/offline state, file counts, scan action buttons
- [x] T075 [US7] Create apps/desktop/src/features/settings/NamingStructure.tsx: token + separator drag builder with draggable token chips (blue, monospace) and separator chips (grey, editable), 3 live preview examples using recent metadata, per-frame-type override toggles (lights/darks/flats/bias)
- [x] T076 [P] [US7] Create apps/desktop/src/features/settings/SourceViewStrategy.tsx: radio table with per-platform reasoning, strategy descriptions
- [x] T077 [US7] Create apps/desktop/src/features/settings/CleanupPolicy.tsx: processing directory DirPickers (default "processing/"), per-tool matrix (rows = data types, columns = PI/Siril/Planetary) with per-cell action dropdowns
- [x] T078 [US7] Create apps/desktop/src/features/settings/RootRecovery.tsx: centered workflow with original mount info, DirPicker for new path, mandatory 4-sample verification display, "what will change" list before apply
- [x] T079 [P] [US7] Create apps/desktop/src/features/settings/Equipment.tsx: auto-detected equipment from metadata with editable aliases, named optical train configurations
- [x] T080 [P] [US7] Create apps/desktop/src/features/settings/Tools.tsx: workflow tool configuration (PixInsight/Siril/Planetary paths and settings)
- [x] T081 [P] [US7] Create apps/desktop/src/features/settings/LogSettings.tsx: log level, retention, export settings
- [x] T082 [P] [US7] Create apps/desktop/src/features/settings/Catalogs.tsx: catalog sources and sync configuration
- [x] T083 [P] [US7] Create apps/desktop/src/features/settings/Protection.tsx: protection defaults for categories, file types, age thresholds
- [x] T084 [US7] Wire settings route in router.tsx: /settings, /settings/:pane

**Checkpoint**: All configuration surfaces functional with auto-save

---

## Phase 10: User Story 8 — First-Run Onboarding and Guided Tour (Priority: P3)

**Goal**: 4-step setup wizard for first launch, followed by 3-step guided tour anchored to real UI elements.

**Independent Test**: First-run state (no roots) triggers wizard, all 4 steps complete, tour hints appear at correct anchors after initial scan, hints are dismissible, tour state tracks completion.

### Implementation

- [x] T085 [US8] Create apps/desktop/src/features/setup/SetupWizard.tsx: centered single-column (max 720px) 4-step wizard using WizardShell — Welcome → Sources (DirPickers with category labels: Raw/Calibration/Project/Inbox + estimated file counts) → Scan settings → Confirm. Persist progress for resume. One-time only.
- [x] T086 [US8] Create apps/desktop/src/features/setup/steps/ with individual step components (StepWelcome.tsx, StepSources.tsx, StepScan.tsx, StepConfirm.tsx)
- [x] T087 [US8] Create apps/desktop/src/features/tour/TourProvider.tsx: react-joyride v3 wrapper with 3 step definitions — (1) confirm first session (anchors to first confirmable row), (2) create first project (anchors to "+ New project"), (3) open in processing tool. Dismissible, completion tracked in preferences, settings toggle for restart.
- [x] T088 [US8] Wire setup/tour routing: conditional redirect to /setup when setupCompleted=false, tour provider wrapping Shell after setup completion

**Checkpoint**: New user experience — zero to browsing in under 2 minutes

---

## Phase 11: User Story 9 — Calibration Masters Management (Priority: P3)

**Goal**: Three-pane calibration page with masters grouped by kind, fingerprint details, aging warnings, and compatible sessions.

**Independent Test**: Three-pane renders masters grouped by kind, fingerprint card shows all fields with provenance, aging ⚠ appears for >90 day masters, compatible sessions table shows scores.

### Implementation

- [x] T089 [US9] Create apps/desktop/src/features/calibration/CalibrationPage.tsx: ThreePane layout with MastersList (left) and MasterDetail (right)
- [x] T090 [P] [US9] Create apps/desktop/src/features/calibration/MastersList.tsx: masters grouped by kind (darks/flats/bias), age badge per master (e.g., "23d", "180d ⚠"), selection highlighting
- [x] T091 [US9] Create apps/desktop/src/features/calibration/MasterDetail.tsx: fingerprint KV card (camera/sensor/exposure/temp/gain/binning with provenance glyphs), provenance card (source session, tool, date, age), usage card (session count, project count), compatible sessions table with match scores and soft mismatches
- [x] T092 [US9] Wire calibration route in router.tsx: /calibration, /calibration/:id

**Checkpoint**: Calibration management — fingerprints, aging, and usage visible

---

## Phase 12: User Story 10 — Audit Log and History (Priority: P3)

**Goal**: Immutable audit log with filtering, dot-notation event names, outcome pills, and JSONL export.

**Independent Test**: Events render with correct columns (timestamp mono, dot-notation event, entity, from→to, actor, outcome pill), refused transitions show as first-class rows, filters work, export produces valid JSONL.

### Implementation

- [x] T093 [US10] Create apps/desktop/src/features/audit/AuditPage.tsx: DataTable with columns (monospace timestamp, dot-notation event type, entity, state change from→to, actor user/system, outcome pill: applied/ok/refused/failed/paused, detail). FilterBar for event type, outcome, actor, date range. "Export JSONL" button producing one event per line download.
- [x] T094 [US10] Wire audit route in router.tsx: /audit

**Checkpoint**: Audit trail — trust through transparency

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T095 [P] Density integration test: verify all DataTable, Toolbar, Sidebar, and KV components respond correctly to compact/comfortable/spacious preference changes in apps/desktop/src/
- [x] T096 [P] Keyboard accessibility pass: verify all interactive elements are reachable via Tab, Escape closes modals/palettes, focus management on route transitions
- [x] T097 [P] Empty state components: add "All caught up" for empty review queue, "No results for [query]" for command palette, empty states for pages with no data
- [x] T098 Performance validation: verify <100ms route transitions, <200ms command palette response, smooth 60fps scroll on 250+ row sessions table with virtual scrolling
- [x] T099 Run quickstart.md milestone validation scenarios (M1-M4) end-to-end in browser

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US2 Shell (Phase 3)**: Depends on Foundational — BLOCKS all page stories
- **US1 Sessions (Phase 4)**: Depends on US2 (shell to render in) + DataTable, GroupByBar
- **US3 Review (Phase 5)**: Depends on US2 + ThreePane primitive
- **US4 Projects (Phase 6)**: Depends on US2 + WizardShell + ApprovalGate from US5
- **US5 Plans (Phase 7)**: Depends on US2 + DataTable
- **US6 Targets (Phase 8)**: Depends on US2 + ThreePane
- **US7 Settings (Phase 9)**: Depends on US2 + DirPicker
- **US8 First-Run + Tour (Phase 10)**: Depends on ALL pages existing (tour anchors to real elements)
- **US9 Calibration (Phase 11)**: Depends on US2 + ThreePane
- **US10 Audit (Phase 12)**: Depends on US2 + DataTable + FilterBar
- **Polish (Phase 13)**: Depends on all user stories being complete

### User Story Dependencies

- **US2 (Shell, P1)**: Can start after Foundational — no story dependencies
- **US1 (Sessions, P1)**: Depends on US2 (needs shell)
- **US3 (Review, P1)**: Depends on US2 — independent of US1
- **US4 (Projects, P2)**: Depends on US5 (wizard step 6 uses ApprovalGate)
- **US5 (Plans, P2)**: Depends on US2 — independent of P1 stories
- **US6 (Targets, P2)**: Depends on US2 — independent of other P2 stories
- **US7 (Settings, P3)**: Depends on US2 — independent
- **US8 (First-Run, P3)**: Depends on ALL other stories (tour anchors)
- **US9 (Calibration, P3)**: Depends on US2 — independent
- **US10 (Audit, P3)**: Depends on US2 — independent

### Critical Path

```
Setup → Foundational → US2 (Shell) → US1 (Sessions) → US8 (Tour)
                                    → US5 (Plans) → US4 (Projects) → US8 (Tour)
                                    → US3/US6/US7/US9/US10 → US8 (Tour)
```

### Parallel Opportunities

**After Foundational completes:**
- US2 can start immediately (only story with no page dependency)

**After US2 (Shell) completes:**
- US1, US3, US5, US6, US7, US9, US10 can ALL start in parallel (independent pages)

**After US5 (Plans) completes:**
- US4 can start (needs ApprovalGate)

**After ALL stories complete:**
- US8 (Tour) and Phase 13 (Polish) can start

---

## Parallel Example: After Shell

```bash
# These 7 user stories can launch in parallel once Shell is done:
Agent A: US1 — Sessions (T038-T042)
Agent B: US3 — Review Queue (T043-T047)
Agent C: US5 — Plans (T062-T067)
Agent D: US6 — Targets (T068-T072)
Agent E: US7 — Settings (T073-T084)
Agent F: US9 — Calibration (T089-T092)
Agent G: US10 — Audit (T093-T094)
```

---

## Implementation Strategy

### MVP First (US2 + US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US2 — App Shell
4. Complete Phase 4: US1 — Sessions
5. **STOP and VALIDATE**: App launches, sessions browsable, shell functional
6. Matches Milestone 1 from plan.md

### Incremental Delivery (Milestones)

1. **M1**: Setup + Foundational + US2 + US1 → Shell + Sessions working
2. **M2**: US5 + US4 + US6 → Plans + Projects + Targets working
3. **M3**: US9 + US7 + US10 → Calibration + Settings + Audit working
4. **M4**: US3 + US8 → Review Queue + First-Run + Tour working
5. **Polish**: Phase 13 cross-cutting validation

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 99 |
| Setup tasks | 6 |
| Foundational tasks | 26 |
| User story tasks | 62 |
| Polish tasks | 5 |
| Parallelizable tasks (marked [P]) | 39 |
| User stories | 10 |
| Critical path length | Setup(6) → Foundation(26) → Shell(5) → Sessions(5) → Tour(4) = 46 sequential |
| Max parallel width | 7 stories after Shell |

---

## Notes

- No test tasks generated (not explicitly requested in spec)
- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Commit after each task or logical group
- All DirPicker implementations MUST use native OS dialog — never text inputs
- All density-sensitive components MUST respect --alm-density custom property
- Mock data in fixtures/ must cover all states (happy path + edge cases like offline roots, blocked projects, refused transitions)
