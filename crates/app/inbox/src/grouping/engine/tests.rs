// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

use super::*;

/// Build a light-frame metadata with sensible real-ish defaults.
fn light_meta() -> FrameMetadata {
    FrameMetadata {
        frame_type: FrameType::Light,
        filter: Some("Ha".to_owned()),
        exposure_s: Some(300.0),
        gain: Some("100".to_owned()),
        offset: Some(20),
        binning_x: Some(1),
        binning_y: Some(1),
        ra_deg: Some(272.6820),
        dec_deg: Some(-15.0197),
        rotator_angle_deg: Some(12.43),
        telescop: Some("Celestron C925".to_owned()),
        instrume: Some("ASI2600MM".to_owned()),
        focal_length_mm: Some(525.0),
        date_loc: Some("2025-10-17T19:23:39".to_owned()),
        date_obs: Some("2025-10-17T15:23:39".to_owned()),
        ..Default::default()
    }
}

fn dark_meta() -> FrameMetadata {
    FrameMetadata {
        frame_type: FrameType::Dark,
        exposure_s: Some(300.0),
        gain: Some("100".to_owned()),
        offset: Some(20),
        set_temp_c: Some(-10.0),
        ccd_temp_c: Some(-10.1),
        binning_x: Some(1),
        binning_y: Some(1),
        instrume: Some("ASI2600MM".to_owned()),
        ..Default::default()
    }
}

fn flat_meta() -> FrameMetadata {
    FrameMetadata {
        frame_type: FrameType::Flat,
        filter: Some("Ha".to_owned()),
        gain: Some("100".to_owned()),
        offset: Some(20),
        binning_x: Some(1),
        binning_y: Some(1),
        rotator_angle_deg: Some(12.43),
        telescop: Some("Celestron C925".to_owned()),
        instrume: Some("ASI2600MM".to_owned()),
        focal_length_mm: Some(525.0),
        date_loc: Some("2025-10-17T19:23:39".to_owned()),
        ..Default::default()
    }
}

fn bias_meta() -> FrameMetadata {
    FrameMetadata {
        frame_type: FrameType::Bias,
        gain: Some("100".to_owned()),
        offset: Some(20),
        binning_x: Some(1),
        binning_y: Some(1),
        instrume: Some("ASI2600MM".to_owned()),
        date_loc: Some("2025-10-17T19:23:39".to_owned()),
        ..Default::default()
    }
}

// ── Determinism (FR-042) ──────────────────────────────────────────────────

#[test]
fn identical_input_yields_identical_key() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let a = group_file(&light_meta(), &cfg);
    let b = group_file(&light_meta(), &cfg);
    assert_eq!(a.key, b.key, "same metadata + recipe ⇒ same key (rescan stability)");
    assert_eq!(a.label, b.label);
}

#[test]
fn key_dimension_order_is_canonical_not_config_order() {
    // Two configs with the SAME enabled dims added in different orders must
    // produce byte-identical keys.
    let mut a = GroupingConfig::default_for(FrameType::Dark);
    // Rebuild dark recipe by disabling everything then enabling in reverse.
    for d in [
        Dimension::Camera,
        Dimension::Exposure,
        Dimension::Gain,
        Dimension::Offset,
        Dimension::SetTemp,
        Dimension::Binning,
    ] {
        a.disable(d);
    }
    for d in [
        Dimension::Binning,
        Dimension::SetTemp,
        Dimension::Offset,
        Dimension::Gain,
        Dimension::Exposure,
        Dimension::Camera,
    ] {
        a.enable(d);
    }
    let b = GroupingConfig::default_for(FrameType::Dark);
    assert_eq!(group_file(&dark_meta(), &a).key, group_file(&dark_meta(), &b).key);
}

// ── Per-type recipe coverage (R-9, FR-035) ────────────────────────────────

#[test]
fn light_recipe_has_no_temperature_dimension() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    assert!(!cfg.has(Dimension::SetTemp), "lights MUST NOT group by temperature (R-9)");
    assert!(cfg.has(Dimension::Pointing));
    assert!(cfg.has(Dimension::Rotation));
    assert!(cfg.has(Dimension::OpticTrain));
    assert!(cfg.has(Dimension::ObservingNight));
    // The key must not contain a temperature token.
    let key = group_file(&light_meta(), &cfg).key.0;
    assert!(!key.contains("set_temp="), "no set_temp token in a light key: {key}");
}

#[test]
fn light_key_contains_expected_tokens_in_order() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let key = group_file(&light_meta(), &cfg).key.0;
    // Spot-check canonical ordering: optic_train before filter before
    // exposure before pointing before rotation before night.
    let idx = |needle: &str| key.find(needle).unwrap_or_else(|| panic!("{needle} in {key}"));
    assert!(idx("type=light") < idx("optic_train="));
    assert!(idx("optic_train=") < idx("filter="));
    assert!(idx("filter=") < idx("exposure="));
    assert!(idx("exposure=") < idx("pointing="));
    assert!(idx("pointing=") < idx("rotation="));
    assert!(idx("rotation=") < idx("night="));
}

#[test]
fn dark_recipe_excludes_optics_and_pointing() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    assert!(cfg.has(Dimension::SetTemp), "darks group by set-temp (R-9)");
    assert!(!cfg.has(Dimension::OpticTrain), "darks have no optics");
    assert!(!cfg.has(Dimension::Pointing));
    assert!(!cfg.has(Dimension::Filter));
    assert!(!cfg.has(Dimension::ObservingNight), "darks night OFF by default (span nights)");
}

#[test]
fn bias_recipe_excludes_exposure_and_optics() {
    let cfg = GroupingConfig::default_for(FrameType::Bias);
    assert!(!cfg.has(Dimension::Exposure), "bias exposure ≈0, not a key (R-9)");
    assert!(!cfg.has(Dimension::OpticTrain));
    assert!(!cfg.has(Dimension::SetTemp));
    assert!(cfg.has(Dimension::ObservingNight));
    assert!(cfg.has(Dimension::Gain));
    assert!(cfg.has(Dimension::Offset));
}

#[test]
fn flat_recipe_requires_filter_excludes_exposure() {
    let cfg = GroupingConfig::default_for(FrameType::Flat);
    assert!(cfg.has(Dimension::Filter), "flat filter required (R-9)");
    assert!(!cfg.has(Dimension::Exposure), "flat exposure excluded (FlatWizard varies it)");
    assert!(cfg.has(Dimension::OpticTrain));
    assert!(cfg.has(Dimension::Rotation));
    assert!(!cfg.has(Dimension::SetTemp), "flats don't group by temperature");
}

// ── Bucketing edge cases (FR-036) ─────────────────────────────────────────

#[test]
fn exposure_buckets_to_canonical_seconds() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    let mut m = dark_meta();
    m.exposure_s = Some(299.6);
    let k1 = group_file(&m, &cfg).key.0;
    m.exposure_s = Some(300.4);
    let k2 = group_file(&m, &cfg).key.0;
    assert_eq!(k1, k2, "299.6 and 300.4 both round to 300s ⇒ same group");
    assert!(k1.contains("exposure=300"), "rounded to integer seconds: {k1}");
}

#[test]
fn exposure_across_bucket_boundary_splits() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    let mut m = dark_meta();
    m.exposure_s = Some(300.0);
    let k1 = group_file(&m, &cfg).key.0;
    m.exposure_s = Some(180.0);
    let k2 = group_file(&m, &cfg).key.0;
    assert_ne!(k1, k2, "300s and 180s are different groups");
}

#[test]
fn configurable_exposure_bucket_size() {
    let mut cfg = GroupingConfig::default_for(FrameType::Dark);
    cfg.exposure_bucket_s = 60.0; // coarse 1-minute buckets
    let mut m = dark_meta();
    m.exposure_s = Some(290.0);
    let k1 = group_file(&m, &cfg).key.0;
    m.exposure_s = Some(305.0);
    let k2 = group_file(&m, &cfg).key.0;
    // 290 → 300, 305 → 300 with 60s buckets.
    assert_eq!(k1, k2, "both snap to the 300s bucket under a 60s grid");
    assert!(k1.contains("exposure=300"));
}

#[test]
fn set_temp_tolerance_groups_within_band() {
    let cfg = GroupingConfig::default_for(FrameType::Dark); // 2°C default
    let mut m = dark_meta();
    m.set_temp_c = Some(-9.4);
    let k1 = group_file(&m, &cfg).key.0;
    m.set_temp_c = Some(-10.6);
    let k2 = group_file(&m, &cfg).key.0;
    // With 2°C buckets, -9.4 → -10 (round(-4.7)*2=-10) and -10.6 → -10.
    assert_eq!(k1, k2, "-9.4 and -10.6 both fall in the -10°C bucket");
}

#[test]
fn set_temp_across_band_splits() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    let mut m = dark_meta();
    m.set_temp_c = Some(-10.0);
    let k1 = group_file(&m, &cfg).key.0;
    m.set_temp_c = Some(-20.0);
    let k2 = group_file(&m, &cfg).key.0;
    assert_ne!(k1, k2, "-10°C and -20°C are different cooling setpoints");
}

// ── Temperature policy (FR-037) ───────────────────────────────────────────

#[test]
fn temp_deviation_warns_but_does_not_split() {
    let cfg = GroupingConfig::default_for(FrameType::Dark); // warn threshold 2°C
    let mut close = dark_meta();
    close.set_temp_c = Some(-10.0);
    close.ccd_temp_c = Some(-10.1); // within 2°C
    let close_res = group_file(&close, &cfg);
    assert!(close_res.warnings.is_empty(), "0.1°C deviation: no warning");

    let mut far = dark_meta();
    far.set_temp_c = Some(-10.0);
    far.ccd_temp_c = Some(-5.0); // 5°C deviation
    let far_res = group_file(&far, &cfg);
    assert!(
        matches!(far_res.warnings.first(), Some(GroupWarning::TempDeviation { .. })),
        "5°C deviation surfaces a quality warning"
    );
    // But the GROUP KEY is identical — setpoint governs, no split.
    assert_eq!(
        close_res.key, far_res.key,
        "deviation warns but does not split (setpoint governs the group)"
    );
}

#[test]
fn ccd_temp_toggle_changes_temp_source() {
    let mut cfg = GroupingConfig::default_for(FrameType::Dark);
    cfg.temp_source = TempSource::CcdTemp;
    let mut m = dark_meta();
    m.set_temp_c = Some(-10.0);
    m.ccd_temp_c = Some(-8.0);
    let key = group_file(&m, &cfg).key.0;
    // Under CCD source, -8.0 buckets to -8 (round(-4)*2), not -10.
    assert!(key.contains("set_temp=-8"), "CCD-TEMP toggle uses ccd value: {key}");
}

#[test]
fn lights_never_group_by_temperature_even_when_present() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut warm = light_meta();
    warm.set_temp_c = Some(-5.0);
    warm.ccd_temp_c = Some(-5.0);
    let mut cold = light_meta();
    cold.set_temp_c = Some(-20.0);
    cold.ccd_temp_c = Some(-20.0);
    assert_eq!(
        group_file(&warm, &cfg).key,
        group_file(&cold, &cfg).key,
        "lights ignore temperature entirely (R-9)"
    );
}

// ── Pointing tolerance (FR-038) ───────────────────────────────────────────

#[test]
fn pointing_within_tolerance_groups_together() {
    let cfg = GroupingConfig::default_for(FrameType::Light); // 0.5° default
    let mut a = light_meta();
    a.ra_deg = Some(272.60);
    a.dec_deg = Some(-15.00);
    let mut b = light_meta();
    b.ra_deg = Some(272.70); // within 0.5° → same bucket
    b.dec_deg = Some(-15.10);
    assert_eq!(
        group_file(&a, &cfg).key,
        group_file(&b, &cfg).key,
        "dither/centering within 0.5° stays one group"
    );
}

#[test]
fn pointing_across_tolerance_splits() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut a = light_meta();
    a.ra_deg = Some(272.0);
    a.dec_deg = Some(-15.0);
    let mut b = light_meta();
    b.ra_deg = Some(280.0); // far away
    b.dec_deg = Some(-15.0);
    assert_ne!(
        group_file(&a, &cfg).key,
        group_file(&b, &cfg).key,
        "different sky positions are different groups"
    );
}

#[test]
fn pointing_uses_decimal_radec() {
    // Sanity: the engine reads ra_deg/dec_deg (decimal) directly; the
    // sexagesimal→decimal conversion is the caller's job (metadata_core).
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let key = group_file(&light_meta(), &cfg).key.0;
    assert!(key.contains("pointing="), "pointing token present: {key}");
}

// ── Rotation = ROTATANG, not OBJCTROT (R-18, FR-040) ──────────────────────

#[test]
fn rotation_uses_rotatang_not_objctrot() {
    // FrameMetadata only carries rotator_angle_deg (ROTATANG); there is NO
    // sky_rotation_deg/OBJCTROT field on the grouping input by design, so it
    // CANNOT leak into the key. Verify the key reflects the mechanical angle.
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut m = light_meta();
    m.rotator_angle_deg = Some(45.0);
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains("rotation=45"), "rotation token uses ROTATANG: {key}");
}

#[test]
fn rotation_within_tolerance_groups() {
    let cfg = GroupingConfig::default_for(FrameType::Light); // 1° default
    let mut a = light_meta();
    a.rotator_angle_deg = Some(12.1);
    let mut b = light_meta();
    b.rotator_angle_deg = Some(12.4); // both round to the 12° bucket
    assert_eq!(group_file(&a, &cfg).key, group_file(&b, &cfg).key);
}

#[test]
fn flat_missing_rotation_warns_when_not_required() {
    let cfg = GroupingConfig::default_for(FrameType::Flat); // rotation enabled, not required
    let mut m = flat_meta();
    m.rotator_angle_deg = None;
    let res = group_file(&m, &cfg);
    assert!(
        res.warnings.contains(&GroupWarning::RotationUnavailable),
        "missing ROTATANG on a flat warns (matched without rotation)"
    );
    assert!(res.key.0.contains(&format!("rotation={SENTINEL_MISSING}")), "{}", res.key.0);
}

#[test]
fn flat_missing_rotation_no_warning_when_required() {
    let mut cfg = GroupingConfig::default_for(FrameType::Flat);
    cfg.flat_rotation_required = true;
    let mut m = flat_meta();
    m.rotator_angle_deg = None;
    let res = group_file(&m, &cfg);
    // When required, absence is a hard sentinel (excluded), not a warn path.
    assert!(!res.warnings.contains(&GroupWarning::RotationUnavailable));
}

// ── Optic-train composite (FR-039) ────────────────────────────────────────

#[test]
fn optic_train_is_composite_of_telescop_instrume_focallen() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let base = light_meta();
    let mut reducer = light_meta();
    reducer.focal_length_mm = Some(672.0); // different focal length (no reducer)
    assert_ne!(
        group_file(&base, &cfg).key,
        group_file(&reducer, &cfg).key,
        "FOCALLEN difference splits the optical train (captures reducers — FR-039)"
    );
}

#[test]
fn optic_train_focal_length_bucketed_to_whole_mm() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut a = light_meta();
    a.focal_length_mm = Some(525.2);
    let mut b = light_meta();
    b.focal_length_mm = Some(524.8);
    assert_eq!(
        group_file(&a, &cfg).key,
        group_file(&b, &cfg).key,
        "525.2 and 524.8 both round to 525mm"
    );
}

/// Sentinel stability: absent optic-train parts MUST render the grouping
/// `SENTINEL_MISSING` (`"∅"`), not the framing-identity sentinel (`"-"`).
/// The `group_key` column is persisted with a UNIQUE constraint — changing
/// this value would re-group existing inbox items and violate FR-042.
#[test]
fn optic_train_partial_data_uses_grouping_sentinel_not_framing_sentinel() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    // Only telescope present; instrume and focal_length absent.
    let mut m = light_meta();
    m.instrume = None;
    m.focal_length_mm = None;
    let key = group_file(&m, &cfg).key.0;
    // The "∅" sentinel (not "-") must appear in the optic_train token.
    let optic_idx = key.find("optic_train=").expect("optic_train token present");
    let token = &key[optic_idx..];
    assert!(
        token.contains("∅"),
        "partial optic-train must use grouping sentinel '∅', not framing sentinel '-': {key}"
    );
    assert!(
        !token.split('·').next().unwrap_or("").contains("|-|"),
        "framing sentinel '-' must not appear in the grouping key: {key}"
    );
}

// ── Missing-dimension sentinels (R-11) ────────────────────────────────────

#[test]
fn missing_enabled_dimension_renders_sentinel() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut m = light_meta();
    m.filter = None;
    let key = group_file(&m, &cfg).key.0;
    assert!(
        key.contains(&format!("filter={SENTINEL_MISSING}")),
        "missing filter renders explicit sentinel: {key}"
    );
}

#[test]
fn missing_pointing_components_render_sentinel() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut m = light_meta();
    m.ra_deg = None; // dec present but ra missing → whole pointing absent
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains(&format!("pointing={SENTINEL_MISSING}")), "{key}");
}

#[test]
fn empty_string_text_is_treated_as_missing() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut m = light_meta();
    m.filter = Some("   ".to_owned()); // whitespace only
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains(&format!("filter={SENTINEL_MISSING}")), "{key}");
}

// ── Normalization ─────────────────────────────────────────────────────────

#[test]
fn text_normalization_is_case_and_whitespace_insensitive() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut a = light_meta();
    a.filter = Some("Ha".to_owned());
    let mut b = light_meta();
    b.filter = Some("  ha ".to_owned());
    assert_eq!(
        group_file(&a, &cfg).key,
        group_file(&b, &cfg).key,
        "'Ha' and '  ha ' normalize to the same filter token"
    );
}

#[test]
fn binning_normalizes_to_nxn() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    let mut m = dark_meta();
    m.binning_x = Some(2);
    m.binning_y = Some(2);
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains("binning=2x2"), "{key}");
}

// ── Observing night (R-18) ────────────────────────────────────────────────

#[test]
fn observing_night_prefers_date_loc_date_portion() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let key = group_file(&light_meta(), &cfg).key.0;
    assert!(key.contains("night=2025-10-17"), "uses DATE-LOC calendar date: {key}");
}

#[test]
fn observing_night_falls_back_to_date_obs() {
    let cfg = GroupingConfig::default_for(FrameType::Bias);
    let mut m = bias_meta();
    m.date_loc = None;
    m.date_obs = Some("2025-10-17T15:23:39".to_owned());
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains("night=2025-10-17"), "DATE-OBS fallback: {key}");
}

// ── Toggle behaviour (FR-035) ─────────────────────────────────────────────

#[test]
fn disabling_a_dimension_removes_its_token() {
    let mut cfg = GroupingConfig::default_for(FrameType::Light);
    assert!(group_file(&light_meta(), &cfg).key.0.contains("offset="));
    cfg.disable(Dimension::Offset);
    assert!(!cfg.has(Dimension::Offset));
    assert!(!group_file(&light_meta(), &cfg).key.0.contains("offset="));
}

#[test]
fn enabling_readout_adds_its_token() {
    let mut cfg = GroupingConfig::default_for(FrameType::Dark);
    assert!(!cfg.has(Dimension::Readout), "readout OFF by default");
    cfg.enable(Dimension::Readout);
    let mut m = dark_meta();
    m.readout_mode = Some("Low Noise".to_owned());
    let key = group_file(&m, &cfg).key.0;
    assert!(key.contains("readout=low noise"), "{key}");
}

// ── Label (R-12) ──────────────────────────────────────────────────────────

#[test]
fn label_has_root_type_and_discriminators() {
    let cfg = GroupingConfig::default_for(FrameType::Dark);
    let label = group_file(&dark_meta(), &cfg).label.0;
    assert!(label.starts_with("(root) · dark"), "{label}");
    assert!(label.contains("300s"), "exposure discriminator: {label}");
    assert!(label.contains("-10°C"), "set-temp discriminator: {label}");
    assert!(label.contains("1x1"), "binning discriminator: {label}");
}

#[test]
fn label_omits_missing_dimensions() {
    let cfg = GroupingConfig::default_for(FrameType::Light);
    let mut m = light_meta();
    m.filter = None;
    let label = group_file(&m, &cfg).label.0;
    // No bare sentinel filter fragment in the human label.
    assert!(!label.contains(SENTINEL_MISSING), "label hides sentinels: {label}");
}

// ── Format helper unit coverage ───────────────────────────────────────────

#[test]
fn format_num_renders_integers_without_decimal() {
    assert_eq!(format_num(300.0), "300");
    assert_eq!(format_num(-10.0), "-10");
    assert_eq!(format_num(0.0), "0");
    assert_eq!(format_num(-0.0), "0", "negative zero normalizes");
}

#[test]
fn format_num_trims_trailing_zeros() {
    assert_eq!(format_num(1.5), "1.5");
    assert_eq!(format_num(272.6820), "272.682");
}

#[test]
fn bucket_disabled_when_size_non_positive() {
    assert!((bucket(123.456, 0.0) - 123.456).abs() < 1e-9);
    assert!((bucket(123.456, -1.0) - 123.456).abs() < 1e-9);
}
