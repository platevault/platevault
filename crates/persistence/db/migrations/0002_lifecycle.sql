-- Migration 0002: lifecycle state tables for spec 002.
--
-- Design notes:
-- * Provenance is NOT stored as columns on entity tables (spec 002 FR-006).
--   Ledger rows omit confidence/evidence/provenance; those live in
--   provenance_history_archive and are returned only in detail views.
-- * All ids are UUIDv4 TEXT (RFC 4122, lowercase hyphenated).
-- * Timestamps are RFC 3339 UTC text.
-- * FK constraints enforced via PRAGMA foreign_keys = ON (set at connect time).

-- ── Library root (DataSource) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS library_root (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    current_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'external', 'network')),
    state TEXT NOT NULL CHECK (state IN ('active', 'missing', 'disabled', 'reconnect_required')),
    last_seen_at TEXT,
    created_at TEXT NOT NULL
);

-- ── File record (inventory entry) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_record (
    id TEXT PRIMARY KEY NOT NULL,
    root_id TEXT NOT NULL REFERENCES library_root(id),
    relative_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mtime TEXT NOT NULL,
    content_hash TEXT,
    state TEXT NOT NULL CHECK (state IN ('observed', 'changed', 'classified', 'missing', 'rejected', 'protected')),
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    UNIQUE (root_id, relative_path)
);

CREATE INDEX IF NOT EXISTS idx_file_record_root ON file_record(root_id);
CREATE INDEX IF NOT EXISTS idx_file_record_state ON file_record(state);

-- ── Target (reference entity, no lifecycle) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS target (
    id TEXT PRIMARY KEY NOT NULL,
    primary_designation TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',   -- JSON array
    catalog_refs TEXT NOT NULL DEFAULT '[]', -- JSON array
    created_at TEXT NOT NULL
);

-- ── Acquisition session ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acquisition_session (
    id TEXT PRIMARY KEY NOT NULL,
    session_key TEXT NOT NULL,
    target_id TEXT REFERENCES target(id),
    -- frame_ids stored as JSON array; relational join table deferred to T006.
    frame_ids TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL CHECK (state IN ('discovered', 'candidate', 'needs_review', 'confirmed', 'rejected', 'ignored')),
    -- observer_location stored as JSON (ProvenancedValue<ObserverLocation>); null when absent.
    observer_location TEXT,
    review_snapshot_id TEXT,
    -- last_action: JSON {label, at, actor}
    last_action TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acq_session_state ON acquisition_session(state);
CREATE INDEX IF NOT EXISTS idx_acq_session_target ON acquisition_session(target_id);

-- ── Calibration session ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_session (
    id TEXT PRIMARY KEY NOT NULL,
    session_key TEXT NOT NULL,
    frame_ids TEXT NOT NULL DEFAULT '[]',
    kind TEXT NOT NULL CHECK (kind IN ('dark', 'flat', 'bias', 'flat_dark')),
    state TEXT NOT NULL CHECK (state IN ('discovered', 'candidate', 'needs_review', 'confirmed', 'rejected', 'ignored')),
    review_snapshot_id TEXT,
    last_action TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cal_session_state ON calibration_session(state);

-- ── Calibration master ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calibration_master (
    id TEXT PRIMARY KEY NOT NULL,
    source_session_id TEXT NOT NULL REFERENCES calibration_session(id),
    artifact_id TEXT NOT NULL,  -- FK → processing_artifact; deferred FK to avoid ordering issue
    kind TEXT NOT NULL CHECK (kind IN ('master_dark', 'master_flat', 'master_bias', 'master_flat_dark')),
    reuse_match_key TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL
);

-- ── Project ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    target_id TEXT NOT NULL REFERENCES target(id),
    -- session_ids: JSON array; relational join table deferred to T006
    session_ids TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL CHECK (state IN ('setup_incomplete', 'ready', 'prepared', 'processing', 'completed', 'archived', 'blocked')),
    last_action TEXT,
    block_reason TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_state ON project(state);

-- ── Filesystem plan ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS filesystem_plan (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('organize', 'prepare_source', 'cleanup', 'archive', 'regenerate_artifact')),
    -- items: JSON array of per-item mutation records
    items TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL CHECK (state IN ('draft', 'ready_for_review', 'approved', 'applying', 'paused', 'applied', 'partially_applied', 'failed', 'cancelled', 'discarded')),
    parent_plan_id TEXT REFERENCES filesystem_plan(id),
    created_by TEXT NOT NULL CHECK (created_by IN ('user', 'system')),
    created_at TEXT NOT NULL,
    applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_state ON filesystem_plan(state);

-- ── Processing artifact ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS processing_artifact (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT REFERENCES project(id),
    file_record_id TEXT NOT NULL REFERENCES file_record(id),
    kind TEXT NOT NULL CHECK (kind IN ('master', 'integration', 'drizzle', 'manifest', 'other')),
    tool TEXT,
    staleness TEXT NOT NULL CHECK (staleness IN ('current', 'stale', 'regenerating')),
    created_at TEXT NOT NULL
);

-- ── Prepared source view ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prepared_source_view (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES project(id),
    state TEXT NOT NULL CHECK (state IN ('not_created', 'planned', 'ready', 'stale', 'retired')),
    created_at TEXT NOT NULL
);

-- ── Audit log entry ───────────────────────────────────────────────────────────
-- Append-only. Never updated or deleted.

CREATE TABLE IF NOT EXISTS audit_log_entry (
    audit_id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    trigger TEXT NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('user', 'system')),
    outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'refused', 'failed')),
    severity TEXT NOT NULL CHECK (severity IN ('workflow', 'diagnostic')),
    request_id TEXT NOT NULL,
    at TEXT NOT NULL,
    payload TEXT   -- JSON; NULL when absent
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log_entry(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log_entry(at);
CREATE INDEX IF NOT EXISTS idx_audit_severity ON audit_log_entry(severity);

-- ── Provenance history archive ────────────────────────────────────────────────
-- Append-only overflow for ProvenancedValue.history (inline retention window exceeded).

CREATE TABLE IF NOT EXISTS provenance_history_archive (
    id TEXT PRIMARY KEY NOT NULL,
    asset_type TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('observed', 'inferred', 'reviewed', 'generated', 'planned', 'applied')),
    value TEXT NOT NULL,  -- JSON
    captured_at TEXT NOT NULL,
    source_id TEXT,
    replaced_by TEXT,
    archived_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prov_archive_asset ON provenance_history_archive(asset_type, asset_id, field_path);

-- ── Catalog equivalence (Target alias matching) ───────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_equivalence (
    id TEXT PRIMARY KEY NOT NULL,
    target_id TEXT NOT NULL REFERENCES target(id),
    alias TEXT NOT NULL,
    catalog_id TEXT,
    catalog_display TEXT,
    designation TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (target_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_cat_equiv_alias ON catalog_equivalence(alias);
