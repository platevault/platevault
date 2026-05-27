# Agent Assignments
# Feature: 030-ui-audit-revision (UI Audit & Revision)
# Generated: 2026-05-26
# Command: /speckit.agent-assign.assign

agents_scanned:
  - name: "rust-pro"
    source: "project"
    description: "Master Rust 1.75+ with modern async patterns and production-ready systems programming"
  - name: "frontend-developer"
    source: "project"
    description: "Build React components, implement responsive layouts, and handle client-side state management"
  - name: "database-architect"
    source: "project"
    description: "Expert database architect specializing in data layer design, schema modeling, and migrations"
  - name: "coder"
    source: "project"
    description: "Implementation subagent for bounded code changes, tests, refactors, and migrations"
  - name: "speckit-implement-task"
    source: "project"
    description: "Implements non-code or tightly scoped tasks from a SpecKit tasks.md"
  - name: "typescript-pro"
    source: "project"
    description: "Master TypeScript with advanced types, generics, and strict type safety"

assignments:
  # Phase 1: Setup
  T001:
    agent: "coder"
    reason: "Simple directory creation task"
  T002:
    agent: "coder"
    reason: "Dependency addition to package.json"
  T003:
    agent: "coder"
    reason: "Dependency addition to package.json"
  T004:
    agent: "rust-pro"
    reason: "SQLite migration for equipment tables with seed data — needs Rust/SQL expertise"
  T005:
    agent: "rust-pro"
    reason: "SQLite migration for cleanup policy and calibration tolerances"
  T006:
    agent: "rust-pro"
    reason: "SQLite migration for ingestion settings"
  T007:
    agent: "rust-pro"
    reason: "SQLite migration for enum expansion with data migration"
  T008:
    agent: "rust-pro"
    reason: "SQLite migration with row-level data migration (prepared → processing)"
  T009:
    agent: "rust-pro"
    reason: "SQLite migration for enum simplification"

  # Phase 2: Foundational — Shared UI Components
  T010:
    agent: "frontend-developer"
    reason: "Complex shared React component (ListSidebar) with search/group/sort/filter"
  T011:
    agent: "frontend-developer"
    reason: "React component (FilterBar) with interactive controls"
  T012:
    agent: "frontend-developer"
    reason: "React component (TopActionBar) with hotkey display"
  T013:
    agent: "frontend-developer"
    reason: "Complex React component (PropertyTable) with editable/read-only modes"
  T014:
    agent: "frontend-developer"
    reason: "React component (ConfirmOverlay) with modal confirmation"

  # Phase 2: Backend — Equipment CRUD
  T015:
    agent: "rust-pro"
    reason: "Rust DTOs with serde + specta derives for equipment entities"
  T016:
    agent: "rust-pro"
    reason: "Rust repository layer with SQLite CRUD and alias-based lookup"
  T017:
    agent: "rust-pro"
    reason: "Rust use-case orchestration for equipment"
  T018:
    agent: "rust-pro"
    reason: "Tauri command registration with specta rename pattern"

  # Phase 2: Backend — Settings & Status
  T019:
    agent: "rust-pro"
    reason: "Rust DTOs + repository for cleanup policy"
  T020:
    agent: "rust-pro"
    reason: "Rust DTOs + repository for calibration tolerances"
  T021:
    agent: "rust-pro"
    reason: "Rust DTOs + repository for ingestion settings"
  T022:
    agent: "rust-pro"
    reason: "Rust DTO + aggregation query spanning multiple tables"
  T023:
    agent: "rust-pro"
    reason: "Tauri command for status summary"
  T024:
    agent: "rust-pro"
    reason: "Tauri commands for cleanup policy CRUD"
  T025:
    agent: "rust-pro"
    reason: "Tauri commands for calibration tolerances CRUD"
  T026:
    agent: "rust-pro"
    reason: "Tauri commands for ingestion settings CRUD"
  T027:
    agent: "rust-pro"
    reason: "Cross-layer enum expansion (contracts + repository + use case)"
  T028:
    agent: "rust-pro"
    reason: "Tauri commands for processing tools management"

  # Phase 2: Backend — Inbox Watcher & Session Operations
  T029:
    agent: "rust-pro"
    reason: "notify crate filesystem watcher integration with Tauri event system"
  T030:
    agent: "rust-pro"
    reason: "Tauri command for on-demand inbox scan"
  T031:
    agent: "rust-pro"
    reason: "Complex Rust use-case: session split with atomic file reassignment"
  T032:
    agent: "rust-pro"
    reason: "Rust use-case: session merge with compatibility validation"

  # Phase 2: Backend — Project Support
  T033:
    agent: "rust-pro"
    reason: "Rust service for DB→disk notes sync with file I/O"
  T034:
    agent: "rust-pro"
    reason: "Rust aggregation service for cleanup scan with reviewable plan output"

  # Phase 2: Bindings
  T035:
    agent: "coder"
    reason: "TypeScript binding regeneration — mechanical build step"

  # Phase 3: US1 — First-Run Setup
  T036:
    agent: "coder"
    reason: "File deletion task — remove old wizard components"
  T037:
    agent: "frontend-developer"
    reason: "Major React component rewrite (SetupWizard 4-step flow)"
  T038:
    agent: "frontend-developer"
    reason: "Complex React component (StepSourceFolders) with OS picker, validation"
  T039:
    agent: "frontend-developer"
    reason: "Zustand/state store rewrite for 6 source types"
  T040:
    agent: "frontend-developer"
    reason: "React component (StepTools) with file browser, path validation"
  T041:
    agent: "frontend-developer"
    reason: "React component (StepCatalogs) with toggles and download"
  T042:
    agent: "frontend-developer"
    reason: "React component (StepConfirm) with summary and blocked-finish logic"
  T043:
    agent: "frontend-developer"
    reason: "SetupPage update — minor React changes"
  T044:
    agent: "frontend-developer"
    reason: "Vitest test rewrite for new wizard flow"

  # Phase 4: US2 — Inbox Session Review
  T045:
    agent: "coder"
    reason: "Directory rename + import updates — mechanical refactor"
  T046:
    agent: "frontend-developer"
    reason: "New React page component (InboxPage)"
  T047:
    agent: "frontend-developer"
    reason: "React component using ListSidebar for inbox list"
  T048:
    agent: "frontend-developer"
    reason: "Complex React component (SessionReview) with PropertyTable integration"
  T049:
    agent: "frontend-developer"
    reason: "React component (ActionSidebar) with hotkey buttons"
  T050:
    agent: "typescript-pro"
    reason: "Pure TypeScript logic — conflict detection with numeric thresholds"
  T051:
    agent: "frontend-developer"
    reason: "React component (SplitPreview) with conflict visualization"
  T052:
    agent: "frontend-developer"
    reason: "React component (MergeSearch) with search/select"
  T053:
    agent: "frontend-developer"
    reason: "React component (ConfirmOverlay) with token pattern preview integration"
  T054:
    agent: "frontend-developer"
    reason: "React component (FilterSelect) with predefined categories"
  T055:
    agent: "typescript-pro"
    reason: "Pure TypeScript logic — session naming rules per frame type"
  T056:
    agent: "coder"
    reason: "File deletion task — remove old review components"

  # Phase 5: US3 — Project Lifecycle
  T057:
    agent: "coder"
    reason: "File deletion task — remove old project tab components"
  T058:
    agent: "frontend-developer"
    reason: "Major React rewrite (ProjectDetail consolidated view)"
  T059:
    agent: "frontend-developer"
    reason: "Complex React component (LifecycleSidebar) with phase logic"
  T060:
    agent: "frontend-developer"
    reason: "React component update (LifecycleStrip 5 phases)"
  T061:
    agent: "frontend-developer"
    reason: "React component (PipelineStatsBar)"
  T062:
    agent: "frontend-developer"
    reason: "React refactor (SourceMap) with lifecycle-gated actions"
  T063:
    agent: "frontend-developer"
    reason: "React component (SourceViewStatus) with reveal button"
  T064:
    agent: "frontend-developer"
    reason: "React component (ProjectNotes) with markdown editor integration"
  T065:
    agent: "frontend-developer"
    reason: "React component (CleanupPlan) with reviewable plan display"
  T066:
    agent: "frontend-developer"
    reason: "React refactor to use shared ListSidebar"
  T067:
    agent: "coder"
    reason: "File deletion task — remove old project inspector"

  # Phase 6: US4 — Navigation & Layout
  T068:
    agent: "frontend-developer"
    reason: "Major React rewrite (Sidebar) with 7 nav items + footer"
  T069:
    agent: "frontend-developer"
    reason: "Router configuration update — route changes"
  T070:
    agent: "frontend-developer"
    reason: "Shell layout update for hybrid layout model"
  T071:
    agent: "frontend-developer"
    reason: "React refactor (SessionsPage) with shared components"
  T072:
    agent: "frontend-developer"
    reason: "React rewrite (SessionDetail) as read-only PropertyTable"
  T073:
    agent: "frontend-developer"
    reason: "Complex React component (CalendarScroll) with virtualization"
  T074:
    agent: "frontend-developer"
    reason: "React update (CalendarView) with session badges"
  T075:
    agent: "frontend-developer"
    reason: "React refactor (CalibrationPage) with shared components"
  T076:
    agent: "frontend-developer"
    reason: "React rewrite (CalibrationDetail) with matching fingerprint"
  T077:
    agent: "frontend-developer"
    reason: "React refactor (TargetsPage) with shared components"
  T078:
    agent: "frontend-developer"
    reason: "React update (TargetDetail) with optical train dropdown"
  T079:
    agent: "frontend-developer"
    reason: "New React page (ArchivePage) with ListSidebar"
  T080:
    agent: "frontend-developer"
    reason: "New React component (ArchiveList) with controls"

  # Phase 7: US5 — Settings
  T081:
    agent: "frontend-developer"
    reason: "Major React rewrite (SettingsPage) with 11 panes"
  T082:
    agent: "frontend-developer"
    reason: "React rewrite (DataSources settings pane)"
  T083:
    agent: "frontend-developer"
    reason: "React rewrite (Equipment settings pane) with inline editing"
  T084:
    agent: "frontend-developer"
    reason: "New React component (Ingestion settings pane)"
  T085:
    agent: "frontend-developer"
    reason: "React rewrite (NamingStructure settings pane) with token builder"
  T086:
    agent: "frontend-developer"
    reason: "React rewrite (SourceViewStrategy settings pane)"
  T087:
    agent: "frontend-developer"
    reason: "New React component (ProcessingTools settings pane)"
  T088:
    agent: "frontend-developer"
    reason: "New React component (CalibrationMatching settings pane)"
  T089:
    agent: "frontend-developer"
    reason: "React rewrite (Catalogs settings pane)"
  T090:
    agent: "frontend-developer"
    reason: "New React component (Cleanup settings pane)"
  T091:
    agent: "frontend-developer"
    reason: "New React component (General settings pane)"
  T092:
    agent: "frontend-developer"
    reason: "New React component (Advanced settings pane)"
  T093:
    agent: "frontend-developer"
    reason: "React component migration (AuditLog to settings)"
  T094:
    agent: "coder"
    reason: "File deletion task — remove obsolete settings files"
  T095:
    agent: "coder"
    reason: "Directory deletion task — remove obsolete feature dirs"

  # Phase 8: US6 — Status Bar
  T096:
    agent: "frontend-developer"
    reason: "React rewrite (StatusBar) with live operational data"
  T097:
    agent: "frontend-developer"
    reason: "React hook (useStatusSummary) for data fetching"
  T098:
    agent: "frontend-developer"
    reason: "Sidebar footer addition with root health indicator"
  T099:
    agent: "coder"
    reason: "Simple removal of obsolete status bar content"
  T100:
    agent: "frontend-developer"
    reason: "Settings integration — wire warning threshold to status bar"

  # Phase 9: Polish
  T101:
    agent: "coder"
    reason: "File deletion — remove screenshot artifacts"
  T102:
    agent: "frontend-developer"
    reason: "Mock data provider updates across all features"
  T103:
    agent: "coder"
    reason: "Lint fix pass — mechanical"
  T104:
    agent: "coder"
    reason: "TypeScript error fix pass — mechanical"
  T105:
    agent: "coder"
    reason: "Test fix pass — mechanical"
  T106:
    agent: "frontend-developer"
    reason: "Playwright E2E script updates for new routes"
  T107:
    agent: "coder"
    reason: "Preference key additions — mechanical"
  T108:
    agent: "speckit-implement-task"
    reason: "Cross-cutting verification task — hotkey audit"
  T109:
    agent: "speckit-implement-task"
    reason: "Cross-cutting verification task — reveal action audit"
