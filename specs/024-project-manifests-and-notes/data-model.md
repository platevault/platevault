# Data Model: Project Manifests And Notes

**Feature**: `024-project-manifests-and-notes`
**Date**: 2026-05-20

## Entities

### ProjectManifest

A versioned, immutable snapshot of project state, written as a markdown
file inside the project's `notes/` folder and indexed in the local
store.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string (uuid or ulid) | yes | Stable identifier. |
| `project_id` | string | yes | FK to `Project.id`. |
| `reason` | ManifestReason | yes | Why the manifest was generated. |
| `timestamp` | datetime (ISO-8601, UTC) | yes | When the snapshot was taken. |
| `path` | string (project-relative) | yes | e.g. `notes/manifest-2026-04-12-1801-source-add.md`. |
| `version` | integer | yes | Schema version of the front-matter shape, starts at 1. |
| `body` | ManifestBody | yes | Structured snapshot embedded into the file front-matter. |

#### ManifestBody (structured payload)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `source_map` | SourceMapSnapshot | yes | Selected lights/flats/darks/bias by Inventory id. |
| `calibration` | CalibrationChoiceSnapshot | optional | Reused masters, match rules. |
| `workflow_profile` | string | optional | Workflow profile id (feature 005). |
| `generated_views` | array<GeneratedViewRef> | optional | Source view paths and ids (feature 014). |
| `lifecycle_state` | string | yes | Project state at snapshot time. |
| `notes` | string | optional | Notes file body at snapshot time. |

`SourceMapSnapshot`, `CalibrationChoiceSnapshot`, and `GeneratedViewRef`
reference Inventory and project records by stable id (FR-007). They are
documented in their respective feature data models.

#### ManifestReason

Enum of generation triggers.

| Value | Meaning |
|-------|---------|
| `created` | First manifest after project creation. |
| `source_change` | Source map mutated (lights/flats/darks/bias). |
| `lifecycle_transition` | Project state changed. |
| `cleanup_applied` | A cleanup plan touched project sources. |
| `workflow_run` | A processing-tool workflow run completed (spec 012 `workflow.run_completed` event). |

The mockup `reason` strings ("Created", "Source added", "Lifecycle: imaging
done") map onto these values for display.

#### Derived view: ProjectManifestSummary

The list contract returns a lightweight summary for the drawer accordion:

| Field | Type |
|-------|------|
| `id` | string |
| `reason` | ManifestReason |
| `timestamp` | datetime |
| `path` | string |
| `has_body` | boolean |

### ProjectNote

Single user-editable note file per project.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable identifier (one per project). |
| `project_id` | string | yes | FK; unique. |
| `updated_at` | datetime | yes | Last save time. |
| `content` | string (markdown) | yes | Free-form body. Stored on disk at `notes/project-notes.md`. |

Notes are addressed by `project_id`; the database row stores
`updated_at` and a cached copy of `content` for fast drawer rendering.
The file on disk is canonical for export; the DB row is canonical for
audit.

## Generation Triggers

The writer in `crates/project/structure/manifest.rs` is invoked by:

| Trigger source | Reason value | Notes |
|----------------|--------------|-------|
| Project create operation | `created` | First manifest in the series. |
| Project source-map mutation (`project.sources.update`) | `source_change` | One manifest per applied mutation, not per UI keystroke. |
| Lifecycle transition (`project.lifecycle.transition`, feature 002) | `lifecycle_transition` | Includes the new state in the body. |
| Cleanup plan apply (`cleanup.plan.apply`, feature 008) | `cleanup_applied` | Only when the cleanup affected files referenced by this project. |
| Workflow run completed (`workflow.run_completed` event from spec 012) | `workflow_run` | Subscriber receives `{ projectId, toolId, completedAt, outputArtifacts: [...] }`. Writes a manifest for the named project. **FLAGGED**: spec 012 must emit `workflow.run_completed` with this payload shape — see GRILL amendment 2026-05-22. |

Triggers are idempotent: if a write fails, the next retry produces a new
filename (timestamp differs) and a new database row. The previous
attempt is recorded as a Manifest Export Event with status `failed`
(FR-005).

## Invariants

- A manifest file is never overwritten or mutated after creation.
- `path` is project-relative; absolute resolution uses the library-root
  abstraction from feature 001.
- `body.notes` is a **full text snapshot** at write time, not a reference or
  hash/excerpt. Editing the live notes file does not change historical manifests.
  (A8, ratified 2026-05-22.)
- `ProjectNote.content` MUST NOT exceed 16 384 bytes (UTF-8). Writes that
  would exceed this limit MUST be rejected with `note.content_too_large`.
  (A5, ratified 2026-05-22.)
- Exactly one `ProjectNote` per project; deletion is not supported in v1.

## Audit Events

Audit events flow through `crates/audit/`:

- `manifest.write.attempt` — about to write a manifest file.
- `manifest.write.success` — file written and row inserted.
- `manifest.write.failure` — write failed; row records the failure.
- `manifest.export.copy` — user used "Export copy".
- `manifest.reveal_in_os` — user used "Reveal in OS".
- `note.update` — note content saved.
