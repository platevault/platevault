// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure calibration rules (spec 068): classification, the exact D13
//! criteria and the exposure mismatch the F4 session matcher's hard checks
//! give.

use std::collections::BTreeSet;

use platevault_core::calibration::{self, Rules};
use platevault_core::{
    CalibrationRules, CaptureEvidence, CaptureMetadata, CriterionId, CriterionResult,
    EvidenceField, EvidenceId, InputEvidence, InputForm, InputKind, InputRef, LightEvidence,
    MasterBasis, MatchCamera, NativePath, SessionInput, SessionLight, Tolerance, Verdict,
    WorkflowSettings,
};
use time::macros::date;
use uuid::Uuid;

fn path(text: &str) -> NativePath {
    NativePath::UnixBytes(text.as_bytes().to_vec())
}

/// The quickstart rig: `RedCat 51` / `ASI2600MM`, gain 100, offset 50, bin 1,
/// 6248 x 4176, -10 C setpoint.
fn capture(image_type: &str) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(image_type.into()),
        camera: Some("ASI2600MM".into()),
        camera_id: Some("2600-0042".into()),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        filter: Some("Ha".into()),
        exposure_seconds: Some(300.0),
        gain: Some(100.0),
        offset: Some(50),
        binning_x: Some(1),
        binning_y: Some(1),
        width: Some(6248),
        height: Some(4176),
        set_temperature_c: Some(-10.0),
        measured_temperature_c: Some(-9.8),
        readout_mode: Some("High Gain".into()),
        ..CaptureMetadata::default()
    }
}

fn evidence(
    meta: &CaptureMetadata,
    night: Option<&str>,
    equipment: Option<Uuid>,
) -> CaptureEvidence {
    CaptureEvidence::from_metadata(meta, &BTreeSet::new(), night, equipment)
}

fn light(meta: &CaptureMetadata) -> LightEvidence {
    LightEvidence {
        session_id: Uuid::from_u128(1),
        grouping_revision: 1,
        capture: evidence(meta, Some("2026-09-18@date-loc-noon"), None),
    }
}

fn input(kind: InputKind, meta: &CaptureMetadata) -> InputEvidence {
    InputEvidence { kind, form: InputForm::RawSet, capture: evidence(meta, None, None) }
}

fn criterion(rows: &[CriterionResult], id: CriterionId) -> &CriterionResult {
    rows.iter().find(|row| row.criterion == id).unwrap_or_else(|| panic!("no {id:?} row"))
}

// ── classify ─────────────────────────────────────────────────────────────────

#[test]
fn raw_frames_map_through_the_v1_table_and_a_count_decides_master() {
    let rules = Rules;
    let classify = |image_type: &str, count: Option<u32>, relative: &str| {
        let meta = CaptureMetadata { stack_count: count, ..capture(image_type) };
        rules.classify(&meta, &path(relative))
    };
    for (image_type, kind) in
        [("Dark", InputKind::Dark), ("Offset", InputKind::Bias), ("Flat", InputKind::Flat)]
    {
        let raw = classify(image_type, None, "calibration/frame_001.fits").unwrap();
        assert_eq!((raw.kind, raw.master.as_ref()), (kind, None), "{image_type}");
        assert_eq!(raw.form(), InputForm::RawSet);
    }

    let master = classify("Master Dark", None, "masters/MasterDark_300s.xisf").unwrap();
    assert_eq!(master.kind, InputKind::Dark);
    assert_eq!(master.master.as_ref().unwrap().basis, MasterBasis::HeaderImagetyp);
    assert_eq!(master.form(), InputForm::Candidate);

    let siril = classify("Flat", Some(30), "output/master_flat_Ha.fit").unwrap();
    assert_eq!(siril.kind, InputKind::Flat);
    let evidence = siril.master.unwrap();
    assert_eq!((evidence.basis, evidence.stack_count), (MasterBasis::HeaderStackCount, Some(30)));

    let named = classify("Flat", None, "output/masterFlat_Ha.fit").unwrap();
    assert_eq!(named.kind, InputKind::Flat);
    assert_eq!(named.master.unwrap().basis, MasterBasis::NameOnly);

    let counted_raw = classify("Flat", Some(1), "flats/masterFlat.fit").unwrap();
    assert_eq!(counted_raw.master, None, "a present count decides over the name");
    assert_eq!(counted_raw.kind, InputKind::Flat);

    for (image_type, count) in
        [("Dark Flat", None), ("Master Light", None), ("Light", Some(20)), ("unknown", None)]
    {
        assert_eq!(classify(image_type, count, "x/frame.fits"), None, "{image_type}");
    }
}

// ── evaluate ─────────────────────────────────────────────────────────────────

#[test]
fn darks_compare_every_criterion_exactly_with_tolerance_none() {
    let rules = Rules;
    let light_meta = capture("Light");
    let dark = CaptureMetadata { exposure_seconds: Some(300.0), ..capture("Dark") };
    let evaluation =
        rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &dark));
    let expected: BTreeSet<CriterionId> = [
        CriterionId::ImageType,
        CriterionId::Camera,
        CriterionId::Dimensions,
        CriterionId::Binning,
        CriterionId::Gain,
        CriterionId::Offset,
        CriterionId::Exposure,
        CriterionId::SetTemperature,
    ]
    .into();
    assert_eq!(
        evaluation.criteria.iter().map(|row| row.criterion).collect::<BTreeSet<_>>(),
        expected
    );
    assert!(
        evaluation.criteria.iter().all(|row| row.verdict == Verdict::Compatible),
        "{evaluation:#?}"
    );
    assert!(evaluation.criteria.iter().all(|row| row.tolerance == Tolerance::None));
    assert_eq!(evaluation.verdict, Verdict::Compatible);
    let exposure = criterion(&evaluation.criteria, CriterionId::Exposure);
    assert_eq!(exposure.light_value.as_deref(), Some("300"));
    assert_eq!(exposure.input_source.as_deref(), Some("EXPTIME"));

    // 300 equals 300.0, which is the same canonical decimal.
    let decimal = CaptureMetadata { exposure_seconds: Some(300.000), ..dark.clone() };
    let same =
        rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &decimal));
    assert_eq!(criterion(&same.criteria, CriterionId::Exposure).verdict, Verdict::Compatible);

    let short = CaptureMetadata { exposure_seconds: Some(120.0), ..dark.clone() };
    let short =
        rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &short));
    assert_eq!(criterion(&short.criteria, CriterionId::Exposure).verdict, Verdict::Incompatible);
    assert_eq!(short.verdict, Verdict::Incompatible);

    let warm = CaptureMetadata { set_temperature_c: Some(-15.0), ..dark.clone() };
    let warm = rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &warm));
    assert_eq!(
        criterion(&warm.criteria, CriterionId::SetTemperature).verdict,
        Verdict::Incompatible
    );

    for missing in [
        CaptureMetadata { set_temperature_c: None, ..dark.clone() },
        CaptureMetadata { gain: None, ..dark.clone() },
    ] {
        let unknown =
            rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &missing));
        assert_eq!(unknown.verdict, Verdict::Unknown, "a missing value is never compatible");
        // The same gap on the light side is unknown too.
        let flipped =
            rules.evaluate(InputKind::Dark, &light(&missing), &input(InputKind::Dark, &dark));
        assert_eq!(flipped.verdict, Verdict::Unknown);
    }

    let ids: BTreeSet<EvidenceId> = evaluation.evidence.iter().map(|row| row.evidence).collect();
    assert!(
        ids.contains(&EvidenceId::MeasuredTemperature) && ids.contains(&EvidenceId::ReadoutMode)
    );
    let cold = CaptureMetadata { measured_temperature_c: Some(-3.0), readout_mode: None, ..dark };
    let cold = rules.evaluate(InputKind::Dark, &light(&light_meta), &input(InputKind::Dark, &cold));
    assert_eq!(
        cold.verdict,
        Verdict::Compatible,
        "measured temperature and readout carry no verdict"
    );
}

#[test]
fn flats_need_the_same_channel_and_a_known_optical_train() {
    let rules = Rules;
    let light_meta = capture("Light");
    let equipment = Uuid::from_u128(77);
    let flat = capture("Flat");
    let with_kind = |meta: &CaptureMetadata, equipment| InputEvidence {
        kind: InputKind::Flat,
        form: InputForm::RawSet,
        capture: evidence(meta, None, equipment),
    };
    let light_side = |equipment| LightEvidence {
        capture: evidence(&light_meta, Some("2026-09-18@date-loc-noon"), equipment),
        ..light(&light_meta)
    };

    let oiii = CaptureMetadata { filter: Some("OIII".into()), ..flat.clone() };
    let channel = rules.evaluate(InputKind::Flat, &light_side(None), &with_kind(&oiii, None));
    assert_eq!(criterion(&channel.criteria, CriterionId::Channel).verdict, Verdict::Incompatible);

    let bare = CaptureMetadata { telescope: None, focal_length_mm: None, ..flat.clone() };
    let unknown =
        rules.evaluate(InputKind::Flat, &light_side(Some(equipment)), &with_kind(&bare, None));
    assert_eq!(criterion(&unknown.criteria, CriterionId::OpticalTrain).verdict, Verdict::Unknown);
    assert_eq!(unknown.verdict, Verdict::Unknown);

    let confirmed = rules.evaluate(
        InputKind::Flat,
        &light_side(Some(equipment)),
        &with_kind(&bare, Some(equipment)),
    );
    let train = criterion(&confirmed.criteria, CriterionId::OpticalTrain);
    assert_eq!(train.verdict, Verdict::Compatible, "the same Confirmed Equipment ID");
    assert!(train.light_source.as_deref().unwrap().contains(&equipment.to_string()));

    let other_equipment = rules.evaluate(
        InputKind::Flat,
        &light_side(Some(equipment)),
        &with_kind(&bare, Some(Uuid::from_u128(78))),
    );
    assert_eq!(
        criterion(&other_equipment.criteria, CriterionId::OpticalTrain).verdict,
        Verdict::Incompatible,
        "a different Confirmed Equipment is another optical train (CAL-AC-14)"
    );

    let header = rules.evaluate(InputKind::Flat, &light_side(None), &with_kind(&flat, None));
    assert_eq!(criterion(&header.criteria, CriterionId::OpticalTrain).verdict, Verdict::Compatible);
    assert_eq!(header.verdict, Verdict::Compatible);

    let longer = CaptureMetadata { focal_length_mm: Some(500.0), ..flat };
    let longer = rules.evaluate(InputKind::Flat, &light_side(None), &with_kind(&longer, None));
    assert_eq!(
        criterion(&longer.criteria, CriterionId::OpticalTrain).verdict,
        Verdict::Incompatible
    );

    let dark_as_flat = rules.evaluate(
        InputKind::Flat,
        &light_side(None),
        &input(InputKind::Dark, &capture("Dark")),
    );
    assert_eq!(
        criterion(&dark_as_flat.criteria, CriterionId::ImageType).verdict,
        Verdict::Incompatible
    );
}

#[test]
fn camera_identity_needs_the_model_and_compares_body_ids_only_when_both_record_one() {
    let rules = Rules;
    let light_meta = capture("Light");
    let bias = capture("Bias");
    let camera = |light_meta: &CaptureMetadata, input_meta: &CaptureMetadata| {
        let evaluation = rules.evaluate(
            InputKind::Bias,
            &light(light_meta),
            &input(InputKind::Bias, input_meta),
        );
        criterion(&evaluation.criteria, CriterionId::Camera).clone()
    };
    let no_id = CaptureMetadata { camera_id: None, ..bias.clone() };
    assert_eq!(camera(&light_meta, &no_id).verdict, Verdict::Unknown, "one-sided CAMERAID");
    assert_eq!(camera(&no_id, &bias).verdict, Verdict::Unknown);
    let neither = camera(&CaptureMetadata { camera_id: None, ..light_meta.clone() }, &no_id);
    assert_eq!(neither.verdict, Verdict::Compatible);
    assert!(neither.note.as_deref().unwrap().contains("CAMERAID"), "the model basis is named");
    let other_body = CaptureMetadata { camera_id: Some("2600-0099".into()), ..bias.clone() };
    assert_eq!(camera(&light_meta, &other_body).verdict, Verdict::Incompatible);
    let other_model = CaptureMetadata { camera: Some("ASI294MM".into()), ..bias };
    assert_eq!(camera(&light_meta, &other_model).verdict, Verdict::Incompatible);
}

// ── exposure mismatch ────────────────────────────────────────────────────────

/// The light session of the quickstart rig, taken on 18 Sep 2026.
fn session_light(meta: &CaptureMetadata) -> SessionLight {
    SessionLight {
        session_id: Uuid::from_u128(1),
        capture: evidence(meta, None, None),
        night: Some(date!(2026 - 09 - 18)),
        camera: MatchCamera::Unlinked,
        rig: None,
        rotator_deg: None,
    }
}

/// A raw set of `kind` taken two days after the lights.
fn session_input(session: u128, kind: InputKind, meta: &CaptureMetadata) -> SessionInput {
    SessionInput {
        input: InputRef::RawSet { session_id: Uuid::from_u128(session), grouping_revision: 1 },
        kind,
        capture: evidence(meta, None, None),
        captured: Some(date!(2026 - 09 - 20)),
        camera: MatchCamera::Unlinked,
        rig_version_id: None,
        rotator_deg: vec![None],
        files: Vec::new(),
        available: true,
    }
}

fn dark_of(exposure: f64) -> CaptureMetadata {
    CaptureMetadata { exposure_seconds: Some(exposure), ..capture("Dark") }
}

/// The canonical exposure text evidence records for `meta`.
fn exposure_text(meta: &CaptureMetadata) -> String {
    evidence(meta, None, None).get(EvidenceField::Exposure).unwrap().value.clone()
}

/// PRJ-FR-11 (record §7 line 165: matching moves to ingestion): when every
/// dark fails the hard checks on exposure alone, the warning names the
/// light's channel and both exposures. The session matcher shares those hard
/// checks, so it offers none of these darks.
#[test]
fn darks_differing_only_in_exposure_are_an_exposure_mismatch() {
    let settings = WorkflowSettings::default();
    let light_meta = capture("Light");
    let light = session_light(&light_meta);
    let darks = [
        session_input(20, InputKind::Dark, &dark_of(120.0)),
        session_input(21, InputKind::Dark, &dark_of(600.0)),
    ];

    let mismatch = calibration::exposure_mismatch(&light, &darks, &settings).unwrap();

    assert_eq!(mismatch.channel.as_deref(), Some("Ha"));
    assert_eq!(mismatch.light_exposures, [exposure_text(&light_meta)].into());
    assert_eq!(
        mismatch.dark_exposures,
        [exposure_text(&dark_of(120.0)), exposure_text(&dark_of(600.0))].into()
    );
    let offered = Rules.match_session(InputKind::Dark, &light, &darks, &settings);
    assert_eq!(offered.offers, [], "a dark of another exposure is never offered");
}

/// PRJ-FR-11: a dark of the lights' exposure clears the warning; a dark that
/// differs in anything besides exposure, and every flat or bias, never
/// counts; with no such dark there is no mismatch.
#[test]
fn exposure_mismatch_needs_every_otherwise_compatible_dark_to_differ() {
    let settings = WorkflowSettings::default();
    let light = session_light(&capture("Light"));
    let other = session_input(20, InputKind::Dark, &dark_of(120.0));
    let same = session_input(21, InputKind::Dark, &dark_of(300.0));
    let gain = CaptureMetadata { gain: Some(0.0), ..dark_of(120.0) };
    let flat = CaptureMetadata { exposure_seconds: Some(2.0), ..capture("Flat") };
    let bias = CaptureMetadata { exposure_seconds: Some(0.001), ..capture("Bias") };
    let mismatch =
        |darks: &[SessionInput]| calibration::exposure_mismatch(&light, darks, &settings);

    assert_eq!(mismatch(&[other.clone(), same]), None, "a 300 s dark matches");
    assert_eq!(mismatch(&[session_input(22, InputKind::Dark, &gain)]), None, "gain differs too");
    let flat_and_bias =
        [session_input(23, InputKind::Flat, &flat), session_input(24, InputKind::Bias, &bias)];
    assert_eq!(mismatch(&flat_and_bias), None, "only darks count");
    assert_eq!(mismatch(&[]), None);
    assert!(mismatch(&[other, session_input(25, InputKind::Dark, &gain)]).is_some());
}
