-- Candidate one-file baseline derived from exact base cee4e87ce3e2045838c2e29f45784bf07a45edee.
-- sqlite_* objects and _sqlx_migrations are intentionally excluded.
-- onboarding_state and onboarding_flags intentionally start empty.

CREATE TABLE operation_states (
    id TEXT PRIMARY KEY NOT NULL,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress_current INTEGER,
    progress_total INTEGER,
    current_message TEXT,
    started_at TEXT,
    finished_at TEXT,
    resume_token TEXT,
    error_code TEXT,
    error_message TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE library_root (
    id TEXT PRIMARY KEY NOT NULL,
    label TEXT NOT NULL,
    current_path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('local', 'external', 'network')),
    state TEXT NOT NULL CHECK (state IN ('active', 'missing', 'disabled', 'reconnect_required')),
    last_seen_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE file_record (
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
CREATE INDEX idx_file_record_root ON file_record(root_id);
CREATE INDEX idx_file_record_state ON file_record(state);
CREATE TABLE target (
    id TEXT PRIMARY KEY NOT NULL,
    primary_designation TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]',   -- JSON array
    catalog_refs TEXT NOT NULL DEFAULT '[]', -- JSON array
    created_at TEXT NOT NULL
);
CREATE TABLE acquisition_session (
    id TEXT PRIMARY KEY NOT NULL,
    session_key TEXT NOT NULL,
    target_id TEXT REFERENCES target(id),
    -- frame_ids stored as JSON array; relational join table deferred to T006.
    frame_ids TEXT NOT NULL DEFAULT '[]',
    observer_location TEXT,
    created_at TEXT NOT NULL
, root_id TEXT REFERENCES library_root(id), canonical_target_id TEXT REFERENCES canonical_target(id), has_observer_location INTEGER NOT NULL DEFAULT 0, pointing_ra_deg  REAL, pointing_dec_deg REAL, rotation_deg     REAL, optic_train_key  TEXT, notes TEXT);
CREATE INDEX idx_acq_session_target ON acquisition_session(target_id);
CREATE TABLE calibration_session (
    id TEXT PRIMARY KEY NOT NULL,
    session_key TEXT NOT NULL,
    frame_ids TEXT NOT NULL DEFAULT '[]',
    kind TEXT NOT NULL CHECK (kind IN ('dark', 'flat', 'bias', 'flat_dark')),
    created_at TEXT NOT NULL
, root_id TEXT REFERENCES library_root(id), source_inbox_item_id TEXT, notes TEXT, archived_at TEXT, archived_via_plan_id TEXT);
CREATE TABLE calibration_master (
    id TEXT PRIMARY KEY NOT NULL,
    source_session_id TEXT NOT NULL REFERENCES calibration_session(id),
    artifact_id TEXT NOT NULL,  -- FK → processing_artifact; deferred FK to avoid ordering issue
    kind TEXT NOT NULL CHECK (kind IN ('master_dark', 'master_flat', 'master_bias', 'master_flat_dark')),
    reuse_match_key TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE filesystem_plan (
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
CREATE INDEX idx_plan_state ON filesystem_plan(state);
CREATE TABLE audit_log_entry (
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
, reason_code TEXT);
CREATE INDEX idx_audit_entity ON audit_log_entry(entity_type, entity_id);
CREATE INDEX idx_audit_at ON audit_log_entry(at);
CREATE INDEX idx_audit_severity ON audit_log_entry(severity);
CREATE TABLE provenance_history_archive (
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
CREATE INDEX idx_prov_archive_asset ON provenance_history_archive(asset_type, asset_id, field_path);
CREATE TABLE catalog_equivalence (
    id TEXT PRIMARY KEY NOT NULL,
    target_id TEXT NOT NULL REFERENCES target(id),
    alias TEXT NOT NULL,
    catalog_id TEXT,
    catalog_display TEXT,
    designation TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (target_id, alias)
);
CREATE INDEX idx_cat_equiv_alias ON catalog_equivalence(alias);
CREATE TABLE events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('user', 'restore', 'system')),
    emitted_at TEXT NOT NULL,
    payload TEXT NOT NULL  -- JSON
);
CREATE INDEX idx_events_topic ON events(topic, event_id);
CREATE TABLE cameras (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL,
    aliases       TEXT NOT NULL DEFAULT '[]',  -- JSON array of alternate names
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
, sensor_type TEXT, passband TEXT, pixel_size_um REAL
    CHECK (pixel_size_um IS NULL OR pixel_size_um > 0), sensor_width_px INTEGER
    CHECK (sensor_width_px IS NULL OR sensor_width_px > 0), sensor_height_px INTEGER
    CHECK (sensor_height_px IS NULL OR sensor_height_px > 0));
CREATE TABLE telescopes (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    aliases         TEXT NOT NULL DEFAULT '[]',  -- JSON array of alternate names
    focal_length_mm INTEGER,
    auto_detected   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
);
CREATE TABLE optical_trains (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    telescope_id    TEXT REFERENCES telescopes(id),
    camera_id       TEXT REFERENCES cameras(id),
    focal_length_mm INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_optical_train_telescope ON optical_trains(telescope_id);
CREATE INDEX idx_optical_train_camera ON optical_trains(camera_id);
CREATE TABLE filters (
    id            TEXT PRIMARY KEY NOT NULL,
    name          TEXT NOT NULL UNIQUE,
    category      TEXT NOT NULL CHECK (category IN ('narrowband', 'broadband', 'dual_band', 'other', 'custom')),
    auto_detected INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);
CREATE TABLE cleanup_policy (
    data_type  TEXT PRIMARY KEY NOT NULL,
    action     TEXT NOT NULL DEFAULT 'keep' CHECK (action IN ('keep', 'archive', 'delete')),
    updated_at TEXT NOT NULL
);
CREATE TABLE calibration_tolerances (
    singleton_id            TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    temperature_tolerance_c REAL NOT NULL DEFAULT 5.0,
    exposure_tolerance_s    REAL NOT NULL DEFAULT 2.0,
    aging_limit_days        INTEGER NOT NULL DEFAULT 365,
    require_same_camera     INTEGER NOT NULL DEFAULT 1,
    require_same_gain       INTEGER NOT NULL DEFAULT 1,
    require_same_binning    INTEGER NOT NULL DEFAULT 1,
    updated_at              TEXT NOT NULL
, require_same_offset INTEGER NOT NULL DEFAULT 1);
CREATE TABLE ingestion_settings (
    singleton_id                    TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    watcher_enabled                 INTEGER NOT NULL DEFAULT 1,
    scan_on_startup                 INTEGER NOT NULL DEFAULT 1,
    follow_symlinks                 INTEGER NOT NULL DEFAULT 0,
    follow_junctions                INTEGER NOT NULL DEFAULT 0,
    eager_hashing                   INTEGER NOT NULL DEFAULT 0,
    metadata_extraction             INTEGER NOT NULL DEFAULT 1,
    exposure_grouping_tolerance_s   REAL NOT NULL DEFAULT 2.0,
    temperature_grouping_tolerance_c REAL NOT NULL DEFAULT 5.0,
    default_filter                  TEXT,
    updated_at                      TEXT NOT NULL
);
CREATE TABLE "first_run_state" (
    singleton_id TEXT PRIMARY KEY DEFAULT 'first_run' CHECK (singleton_id = 'first_run'),
    completed_at TEXT,
    last_step    TEXT NOT NULL DEFAULT 'source_folders' CHECK (last_step IN ('source_folders', 'processing_tools', 'catalogs', 'confirm', 'complete')),
    updated_at   TEXT NOT NULL
);
CREATE TABLE source_view_config (
    singleton_id TEXT PRIMARY KEY DEFAULT 'default' CHECK (singleton_id = 'default'),
    strategy     TEXT NOT NULL DEFAULT 'junctions' CHECK (strategy IN ('junctions', 'symlinks', 'hardlinks', 'copy')),
    updated_at   TEXT NOT NULL
);
CREATE TABLE settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL, -- JSON-encoded value
    updated_at TEXT NOT NULL
);
CREATE TABLE source_overrides (
    source_id  TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL, -- JSON-encoded value
    updated_at TEXT NOT NULL,
    PRIMARY KEY (source_id, key)
);
CREATE TABLE plan_apply_runs (
    id               TEXT PRIMARY KEY NOT NULL,
    plan_id          TEXT NOT NULL REFERENCES plans(id),
    approval_token   TEXT NOT NULL,
    started_at       TEXT NOT NULL,
    ended_at         TEXT,
    terminal_state   TEXT CHECK (terminal_state IN ('applied','partially_applied','failed','cancelled','paused')),
    items_total      INTEGER NOT NULL DEFAULT 0,
    items_applied    INTEGER NOT NULL DEFAULT 0,
    items_failed     INTEGER NOT NULL DEFAULT 0,
    items_skipped    INTEGER NOT NULL DEFAULT 0,
    items_cancelled  INTEGER NOT NULL DEFAULT 0,
    items_pending    INTEGER NOT NULL DEFAULT 0,
    pause_reason     TEXT    -- last pause reason: 'volume.unavailable' | 'disk.full' | 'item.stale'
);
CREATE INDEX plan_apply_runs_plan ON plan_apply_runs (plan_id);
CREATE TABLE plan_apply_events (
    id           TEXT PRIMARY KEY NOT NULL,
    run_id       TEXT NOT NULL REFERENCES plan_apply_runs(id),
    plan_id      TEXT NOT NULL,
    item_id      TEXT,   -- NULL for plan-level events
    prior_state  TEXT NOT NULL,
    new_state    TEXT NOT NULL,
    at           TEXT NOT NULL,
    -- Failure detail (set when new_state = 'failed' or 'stale')
    failure_code          TEXT,
    failure_message       TEXT,
    failure_recoverable   INTEGER,  -- 0/1 boolean
    -- Rollback detail (set when a rollback was attempted)
    rollback_attempted    INTEGER,  -- 0/1 boolean
    rollback_outcome      TEXT CHECK (rollback_outcome IN ('succeeded','failed','not_applicable') OR rollback_outcome IS NULL),
    rollback_message      TEXT
);
CREATE INDEX plan_apply_events_plan ON plan_apply_events (plan_id, at ASC);
CREATE INDEX plan_apply_events_run  ON plan_apply_events (run_id, at ASC);
CREATE TABLE projects (
    id                  TEXT        NOT NULL PRIMARY KEY,
    name                TEXT        NOT NULL,
    -- "PixInsight" | "Siril" | "Planetary Suite"
    tool                TEXT        NOT NULL,
    -- lifecycle states per spec 009 / domain_core::lifecycle::project::ProjectState
    lifecycle           TEXT        NOT NULL DEFAULT 'setup_incomplete',
    -- library-root-relative path (Constitution I: roots modelled separately)
    path                TEXT        NOT NULL,
    notes               TEXT,
    -- channel drift flag: set to 1 when sources are added after last channel review
    channel_drift       INTEGER     NOT NULL DEFAULT 0,
    created_at          TEXT        NOT NULL,
    updated_at          TEXT        NOT NULL, canonical_target_id TEXT REFERENCES canonical_target(id), blocked_reason_kind TEXT, blocked_reason_note TEXT, archived_via_plan_id TEXT, is_mosaic INTEGER NOT NULL DEFAULT 0,

    UNIQUE(name),
    UNIQUE(path)
);
CREATE TABLE project_sources (
    -- stable row identifier (UUID string)
    id                  TEXT        NOT NULL PRIMARY KEY,
    project_id          TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- hard reference to the Inventory/AcquisitionSession row
    inventory_session_id TEXT       NOT NULL,
    -- snapshot fields copied from the Inventory row at link time
    name_snapshot       TEXT        NOT NULL DEFAULT '',
    frames_snapshot     INTEGER     NOT NULL DEFAULT 0,
    filter_snapshot     TEXT        NOT NULL DEFAULT '',
    exposure_snapshot   TEXT        NOT NULL DEFAULT '',
    linked_at           TEXT        NOT NULL,

    UNIQUE(project_id, inventory_session_id)
);
CREATE TABLE project_channels (
    project_id          TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label               TEXT        NOT NULL,
    -- "inferred" | "manual"
    source              TEXT        NOT NULL DEFAULT 'inferred',
    added_at            TEXT        NOT NULL,

    PRIMARY KEY (project_id, label)
);
CREATE INDEX idx_projects_lifecycle ON projects(lifecycle);
CREATE INDEX idx_projects_tool      ON projects(tool);
CREATE INDEX idx_project_sources_project_id ON project_sources(project_id);
CREATE TABLE inbox_classification_breakdown (
    id                  TEXT        NOT NULL PRIMARY KEY,
    inbox_item_id       TEXT        NOT NULL
                            REFERENCES inbox_items(id) ON DELETE CASCADE,
    kind                TEXT        NOT NULL
                            CHECK (kind IN ('light','dark','bias','flat','dark_flat')),
    count               INTEGER     NOT NULL DEFAULT 0,
    destination_preview TEXT,                        -- preview path from active pattern (spec 015)
    sample_files        TEXT        NOT NULL DEFAULT '[]'  -- JSON array of up to 10 filenames
);
CREATE UNIQUE INDEX inbox_breakdown_item_kind
    ON inbox_classification_breakdown (inbox_item_id, kind);
CREATE TABLE inbox_plan_links (
    inbox_item_id   TEXT        NOT NULL PRIMARY KEY
                        REFERENCES inbox_items(id) ON DELETE CASCADE,
    plan_id         TEXT        NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    linked_at       TEXT        NOT NULL
);
CREATE INDEX inbox_plan_links_plan
    ON inbox_plan_links (plan_id);
CREATE INDEX idx_acq_session_root ON acquisition_session(root_id);
CREATE INDEX idx_cal_session_root ON calibration_session(root_id);
CREATE TABLE calibration_assignment (
    id                    TEXT PRIMARY KEY NOT NULL,
    session_id            TEXT NOT NULL,
    calibration_type      TEXT NOT NULL CHECK (calibration_type IN ('dark', 'flat', 'bias')),
    master_id             TEXT NOT NULL,
    confidence            REAL NOT NULL,
    was_override          INTEGER NOT NULL DEFAULT 0,  -- 0=false, 1=true
    mismatched_dimensions TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
    assigned_at           TEXT NOT NULL,               -- ISO-8601 UTC

    UNIQUE (session_id, calibration_type)
);
CREATE INDEX idx_cal_assignment_session
    ON calibration_assignment (session_id);
CREATE TABLE calibration_fingerprint (
    id                    TEXT PRIMARY KEY NOT NULL REFERENCES calibration_session(id),
    calibration_type      TEXT NOT NULL CHECK (calibration_type IN ('dark', 'flat', 'bias')),
    gain                  REAL,
    offset_val            REAL,
    exposure_s            REAL,
    temp_c                REAL,
    filter_name           TEXT,
    rotation_deg          REAL,
    binning               TEXT,
    optic_train           TEXT,
    source_session_id     TEXT,   -- originating capture session (for same_session reason)
    observing_night_date  TEXT    -- YYYY-MM-DD local observing night
);
CREATE INDEX idx_cal_fingerprint_type
    ON calibration_fingerprint (calibration_type);
CREATE TABLE acquisition_fingerprint (
    id                    TEXT PRIMARY KEY NOT NULL REFERENCES acquisition_session(id),
    session_type          TEXT NOT NULL DEFAULT 'light',
    gain                  REAL,
    offset_val            REAL,
    exposure_s            REAL,
    temp_c                REAL,
    filter_name           TEXT,
    rotation_deg          REAL,
    binning               TEXT,
    optic_train           TEXT,
    observing_night_date  TEXT,   -- YYYY-MM-DD local observing night
    has_observer_location INTEGER NOT NULL DEFAULT 0,
    has_exposure_start_utc INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tool_launches (
    id           TEXT    NOT NULL PRIMARY KEY,  -- UUID
    project_id   TEXT    NOT NULL,
    tool_id      TEXT    NOT NULL,              -- matches ToolProfile.id
    launched_at  TEXT    NOT NULL,              -- RFC-3339
    pid          INTEGER,                       -- OS PID; NULL when not surfaced before detach
    working_dir  TEXT,                          -- resolved cwd passed to the child
    args_hash    TEXT,                          -- BLAKE3 hex; NULL when failure before render
    outcome      TEXT    NOT NULL DEFAULT 'spawned',
    completed_at TEXT,                          -- reserved for spec 012; always NULL in v1
    audit_id     TEXT    NOT NULL               -- back-reference to events/audit table
);
CREATE INDEX tool_launches_project_launched
    ON tool_launches (project_id, launched_at DESC);
CREATE TABLE processing_artifacts (
    id                         TEXT    NOT NULL PRIMARY KEY,  -- UUID (C4)
    project_id                 TEXT    NOT NULL,
    tool_launch_id             TEXT    NULL      REFERENCES tool_launches(id),
    path                       TEXT    NOT NULL,              -- project-relative
    kind                       TEXT    NOT NULL CHECK (kind IN ('intermediate','master','final')),
    tool                       TEXT    NOT NULL,              -- workflow-profile tool id
    detected_at                TEXT    NOT NULL,              -- RFC-3339; app-clock (R-AppClock)
    last_seen_at               TEXT    NOT NULL,              -- updated on every reconciliation pass
    state                      TEXT    NOT NULL DEFAULT 'present'
                                       CHECK (state IN ('present','missing','user_resolved_missing')),
    classification_confidence  REAL    NOT NULL CHECK (classification_confidence >= 0.0 AND classification_confidence <= 1.0),
    classification_source      TEXT    NOT NULL CHECK (classification_source IN ('rule','manual_override','fallback')),
    size_bytes                 INTEGER NOT NULL,
    file_mtime                 TEXT    NOT NULL,              -- stored; NOT used for attribution
    content_hash               TEXT    NULL,                  -- hex SHA-256; updated in-place on rerun (A8)
    UNIQUE (project_id, path)
);
CREATE INDEX idx_artifacts_project
    ON processing_artifacts (project_id, detected_at DESC);
CREATE INDEX idx_artifacts_state
    ON processing_artifacts (state);
CREATE TABLE classification_overrides (
    artifact_id  TEXT NOT NULL PRIMARY KEY REFERENCES processing_artifacts(id),
    kind         TEXT NOT NULL CHECK (kind IN ('intermediate','master','final')),
    created_at   TEXT NOT NULL,
    reason       TEXT NULL
);
CREATE TABLE manifests (
    id          TEXT    NOT NULL PRIMARY KEY,   -- UUID (C4)
    project_id  TEXT    NOT NULL REFERENCES projects(id),
    reason      TEXT    NOT NULL CHECK (reason IN (
                    'created','source_change','lifecycle_transition',
                    'cleanup_applied','workflow_run'
                )),
    timestamp   TEXT    NOT NULL,               -- RFC-3339 UTC
    path        TEXT    NOT NULL,               -- project-relative, e.g. notes/manifest-…md
    version     INTEGER NOT NULL DEFAULT 1,     -- front-matter schema version
    body_json   TEXT    NOT NULL DEFAULT '{}'   -- JSON serialisation of ManifestBody
);
CREATE INDEX idx_manifests_project_ts
    ON manifests (project_id, timestamp DESC);
CREATE TABLE project_notes (
    id          TEXT    NOT NULL PRIMARY KEY,   -- UUID (C4)
    project_id  TEXT    NOT NULL UNIQUE REFERENCES projects(id),
    updated_at  TEXT    NOT NULL,               -- RFC-3339 UTC
    content     TEXT    NOT NULL DEFAULT ''     -- ≤16 384 UTF-8 bytes enforced in app layer
);
CREATE TABLE prepared_source_views (
    id           TEXT    NOT NULL PRIMARY KEY,          -- UUID
    project_id   TEXT    NOT NULL REFERENCES projects(id),
    kind         TEXT    NOT NULL CHECK (kind IN (
                     'symlink', 'junction', 'copy', 'hardlink'
                 )),
    state        TEXT    NOT NULL DEFAULT 'current' CHECK (state IN (
                     'current', 'stale', 'missing', 'removed',
                     'failed', 'kind_diverged'
                 )),
    created_at   TEXT    NOT NULL,                      -- RFC-3339 UTC
    removed_at   TEXT                                   -- set when ViewRemovalPlan applied
);
CREATE INDEX idx_prepared_source_views_project
    ON prepared_source_views (project_id);
CREATE TABLE prepared_source_view_items (
    id                   TEXT    NOT NULL PRIMARY KEY,  -- UUID
    view_id              TEXT    NOT NULL REFERENCES prepared_source_views(id),
    inventory_item_id    TEXT    NOT NULL,              -- FK to inventory items (no FK constraint — inventory may be missing)
    view_relative_path   TEXT    NOT NULL,              -- path under project workspace
    materialization      TEXT    NOT NULL CHECK (materialization IN (
                             'symlink', 'junction', 'copy', 'hardlink'
                         )),
    last_observed_state  TEXT    NOT NULL DEFAULT 'present' CHECK (last_observed_state IN (
                             'present', 'missing', 'changed_kind', 'diverged', 'hash_diverged'
                         ))
);
CREATE INDEX idx_psvi_view_id
    ON prepared_source_view_items (view_id);
CREATE TABLE canonical_target (
    id                  TEXT    NOT NULL PRIMARY KEY,     -- UUID v5
    simbad_oid          INTEGER,                          -- SIMBAD physical-object id; UNIQUE when non-null
    primary_designation TEXT    NOT NULL,                 -- canonical display designation
    object_type         TEXT    NOT NULL,                 -- closed ObjectType enum (snake_case)
    ra_deg              REAL    NOT NULL CHECK (ra_deg  >= 0   AND ra_deg  < 360),
    dec_deg             REAL    NOT NULL CHECK (dec_deg >= -90 AND dec_deg <= 90),
    source              TEXT    NOT NULL CHECK (source IN ('seed', 'resolved', 'user-override')),
    resolved_at         TEXT    NOT NULL,                 -- RFC 3339 UTC
    -- spec 036: optional user-owned display label. NULL = show primary_designation.
    -- Presentation only — never matched/normalized; preserved across re-resolution.
    display_alias       TEXT
, constellation TEXT, magnitude     REAL, notes TEXT);
CREATE UNIQUE INDEX idx_canonical_target_simbad_oid
    ON canonical_target(simbad_oid) WHERE simbad_oid IS NOT NULL;
CREATE TABLE target_alias (
    id          TEXT NOT NULL PRIMARY KEY,                -- UUID
    target_id   TEXT NOT NULL REFERENCES canonical_target(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,                            -- display designation / NAME common name
    normalized  TEXT NOT NULL,                            -- normalized form for matching (spec 013)
    -- spec 036: 'user' marks a user-added alias (only these are user-removable).
    kind        TEXT NOT NULL CHECK (kind IN ('designation', 'common_name', 'user')),
    UNIQUE (target_id, normalized)
);
CREATE INDEX idx_target_alias_normalized
    ON target_alias(normalized);
CREATE TABLE resolver_settings (
    id                   INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
    online_enabled       INTEGER NOT NULL DEFAULT 1,      -- bool; online SIMBAD resolution (FR-015)
    simbad_endpoint      TEXT    NOT NULL DEFAULT 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
    debounce_ms          INTEGER NOT NULL DEFAULT 300,    -- interactive query debounce
    request_timeout_secs INTEGER NOT NULL DEFAULT 10      -- per-request timeout; degrade to seed+cache
);
CREATE TABLE ingest_resolution (
    id          TEXT    NOT NULL PRIMARY KEY,             -- UUID
    image_id    TEXT    NOT NULL REFERENCES file_record(id) ON DELETE CASCADE,
    object_raw  TEXT    NOT NULL,                         -- verbatim FITS OBJECT value
    state       TEXT    NOT NULL CHECK (state IN ('pending', 'resolved', 'unresolved')),
    target_id   TEXT    REFERENCES canonical_target(id),  -- set when resolved
    attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ingest_resolution_pending
    ON ingest_resolution(state) WHERE state = 'pending';
CREATE TABLE "registered_sources" (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('light_frames', 'calibration', 'project', 'inbox')),
    path         TEXT NOT NULL,
    kind_subtype TEXT,
    scan_depth   TEXT NOT NULL DEFAULT 'recursive' CHECK (scan_depth IN ('recursive', 'single')),
    created_at   TEXT NOT NULL,
    created_via  TEXT NOT NULL CHECK (created_via IN ('first_run', 'settings_add', 'settings_restart')),
    last_seen_at TEXT, organization_state TEXT NOT NULL DEFAULT 'unorganized'
        CHECK (organization_state IN ('organized', 'unorganized')), active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(kind, path)
);
CREATE INDEX idx_projects_canonical_target_id
    ON projects(canonical_target_id);
CREATE TABLE protection_defaults (
    scope      TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,  -- JSON-encoded value
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, key)
);
CREATE TABLE project (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    target_id   TEXT NOT NULL REFERENCES target(id),
    session_ids TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_project_target ON project(target_id);
CREATE INDEX idx_cal_fp_type_gain_binning
    ON calibration_fingerprint (calibration_type, gain, binning);
CREATE INDEX idx_cal_fp_type_filter
    ON calibration_fingerprint (calibration_type, filter_name)
    WHERE filter_name IS NOT NULL;
CREATE INDEX idx_acq_fp_gain_binning
    ON acquisition_fingerprint (gain, binning);
CREATE TABLE inbox_file_metadata (
    id                   TEXT PRIMARY KEY NOT NULL,
    inbox_item_id        TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
    relative_file_path   TEXT NOT NULL,
    -- extracted image-header fields (all nullable — not all file types carry all fields)
    filter               TEXT,
    exposure_s           REAL,
    gain                 TEXT,
    binning_x            INTEGER,
    binning_y            INTEGER,
    temperature_c        REAL,
    object               TEXT,
    date_obs             TEXT,
    instrume             TEXT,
    telescop             TEXT,
    naxis1               INTEGER,
    naxis2               INTEGER,
    stack_count          INTEGER,
    -- cheap per-file identity for override staleness (R-4; no full-content hash)
    file_size_bytes      INTEGER,
    file_mtime           TEXT, offset          INTEGER, set_temp_c      REAL, ccd_temp_c      REAL, ra_deg          REAL, dec_deg         REAL, rotator_angle_deg REAL, rotator_name    TEXT, sky_rotation_deg REAL, readout_mode    TEXT, focal_length_mm REAL, pixel_size_um   REAL, observer_lat    REAL, observer_long   REAL, observer_elev   REAL, date_loc        TEXT, date_end        TEXT, mjd_avg         REAL, mjd_obs         REAL, wcs_ra_deg       REAL, wcs_dec_deg      REAL, wcs_rotation_deg REAL,
    UNIQUE (inbox_item_id, relative_file_path)
);
CREATE INDEX inbox_file_metadata_item
    ON inbox_file_metadata (inbox_item_id);
CREATE TABLE "plan_items" (
    id                          TEXT PRIMARY KEY NOT NULL,
    plan_id                     TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    item_index                  INTEGER NOT NULL,
    name                        TEXT NOT NULL,
    action                      TEXT NOT NULL CHECK (action IN (
                                    'move', 'archive', 'delete', 'link', 'write',
                                    'mkdir', 'write_manifest', 'catalogue'
                                )),
    from_root_id                TEXT,
    from_relative_path          TEXT NOT NULL DEFAULT '',
    to_root_id                  TEXT,
    to_relative_path            TEXT NOT NULL DEFAULT '',
    reason                      TEXT NOT NULL DEFAULT '',
    protection                  TEXT NOT NULL DEFAULT 'normal'
                                    CHECK (protection IN ('normal', 'protected')),
    linked_entity               TEXT,
    item_state                  TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (item_state IN (
                                        'pending', 'applying', 'succeeded',
                                        'failed', 'skipped', 'cancelled'
                                    )),
    failure_reason              TEXT,
    provenance                  TEXT,
    approved_mtime              TEXT,
    approved_size_bytes         INTEGER,
    archive_path                TEXT,
    created_at                  TEXT NOT NULL,
    -- added by migration 0015
    item_stale                  INTEGER NOT NULL DEFAULT 0,
    -- added by migration 0039
    source_id                   TEXT,
    category                    TEXT,
    requires_destructive_confirm INTEGER NOT NULL DEFAULT 0,
    resolved_pattern            TEXT,
    -- added by migration 0041
    destructive_confirmed       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX plan_items_plan   ON plan_items (plan_id, item_index ASC);
CREATE INDEX plan_items_source ON plan_items (source_id)
    WHERE source_id IS NOT NULL;
CREATE INDEX idx_acq_session_canonical_target
    ON acquisition_session(canonical_target_id)
    WHERE canonical_target_id IS NOT NULL;
CREATE INDEX idx_acq_session_session_key
    ON acquisition_session(session_key);
CREATE TABLE inbox_source_groups (
    id                  TEXT        NOT NULL PRIMARY KEY,
    root_id             TEXT        NOT NULL,           -- FK to library root (Constitution §I)
    relative_path       TEXT        NOT NULL,           -- leaf folder relative to root
    discovered_at       TEXT        NOT NULL,
    last_scanned_at     TEXT        NOT NULL,
    content_signature   TEXT,                           -- folder-level signature (partial 65 KB read); lazy
    format              TEXT,                           -- dominant format: fits/xisf/video/mixed/NULL
    lane                TEXT,                           -- move-vs-catalogue (from source organization_state)
    child_count         INTEGER     NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0, -- single-type sub-items from this group
    UNIQUE (root_id, relative_path)
);
CREATE INDEX inbox_source_groups_root
    ON inbox_source_groups (root_id);
CREATE TABLE "inbox_items" (
    id                  TEXT        NOT NULL PRIMARY KEY,
    root_id             TEXT        NOT NULL,
    relative_path       TEXT        NOT NULL,
    source_group_id     TEXT        REFERENCES inbox_source_groups(id) ON DELETE SET NULL,
    group_key           TEXT        NOT NULL DEFAULT '',  -- empty sentinel for legacy rows
    group_label         TEXT,
    frame_type          TEXT
                            CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    file_count          INTEGER     NOT NULL DEFAULT 0,
    discovered_at       TEXT        NOT NULL,
    last_scanned_at     TEXT        NOT NULL,
    content_signature   TEXT,
    state               TEXT        NOT NULL DEFAULT 'pending_classification'
                            CHECK (state IN (
                                'pending_classification',
                                'classified',
                                'plan_open',
                                'resolved'
                            )),
    lane                TEXT        NOT NULL DEFAULT 'fits'
                            CHECK (lane IN ('fits', 'video')),
    -- columns from migration 0043
    format              TEXT,
    is_master_item      INTEGER     NOT NULL DEFAULT 0
                            CHECK (is_master_item IN (0, 1)),
    master_frame_type   TEXT,
    master_filter       TEXT,
    master_exposure_s   REAL, needs_review INTEGER NOT NULL DEFAULT 0
        CHECK (needs_review IN (0, 1)),
    UNIQUE (root_id, relative_path, group_key)
);
CREATE INDEX inbox_items_root_path
    ON inbox_items (root_id, relative_path);
CREATE INDEX inbox_items_source_group
    ON inbox_items (source_group_id)
    WHERE source_group_id IS NOT NULL;
CREATE TABLE inbox_file_overrides (
    id                  TEXT        NOT NULL PRIMARY KEY,
    source_group_id     TEXT        NOT NULL
                            REFERENCES inbox_source_groups(id) ON DELETE CASCADE,
    relative_file_path  TEXT        NOT NULL,           -- file within the source group
    property_key        TEXT        NOT NULL,           -- from R-13 property registry
    value               TEXT        NOT NULL,           -- typed per registry; stored as text/JSON
    file_size_bytes     INTEGER,                        -- staleness identity (R-4)
    file_mtime          TEXT,                           -- staleness identity (R-4)
    override_stale      INTEGER     NOT NULL DEFAULT 0, -- 1 when file size/mtime changed
    set_at              TEXT        NOT NULL,
    UNIQUE (source_group_id, relative_file_path, property_key)
);
CREATE INDEX inbox_file_overrides_group
    ON inbox_file_overrides (source_group_id);
CREATE INDEX inbox_file_overrides_group_file
    ON inbox_file_overrides (source_group_id, relative_file_path);
CREATE TABLE "inbox_classifications" (
    inbox_item_id           TEXT        NOT NULL PRIMARY KEY
                                REFERENCES inbox_items(id) ON DELETE CASCADE,
    result                  TEXT        NOT NULL
                                CHECK (result IN ('classified', 'unclassified')),
    frame_type              TEXT
                                CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    computed_at             TEXT        NOT NULL,
    content_signature       TEXT        NOT NULL,
    unclassified_file_count INTEGER     NOT NULL DEFAULT 0
);
CREATE TABLE "inbox_classification_evidence" (
    id                  TEXT        NOT NULL PRIMARY KEY,
    inbox_item_id       TEXT        NOT NULL
                            REFERENCES inbox_items(id) ON DELETE CASCADE,
    relative_file_path  TEXT        NOT NULL,
    frame_type          TEXT
                            CHECK (frame_type IN ('light','dark','bias','flat','dark_flat')),
    evidence_source     TEXT        NOT NULL DEFAULT 'none'
                            CHECK (evidence_source IN (
                                'imagetyp_header',
                                'xisf_property',
                                'manual_override',
                                'none'
                            )),
    raw_value           TEXT,
    unclassified        INTEGER     NOT NULL DEFAULT 0  CHECK (unclassified IN (0,1)),
    -- manual_override retained: the "correct classification" action still uses it
    -- until T068 (field-agnostic reclassify) lands. After T068, the frameType
    -- override in inbox_file_overrides supersedes this column.
    manual_override     TEXT
                            CHECK (manual_override IN ('light','dark','bias','flat','dark_flat')),
    -- from migration 0042
    is_master           INTEGER     NOT NULL DEFAULT 0  CHECK (is_master IN (0,1)),
    master_detector     TEXT,
    -- override_stale kept (per-file staleness flag used by UI)
    override_stale      INTEGER     NOT NULL DEFAULT 0
);
CREATE INDEX inbox_evidence_item
    ON inbox_classification_evidence (inbox_item_id);
CREATE UNIQUE INDEX inbox_evidence_item_path
    ON inbox_classification_evidence (inbox_item_id, relative_file_path);
CREATE TABLE target_favourite (
    target_id     TEXT NOT NULL PRIMARY KEY REFERENCES canonical_target(id) ON DELETE CASCADE,
    favourited_at TEXT NOT NULL
);
CREATE INDEX idx_audit_outcome ON audit_log_entry(outcome, reason_code);
CREATE TABLE framing (
    id                      TEXT NOT NULL PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Nullable: FR-018 forbids OBJECT/panel-name attribution; a framing may
    -- exist before target resolution completes.
    target_id               TEXT REFERENCES canonical_target(id),
    -- Optic-train identity (Q12/Q17 grouping key).
    optic_train_key         TEXT NOT NULL,
    -- Representative FOV-relative pointing (circular-mean of members, R11a).
    pointing_ra_deg         REAL NOT NULL,
    pointing_dec_deg        REAL NOT NULL,
    rotation_deg            REAL NOT NULL,
    -- Snapshot of the tunable tolerance the clustering pass used (FR-014).
    -- `tolerance_pointing` is unit-agnostic (FOV-relative fraction, or the
    -- absolute-degree no-FOV fallback per research R11a); never an exact key.
    tolerance_pointing      REAL NOT NULL,
    tolerance_rotation_deg  REAL NOT NULL,
    -- 'suggested' | 'user_adjusted' (FR-015). Re-derivation MUST NEVER modify
    -- a 'user_adjusted' framing.
    clustering              TEXT NOT NULL DEFAULT 'suggested'
                                 CHECK (clustering IN ('suggested', 'user_adjusted')),
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);
CREATE INDEX idx_framing_project ON framing(project_id);
CREATE INDEX idx_framing_target  ON framing(target_id)
    WHERE target_id IS NOT NULL;
CREATE TABLE framing_session (
    framing_id  TEXT NOT NULL REFERENCES framing(id) ON DELETE CASCADE,
    -- UNIQUE: a light session belongs to at most one framing.
    session_id  TEXT NOT NULL UNIQUE REFERENCES acquisition_session(id) ON DELETE CASCADE,
    added_at    TEXT NOT NULL,
    PRIMARY KEY (framing_id, session_id)
);
CREATE INDEX idx_acq_session_optic_train_key
    ON acquisition_session(optic_train_key)
    WHERE optic_train_key IS NOT NULL;
CREATE INDEX idx_framing_optic_train_key ON framing(optic_train_key);
CREATE TABLE processing_artifact (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT REFERENCES project(id),
    file_record_id TEXT NOT NULL REFERENCES file_record(id),
    kind TEXT NOT NULL CHECK (kind IN ('master', 'integration', 'drizzle', 'manifest', 'other')),
    tool TEXT,
    staleness TEXT NOT NULL CHECK (staleness IN ('current', 'stale', 'regenerating')),
    created_at TEXT NOT NULL
);
CREATE TABLE prepared_source_view (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES project(id),
    state TEXT NOT NULL CHECK (state IN ('not_created', 'planned', 'ready', 'stale', 'retired')),
    created_at TEXT NOT NULL
);
CREATE VIEW ledger_view AS
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
    'project',
    id,
    lifecycle,
    name,
    NULL,
    id,
    updated_at
FROM projects
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
CREATE TABLE "source_protection_state" (
    source_id             TEXT PRIMARY KEY NOT NULL,
    level                 TEXT NOT NULL CHECK (level IN ('protected', 'unprotected')),
    block_permanent_delete INTEGER,
    categories            TEXT,
    updated_at            TEXT NOT NULL,
    updated_by            TEXT NOT NULL DEFAULT 'system'
);
CREATE TABLE "plans" (
    id                       TEXT    NOT NULL PRIMARY KEY,
    number                   INTEGER NOT NULL,
    title                    TEXT    NOT NULL,
    origin                   TEXT    NOT NULL CHECK (origin IN ('project','inbox','cleanup','archive','restore','source_view','manifest','prepared_view_removal','prepared_view_regeneration','prepared_view_generation','calibration_master_archive','calibration_master_restore')),
    origin_path              TEXT,
    state                    TEXT    NOT NULL CHECK (state IN ('draft','ready_for_review','approved','applying','paused','applied','partially_applied','failed','cancelled','discarded')),
    plan_type                TEXT    NOT NULL CHECK (plan_type IN ('split','restructure','cleanup','archive','restore','source_map','project_create','source_view_removal','source_view_regeneration','source_view_generation','calibration_master_archive','calibration_master_restore')),
    destructive_destination  TEXT    NOT NULL DEFAULT 'archive'
                               CHECK (destructive_destination IN ('archive','trash')),
    parent_plan_id           TEXT    REFERENCES "plans"(id),
    items_total              INTEGER NOT NULL DEFAULT 0,
    items_applied            INTEGER NOT NULL DEFAULT 0,
    items_failed             INTEGER NOT NULL DEFAULT 0,
    items_skipped            INTEGER NOT NULL DEFAULT 0,
    items_cancelled          INTEGER NOT NULL DEFAULT 0,
    items_pending            INTEGER NOT NULL DEFAULT 0,
    total_bytes_required     INTEGER NOT NULL DEFAULT 0,
    approval_token           TEXT,
    approved_at              TEXT,
    discarded_at             TEXT,
    created_at               TEXT    NOT NULL,
    chosen_framing_id        TEXT    REFERENCES framing(id)
);
CREATE INDEX plans_state_created ON plans (state, created_at DESC);
CREATE INDEX plans_parent        ON plans (parent_plan_id);
CREATE VIEW calibration_master_view AS
SELECT
    cs.id                                               AS id,
    cs.kind                                             AS kind,
    COALESCE(cf.calibration_type, cs.kind)              AS calibration_type,
    cs.created_at                                       AS created_at,
    CAST(NULL AS INTEGER)                               AS size_bytes,
    cf.gain                                             AS fp_gain,
    cf.offset_val                                       AS fp_offset_val,
    cf.exposure_s                                       AS fp_exposure_s,
    cf.temp_c                                           AS fp_temp_c,
    cf.filter_name                                      AS fp_filter_name,
    cf.rotation_deg                                     AS fp_rotation_deg,
    cf.binning                                          AS fp_binning,
    cf.optic_train                                      AS fp_optic_train,
    cf.source_session_id                                AS source_session_id,
    cf.observing_night_date                             AS observing_night_date,
    cs.root_id                                          AS root_id,
    fr.relative_path                                    AS frame_relative_path,
    cs.archived_at                                      AS archived_at,
    cs.archived_via_plan_id                             AS archived_via_plan_id
FROM calibration_session cs
LEFT JOIN calibration_fingerprint cf ON cf.id = cs.id
LEFT JOIN file_record fr ON fr.id = json_extract(cs.frame_ids, '$[0]')
WHERE cs.kind IN ('dark', 'flat', 'bias');
CREATE TABLE onboarding_state (
    item_id TEXT NOT NULL PRIMARY KEY,
    state   TEXT NOT NULL CHECK (state IN ('unchecked', 'auto_checked', 'manually_checked', 'dismissed')),
    at      TEXT NOT NULL,
    source  TEXT NOT NULL CHECK (source IN ('seed', 'event', 'user'))
);
CREATE TABLE onboarding_flags (
    singleton_id       INTEGER NOT NULL PRIMARY KEY CHECK (singleton_id = 1),
    orientation_done_at TEXT,
    section_hidden_at   TEXT,
    sidebar_collapsed   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "calibration_tolerances" VALUES('default',5.0,2.0,365,1,1,1,'2026-05-26T00:00:00Z',1);
INSERT INTO "cleanup_policy" VALUES('bias_subs_with_master','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('calibrated_lights','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('cosmetic_correction','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('dark_subs_with_master','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('debayered_frames','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('drizzle_data','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('flat_subs_with_master','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('light_subs_with_master','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('master_bias','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('master_dark','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('master_flat','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('master_light','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('processing_logs','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('registered_lights','keep','2026-05-26T00:00:00Z');
INSERT INTO "cleanup_policy" VALUES('sequence_files','keep','2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000001','Ha','narrowband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000002','SII','narrowband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000003','OIII','narrowband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000004','NII','narrowband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000005','L','broadband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000006','R','broadband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000007','G','broadband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000008','B','broadband',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-000000000009','HO','dual_band',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-00000000000a','SO','dual_band',0,'2026-05-26T00:00:00Z');
INSERT INTO "filters" VALUES('a0000000-0000-4000-8000-00000000000b','UV/IR Cut','other',0,'2026-05-26T00:00:00Z');
INSERT INTO "ingestion_settings" VALUES('default',1,1,0,0,0,1,2.0,5.0,NULL,'2026-05-26T00:00:00Z');
INSERT INTO "protection_defaults" VALUES('global','blockPermanentDelete','true','1970-01-01T00:00:00Z');
INSERT INTO "protection_defaults" VALUES('global','defaultProtection','"protected"','1970-01-01T00:00:00Z');
INSERT INTO "protection_defaults" VALUES('global','protectedCategories','["lights","masters","finals"]','1970-01-01T00:00:00Z');
INSERT INTO "resolver_settings" VALUES(1,1,'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',300,10);
INSERT INTO "source_view_config" VALUES('default','junctions','2026-05-26T00:00:00Z');
