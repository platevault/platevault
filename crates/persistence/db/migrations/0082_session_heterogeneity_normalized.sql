-- Spec 062: normalized immutable sessions, relation history, and materialization journals.
--
-- Public UUIDv7 values remain TEXT at the API boundary. All physical relationships use
-- INTEGER row keys. Relationship and result collections are normalized child rows; JSON is
-- reserved for canonical source, audit, command-response, and outbox payloads.

CREATE TABLE spec062_actor (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE spec062_config_revision (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    revision_number INTEGER NOT NULL UNIQUE CHECK (revision_number >= 1),
    canonical_digest TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE repository_change (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    command_row_id INTEGER,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE command_execution (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    operation TEXT NOT NULL,
    canonical_payload_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('received','executing','applied','refused','failed')),
    state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
    lease_owner TEXT,
    lease_expires_at TEXT,
    heartbeat_at TEXT,
    response_json TEXT,
    result_ref_type TEXT,
    result_ref_public_id TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
    CHECK ((lease_owner IS NULL) = (heartbeat_at IS NULL)),
    CHECK ((state IN ('applied','refused','failed')) = (finished_at IS NOT NULL)),
    CHECK ((state IN ('refused','failed')) = (error_code IS NOT NULL))
) STRICT;

CREATE INDEX idx_command_execution_recovery
    ON command_execution(lease_expires_at, row_id)
    WHERE state IN ('received','executing');

CREATE TABLE spec062_file_identity (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    legacy_file_public_id TEXT UNIQUE,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE frame_record (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    file_row_id INTEGER NOT NULL UNIQUE REFERENCES spec062_file_identity(row_id),
    content_fingerprint TEXT,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    captured_metadata_digest TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE frame_metadata_evidence (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    frame_row_id INTEGER NOT NULL REFERENCES frame_record(row_id),
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    predecessor_evidence_row_id INTEGER REFERENCES frame_metadata_evidence(row_id),
    detected_kind TEXT NOT NULL CHECK (detected_kind IN ('light','dark','bias','flat')),
    canonical_exposure_at_utc TEXT,
    exposure_us INTEGER CHECK (exposure_us IS NULL OR exposure_us >= 0),
    offset_state TEXT NOT NULL CHECK (offset_state IN ('present','absent','invalid','contradictory')),
    offset_value INTEGER,
    binning_state TEXT NOT NULL CHECK (binning_state IN ('present','absent','invalid','contradictory')),
    bin_x INTEGER,
    bin_y INTEGER,
    readout_state TEXT NOT NULL CHECK (readout_state IN ('present','absent','invalid','contradictory')),
    readout_mode TEXT,
    raster_width INTEGER CHECK (raster_width IS NULL OR raster_width > 0),
    raster_height INTEGER CHECK (raster_height IS NULL OR raster_height > 0),
    parity TEXT CHECK (parity IS NULL OR parity IN ('normal','mirrored')),
    footprint_wkb BLOB,
    footprint_digest TEXT,
    bbox_min_x_ppb INTEGER CHECK (bbox_min_x_ppb BETWEEN -1000000000 AND 1000000000),
    bbox_max_x_ppb INTEGER CHECK (bbox_max_x_ppb BETWEEN -1000000000 AND 1000000000),
    bbox_min_y_ppb INTEGER CHECK (bbox_min_y_ppb BETWEEN -1000000000 AND 1000000000),
    bbox_max_y_ppb INTEGER CHECK (bbox_max_y_ppb BETWEEN -1000000000 AND 1000000000),
    bbox_min_z_ppb INTEGER CHECK (bbox_min_z_ppb BETWEEN -1000000000 AND 1000000000),
    bbox_max_z_ppb INTEGER CHECK (bbox_max_z_ppb BETWEEN -1000000000 AND 1000000000),
    geometry_solver_version TEXT,
    source_payload_json TEXT,
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    command_row_id INTEGER NOT NULL REFERENCES command_execution(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    recorded_at TEXT NOT NULL,
    UNIQUE (frame_row_id, revision_number),
    UNIQUE (predecessor_evidence_row_id),
    CHECK ((offset_state = 'present') = (offset_value IS NOT NULL)),
    CHECK ((binning_state = 'present') = (bin_x IS NOT NULL AND bin_y IS NOT NULL)),
    CHECK (bin_x IS NULL OR bin_x > 0),
    CHECK (bin_y IS NULL OR bin_y > 0),
    CHECK ((readout_state = 'present') = (readout_mode IS NOT NULL)),
    CHECK ((footprint_wkb IS NULL) = (footprint_digest IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_min_x_ppb IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_max_x_ppb IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_min_y_ppb IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_max_y_ppb IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_min_z_ppb IS NULL)),
    CHECK ((footprint_wkb IS NULL) = (bbox_max_z_ppb IS NULL)),
    CHECK (bbox_min_x_ppb IS NULL OR bbox_min_x_ppb <= bbox_max_x_ppb),
    CHECK (bbox_min_y_ppb IS NULL OR bbox_min_y_ppb <= bbox_max_y_ppb),
    CHECK (bbox_min_z_ppb IS NULL OR bbox_min_z_ppb <= bbox_max_z_ppb)
) STRICT;

CREATE TABLE frame_metadata_evidence_head (
    frame_row_id INTEGER PRIMARY KEY REFERENCES frame_record(row_id),
    head_evidence_row_id INTEGER NOT NULL UNIQUE REFERENCES frame_metadata_evidence(row_id),
    head_generation INTEGER NOT NULL DEFAULT 0 CHECK (head_generation >= 0)
) STRICT;

-- Values are already conservatively quantized by floor(min * 1e9) and ceil(max * 1e9)
-- before insertion. rtree_i32 preserves those outward i32 bounds without float narrowing.
CREATE VIRTUAL TABLE frame_footprint_rtree USING rtree_i32(
    evidence_row_id,
    min_x_ppb, max_x_ppb,
    min_y_ppb, max_y_ppb,
    min_z_ppb, max_z_ppb
);

CREATE TRIGGER frame_metadata_evidence_rtree_insert
AFTER INSERT ON frame_metadata_evidence
WHEN NEW.footprint_wkb IS NOT NULL
BEGIN
    INSERT INTO frame_footprint_rtree VALUES (
        NEW.row_id,
        NEW.bbox_min_x_ppb, NEW.bbox_max_x_ppb,
        NEW.bbox_min_y_ppb, NEW.bbox_max_y_ppb,
        NEW.bbox_min_z_ppb, NEW.bbox_max_z_ppb
    );
END;

CREATE TABLE acquisition_site (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    timezone_name TEXT,
    timezone_state TEXT NOT NULL CHECK (timezone_state IN ('confirmed','unconfirmed','absent')),
    latitude_udeg INTEGER,
    longitude_udeg INTEGER,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    CHECK ((timezone_state = 'absent') = (timezone_name IS NULL))
) STRICT;

CREATE TABLE session_materialization_operation (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('inbox_ingestion','metadata_reclassification')),
    command_row_id INTEGER NOT NULL UNIQUE REFERENCES command_execution(row_id),
    config_revision_row_id INTEGER NOT NULL REFERENCES spec062_config_revision(row_id),
    state TEXT NOT NULL CHECK (state IN ('ready','applying','cancelling','cancelled','applied','failed')),
    state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    result_snapshot_row_id INTEGER REFERENCES session_materialization_result_snapshot(row_id)
        DEFERRABLE INITIALLY DEFERRED,
    session_count INTEGER CHECK (session_count IS NULL OR session_count >= 0),
    membership_count INTEGER CHECK (membership_count IS NULL OR membership_count >= 0),
    singleton_group_count INTEGER CHECK (singleton_group_count IS NULL OR singleton_group_count >= 0),
    blocked_frame_count INTEGER CHECK (blocked_frame_count IS NULL OR blocked_frame_count >= 0),
    started_at TEXT,
    finished_at TEXT,
    failure_code TEXT,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    CHECK ((state IN ('cancelled','applied','failed')) = (finished_at IS NOT NULL)),
    CHECK ((state = 'failed') = (failure_code IS NOT NULL)),
    CHECK ((state = 'applied') = (result_snapshot_row_id IS NOT NULL))
) STRICT;

CREATE TABLE spec062_target (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE session (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    materialization_operation_row_id INTEGER NOT NULL REFERENCES session_materialization_operation(row_id),
    kind TEXT NOT NULL CHECK (kind IN ('light','dark','bias','flat')),
    ordinal_in_operation INTEGER NOT NULL CHECK (ordinal_in_operation >= 0),
    identity_digest TEXT NOT NULL,
    observing_night_date TEXT NOT NULL,
    site_row_id INTEGER REFERENCES acquisition_site(row_id),
    timezone_name_snapshot TEXT,
    night_derivation TEXT NOT NULL CHECK (night_derivation IN ('acquisition_timezone','reviewed_local_fallback')),
    canonical_target_row_id INTEGER REFERENCES spec062_target(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (materialization_operation_row_id, ordinal_in_operation),
    UNIQUE (materialization_operation_row_id, identity_digest),
    UNIQUE (row_id, materialization_operation_row_id),
    CHECK ((kind = 'light') = (canonical_target_row_id IS NOT NULL)),
    CHECK ((night_derivation = 'acquisition_timezone') = (site_row_id IS NOT NULL AND timezone_name_snapshot IS NOT NULL))
) STRICT;

CREATE INDEX idx_session_kind_cursor ON session(kind, created_at DESC, public_id);
CREATE INDEX idx_session_target_cursor ON session(canonical_target_row_id, created_at DESC, public_id);

CREATE TABLE session_frame (
    session_row_id INTEGER NOT NULL,
    frame_row_id INTEGER NOT NULL REFERENCES frame_record(row_id),
    materialization_operation_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    is_representative INTEGER NOT NULL CHECK (is_representative IN (0,1)),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    PRIMARY KEY (session_row_id, frame_row_id),
    UNIQUE (session_row_id, ordinal),
    UNIQUE (materialization_operation_row_id, frame_row_id),
    FOREIGN KEY (session_row_id, materialization_operation_row_id)
        REFERENCES session(row_id, materialization_operation_row_id)
) STRICT;

CREATE UNIQUE INDEX idx_session_frame_one_representative
    ON session_frame(session_row_id) WHERE is_representative = 1;
CREATE INDEX idx_session_frame_by_frame ON session_frame(frame_row_id, session_row_id);

CREATE TABLE camera (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    regulation_head_decision_public_id TEXT,
    head_generation INTEGER NOT NULL DEFAULT 0 CHECK (head_generation >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE optical_profile (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    representative_camera_row_id INTEGER REFERENCES camera(row_id),
    representative_focal_length_um INTEGER NOT NULL CHECK (representative_focal_length_um > 0),
    representative_raster_width INTEGER NOT NULL CHECK (representative_raster_width > 0),
    representative_raster_height INTEGER NOT NULL CHECK (representative_raster_height > 0),
    representative_pixel_size_nm INTEGER CHECK (representative_pixel_size_nm IS NULL OR representative_pixel_size_nm > 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE filter_label (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    optical_profile_row_id INTEGER NOT NULL REFERENCES optical_profile(row_id),
    normalized_label TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (optical_profile_row_id, normalized_label),
    UNIQUE (row_id, optical_profile_row_id)
) STRICT;

CREATE TABLE light_session_identity (
    session_row_id INTEGER PRIMARY KEY REFERENCES session(row_id),
    optical_profile_row_id INTEGER NOT NULL REFERENCES optical_profile(row_id),
    filter_label_row_id INTEGER NOT NULL,
    exposure_us INTEGER NOT NULL CHECK (exposure_us >= 0),
    gain_text TEXT NOT NULL,
    offset_state TEXT NOT NULL CHECK (offset_state IN ('present','absent')),
    offset_value INTEGER,
    binning_state TEXT NOT NULL CHECK (binning_state IN ('present','absent')),
    bin_x INTEGER,
    bin_y INTEGER,
    readout_state TEXT NOT NULL CHECK (readout_state IN ('present','absent')),
    readout_mode TEXT,
    raster_width INTEGER NOT NULL CHECK (raster_width > 0),
    raster_height INTEGER NOT NULL CHECK (raster_height > 0),
    crop_state TEXT NOT NULL CHECK (crop_state IN ('reported_full','reported_crop','reported_subframe','absent')),
    crop_payload TEXT,
    parity TEXT NOT NULL CHECK (parity IN ('normal','mirrored')),
    footprint_digest TEXT NOT NULL,
    representative_orientation_udeg INTEGER NOT NULL,
    CHECK ((offset_state = 'present') = (offset_value IS NOT NULL)),
    CHECK ((binning_state = 'present') = (bin_x IS NOT NULL AND bin_y IS NOT NULL)),
    CHECK (bin_x IS NULL OR bin_x > 0),
    CHECK (bin_y IS NULL OR bin_y > 0),
    CHECK ((readout_state = 'present') = (readout_mode IS NOT NULL)),
    CHECK ((crop_state IN ('reported_crop','reported_subframe')) = (crop_payload IS NOT NULL)),
    FOREIGN KEY (filter_label_row_id, optical_profile_row_id)
        REFERENCES filter_label(row_id, optical_profile_row_id)
) STRICT;

CREATE TABLE calibration_family (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('dark','bias','flat')),
    camera_row_id INTEGER REFERENCES camera(row_id),
    optical_profile_row_id INTEGER REFERENCES optical_profile(row_id),
    filter_label_row_id INTEGER,
    identity_digest TEXT NOT NULL,
    representative_session_row_id INTEGER REFERENCES session(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    CHECK ((kind IN ('dark','bias')) = (camera_row_id IS NOT NULL)),
    CHECK ((kind = 'flat') = (optical_profile_row_id IS NOT NULL)),
    CHECK ((kind = 'flat') = (filter_label_row_id IS NOT NULL)),
    FOREIGN KEY (filter_label_row_id, optical_profile_row_id)
        REFERENCES filter_label(row_id, optical_profile_row_id)
) STRICT;

CREATE UNIQUE INDEX idx_calibration_family_dark_bias
    ON calibration_family(camera_row_id, kind, identity_digest)
    WHERE kind IN ('dark','bias');
CREATE UNIQUE INDEX idx_calibration_family_flat
    ON calibration_family(optical_profile_row_id, filter_label_row_id, identity_digest)
    WHERE kind = 'flat';

CREATE TABLE dark_recipe_identity (
    family_row_id INTEGER PRIMARY KEY REFERENCES calibration_family(row_id),
    exposure_us INTEGER NOT NULL CHECK (exposure_us >= 0),
    gain_text TEXT NOT NULL,
    offset_state TEXT NOT NULL CHECK (offset_state IN ('present','absent')),
    offset_value INTEGER,
    binning_state TEXT NOT NULL CHECK (binning_state IN ('present','absent')),
    bin_x INTEGER,
    bin_y INTEGER,
    readout_state TEXT NOT NULL CHECK (readout_state IN ('present','absent')),
    readout_mode TEXT,
    CHECK ((offset_state = 'present') = (offset_value IS NOT NULL)),
    CHECK ((binning_state = 'present') = (bin_x IS NOT NULL AND bin_y IS NOT NULL)),
    CHECK ((readout_state = 'present') = (readout_mode IS NOT NULL))
) STRICT;

CREATE TABLE bias_recipe_identity (
    family_row_id INTEGER PRIMARY KEY REFERENCES calibration_family(row_id),
    gain_text TEXT NOT NULL,
    offset_state TEXT NOT NULL CHECK (offset_state IN ('present','absent')),
    offset_value INTEGER,
    binning_state TEXT NOT NULL CHECK (binning_state IN ('present','absent')),
    bin_x INTEGER,
    bin_y INTEGER,
    readout_state TEXT NOT NULL CHECK (readout_state IN ('present','absent')),
    readout_mode TEXT,
    CHECK ((offset_state = 'present') = (offset_value IS NOT NULL)),
    CHECK ((binning_state = 'present') = (bin_x IS NOT NULL AND bin_y IS NOT NULL)),
    CHECK ((readout_state = 'present') = (readout_mode IS NOT NULL))
) STRICT;

CREATE TABLE flat_family_identity (
    family_row_id INTEGER PRIMARY KEY REFERENCES calibration_family(row_id),
    physical_rotator_state TEXT NOT NULL CHECK (physical_rotator_state IN ('verified','absent','unverified')),
    physical_rotator_udeg INTEGER,
    CHECK ((physical_rotator_state = 'verified') = (physical_rotator_udeg IS NOT NULL))
) STRICT;

CREATE TABLE calibration_session_identity (
    session_row_id INTEGER PRIMARY KEY REFERENCES session(row_id),
    family_row_id INTEGER NOT NULL REFERENCES calibration_family(row_id),
    age_anchor_at_utc TEXT NOT NULL,
    cooling_setpoint_state TEXT NOT NULL CHECK (cooling_setpoint_state IN ('present','absent','invalid','contradictory')),
    cooling_setpoint_millic INTEGER,
    representative_sensor_temperature_state TEXT NOT NULL CHECK (representative_sensor_temperature_state IN ('present','absent','invalid','contradictory')),
    representative_sensor_temperature_millic INTEGER,
    CHECK ((cooling_setpoint_state = 'present') = (cooling_setpoint_millic IS NOT NULL)),
    CHECK ((representative_sensor_temperature_state = 'present') = (representative_sensor_temperature_millic IS NOT NULL))
) STRICT;

CREATE INDEX idx_calibration_session_recency
    ON calibration_session_identity(family_row_id, age_anchor_at_utc DESC, session_row_id);

CREATE TABLE calibration_reuse_decision (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    source TEXT NOT NULL CHECK (source IN ('automatic','audited_manual')),
    audit_public_id TEXT,
    reason_code TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    CHECK ((source = 'audited_manual') = (audit_public_id IS NOT NULL))
) STRICT;

CREATE TABLE session_supersession (
    predecessor_session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    replacement_session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    applied_plan_revision_public_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    PRIMARY KEY (predecessor_session_row_id, replacement_session_row_id),
    CHECK (predecessor_session_row_id <> replacement_session_row_id)
) STRICT;

CREATE INDEX idx_session_supersession_replacement
    ON session_supersession(replacement_session_row_id, predecessor_session_row_id);

CREATE TABLE session_materialization_result_snapshot (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    operation_row_id INTEGER NOT NULL UNIQUE REFERENCES session_materialization_operation(row_id),
    session_count INTEGER NOT NULL CHECK (session_count >= 0),
    membership_count INTEGER NOT NULL CHECK (membership_count >= 0),
    singleton_group_count INTEGER NOT NULL CHECK (singleton_group_count >= 0),
    blocked_frame_count INTEGER NOT NULL CHECK (blocked_frame_count >= 0),
    canonical_digest TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE session_materialization_result_session (
    snapshot_row_id INTEGER NOT NULL REFERENCES session_materialization_result_snapshot(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (snapshot_row_id, session_row_id),
    UNIQUE (snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE session_materialization_result_frame (
    snapshot_row_id INTEGER NOT NULL REFERENCES session_materialization_result_snapshot(row_id),
    session_row_id INTEGER NOT NULL,
    frame_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (snapshot_row_id, session_row_id, frame_row_id),
    UNIQUE (snapshot_row_id, ordinal),
    FOREIGN KEY (session_row_id, frame_row_id) REFERENCES session_frame(session_row_id, frame_row_id)
) STRICT;

CREATE TABLE session_materialization_result_blocked_frame (
    snapshot_row_id INTEGER NOT NULL REFERENCES session_materialization_result_snapshot(row_id),
    frame_row_id INTEGER NOT NULL REFERENCES frame_record(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    reason_code TEXT NOT NULL,
    PRIMARY KEY (snapshot_row_id, frame_row_id),
    UNIQUE (snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE panel_group (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    canonical_target_row_id INTEGER REFERENCES spec062_target(row_id),
    cross_target_association_public_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','retired')),
    head_revision_row_id INTEGER REFERENCES panel_group_revision(row_id)
        DEFERRABLE INITIALLY DEFERRED,
    head_generation INTEGER NOT NULL DEFAULT 0 CHECK (head_generation >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    retired_at TEXT,
    CHECK ((canonical_target_row_id IS NULL) <> (cross_target_association_public_id IS NULL)),
    CHECK ((status = 'retired') = (retired_at IS NOT NULL))
) STRICT;

CREATE TABLE panel_group_revision (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    panel_group_row_id INTEGER NOT NULL REFERENCES panel_group(row_id),
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    parent_revision_row_id INTEGER REFERENCES panel_group_revision(row_id),
    representative_session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    proposal_public_id TEXT,
    config_revision_row_id INTEGER NOT NULL REFERENCES spec062_config_revision(row_id),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    reason_code TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (panel_group_row_id, revision_number),
    UNIQUE (parent_revision_row_id),
    UNIQUE (row_id, panel_group_row_id)
) STRICT;

CREATE TABLE panel_revision_session (
    panel_revision_row_id INTEGER NOT NULL REFERENCES panel_group_revision(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (panel_revision_row_id, session_row_id),
    UNIQUE (panel_revision_row_id, ordinal)
) STRICT;

CREATE INDEX idx_panel_revision_session_lookup
    ON panel_revision_session(session_row_id, panel_revision_row_id);

CREATE TABLE panel_group_head_history (
    panel_group_row_id INTEGER NOT NULL REFERENCES panel_group(row_id),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    head_revision_row_id INTEGER NOT NULL,
    accepted_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    retired_sequence INTEGER REFERENCES repository_change(sequence),
    PRIMARY KEY (panel_group_row_id, generation),
    FOREIGN KEY (head_revision_row_id, panel_group_row_id)
        REFERENCES panel_group_revision(row_id, panel_group_row_id),
    CHECK (retired_sequence IS NULL OR retired_sequence > accepted_sequence)
) STRICT;

CREATE INDEX idx_panel_head_watermark
    ON panel_group_head_history(accepted_sequence DESC, panel_group_row_id);

CREATE TABLE panel_group_lineage (
    predecessor_group_row_id INTEGER NOT NULL REFERENCES panel_group(row_id),
    successor_group_row_id INTEGER NOT NULL REFERENCES panel_group(row_id),
    kind TEXT NOT NULL CHECK (kind IN ('split','merge','identity_change')),
    proposal_public_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    PRIMARY KEY (predecessor_group_row_id, successor_group_row_id),
    CHECK (predecessor_group_row_id <> successor_group_row_id)
) STRICT;

CREATE INDEX idx_panel_lineage_successor
    ON panel_group_lineage(successor_group_row_id, predecessor_group_row_id);

CREATE TABLE mosaic_edge_evidence (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    left_panel_revision_row_id INTEGER NOT NULL REFERENCES panel_group_revision(row_id),
    right_panel_revision_row_id INTEGER NOT NULL REFERENCES panel_group_revision(row_id),
    overlap_ppm INTEGER NOT NULL CHECK (overlap_ppm BETWEEN 0 AND 1000000),
    centre_separation_udeg INTEGER NOT NULL CHECK (centre_separation_udeg >= 0),
    residual_orientation_udeg INTEGER NOT NULL,
    parity_match INTEGER NOT NULL CHECK (parity_match IN (0,1)),
    evidence_digest TEXT NOT NULL,
    config_revision_row_id INTEGER NOT NULL REFERENCES spec062_config_revision(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (left_panel_revision_row_id, right_panel_revision_row_id, evidence_digest),
    CHECK (left_panel_revision_row_id < right_panel_revision_row_id)
) STRICT;

CREATE TABLE mosaic (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    canonical_target_row_id INTEGER REFERENCES spec062_target(row_id),
    cross_target_association_public_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('active','retired')),
    head_revision_row_id INTEGER REFERENCES mosaic_revision(row_id)
        DEFERRABLE INITIALLY DEFERRED,
    head_generation INTEGER NOT NULL DEFAULT 0 CHECK (head_generation >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    retired_at TEXT,
    CHECK ((canonical_target_row_id IS NULL) <> (cross_target_association_public_id IS NULL)),
    CHECK ((status = 'retired') = (retired_at IS NOT NULL))
) STRICT;

CREATE TABLE mosaic_revision (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    mosaic_row_id INTEGER NOT NULL REFERENCES mosaic(row_id),
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    parent_revision_row_id INTEGER REFERENCES mosaic_revision(row_id),
    proposal_public_id TEXT NOT NULL,
    config_revision_row_id INTEGER NOT NULL REFERENCES spec062_config_revision(row_id),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    reason_code TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (mosaic_row_id, revision_number),
    UNIQUE (parent_revision_row_id),
    UNIQUE (row_id, mosaic_row_id)
) STRICT;

CREATE TABLE mosaic_revision_panel (
    mosaic_revision_row_id INTEGER NOT NULL REFERENCES mosaic_revision(row_id),
    panel_revision_row_id INTEGER NOT NULL REFERENCES panel_group_revision(row_id),
    panel_group_row_id INTEGER NOT NULL REFERENCES panel_group(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (mosaic_revision_row_id, panel_revision_row_id),
    UNIQUE (mosaic_revision_row_id, panel_group_row_id),
    UNIQUE (mosaic_revision_row_id, ordinal),
    FOREIGN KEY (panel_revision_row_id, panel_group_row_id)
        REFERENCES panel_group_revision(row_id, panel_group_row_id)
) STRICT;

CREATE TABLE mosaic_revision_edge (
    mosaic_revision_row_id INTEGER NOT NULL REFERENCES mosaic_revision(row_id),
    edge_evidence_row_id INTEGER NOT NULL REFERENCES mosaic_edge_evidence(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (mosaic_revision_row_id, edge_evidence_row_id),
    UNIQUE (mosaic_revision_row_id, ordinal)
) STRICT;

CREATE TABLE mosaic_head_history (
    mosaic_row_id INTEGER NOT NULL REFERENCES mosaic(row_id),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    head_revision_row_id INTEGER NOT NULL,
    accepted_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    retired_sequence INTEGER REFERENCES repository_change(sequence),
    PRIMARY KEY (mosaic_row_id, generation),
    FOREIGN KEY (head_revision_row_id, mosaic_row_id)
        REFERENCES mosaic_revision(row_id, mosaic_row_id),
    CHECK (retired_sequence IS NULL OR retired_sequence > accepted_sequence)
) STRICT;

CREATE TABLE mosaic_lineage (
    predecessor_mosaic_row_id INTEGER NOT NULL REFERENCES mosaic(row_id),
    successor_mosaic_row_id INTEGER NOT NULL REFERENCES mosaic(row_id),
    kind TEXT NOT NULL CHECK (kind IN ('split','merge','identity_change')),
    proposal_public_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    PRIMARY KEY (predecessor_mosaic_row_id, successor_mosaic_row_id),
    CHECK (predecessor_mosaic_row_id <> successor_mosaic_row_id)
) STRICT;

CREATE INDEX idx_mosaic_lineage_successor
    ON mosaic_lineage(successor_mosaic_row_id, predecessor_mosaic_row_id);

CREATE TABLE relation_proposal (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    proposal_revision INTEGER NOT NULL CHECK (proposal_revision >= 1),
    kind TEXT NOT NULL CHECK (kind IN ('panel_add','panel_replace','panel_split','panel_merge','mosaic_create','mosaic_edge','mosaic_split','mosaic_merge','manual_relation')),
    basis_digest TEXT NOT NULL,
    evidence_digest TEXT NOT NULL,
    config_revision_row_id INTEGER NOT NULL REFERENCES spec062_config_revision(row_id),
    state TEXT NOT NULL CHECK (state IN ('pending','accepted','rejected','superseded','stale')),
    actor_row_id INTEGER REFERENCES spec062_actor(row_id),
    reason_code TEXT,
    superseded_by_proposal_row_id INTEGER REFERENCES relation_proposal(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    decided_sequence INTEGER REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    UNIQUE (kind, basis_digest, evidence_digest, config_revision_row_id),
    CHECK ((state = 'pending') = (decided_at IS NULL)),
    CHECK ((state = 'superseded') = (superseded_by_proposal_row_id IS NOT NULL))
) STRICT;

CREATE TABLE relation_proposal_session (
    proposal_row_id INTEGER NOT NULL REFERENCES relation_proposal(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    role TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (proposal_row_id, session_row_id, role),
    UNIQUE (proposal_row_id, ordinal)
) STRICT;

CREATE TABLE relation_decision_snapshot (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    proposal_row_id INTEGER NOT NULL REFERENCES relation_proposal(row_id),
    proposal_revision INTEGER NOT NULL CHECK (proposal_revision >= 1),
    decision_kind TEXT NOT NULL CHECK (decision_kind IN ('accepted','rejected','corrected')),
    accepted_revision_count INTEGER NOT NULL CHECK (accepted_revision_count >= 0),
    retired_group_count INTEGER NOT NULL CHECK (retired_group_count >= 0),
    lineage_count INTEGER NOT NULL CHECK (lineage_count >= 0),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    reason_code TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (proposal_row_id, proposal_revision)
) STRICT;

CREATE TABLE relation_decision_revision (
    decision_snapshot_row_id INTEGER NOT NULL REFERENCES relation_decision_snapshot(row_id),
    revision_kind TEXT NOT NULL CHECK (revision_kind IN ('panel','mosaic')),
    revision_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (decision_snapshot_row_id, revision_kind, revision_row_id),
    UNIQUE (decision_snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE relation_decision_retired_group (
    decision_snapshot_row_id INTEGER NOT NULL REFERENCES relation_decision_snapshot(row_id),
    group_kind TEXT NOT NULL CHECK (group_kind IN ('panel','mosaic')),
    group_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (decision_snapshot_row_id, group_kind, group_row_id),
    UNIQUE (decision_snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE relation_decision_lineage (
    decision_snapshot_row_id INTEGER NOT NULL REFERENCES relation_decision_snapshot(row_id),
    lineage_kind TEXT NOT NULL CHECK (lineage_kind IN ('panel','mosaic','session')),
    predecessor_row_id INTEGER NOT NULL,
    successor_row_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (decision_snapshot_row_id, lineage_kind, predecessor_row_id, successor_row_id),
    UNIQUE (decision_snapshot_row_id, ordinal),
    CHECK (predecessor_row_id <> successor_row_id)
) STRICT;

CREATE TABLE spec062_project (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    membership_head_revision_row_id INTEGER REFERENCES project_membership_revision(row_id)
        DEFERRABLE INITIALLY DEFERRED,
    membership_head_generation INTEGER NOT NULL DEFAULT 0 CHECK (membership_head_generation >= 0),
    materialization_head_snapshot_row_id INTEGER REFERENCES project_materialization_snapshot(row_id)
        DEFERRABLE INITIALLY DEFERRED,
    materialization_head_generation INTEGER NOT NULL DEFAULT 0 CHECK (materialization_head_generation >= 0),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_membership_revision (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    parent_revision_row_id INTEGER REFERENCES project_membership_revision(row_id),
    proposal_row_id INTEGER REFERENCES relation_proposal(row_id),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (project_row_id, revision_number),
    UNIQUE (parent_revision_row_id),
    UNIQUE (row_id, project_row_id)
) STRICT;

CREATE TABLE project_membership_revision_session (
    revision_row_id INTEGER NOT NULL REFERENCES project_membership_revision(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    pin_revision INTEGER NOT NULL CHECK (pin_revision >= 1),
    source TEXT NOT NULL CHECK (source IN ('explicit_add','explicit_replacement','project_creation')),
    replaces_session_row_id INTEGER REFERENCES session(row_id),
    applied_reclassification_plan_revision_public_id TEXT,
    pinned_by_actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    pinned_at TEXT NOT NULL,
    PRIMARY KEY (revision_row_id, session_row_id),
    CHECK ((source = 'explicit_replacement') = (replaces_session_row_id IS NOT NULL)),
    CHECK ((source = 'explicit_replacement') = (applied_reclassification_plan_revision_public_id IS NOT NULL))
) STRICT;

CREATE INDEX idx_project_membership_by_session
    ON project_membership_revision_session(session_row_id, revision_row_id);

CREATE TABLE project_membership_head_history (
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    head_revision_row_id INTEGER NOT NULL,
    accepted_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    retired_sequence INTEGER REFERENCES repository_change(sequence),
    PRIMARY KEY (project_row_id, generation),
    FOREIGN KEY (head_revision_row_id, project_row_id)
        REFERENCES project_membership_revision(row_id, project_row_id),
    CHECK (retired_sequence IS NULL OR retired_sequence > accepted_sequence)
) STRICT;

CREATE TABLE project_materialization_snapshot (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    membership_revision_row_id INTEGER NOT NULL REFERENCES project_membership_revision(row_id),
    predecessor_snapshot_row_id INTEGER REFERENCES project_materialization_snapshot(row_id),
    applied_plan_public_id TEXT NOT NULL UNIQUE,
    entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
    session_count INTEGER NOT NULL CHECK (session_count >= 0),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (row_id, project_row_id),
    UNIQUE (predecessor_snapshot_row_id)
) STRICT;

CREATE TABLE project_materialization_snapshot_session (
    snapshot_row_id INTEGER NOT NULL REFERENCES project_materialization_snapshot(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (snapshot_row_id, session_row_id),
    UNIQUE (snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE materialized_entry (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    first_snapshot_row_id INTEGER NOT NULL REFERENCES project_materialization_snapshot(row_id),
    source_session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    source_frame_row_id INTEGER NOT NULL REFERENCES frame_record(row_id),
    destination_root_public_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_fingerprint TEXT,
    created_by_plan_public_id TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL,
    UNIQUE (project_row_id, destination_root_public_id, relative_path)
) STRICT;

CREATE TABLE project_materialization_snapshot_entry (
    snapshot_row_id INTEGER NOT NULL REFERENCES project_materialization_snapshot(row_id),
    entry_row_id INTEGER NOT NULL REFERENCES materialized_entry(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (snapshot_row_id, entry_row_id),
    UNIQUE (snapshot_row_id, ordinal)
) STRICT;

CREATE TABLE project_materialization_head_history (
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    generation INTEGER NOT NULL CHECK (generation >= 0),
    head_snapshot_row_id INTEGER NOT NULL,
    accepted_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    retired_sequence INTEGER REFERENCES repository_change(sequence),
    PRIMARY KEY (project_row_id, generation),
    FOREIGN KEY (head_snapshot_row_id, project_row_id)
        REFERENCES project_materialization_snapshot(row_id, project_row_id),
    CHECK (retired_sequence IS NULL OR retired_sequence > accepted_sequence)
) STRICT;

CREATE TABLE materialization_update_plan (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    project_row_id INTEGER NOT NULL REFERENCES spec062_project(row_id),
    base_snapshot_row_id INTEGER REFERENCES project_materialization_snapshot(row_id),
    target_membership_revision_row_id INTEGER NOT NULL REFERENCES project_membership_revision(row_id),
    state TEXT NOT NULL CHECK (state IN ('draft','approved','applying','stopped','applied','failed','discarded','stale')),
    content_digest TEXT NOT NULL,
    session_count INTEGER NOT NULL CHECK (session_count BETWEEN 0 AND 500),
    item_count INTEGER NOT NULL CHECK (item_count BETWEEN 0 AND 100000),
    source_frame_count INTEGER NOT NULL CHECK (source_frame_count BETWEEN 0 AND 100000),
    source_byte_count INTEGER NOT NULL CHECK (source_byte_count BETWEEN 0 AND 17592186044416),
    remaining_session_count INTEGER NOT NULL CHECK (remaining_session_count >= 0),
    next_session_row_id INTEGER REFERENCES session(row_id),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE materialization_update_plan_session (
    plan_row_id INTEGER NOT NULL REFERENCES materialization_update_plan(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (plan_row_id, session_row_id),
    UNIQUE (plan_row_id, ordinal)
) STRICT;

CREATE TABLE materialization_plan_item (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    plan_row_id INTEGER NOT NULL REFERENCES materialization_update_plan(row_id),
    session_row_id INTEGER NOT NULL REFERENCES session(row_id),
    frame_row_id INTEGER NOT NULL REFERENCES frame_record(row_id),
    destination_root_public_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    approved_fingerprint TEXT NOT NULL,
    collision_state TEXT NOT NULL CHECK (collision_state IN ('clear','collision')),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    UNIQUE (plan_row_id, ordinal),
    UNIQUE (plan_row_id, destination_root_public_id, relative_path)
) STRICT;

CREATE TABLE materialization_install_intent (
    plan_item_row_id INTEGER PRIMARY KEY REFERENCES materialization_plan_item(row_id),
    plan_row_id INTEGER NOT NULL REFERENCES materialization_update_plan(row_id),
    collision_key TEXT NOT NULL,
    canonical_destination TEXT NOT NULL,
    approved_fingerprint TEXT NOT NULL,
    ownership_token TEXT NOT NULL,
    command_row_id INTEGER NOT NULL REFERENCES command_execution(row_id),
    lease_owner TEXT NOT NULL,
    lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
    state TEXT NOT NULL CHECK (state IN ('prepared','installed','journaled')),
    updated_at TEXT NOT NULL,
    UNIQUE (plan_row_id, collision_key)
) STRICT;

CREATE TABLE materialization_item_journal (
    plan_item_row_id INTEGER PRIMARY KEY REFERENCES materialization_plan_item(row_id),
    plan_row_id INTEGER NOT NULL REFERENCES materialization_update_plan(row_id),
    operation_command_row_id INTEGER NOT NULL REFERENCES command_execution(row_id),
    resulting_entry_row_id INTEGER NOT NULL UNIQUE REFERENCES materialized_entry(row_id),
    destination_root_public_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_fingerprint TEXT NOT NULL,
    lease_owner TEXT NOT NULL,
    lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
    completed_at TEXT NOT NULL,
    UNIQUE (plan_row_id, destination_root_public_id, relative_path)
) STRICT;

CREATE TABLE audit_event (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    command_row_id INTEGER NOT NULL REFERENCES command_execution(row_id),
    operation_row_id INTEGER REFERENCES session_materialization_operation(row_id),
    proposal_row_id INTEGER REFERENCES relation_proposal(row_id),
    decision_snapshot_row_id INTEGER REFERENCES relation_decision_snapshot(row_id),
    actor_row_id INTEGER NOT NULL REFERENCES spec062_actor(row_id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_public_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('applied','rejected','refused','failed')),
    reason_code TEXT NOT NULL,
    payload_json TEXT,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    occurred_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_audit_event_entity
    ON audit_event(entity_type, entity_public_id, occurred_at DESC, row_id);
CREATE INDEX idx_audit_event_proposal
    ON audit_event(proposal_row_id, occurred_at);

CREATE TABLE outbox_event (
    row_id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    command_row_id INTEGER NOT NULL REFERENCES command_execution(row_id),
    event_ordinal INTEGER NOT NULL CHECK (event_ordinal >= 0),
    aggregate_type TEXT NOT NULL,
    aggregate_public_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_sequence INTEGER NOT NULL REFERENCES repository_change(sequence),
    occurred_at TEXT NOT NULL,
    published_at TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    UNIQUE (command_row_id, event_ordinal)
) STRICT;

CREATE INDEX idx_outbox_event_unpublished
    ON outbox_event(occurred_at, row_id) WHERE published_at IS NULL;

-- Local checks and append-only guards complement the repository's cross-table precommit
-- query. Heads, command leases, install intents, journals, and outbox delivery are the only
-- intentionally mutable records in this schema.
CREATE VIEW spec062_invariant_violation AS
SELECT 'session_membership_cardinality' AS invariant, s.row_id AS owner_row_id
FROM session AS s
LEFT JOIN session_frame AS sf ON sf.session_row_id = s.row_id
GROUP BY s.row_id
HAVING COUNT(sf.frame_row_id) = 0 OR SUM(sf.is_representative) <> 1
UNION ALL
SELECT 'operation_session_count', rs.row_id
FROM session_materialization_result_snapshot AS rs
LEFT JOIN session_materialization_result_session AS child ON child.snapshot_row_id = rs.row_id
GROUP BY rs.row_id
HAVING COUNT(child.session_row_id) <> rs.session_count
UNION ALL
SELECT 'operation_membership_count', rs.row_id
FROM session_materialization_result_snapshot AS rs
LEFT JOIN session_materialization_result_frame AS child ON child.snapshot_row_id = rs.row_id
GROUP BY rs.row_id
HAVING COUNT(child.frame_row_id) <> rs.membership_count
UNION ALL
SELECT 'operation_blocked_count', rs.row_id
FROM session_materialization_result_snapshot AS rs
LEFT JOIN session_materialization_result_blocked_frame AS child ON child.snapshot_row_id = rs.row_id
GROUP BY rs.row_id
HAVING COUNT(child.frame_row_id) <> rs.blocked_frame_count
UNION ALL
SELECT 'decision_revision_count', ds.row_id
FROM relation_decision_snapshot AS ds
LEFT JOIN relation_decision_revision AS child ON child.decision_snapshot_row_id = ds.row_id
GROUP BY ds.row_id
HAVING COUNT(child.revision_row_id) <> ds.accepted_revision_count
UNION ALL
SELECT 'decision_retired_group_count', ds.row_id
FROM relation_decision_snapshot AS ds
LEFT JOIN relation_decision_retired_group AS child ON child.decision_snapshot_row_id = ds.row_id
GROUP BY ds.row_id
HAVING COUNT(child.group_row_id) <> ds.retired_group_count
UNION ALL
SELECT 'decision_lineage_count', ds.row_id
FROM relation_decision_snapshot AS ds
LEFT JOIN relation_decision_lineage AS child ON child.decision_snapshot_row_id = ds.row_id
GROUP BY ds.row_id
HAVING COUNT(child.predecessor_row_id) <> ds.lineage_count
UNION ALL
SELECT 'project_snapshot_session_count', ps.row_id
FROM project_materialization_snapshot AS ps
LEFT JOIN project_materialization_snapshot_session AS child ON child.snapshot_row_id = ps.row_id
GROUP BY ps.row_id
HAVING COUNT(child.session_row_id) <> ps.session_count
UNION ALL
SELECT 'project_snapshot_entry_count', ps.row_id
FROM project_materialization_snapshot AS ps
LEFT JOIN project_materialization_snapshot_entry AS child ON child.snapshot_row_id = ps.row_id
GROUP BY ps.row_id
HAVING COUNT(child.entry_row_id) <> ps.entry_count
UNION ALL
SELECT 'update_plan_session_count', p.row_id
FROM materialization_update_plan AS p
LEFT JOIN materialization_update_plan_session AS child ON child.plan_row_id = p.row_id
GROUP BY p.row_id
HAVING COUNT(child.session_row_id) <> p.session_count
UNION ALL
SELECT 'update_plan_item_count', p.row_id
FROM materialization_update_plan AS p
LEFT JOIN materialization_plan_item AS child ON child.plan_row_id = p.row_id
GROUP BY p.row_id
HAVING COUNT(child.row_id) <> p.item_count;

CREATE TRIGGER session_immutable_update BEFORE UPDATE ON session BEGIN
    SELECT RAISE(ABORT, 'session is append-only');
END;
CREATE TRIGGER session_immutable_delete BEFORE DELETE ON session BEGIN
    SELECT RAISE(ABORT, 'session is append-only');
END;
CREATE TRIGGER session_frame_immutable_update BEFORE UPDATE ON session_frame BEGIN
    SELECT RAISE(ABORT, 'session membership is append-only');
END;
CREATE TRIGGER session_frame_immutable_delete BEFORE DELETE ON session_frame BEGIN
    SELECT RAISE(ABORT, 'session membership is append-only');
END;
CREATE TRIGGER frame_metadata_evidence_immutable_update BEFORE UPDATE ON frame_metadata_evidence BEGIN
    SELECT RAISE(ABORT, 'frame metadata evidence is append-only');
END;
CREATE TRIGGER frame_metadata_evidence_immutable_delete BEFORE DELETE ON frame_metadata_evidence BEGIN
    SELECT RAISE(ABORT, 'frame metadata evidence is append-only');
END;
CREATE TRIGGER panel_revision_immutable_update BEFORE UPDATE ON panel_group_revision BEGIN
    SELECT RAISE(ABORT, 'panel revision is append-only');
END;
CREATE TRIGGER panel_revision_immutable_delete BEFORE DELETE ON panel_group_revision BEGIN
    SELECT RAISE(ABORT, 'panel revision is append-only');
END;
CREATE TRIGGER panel_membership_immutable_update BEFORE UPDATE ON panel_revision_session BEGIN
    SELECT RAISE(ABORT, 'panel membership is append-only');
END;
CREATE TRIGGER panel_membership_immutable_delete BEFORE DELETE ON panel_revision_session BEGIN
    SELECT RAISE(ABORT, 'panel membership is append-only');
END;
CREATE TRIGGER mosaic_revision_immutable_update BEFORE UPDATE ON mosaic_revision BEGIN
    SELECT RAISE(ABORT, 'mosaic revision is append-only');
END;
CREATE TRIGGER mosaic_revision_immutable_delete BEFORE DELETE ON mosaic_revision BEGIN
    SELECT RAISE(ABORT, 'mosaic revision is append-only');
END;
CREATE TRIGGER project_membership_immutable_update BEFORE UPDATE ON project_membership_revision BEGIN
    SELECT RAISE(ABORT, 'project membership revision is append-only');
END;
CREATE TRIGGER project_membership_immutable_delete BEFORE DELETE ON project_membership_revision BEGIN
    SELECT RAISE(ABORT, 'project membership revision is append-only');
END;
CREATE TRIGGER project_membership_session_immutable_update BEFORE UPDATE ON project_membership_revision_session BEGIN
    SELECT RAISE(ABORT, 'project session membership is append-only');
END;
CREATE TRIGGER project_membership_session_immutable_delete BEFORE DELETE ON project_membership_revision_session BEGIN
    SELECT RAISE(ABORT, 'project session membership is append-only');
END;
CREATE TRIGGER materialized_entry_immutable_update BEFORE UPDATE ON materialized_entry BEGIN
    SELECT RAISE(ABORT, 'materialized entry is append-only');
END;
CREATE TRIGGER materialized_entry_immutable_delete BEFORE DELETE ON materialized_entry BEGIN
    SELECT RAISE(ABORT, 'materialized entry is append-only');
END;
CREATE TRIGGER audit_event_immutable_update BEFORE UPDATE ON audit_event BEGIN
    SELECT RAISE(ABORT, 'audit event is append-only');
END;
CREATE TRIGGER audit_event_immutable_delete BEFORE DELETE ON audit_event BEGIN
    SELECT RAISE(ABORT, 'audit event is append-only');
END;
CREATE TRIGGER outbox_event_domain_immutable
BEFORE UPDATE OF command_row_id, event_ordinal, aggregate_type, aggregate_public_id,
                 event_type, payload_json, created_sequence, occurred_at
ON outbox_event BEGIN
    SELECT RAISE(ABORT, 'outbox domain fields are append-only');
END;
CREATE TRIGGER outbox_event_immutable_delete BEFORE DELETE ON outbox_event BEGIN
    SELECT RAISE(ABORT, 'outbox event is append-only');
END;
