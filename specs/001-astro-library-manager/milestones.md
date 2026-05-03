# V1 Milestone Breakdown

## Milestone 0: Planning Baseline

Scope:
- SpecKit specification, constitution, research, plan, data model, contracts,
  quickstart, tasks, UX workflows, and risk register.
- Monorepo scaffold with dependency-light Rust crates and package placeholders.

Exit criteria:
- Planning artifacts have no unresolved placeholders.
- Workspace placeholder tests pass.
- Tasks are dependency ordered and grouped by user story.

## Milestone 1: Non-Mutating Library Inventory MVP

Primary story:
- US1: Index Existing Library

Scope:
- Register library roots.
- Scan without mutation.
- Store root-relative file/folder/link records.
- Avoid link traversal by default.
- Classify obvious categories with confidence and unknown buckets.
- Show inventory dashboard and scan progress.

Exit criteria:
- Representative messy fixture scans without file mutation.
- 100,000 item scan target has a benchmark harness.
- Root-relative storage and moved/missing root handling are covered by tests.

## Milestone 2: Metadata, Sessions, and Calibration Candidates

Primary story:
- US2: Ingest Acquisition and Calibration Data

Scope:
- FITS/XISF/video/sidecar metadata extraction.
- Immutable acquisition session candidates.
- Independent calibration sessions and calibration masters.
- Target, equipment, software, optical train, and setup fingerprints.
- Calibration match candidate scoring with evidence and review state.

Exit criteria:
- Sample lights, darks, biases, flats, dark flats, masters, and plan references
  produce reviewable candidates.
- Calibration reuse cases are explainable and overrideable.

## Milestone 3: App-Owned Projects and Source Mapping

Primary story:
- US3: Create and Map Processing Projects

Scope:
- Supported project envelope.
- Brownfield conformance checks.
- Workflow profile selection.
- Multi-session and mosaic mapping.
- Manifest preview from canonical database records.

Exit criteria:
- Multi-session and mosaic fixtures produce app-managed projects.
- Project creation is represented as a reviewed filesystem plan.
- Nonconforming brownfield folders are not ingested as app-managed projects.

## Milestone 4: Tool Source Views

Primary story:
- US4: Prepare Tool Source Views

Scope:
- Source view strategy comparison.
- Manifest-only, link/junction/hard-link/copy/hybrid planning.
- App-created view item tracking.
- Safe removal plan for generated views.

Exit criteria:
- Source views are generated only through reviewed plans.
- Original sources are never touched by source view cleanup.

## Milestone 5: Lifecycle, Cleanup, Archive, and Audit

Primary story:
- US5: Track Lifecycle, Outputs, Archive, and Cleanup

Scope:
- Final output registration and verification.
- PixInsight/tool artifact observation.
- Nested inherited cleanup policy tree.
- Cleanup/archive planning and application.
- Per-item audit history.
- Generated JSON, JSONL, and Markdown manifests.

Exit criteria:
- Protected categories are enforced by default.
- Cleanup plans estimate reclaimable disk space.
- Plan application records success, failure, and partial completion.

## Milestone 6: Target-Centered History

Primary story:
- US7: Track Targets and Observing History

Scope:
- Target catalog.
- Aliases and catalog identifiers.
- Linked sessions, projects, outputs, plan references, and notes.
- Create session/project flow from target context.

Exit criteria:
- Target view answers what data exists for an object and where it is used.

## Milestone 7: Rules and Root Recovery

Primary story:
- US6: Configure Rules and Recover Roots

Scope:
- Naming, classification, retention, protected folders, aliases, taxonomy, and
  metadata keyword maps.
- Root remapping workflow with sample verification.

Exit criteria:
- Users can adapt classification and path behavior without immediate migration.
- Moved roots resolve existing relationships without rewriting history.

## Recommended Initial Scaffold After Decisions

The current scaffold is sufficient for task execution:
- Monorepo root with Rust workspace and package workspace.
- Tauri/React placeholder under `apps/desktop`.
- Contract package placeholder under `packages/contracts`.
- Granular crates under `crates/`.

Do not add full Tauri/React/SQLite/parser dependencies until Phase 1 and Phase 2
implementation tasks select and wire them deliberately.
