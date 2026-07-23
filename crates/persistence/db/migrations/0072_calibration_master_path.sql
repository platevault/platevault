-- Migration 0072: expose the master file's location on calibration_master_view (#642).
--
-- `calibration_session.frame_ids` for a `dark`/`flat`/`bias` (master) session
-- holds exactly the applied master frame's own `file_record` id (written by
-- `crates/app/inbox/src/plan_listener.rs`'s `write_calibration_frame_record`
-- at master-confirm time) — `'[]'` only when that resolution failed. Joining
-- `json_extract(frame_ids, '$[0]')` to `file_record` recovers the master
-- file's root-relative path without adding a new tracking column: the data
-- was already there, just not surfaced through the view. `root_id` is read
-- directly off `calibration_session` (migration 0021) rather than the joined
-- `file_record.root_id`, since the session's own root_id is the FK the rest
-- of the codebase already keys reveal/connectivity lookups on.
--
-- Constitution I: library roots stay modeled separately from relative paths
-- (`root_id` + `frame_relative_path`, not a baked absolute string) so a moved
-- drive / remapped root still resolves correctly.

DROP VIEW IF EXISTS calibration_master_view;

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
    fr.relative_path                                    AS frame_relative_path
FROM calibration_session cs
LEFT JOIN calibration_fingerprint cf ON cf.id = cs.id
LEFT JOIN file_record fr ON fr.id = json_extract(cs.frame_ids, '$[0]')
WHERE cs.kind IN ('dark', 'flat', 'bias');
