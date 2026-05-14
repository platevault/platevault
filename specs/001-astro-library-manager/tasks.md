# Tasks: Astro Library Manager

**Input**: Design documents from `/specs/001-astro-library-manager/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Include contract, unit, integration, and filesystem fixture tests because the specification defines independent tests, measurable outcomes, and filesystem safety requirements.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested as an independently demonstrable increment.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Finish the implementation scaffold without building product behavior yet.

- [X] T001 Document and decide dependency selections for Tauri, React, SQLite, SQLite migration tooling, schema generation, Zod/type generation, FITS parsing, XISF parsing, and video metadata probing in docs/research/implementation-dependencies.md
- [X] T002 [P] Create frontend source directory skeleton in apps/desktop/src/README.md
- [X] T003 [P] Create contract schema directory skeleton in packages/contracts/schemas/README.md
- [X] T004 [P] Create fixture directory guide for library, metadata, project, and filesystem safety fixtures in tests/fixtures/README.md
- [X] T005 [P] Create integration test directory guide for cross-crate flows in tests/integration/README.md
- [X] T006 Update workspace scripts and install/configure the selected Rust, TypeScript, contract, SQLite, migration, metadata parser, and fixture-check dependencies in package.json, Cargo.toml, and justfile

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared architecture that must exist before user-story implementation.

**CRITICAL**: No user story work should begin until this phase is complete.

- [X] T007 Define common domain identifiers, timestamps, confidence, review state, and lifecycle enums in crates/domain/core/src/lib.rs
- [X] T008 [P] Define contract envelope, operation handle, operation event, and error DTOs in crates/contracts/core/src/lib.rs
- [X] T009 [P] Define JSON Schema envelope, operation event, and error schemas in packages/contracts/schemas/envelope.schema.json
- [X] T010 Add contract validation test harness for Rust and TypeScript schema parity in tests/contract/contract_schema_parity.rs
- [X] T011 Define AlmClient TypeScript interface and transport adapter boundary in packages/contracts/src/client.ts
- [X] T012 Define Tauri command adapter boundary for operation envelopes in apps/desktop/src-tauri/src/commands/mod.rs
- [X] T013 Define application operation dispatcher traits in crates/app/core/src/lib.rs
- [X] T014 Define SQLite migration and repository abstraction boundary in crates/persistence/db/src/lib.rs
- [X] T015 Define operation state persistence model and repository contract in crates/persistence/db/src/operation_state.rs
- [X] T016 Define audit event model and append-only audit writer trait in crates/audit/src/lib.rs
- [X] T017 Define reviewable filesystem plan, plan item, approval, and precondition models in crates/fs/planner/src/lib.rs
- [X] T018 Run $impeccable product-UI preflight and shape gate for the application shell, then create shared React app shell, route registry, and feature service provider placeholders in apps/desktop/src/app/App.tsx

**Checkpoint**: Foundation ready. User-story tasks can now be implemented in priority order or by parallel teams.

---

## Phase 3: User Story 1 - Index Existing Library (Priority: P1) MVP

**Goal**: Register one or more roots, scan without mutation, classify discovered items, show confidence and unknowns, and preserve link/root safety.

**Independent Test**: Point the app at a representative messy fixture tree and verify inventory, confidence labels, unknown buckets, missing/remapped root handling, link records, and no filesystem mutations.

### Tests for User Story 1

- [X] T019 [P] [US1] Add filesystem fixture for messy astrophotography root with Raw, Masters, Process, Published, SharpCap, Manual, and PixInsight-like folders in tests/fixtures/library_messy/README.md
- [X] T020 [P] [US1] Add contract tests for library.root.register, library.scan.start, and library.inventory.query in tests/contract/library_inventory_contract.rs
- [ ] T021 [P] [US1] Add filesystem scan safety tests for root-relative paths, symlink/junction non-traversal, missing roots, and lazy hashing in tests/filesystem/library_scan_safety.rs
- [ ] T022 [P] [US1] Add integration test for non-mutating inventory scan in tests/integration/us1_index_existing_library.rs

### Implementation for User Story 1

- [ ] T023 [P] [US1] Define LibraryRoot, RootRemapEvent, ScanSettings, RootRelativePath, FileRecord, and ClassificationAssignment models in crates/fs/inventory/src/lib.rs
- [ ] T024 [US1] Implement root registration and availability checks in crates/fs/inventory/src/roots.rs
- [ ] T025 [US1] Implement non-following directory scanner with link recording and optional lazy hashing hooks in crates/fs/inventory/src/scanner.rs
- [ ] T026 [US1] Implement path normalization and cross-platform warning generation in crates/fs/inventory/src/paths.rs
- [ ] T027 [US1] Implement initial classification rules for raw, calibration, masters, project-like material, outputs, processing artifacts, manifests, notes, tools, and unknowns in crates/fs/inventory/src/classification.rs
- [ ] T028 [US1] Implement library root and inventory repositories in crates/persistence/db/src/library_inventory.rs
- [ ] T029 [US1] Implement library.root.register, library.scan.start, and library.inventory.query operation handlers in crates/app/core/src/library_inventory.rs
- [ ] T030 [US1] Wire library inventory Tauri commands through the operation dispatcher in apps/desktop/src-tauri/src/commands/library_inventory.rs
- [ ] T031 [US1] Use $impeccable product-UI guidance to build root selection, scan progress, inventory summary, confidence labels, and unknown item UI in apps/desktop/src/features/library/LibraryInventoryPage.tsx
- [ ] T032 [US1] Document US1 demo and safety verification steps in specs/001-astro-library-manager/quickstart.md

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Ingest Acquisition and Calibration Data (Priority: P1)

**Goal**: Extract metadata, create reviewable acquisition/calibration candidates, model reusable calibration material, and preserve source files as immutable references.

**Independent Test**: Ingest sample lights, darks, flats, biases, dark flats, masters, and plan files from multiple nights and verify candidate sessions, setup fingerprints, calibration candidates, and review state.

### Tests for User Story 2

- [ ] T033 [P] [US2] Add FITS, XISF, sidecar, video, and NINA-plan fixture manifest in tests/fixtures/metadata/README.md
- [ ] T034 [P] [US2] Add metadata extraction normalization tests for FITS/XISF keyword variants in tests/integration/us2_metadata_extraction.rs
- [ ] T035 [P] [US2] Add session grouping and immutability tests for multi-target and incomplete-metadata folders in tests/integration/us2_session_ingest.rs
- [ ] T036 [P] [US2] Add calibration candidate scoring tests for reusable dark, bias, dark-flat, flat, and master scenarios in tests/integration/us2_calibration_matching.rs

### Implementation for User Story 2

- [ ] T037 [P] [US2] Define raw metadata value, normalized metadata field, keyword map, and extraction result models in crates/metadata/core/src/lib.rs
- [ ] T038 [US2] Implement FITS header extraction adapter boundary and keyword normalization in crates/metadata/fits/src/lib.rs
- [ ] T039 [US2] Implement XISF metadata extraction adapter boundary and property normalization in crates/metadata/xisf/src/lib.rs
- [ ] T040 [US2] Implement video metadata adapter boundary for planetary/lunar source files in crates/metadata/video/src/lib.rs
- [ ] T041 [P] [US2] Define Target, TargetAlias, ObservingPlanReference, Equipment, OpticalTrain, and SoftwareTool models in crates/targeting/src/lib.rs
- [ ] T042 [P] [US2] Define AcquisitionSession, CalibrationSession, CalibrationMaster, FileSet, and session review models in crates/sessions/src/lib.rs
- [ ] T043 [US2] Implement immutable acquisition session candidate grouping in crates/sessions/src/acquisition.rs
- [ ] T044 [US2] Implement independent calibration session and master candidate grouping in crates/sessions/src/calibration.rs
- [ ] T045 [US2] Implement setup fingerprint construction from metadata, equipment, optical train, filter, exposure, gain, offset, binning, and temperature in crates/sessions/src/setup_fingerprint.rs
- [ ] T046 [US2] Implement weighted calibration match scoring with hard incompatibility gates and explanation output in crates/calibration/core/src/lib.rs
- [ ] T047 [US2] Implement metadata, session, target, equipment, and calibration repositories in crates/persistence/db/src/ingest.rs
- [ ] T048 [US2] Implement metadata.extract.start, session candidate, calibration match, and review operation handlers in crates/app/core/src/ingest.rs
- [ ] T049 [US2] Use $impeccable product-UI guidance to build ingest review UI for metadata, acquisition sessions, calibration sessions, masters, equipment, setup fingerprints, and plan references in apps/desktop/src/features/ingest/IngestReviewPage.tsx

**Checkpoint**: User Story 2 is fully functional and testable independently.

---

## Phase 5: User Story 3 - Create and Map Processing Projects (Priority: P1)

**Goal**: Create app-owned project envelopes, select workflow profiles, map sources/calibrations/panels, and generate documented source maps.

**Independent Test**: Create multi-session and mosaic projects from seeded sessions, associate calibrations, select PixInsight/WBPP or planetary/lunar profile, and verify the manifest explains selected source usage.

### Tests for User Story 3

- [ ] T050 [P] [US3] Add project envelope fixture expectations for .alm, sources, processing, outputs, notes, and archive folders in tests/fixtures/project_structure/README.md
- [ ] T051 [P] [US3] Add project creation and structure plan contract tests in tests/contract/project_contract.rs
- [ ] T052 [P] [US3] Add integration tests for multi-session, calibration-selected, and mosaic project mapping in tests/integration/us3_project_mapping.rs

### Implementation for User Story 3

- [ ] T053 [P] [US3] Define WorkflowProfile, source-view defaults, artifact ruleset references, and initial PixInsight/WBPP plus planetary/lunar profiles in crates/workflow/profiles/src/lib.rs
- [ ] T054 [P] [US3] Define Project, ProjectTarget, ProjectPanel, ProjectSource, ProcessingAttempt, ProjectManifest, and lifecycle state models in crates/project/structure/src/lib.rs
- [ ] T055 [US3] Implement supported project envelope validator and project-like brownfield conformance checker in crates/project/structure/src/envelope.rs
- [ ] T056 [US3] Implement project structure filesystem plan generation with no-overwrite preconditions in crates/project/structure/src/plans.rs
- [ ] T057 [US3] Implement project, panel, source, workflow profile, and manifest repositories in crates/persistence/db/src/projects.rs
- [ ] T058 [US3] Implement project.structure.plan_create, project.create_from_applied_plan, project.import.check_structure, project.source.map.update, and project.lifecycle.update handlers in crates/app/core/src/projects.rs
- [ ] T059 [US3] Implement manifest preview generator from canonical database records in crates/project/structure/src/manifest.rs
- [ ] T060 [US3] Use $impeccable product-UI guidance to build project creation, workflow profile selection, source mapping, calibration review, mosaic panel mapping, and manifest preview UI in apps/desktop/src/features/projects/ProjectEditorPage.tsx

**Checkpoint**: User Story 3 is fully functional and testable independently.

---

## Phase 6: User Story 4 - Prepare Tool Source Views (Priority: P2)

**Goal**: Generate reviewed tool-friendly source view plans without copying large source data by default and track generated view artifacts for safe removal.

**Independent Test**: Generate a source view plan from an approved project map and confirm expected manifests, links, junctions, or copies are proposed and tracked according to strategy.

### Tests for User Story 4

- [ ] T061 [P] [US4] Add source view contract tests for source_view.plan_generate and source_view.remove.plan in tests/contract/source_view_contract.rs
- [ ] T062 [P] [US4] Add filesystem tests for manifest-only, symlink, junction, hard-link, copy, and hybrid strategy planning in tests/filesystem/source_view_planning.rs
- [ ] T063 [P] [US4] Add integration test for generating and removing tracked app-created source view items in tests/integration/us4_source_views.rs

### Implementation for User Story 4

- [ ] T064 [P] [US4] Define SourceView and SourceViewItem models in crates/project/structure/src/source_view.rs
- [ ] T065 [US4] Implement platform capability detection and source view strategy selection in crates/fs/planner/src/source_view_strategy.rs
- [ ] T066 [US4] Implement source view plan generation for manifest-only, link, junction, hard-link, copy, and hybrid outputs in crates/fs/planner/src/source_view_plan.rs
- [ ] T067 [US4] Implement source view tracking repositories in crates/persistence/db/src/source_views.rs
- [ ] T068 [US4] Implement source_view.plan_generate and source_view.remove.plan operation handlers in crates/app/core/src/source_views.rs
- [ ] T069 [US4] Use $impeccable product-UI guidance to build source view strategy comparison, plan preview, and generated view cleanup UI in apps/desktop/src/features/source-views/SourceViewPage.tsx

**Checkpoint**: User Story 4 is fully functional and testable independently.

---

## Phase 7: User Story 5 - Track Lifecycle, Outputs, Archive, and Cleanup (Priority: P2)

**Goal**: Track project outputs, observe PixInsight/tool artifacts, enforce lifecycle gates, generate inherited cleanup trees, and apply reviewed archive/cleanup plans with audit.

**Independent Test**: Mark a project finalized and verified, observe a PixInsight-like workspace, generate cleanup/archive plans, protect sources/masters/finals/manifests/notes/audit, and apply an approved plan with per-item audit records.

### Tests for User Story 5

- [ ] T070 [P] [US5] Validate and document current PixInsight/WBPP artifact taxonomy plus planetary/lunar processing workspace fixture expectations in tests/fixtures/processing_artifacts/README.md
- [ ] T071 [P] [US5] Add artifact observation and lifecycle contract tests in tests/contract/lifecycle_cleanup_contract.rs
- [ ] T072 [P] [US5] Add cleanup tree inheritance, override, and protected-category tests in tests/integration/us5_cleanup_policy.rs
- [ ] T073 [P] [US5] Add filesystem plan apply and audit tests for archive, trash, generated-link removal, partial failure, and no silent overwrite in tests/filesystem/plan_application_audit.rs

### Implementation for User Story 5

- [ ] T074 [P] [US5] Define ProcessingArtifact, ProjectOutput, CleanupPolicy, CleanupTreeNode, and cleanup eligibility models in crates/project/structure/src/lifecycle.rs
- [ ] T075 [US5] Implement processing workspace refresh observation and artifact classification in crates/project/structure/src/artifact_observation.rs
- [ ] T076 [US5] Implement project output registration, final verification, and lifecycle transition validation in crates/project/structure/src/lifecycle_transitions.rs
- [ ] T077 [US5] Implement inherited cleanup policy resolution and nested cleanup tree construction in crates/project/structure/src/cleanup_policy.rs
- [ ] T078 [US5] Implement cleanup and archive candidate plan generation with protected-category checks and reclaimable-size estimates in crates/fs/planner/src/cleanup_plan.rs
- [ ] T079 [US5] Implement reviewed filesystem plan application with archive/trash/delete-disabled defaults and per-item precondition checks in crates/fs/planner/src/apply.rs
- [ ] T080 [US5] Implement lifecycle, artifact, output, cleanup policy, cleanup tree, plan approval, and audit repositories in crates/persistence/db/src/lifecycle_cleanup.rs
- [ ] T081 [US5] Implement artifact.observe.start, cleanup.policy.update, cleanup.tree.preview, cleanup.plan_generate, archive.plan_generate, plan.preview, plan.approve, plan.apply.start, manifest.generate.plan, and audit.query handlers in crates/app/core/src/lifecycle_cleanup.rs
- [ ] T082 [US5] Use $impeccable product-UI guidance to build lifecycle, outputs, artifact observation, cleanup tree, archive plan, plan review, plan apply progress, and audit history UI in apps/desktop/src/features/lifecycle/LifecycleCleanupPage.tsx
- [ ] T083 [US5] Implement JSON, JSONL events, and Markdown manifest file writers as plan items in crates/project/structure/src/manifest_writers.rs

**Checkpoint**: User Story 5 is fully functional and testable independently.

---

## Phase 8: User Story 7 - Track Targets and Observing History (Priority: P2)

**Goal**: Provide target-centered history for sessions, calibration context, projects, outputs, plan references, aliases, and notes.

**Independent Test**: Create/import target metadata, link sessions and projects, attach a plan reference, and verify target view shows dates, coverage, outputs, and project status.

### Tests for User Story 7

- [ ] T084 [P] [US7] Add target query and target create contract tests in tests/contract/target_contract.rs
- [ ] T085 [P] [US7] Add integration test for target-centered observing history and alias resolution in tests/integration/us7_target_history.rs

### Implementation for User Story 7

- [ ] T086 [US7] Implement target catalog repositories and coverage summary queries in crates/persistence/db/src/targets.rs
- [ ] T087 [US7] Implement target.create, target.query, alias confirmation, and observing-plan link operation handlers in crates/app/core/src/targets.rs
- [ ] T088 [US7] Implement target history aggregation across sessions, calibration context, projects, outputs, notes, and plan references in crates/targeting/src/history.rs
- [ ] T089 [US7] Use $impeccable product-UI guidance to build target catalog, target detail, alias review, session/project history, output history, and plan reference UI in apps/desktop/src/features/targets/TargetHistoryPage.tsx

**Checkpoint**: User Story 7 is fully functional and testable independently.

---

## Phase 9: User Story 6 - Configure Rules and Recover Roots (Priority: P3)

**Goal**: Configure naming, classification, retention, protected folder, alias, taxonomy, and root remapping rules without forcing file migration.

**Independent Test**: Change rules and aliases, remap a moved root, and verify classification suggestions, relationships, and audit history update without filesystem mutation.

### Tests for User Story 6

- [ ] T090 [P] [US6] Add settings, rules, and root remap contract tests in tests/contract/settings_rules_contract.rs
- [ ] T091 [P] [US6] Add integration test for rule updates and moved-root recovery in tests/integration/us6_rules_root_recovery.rs

### Implementation for User Story 6

- [ ] T092 [US6] Define RuleOrTemplate, settings document, naming template, taxonomy, and root remap policy models in crates/domain/core/src/rules.rs
- [ ] T093 [US6] Implement rule evaluation hooks for classification, naming, protected folders, aliases, metadata keyword maps, and retention in crates/app/core/src/rules.rs
- [ ] T094 [US6] Implement root remap verification plan generation and relationship recovery in crates/fs/inventory/src/root_remap.rs
- [ ] T095 [US6] Implement settings.get, settings.update, rules.update, and library.root.remap.plan handlers in crates/app/core/src/settings_rules.rs
- [ ] T096 [US6] Use $impeccable product-UI guidance to build settings, rules, cleanup defaults, protected folders, aliases, taxonomy, and root recovery UI in apps/desktop/src/features/settings/SettingsRulesPage.tsx

**Checkpoint**: User Story 6 is fully functional and testable independently.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, documentation, performance, and release-readiness after selected user stories are complete.

- [ ] T097 [P] Add quickstart fixture walkthrough screenshots and verification notes in specs/001-astro-library-manager/quickstart.md
- [ ] T098 [P] Add architecture ADRs for contract source of truth, SQLite migration choice, and manifest projection policy in docs/architecture/contract-source-of-truth.md, docs/architecture/sqlite-migration-choice.md, and docs/architecture/manifest-projection-policy.md
- [ ] T099 Add performance benchmark harness for 100,000 item scan and lazy hashing behavior in tests/integration/performance_inventory_scan.rs
- [ ] T100 Add cross-platform path compatibility matrix and manual verification checklist in docs/architecture/filesystem-safety.md
- [ ] T101 Run cargo fmt, cargo clippy, cargo test, contract validation, frontend typecheck, and fixture smoke test commands defined in justfile
- [ ] T102 Review SpecKit analysis report and update affected SpecKit artifacts in specs/001-astro-library-manager/tasks.md, specs/001-astro-library-manager/spec.md, specs/001-astro-library-manager/plan.md, or specs/001-astro-library-manager/research.md

---

## Dependencies & Execution Order

### Task Dependencies

```toml
[graph.T001]
blocked_by = []
[graph.T002]
blocked_by = []
[graph.T003]
blocked_by = []
[graph.T004]
blocked_by = []
[graph.T005]
blocked_by = []
[graph.T006]
blocked_by = ["T001", "T002", "T003"]
[graph.T007]
blocked_by = ["T006"]
[graph.T008]
blocked_by = ["T006"]
[graph.T009]
blocked_by = ["T003"]
[graph.T010]
blocked_by = ["T008", "T009"]
[graph.T011]
blocked_by = ["T008", "T009"]
[graph.T012]
blocked_by = ["T008"]
[graph.T013]
blocked_by = ["T007", "T008"]
[graph.T014]
blocked_by = ["T007"]
[graph.T015]
blocked_by = ["T014"]
[graph.T016]
blocked_by = ["T007"]
[graph.T017]
blocked_by = ["T007", "T016"]
[graph.T018]
blocked_by = ["T002", "T011"]
[graph.T019]
blocked_by = ["T004"]
[graph.T020]
blocked_by = ["T010"]
[graph.T021]
blocked_by = ["T004", "T007"]
[graph.T022]
blocked_by = ["T019", "T020", "T021"]
[graph.T023]
blocked_by = ["T007"]
[graph.T024]
blocked_by = ["T023"]
[graph.T025]
blocked_by = ["T023", "T024"]
[graph.T026]
blocked_by = ["T023"]
[graph.T027]
blocked_by = ["T023", "T026"]
[graph.T028]
blocked_by = ["T014", "T023"]
[graph.T029]
blocked_by = ["T013", "T025", "T027", "T028"]
[graph.T030]
blocked_by = ["T012", "T029"]
[graph.T031]
blocked_by = ["T011", "T018", "T029"]
[graph.T032]
blocked_by = ["T022", "T031"]
[graph.T033]
blocked_by = ["T004"]
[graph.T034]
blocked_by = ["T033"]
[graph.T035]
blocked_by = ["T033"]
[graph.T036]
blocked_by = ["T033"]
[graph.T037]
blocked_by = ["T007"]
[graph.T038]
blocked_by = ["T037"]
[graph.T039]
blocked_by = ["T037"]
[graph.T040]
blocked_by = ["T037"]
[graph.T041]
blocked_by = ["T007"]
[graph.T042]
blocked_by = ["T007", "T041"]
[graph.T043]
blocked_by = ["T037", "T041", "T042"]
[graph.T044]
blocked_by = ["T037", "T042"]
[graph.T045]
blocked_by = ["T037", "T041", "T042"]
[graph.T046]
blocked_by = ["T044", "T045"]
[graph.T047]
blocked_by = ["T014", "T037", "T041", "T042", "T046"]
[graph.T048]
blocked_by = ["T013", "T038", "T039", "T040", "T043", "T044", "T046", "T047"]
[graph.T049]
blocked_by = ["T011", "T018", "T048"]
[graph.T050]
blocked_by = ["T004"]
[graph.T051]
blocked_by = ["T008", "T017"]
[graph.T052]
blocked_by = ["T050", "T051"]
[graph.T053]
blocked_by = ["T007"]
[graph.T054]
blocked_by = ["T007", "T041", "T042", "T053"]
[graph.T055]
blocked_by = ["T054"]
[graph.T056]
blocked_by = ["T017", "T055"]
[graph.T057]
blocked_by = ["T014", "T054"]
[graph.T058]
blocked_by = ["T013", "T056", "T057"]
[graph.T059]
blocked_by = ["T054", "T057"]
[graph.T060]
blocked_by = ["T011", "T018", "T058", "T059"]
[graph.T061]
blocked_by = ["T008", "T054"]
[graph.T062]
blocked_by = ["T017", "T050"]
[graph.T063]
blocked_by = ["T061", "T062"]
[graph.T064]
blocked_by = ["T054"]
[graph.T065]
blocked_by = ["T017", "T064"]
[graph.T066]
blocked_by = ["T064", "T065"]
[graph.T067]
blocked_by = ["T014", "T064"]
[graph.T068]
blocked_by = ["T013", "T066", "T067"]
[graph.T069]
blocked_by = ["T011", "T018", "T068"]
[graph.T070]
blocked_by = ["T004"]
[graph.T071]
blocked_by = ["T008", "T054"]
[graph.T072]
blocked_by = ["T071"]
[graph.T073]
blocked_by = ["T017", "T070"]
[graph.T074]
blocked_by = ["T054"]
[graph.T075]
blocked_by = ["T023", "T053", "T070", "T074"]
[graph.T076]
blocked_by = ["T054", "T074"]
[graph.T077]
blocked_by = ["T074"]
[graph.T078]
blocked_by = ["T017", "T075", "T077"]
[graph.T079]
blocked_by = ["T016", "T017", "T078"]
[graph.T080]
blocked_by = ["T014", "T074", "T079"]
[graph.T081]
blocked_by = ["T013", "T075", "T076", "T077", "T078", "T079", "T080"]
[graph.T082]
blocked_by = ["T011", "T018", "T081"]
[graph.T083]
blocked_by = ["T059", "T079", "T080"]
[graph.T084]
blocked_by = ["T008", "T041"]
[graph.T085]
blocked_by = ["T084"]
[graph.T086]
blocked_by = ["T014", "T041", "T057", "T080"]
[graph.T087]
blocked_by = ["T013", "T086"]
[graph.T088]
blocked_by = ["T041", "T042", "T054", "T086"]
[graph.T089]
blocked_by = ["T011", "T018", "T087", "T088"]
[graph.T090]
blocked_by = ["T008", "T023"]
[graph.T091]
blocked_by = ["T090"]
[graph.T092]
blocked_by = ["T007"]
[graph.T093]
blocked_by = ["T027", "T041", "T092"]
[graph.T094]
blocked_by = ["T017", "T023", "T092"]
[graph.T095]
blocked_by = ["T013", "T093", "T094"]
[graph.T096]
blocked_by = ["T011", "T018", "T095"]
[graph.T097]
blocked_by = ["T032", "T049", "T060", "T069", "T082", "T089", "T096"]
[graph.T098]
blocked_by = ["T001", "T083"]
[graph.T099]
blocked_by = ["T025", "T028", "T029"]
[graph.T100]
blocked_by = ["T026", "T065", "T079", "T094"]
[graph.T101]
blocked_by = ["T097", "T098", "T099", "T100"]
[graph.T102]
blocked_by = ["T101"]
```

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **US1, US2, US3 (P1)**: Start after Foundational. US1 is the MVP; US2 and US3 can proceed with seeded fixtures once foundation exists, but product integration is strongest in US1 -> US2 -> US3 order.
- **US4, US5, US7 (P2)**: Start after the project/source/session foundation exists. US4 depends most on US3; US5 depends on US3 and benefits from US4; US7 can be implemented after US2/US3 data exists.
- **US6 (P3)**: Starts after core rules, root, and settings entities exist; it can be implemented after US1 and foundational contracts.
- **Polish**: Depends on selected user stories being complete.

### User Story Dependencies

- **US1**: No story dependency after Foundational.
- **US2**: No story dependency after Foundational if fixture roots are available, but integrates with US1 inventory records.
- **US3**: Depends on source/session/calibration concepts from US2 for full behavior; can be tested with seeded repository fixtures.
- **US4**: Depends on project source maps from US3.
- **US5**: Depends on projects from US3 and source views from US4 for full cleanup behavior.
- **US7**: Depends on target/session/project/output records from US2, US3, and US5.
- **US6**: Cross-cutting configuration; implement after US1 for root remap value, then extend across later stories.

### Parallel Opportunities

- Setup tasks T002-T005 can run in parallel.
- Foundational DTO/schema/UI-shell tasks T007-T018 can be split by crate/package after T006.
- Contract tests for each story can run in parallel with fixture creation.
- Rust model tasks in separate crates can run in parallel when their dependencies are explicit.
- UI page tasks can run after their operation handlers exist and do not conflict by file path.

---

## Parallel Examples

### User Story 1

```text
Task: T019 Add filesystem fixture in tests/fixtures/library_messy/README.md
Task: T020 Add contract tests in tests/contract/library_inventory_contract.rs
Task: T021 Add scan safety tests in tests/filesystem/library_scan_safety.rs
```

### User Story 2

```text
Task: T037 Define metadata core models in crates/metadata/core/src/lib.rs
Task: T041 Define target/equipment models in crates/targeting/src/lib.rs
Task: T042 Define session models in crates/sessions/src/lib.rs
```

### User Story 3

```text
Task: T053 Define workflow profiles in crates/workflow/profiles/src/lib.rs
Task: T054 Define project models in crates/project/structure/src/lib.rs
Task: T051 Add project contract tests in tests/contract/project_contract.rs
```

### User Story 5

```text
Task: T070 Add processing artifact fixtures in tests/fixtures/processing_artifacts/README.md
Task: T071 Add lifecycle cleanup contract tests in tests/contract/lifecycle_cleanup_contract.rs
Task: T073 Add filesystem plan apply tests in tests/filesystem/plan_application_audit.rs
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 / US1.
3. Stop and validate that a messy library can be indexed without filesystem mutation.
4. Use US1 as the first demonstrable local-first product slice.

### Incremental Delivery

1. US1: Inventory and scan safety.
2. US2: Metadata, acquisition sessions, calibration sessions, and calibration matching.
3. US3: App-owned projects, workflow profiles, source mapping, and manifest preview.
4. US4: Tool source views.
5. US5: Lifecycle, outputs, artifact observation, cleanup, archive, and audit.
6. US7: Target-centered history.
7. US6: Configurable rules and root recovery.

### Implementation Guardrails

- Do not add calibration, debayering, registration, integration, drizzle, stacking, image editing, or video processing tasks.
- Do not expose direct unreviewed filesystem mutation commands.
- Keep all UI access behind the `AlmClient` contract boundary.
- Keep database records canonical and manifests generated.
- Keep large-file hashing optional/lazy.
- Track every app-created link, generated source view item, manifest, and filesystem mutation plan item.
