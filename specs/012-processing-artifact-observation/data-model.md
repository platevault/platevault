# Data Model: Processing Artifact Observation

**Feature**: `012-processing-artifact-observation`
**Date**: 2026-05-20

## Entities

### ProcessingArtifact

A single observed output file from an external processing tool, indexed
by the app but never owned by it.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string (ulid) | yes | Stable identifier. |
| `project_id` | string | yes | FK to `Project.id`. |
| `tool_launch_id` | string | optional | FK to `ToolLaunch.id` (feature 011); null when no launch matches the detection window. |
| `path` | string (project-relative) | yes | Project-relative path; absolute resolution via library root (feature 001). |
| `kind` | ArtifactKind | yes | One of `intermediate`, `master`, `final`. |
| `tool` | string | yes | Workflow-profile tool id (e.g. `pixinsight`, `siril`). Never UI-hardcoded. |
| `detected_at` | datetime (ISO-8601, UTC) | yes | First observation timestamp. |
| `last_seen_at` | datetime | yes | Updated on every reconciliation scan that finds the file. |
| `state` | ArtifactState | yes | `present`, `missing`, or `user_resolved_missing`. |
| `classification_confidence` | float in [0,1] | yes | 1.0 for manual overrides; otherwise per rule (research R-2). |
| `classification_source` | ClassificationSource | yes | `rule`, `manual_override`, or `fallback`. |
| `size_bytes` | integer | yes | Snapshot at detection; used for partial-write stable-size check. |
| `file_mtime` | datetime | yes | Filesystem mtime at detection. |

### ArtifactKind

| Value | Meaning |
|-------|---------|
| `intermediate` | Calibrated, registered, debayered, or otherwise transient output. |
| `master` | Reusable calibration master (dark/flat/bias). |
| `final` | End-product image intended for export/share. |

### ArtifactState

| Value | Meaning |
|-------|---------|
| `present` | File exists at `path`. |
| `missing` | File was previously observed but is no longer at `path`. Auditable. |
| `user_resolved_missing` | User explicitly marked the missing row as resolved; row is retained for history but excluded from default UI listings. |

State transitions:

```
[ new ] ─detection→ present
present ─rescan-not-found→ missing
missing ─rescan-found→ present
missing ─user-resolve→ user_resolved_missing
```

A row never returns to `[new]`. Reappearance after `user_resolved_missing`
creates a new `ProcessingArtifact` row.

### ClassificationSource

| Value | Meaning |
|-------|---------|
| `rule` | Classified by a workflow-profile `ArtifactRule`. |
| `manual_override` | User changed kind via `artifact.classify`; sticky. |
| `fallback` | No rule matched; fallback to `intermediate` with confidence < 0.2. |

### ArtifactRule

Per-workflow-profile rule consumed by the classifier. Stored alongside
the workflow profile (feature 011 / `crates/workflow/profiles/`),
indexed for fast lookup but not user-edited in v1 outside profile JSON.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable identifier within profile. |
| `workflow_profile_id` | string | yes | FK. |
| `tool` | string | yes | Tool id stamped onto the artifact. |
| `match` | RuleMatch | yes | One of `literal`, `prefix`, `suffix`, `glob`. |
| `pattern` | string | yes | The pattern body. |
| `kind` | ArtifactKind | yes | The kind to assign on match. |
| `confidence` | float in [0,1] | yes | Per match type (research R-2). |
| `priority` | integer | yes | Higher wins. Manual override is always priority ∞. |

### ClassificationOverride

Sticky user override. One row per `(artifact_id)`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `artifact_id` | string | yes | FK; unique. |
| `kind` | ArtifactKind | yes | The user-asserted kind. |
| `created_at` | datetime | yes | Audit timestamp. |
| `reason` | string | optional | Free-form user note. |

Presence of a row forces `classification_source = manual_override`,
`classification_confidence = 1.0`, and disables automatic
re-classification.

---

## Derived View: ProcessingArtifactSummary

The drawer accordion consumes a lightweight summary:

| Field | Type |
|-------|------|
| `id` | string |
| `tool_launch_id` | string \| null |
| `path` | string |
| `kind` | ArtifactKind |
| `tool` | string |
| `detected_at` | datetime |
| `state` | ArtifactState |
| `classification_confidence` | float |
| `classification_source` | ClassificationSource |

Grouping for the drawer:

1. Bucket artifacts by `tool_launch_id`.
2. Within a bucket, sort by `detected_at` ascending.
3. Buckets sort by the matching launch's start time descending (newest
   launch on top).
4. Artifacts with `tool_launch_id = null` collect under an
   "Unattributed" bucket at the bottom.

## Tool Launch Attribution

When a new artifact is detected:

1. Look up all `ToolLaunch` rows for the project whose `started_at`
   is within `launch_attribution_window` (default 6h, configurable
   per workflow profile) before `detected_at`.
2. Of those, pick the nearest preceding launch with the same `tool`.
3. If none match, leave `tool_launch_id` null.

Attribution is computed once at detection and is not recomputed when
launches are added later. Future re-attribution is out of scope.

## Invariants

- `path` is project-relative. Absolute resolution always goes through
  the library-root abstraction (feature 001).
- An observed file is never written to or renamed by the app.
- Manual override survives re-detection: if a row transitions
  `missing → present`, an existing override is preserved.
- A row's `kind` and `classification_confidence` are recomputed only
  when `classification_source != manual_override`.

## Audit Events

Audit events flow through `crates/audit/`:

- `artifact.detected` — new row created.
- `artifact.classified` — automatic classification recorded.
- `artifact.classify.override` — manual override applied.
- `artifact.missing` — state transitioned to `missing`.
- `artifact.recovered` — state transitioned `missing → present`.
- `artifact.user_resolved` — user marked a missing row resolved.

## Storage Sketch

```sql
CREATE TABLE processing_artifacts (
  id                         TEXT PRIMARY KEY,
  project_id                 TEXT NOT NULL,
  tool_launch_id             TEXT NULL,
  path                       TEXT NOT NULL,
  kind                       TEXT NOT NULL CHECK (kind IN ('intermediate','master','final')),
  tool                       TEXT NOT NULL,
  detected_at                TEXT NOT NULL,
  last_seen_at               TEXT NOT NULL,
  state                      TEXT NOT NULL CHECK (state IN ('present','missing','user_resolved_missing')),
  classification_confidence  REAL NOT NULL,
  classification_source      TEXT NOT NULL CHECK (classification_source IN ('rule','manual_override','fallback')),
  size_bytes                 INTEGER NOT NULL,
  file_mtime                 TEXT NOT NULL,
  UNIQUE (project_id, path)
);

CREATE TABLE classification_overrides (
  artifact_id  TEXT PRIMARY KEY REFERENCES processing_artifacts(id),
  kind         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  reason       TEXT NULL
);

CREATE INDEX idx_artifacts_project ON processing_artifacts (project_id, detected_at DESC);
CREATE INDEX idx_artifacts_state   ON processing_artifacts (state);
```
