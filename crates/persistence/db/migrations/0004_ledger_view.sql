-- Migration 0004: materialised ledger view for spec 002 list_assets_ledger.
--
-- Replaces the per-table merge done in Rust (`list_assets_ledger`) with a
-- single SQL view that UNION ALLs the eight entity tables with a consistent
-- column shape. Filtering, ordering, limit/offset live in the application
-- query against this view.
--
-- Column shape:
--   entity_type  TEXT  — snake_case tag matching EntityType::as_str()
--   entity_id    TEXT  — UUIDv4
--   state        TEXT  — lifecycle state string for that row
--   title        TEXT  — nullable display title (NULL when entity has no name field)
--   path         TEXT  — nullable filesystem path (NULL when entity has no path)
--   project_id   TEXT  — nullable owning-project reference (NULL when n/a)
--   updated_at   TEXT  — RFC 3339 timestamp; falls back to created_at when no
--                       distinct updated_at column exists (per data-model.md;
--                       a future migration can introduce dedicated updated_at
--                       columns once writers maintain them)
--
-- Ambiguity choices documented for review:
--   * `file_record` has no title; UI displays relative_path. title = NULL,
--     path = relative_path.
--   * `project.name` maps to title; project has no path.
--   * `acquisition_session` / `calibration_session` have no human title yet;
--     left NULL until the UI surfaces session_key (R-Title-1).
--   * `filesystem_plan` has neither title nor path on the row.
--   * `processing_artifact.staleness` is the lifecycle state column for that
--     entity family (matches state_column_for() in lifecycle.rs).
--   * `prepared_source_view` reports as entity_type 'prepared_source' to match
--     EntityType::PreparedSource::as_str().
--   * `library_root` reports as entity_type 'data_source' to match
--     EntityType::DataSource::as_str() and the contract surface (RegisteredSource).

CREATE VIEW IF NOT EXISTS ledger_view AS
SELECT
    'file_record'      AS entity_type,
    id                 AS entity_id,
    state              AS state,
    NULL               AS title,
    relative_path      AS path,
    NULL               AS project_id,
    last_seen_at       AS updated_at
FROM file_record
UNION ALL
SELECT
    'acquisition_session',
    id,
    state,
    NULL,
    NULL,
    NULL,
    created_at
FROM acquisition_session
UNION ALL
SELECT
    'calibration_session',
    id,
    state,
    NULL,
    NULL,
    NULL,
    created_at
FROM calibration_session
UNION ALL
SELECT
    'project',
    id,
    state,
    name,
    NULL,
    id,
    created_at
FROM project
UNION ALL
SELECT
    'filesystem_plan',
    id,
    state,
    NULL,
    NULL,
    NULL,
    COALESCE(applied_at, created_at)
FROM filesystem_plan
UNION ALL
SELECT
    'processing_artifact',
    id,
    staleness,
    NULL,
    NULL,
    project_id,
    created_at
FROM processing_artifact
UNION ALL
SELECT
    'prepared_source',
    id,
    state,
    NULL,
    NULL,
    project_id,
    created_at
FROM prepared_source_view
UNION ALL
SELECT
    'data_source',
    id,
    state,
    label,
    current_path,
    NULL,
    COALESCE(last_seen_at, created_at)
FROM library_root;
