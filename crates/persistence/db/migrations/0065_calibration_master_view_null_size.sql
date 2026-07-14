-- Migration 0065: calibration_master_view — NULL size_bytes (Q16 / #620, FR-136).
--
-- Migration 0033 hardcoded `0 AS size_bytes` in this view because
-- calibration_session has no size column; that literal 0 was indistinguishable
-- from a real zero-byte file downstream (contract `CalibrationMaster.size_bytes`
-- / `MasterDetail.size_bytes` were non-optional, forcing the fabricated value
-- all the way to the UI as "Size 0 KB"). Redefine the view to emit NULL
-- instead — unresolved size is now represented as null/None end-to-end
-- (extraction/view -> persistence row -> app layer -> contract -> UI), per the
-- Missing-Value Semantics rule (spec-030 data-model.md "Metadata Value
-- States"). No computed-size source exists yet (calibration_session carries no
-- frame-size data); a real size column/computation is future work, not
-- fabricated here.
--
-- Constitution §I: no image files touched; this only changes a denormalized
-- read view over existing metadata tables.

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
    cf.observing_night_date                             AS observing_night_date
FROM calibration_session cs
LEFT JOIN calibration_fingerprint cf ON cf.id = cs.id
WHERE cs.kind IN ('dark', 'flat', 'bias');
