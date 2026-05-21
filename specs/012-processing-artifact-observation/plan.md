# Implementation Plan: Processing Artifact Observation

**Branch**: `012-processing-artifact-observation` | **Date**: 2026-05-20
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/012-processing-artifact-observation/spec.md`

## Implementation Status: NOT IMPLEMENTED

This plan defines the future-build target. No production code lands.

## Summary

The app observes — never owns — files written into a project's
configured output folder by external processing tools (PixInsight,
Siril, planetary/lunar tools). A per-project filesystem watcher
(falling back to polling on hostile filesystems) feeds a classifier
driven by the active workflow profile's naming/extension rules. Each
detected file becomes a `ProcessingArtifact` row with kind
(`intermediate` / `master` / `final`), tool, detection timestamp, and
classification confidence. Artifacts surface in the project drawer's
Tool Launches accordion, grouped under the nearest preceding launch
from feature 011, and are referenced in lifecycle manifests from
feature 024. The app never writes to, renames, or processes observed
files.

## Technical Context

**Language/Runtime**: Rust (workspace crates), TypeScript (Tauri/React desktop).
**Storage**: SQLite for artifact index, classification overrides, and
audit events. Observed files remain on the user's disk untouched.
**Surface**: Tauri command boundary backed by JSON-schema contracts in
`packages/contracts/`. Two new operations: `artifact.list` and
`artifact.classify` (manual override).
**Future home**:
- `crates/workflow/artifacts/watcher.rs` — per-project watcher + poll fallback.
- `crates/workflow/artifacts/classifier.rs` — rule-driven classification.
- `crates/workflow/profiles/` — already exists; extended with artifact rule shape.
- `crates/persistence/db/` — `processing_artifacts` table + classification overrides.
- `crates/audit/` — artifact lifecycle events.

## Constitution Check

- **Local-First File Custody**: PASS. Observation is read-only. Artifact
  paths are stored project-relative; library roots from feature 001
  resolve absolute paths. Removed drives produce `missing` state, not
  data loss.
- **Reviewable Filesystem Mutation**: PASS. No filesystem mutations.
  The classify contract changes only DB rows.
- **PixInsight Boundary**: PASS. The watcher never opens files for
  processing. Classification reads filenames and extensions only;
  optional shallow header peeks are deferred to a research item.
- **Research-Led Domain Modeling**: PASS. Output-folder conventions,
  extension allow-list, watch-vs-poll, and debounce are deferred to
  `research.md`.
- **Portable Contracts and Durable Records**: PASS. Two JSON-schema
  contracts (`artifact.list`, `artifact.classify`). DB is the durable
  record; the file index is reproducible from a rescan.
- **Cross-Platform Path Safety**: PASS. Watcher abstracts notify-rs on
  Windows/macOS/Linux and falls back to polling on network shares per
  research item M-2.

## Project Structure

### Documentation (this feature)

```
specs/012-processing-artifact-observation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── artifact.list.json
│   └── artifact.classify.json
└── tasks.md
```

### Source Code (future)

```
crates/workflow/artifacts/
├── watcher.rs              # notify-rs wrapper with poll fallback
├── classifier.rs           # rule-driven classification
├── reconciler.rs           # on-attach rescan + missing-state transitions
└── rules.rs                # ArtifactRule shape consumed from workflow profiles

crates/workflow/profiles/
└── artifact_rules.rs       # Per-profile rules: extensions, suffix patterns

crates/persistence/db/
├── artifacts_repo.rs       # CRUD + state transitions
└── migrations/             # processing_artifacts, classification_overrides

crates/audit/
└── artifact_events.rs

apps/desktop/src/features/projects/
└── ToolLaunchesAccordion.tsx   # Renders artifacts grouped under launches
```

## Architecture Decisions

1. **One watcher per active project, attached when the project drawer
   opens or the project becomes active.** Closing the drawer detaches
   the watcher; reopening triggers a reconciliation scan first so any
   files that landed while detached are picked up. This bounds the
   number of OS watchers, which is a scarce resource on macOS and
   Linux.

2. **Workflow-profile-driven classification, never hardcoded per tool
   in the UI layer.** The classifier consumes `ArtifactRule` entries
   from the active workflow profile. A PixInsight profile and a Siril
   profile coexist without leaking labels into each other. Unknown
   files are recorded with `kind = intermediate` and
   `classification_confidence < 0.2` so they surface as "needs review"
   rather than being dropped.

3. **Manual override is sticky.** When a user changes an artifact's
   kind through `artifact.classify`, the override is recorded with
   `classification_source = manual_override`. Subsequent automatic
   re-classifications ignore manual rows. Reclassification can only
   be re-enabled by clearing the override (future operation, out of
   v1 scope).

4. **Attribution to tool launches via timestamp window.** Each
   artifact's `detected_at` is matched against feature-011 launch
   records: the nearest preceding launch with the same `tool` whose
   start time is within a configurable window (default 6 hours) wins.
   Artifacts with no matching launch are surfaced under
   "Unattributed". This is a soft association — the artifact does not
   become invalid if the launch row is deleted.

5. **Read-only observation, audited.** The watcher never opens an
   observed file for write. Every detection, classification, override,
   and missing-state transition emits an audit event so the user's
   project history is reconstructible without the file index.

6. **Watcher with polling fallback.** notify-rs is the default. On
   network shares, FUSE mounts, and known-bad filesystems detected via
   probing (research item M-2), the watcher falls back to a polling
   loop with the same debounce envelope. The fallback is transparent
   to upstream consumers.

## Phase 0 — Research

See [research.md](./research.md) for:

- Output-folder conventions per tool (PI project-relative,
  Siril user-configurable).
- Classification heuristics (filename suffix patterns, extensions).
- Watch vs poll selection and debounce window defaults.
- Cross-platform watcher tradeoffs.

## Phase 1 — Design

- [data-model.md](./data-model.md) — `ProcessingArtifact`,
  `ArtifactRule`, classification override, state transitions.
- [contracts/](./contracts/) — `artifact.list`, `artifact.classify`.

## Phase 2 — Tasks

See [tasks.md](./tasks.md). Grouped by user story (P1 detect, P2
classify, P3 surface in project drawer).

## Cross-References

- **Feature 011 (Processing Tool Launch)**: supplies `tool_launch_id`
  for attribution; this feature consumes its launch index.
- **Feature 024 (Project Manifests And Notes)**: manifests snapshot
  the artifact list at lifecycle checkpoints; consumes `artifact.list`.
- **Feature 001 (Library Manager)**: library-root abstraction resolves
  absolute paths.
- **Feature 017 (Cleanup/Archive Review Plans)**: artifacts marked
  `final` are protected by default during cleanup planning.

## Risks

- OS watcher exhaustion: per-project attach/detach bounds the count.
- Network share unreliability: polling fallback per research item M-2.
- Naming-collision false positives (e.g. a session light named
  `MasterDark_*.fits`): mitigated by scoping rules to the output
  folder, not the project's source folder.
- Workflow profile drift: rule changes do not retroactively rewrite
  existing classifications; user-initiated reclassify required.

## Out of Scope (Plan-Level)

- Header-level peeks into XISF/FITS files for classification (deferred).
- Cross-project artifact discovery.
- Auto-deletion of intermediates.
- Remote/cloud output folders.
- Real-time partial-write detection (the watcher waits for stable size).
