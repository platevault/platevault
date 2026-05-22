# Implementation Plan: Project Manifests And Notes

**Branch**: `024-project-manifests-and-notes` | **Date**: 2026-05-20
**Spec**: [spec.md](./spec.md)
**Input**: Feature specification at `specs/024-project-manifests-and-notes/spec.md`

## Summary

Project manifests are auto-generated, read-only documentation snapshots
written by the app at lifecycle checkpoints (project created, source
changed, lifecycle transition, cleanup applied). Each manifest is a
stable markdown file inside the project's `notes/` folder on disk and is
indexed in the local store. Notes are user-editable free-form text saved
to a sibling file in the same `notes/` folder. The drawer renders both:
manifests as an accordion of snapshots with reveal/export actions, notes
as a single editable section.

## Technical Context

**Language/Runtime**: Rust (workspace crates), TypeScript (Tauri/React desktop).
**Storage**: SQLite for indexed metadata; markdown files on disk for manifest
bodies and notes content. Files live inside the project envelope's `notes/`
folder. Reproducible from the database where possible.
**Surface**: Tauri command boundary backed by JSON-schema contracts in
`packages/contracts/`. Mockup state in `apps/desktop/src/features/projects/`
and `apps/desktop/src/data/mock.ts`.
**Future home**: `crates/project/structure/manifest.rs` (writer, path
resolver, version stamp) and a small `notes.rs` sibling for the notes file
adapter. Audit events flow through `crates/audit/`.

## Constitution Check

- **Local-First File Custody**: PASS. Manifests and notes live inside the
  user's project folder under `notes/`. The database holds the index and
  audit trail; the file bodies remain on disk.
- **Reviewable Filesystem Mutation**: PASS. Manifest writes are app-owned
  and idempotent (one file per checkpoint, never overwritten). Notes
  updates write to a single known path; failed writes record audit events
  without corrupting project state.
- **PixInsight Boundary**: PASS. Manifests document inputs/outputs only
  and do not modify image data.
- **Research-Led Domain Modeling**: PASS. Open questions (file format,
  retention, OS reveal behavior) are deferred to `research.md`.
- **Portable Contracts and Durable Records**: PASS. Three JSON-schema
  contracts (`project.manifest.list`, `project.manifest.get`,
  `project.note.update`) define the transport boundary.

## Project Structure

### Documentation (this feature)

```
specs/024-project-manifests-and-notes/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── project.manifest.list.json
│   ├── project.manifest.get.json
│   └── project.note.update.json
└── tasks.md
```

### Source Code (future)

```
crates/project/structure/
├── manifest.rs            # Writer triggered on lifecycle transitions
├── notes.rs               # Notes file adapter (read/write/audit)
└── path.rs                # Project envelope path resolution

crates/persistence/db/
└── manifests_repo.rs      # Index, list, fetch by id

crates/audit/
└── manifest_events.rs     # Write/export/note-edit audit events

apps/desktop/src/features/projects/
├── ProjectsPage.tsx       # Drawer accordion (mocked today)
└── manifests/             # Future split-out components
```

## Architecture Decisions

1. **Manifest writer triggered on project lifecycle transitions and workflow
   run completions.** A small writer function inside
   `crates/project/structure/manifest.rs` is the single producer. Triggers
   are: project created, source map changed (lights/flats/darks/bias added
   or removed), lifecycle state transition (e.g. acquisition → imaging →
   done), cleanup plan applied, and workflow run completed. The writer
   takes a `ManifestReason` enum, snapshots the project's current source
   map / workflow / state, renders markdown, writes the file, then records
   a database row and an audit event.

   The `workflow_run` reason is triggered by subscribing to the
   `workflow.run_completed` event-bus topic (spec 012). On receipt, the
   manifest writer is called with `reason = workflow_run` for the project
   identified in the payload `{ projectId, toolId, completedAt,
   outputArtifacts }`. **FLAGGED — spec 012 ripple**: spec 012 must emit
   `workflow.run_completed` with the above payload shape. Do NOT edit spec
   012 here; see GRILL amendment 2026-05-22.

   Note on `crates/patterns/` dependency (D, spec 015 R-CratePatterns):
   the manifest writer does not use pattern resolution. No dependency on
   `crates/patterns/` is required here.

2. **Manifest file is canonical and immutable.** A manifest snapshot
   captures the project state at one moment and is never rewritten.
   Filenames embed timestamp + reason so retries are deterministic and
   the index in the database stays in lockstep with files on disk. The
   `version` field on the row governs the format used for NEW writes only;
   existing files are never re-rendered from the database. (A7, ratified
   2026-05-22.)

3. **Manifest path inside the project's `notes/` folder.** The writer
   resolves `<project_root>/notes/manifest-<YYYY-MM-DD-HHMMSS>-<reason>.md`.
   The `notes/` folder is created on first manifest if missing. Paths
   stored in the database are project-relative; the library-root layer
   from feature 001 is responsible for absolute resolution.

4. **Notes are a separate user-editable file.** Notes live at
   `<project_root>/notes/project-notes.md`. There is one notes file per
   project. Saves go through a contract (`project.note.update`) that
   writes the file atomically and records an audit event with the new
   `updated_at` timestamp. The UI applies a **5-second debounce** before
   issuing the update call to avoid noisy per-keystroke writes. (A5.)
   Notes are editable on projects in any lifecycle state except `archived`;
   the `project.read_only` error fires only when `lifecycle == "archived"`.
   (R-NotesEdit, ratified 2026-05-22.)

5. **Read-only manifest surface in the contracts.** No
   `project.manifest.update` or `project.manifest.delete` contract is
   defined. The only write path is the internal lifecycle trigger.

## Phase 0 — Research

See [research.md](./research.md) for trigger taxonomy, file format,
notes/manifest separation, retention, and cross-platform reveal
behavior.

## Phase 1 — Design

- [data-model.md](./data-model.md) — `ProjectManifest`, `ProjectNote`,
  `ManifestReason`, generation triggers.
- [contracts/](./contracts/) — three JSON-schema operations covering
  list, get, and note update.

## Phase 2 — Tasks

See [tasks.md](./tasks.md). Grouped by user story (P1 view manifests,
P2 expand body, P3 reveal in OS, P4 edit notes) with explicit mockup-done
markers where the desktop mock already covers the surface.

## Risks

- Manifest folder name collisions with user-owned `notes/` content from
  legacy libraries. Mitigation: research item M-3 documents detection
  and safe coexistence.
- Cross-platform "Reveal in OS" semantics differ (Explorer, Finder,
  xdg-open). Mitigation: research item M-5.
- Notes file conflicts if the user edits externally while the app is
  running. Mitigation: tracked as deferred work; v1 reads on focus and
  writes with last-write-wins plus audit entry.

## Out of Scope (Plan-Level)

- Rich-text or WYSIWYG note editing.
- Cloud/remote publishing of manifests.
- Cross-project manifest comparison or diffs.
- Manual manifest authoring or deletion.
