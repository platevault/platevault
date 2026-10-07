// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure calibration rules (spec 068): classification, exact D13 criteria,
//! candidate order, preselection and R13 applicability.

use std::collections::{BTreeMap, BTreeSet};

use platevault_core::calibration::Rules;
use platevault_core::{
    Availability, CalibrationDecision, CalibrationPlan, CalibrationRules, CalibrationViewBasis,
    CandidateRef, CaptureEvidence, CaptureMetadata, CriterionId, CriterionResult, EvidenceId,
    FileIdentity, InputCandidate, InputEvidence, InputForm, InputKind, InputRef, InputState,
    LightBasis, LightEvidence, MasterBasis, NativePath, ObservationFingerprint, PathSensitivity,
    RequirementState, Resolution, Tolerance, UnresolvedReason, Verdict, VolumeIdentity,
};
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

fn verdicts(rows: &[CriterionResult]) -> BTreeMap<CriterionId, Verdict> {
    rows.iter().map(|row| (row.criterion, row.verdict)).collect()
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

// ── plan ─────────────────────────────────────────────────────────────────────

fn fingerprint() -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("vol".into()),
                file_ids_stable: true,
                case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive,
            },
            file_id: Some("7".into()),
        },
        size_bytes: 2880,
        modified_ns: 1,
        content_sha256: Some("cd".repeat(32)),
    }
}

fn available(members: u64) -> InputState {
    InputState {
        availability: Availability::Available,
        members,
        available_members: members,
        excluded_members: 0,
        superseded: false,
        drifted: false,
    }
}

fn light_basis(session: u128, meta: &CaptureMetadata, night: &str) -> LightBasis {
    LightBasis {
        evidence: LightEvidence {
            session_id: Uuid::from_u128(session),
            grouping_revision: 1,
            capture: evidence(meta, Some(night), None),
        },
        included_assets: [Uuid::from_u128(session * 1000), Uuid::from_u128(session * 1000 + 1)]
            .into(),
        light_type_known: true,
        product: false,
    }
}

fn raw_set(
    session: u128,
    kind: InputKind,
    meta: &CaptureMetadata,
    night: Option<&str>,
) -> InputCandidate {
    InputCandidate {
        candidate: CandidateRef::RawSet {
            session_id: Uuid::from_u128(session),
            grouping_revision: 1,
        },
        evidence: InputEvidence {
            kind,
            form: InputForm::RawSet,
            capture: evidence(meta, night, None),
        },
        state: available(20),
        master: None,
        origin: None,
    }
}

fn master(id: u128, kind: InputKind, meta: &CaptureMetadata) -> InputCandidate {
    InputCandidate {
        candidate: CandidateRef::Master { master_id: Uuid::from_u128(id), revision: 1 },
        evidence: InputEvidence {
            kind,
            form: InputForm::Master,
            capture: evidence(meta, None, None),
        },
        state: available(1),
        master: None,
        origin: None,
    }
}

fn basis(
    lights: Vec<LightBasis>,
    candidates: Vec<InputCandidate>,
    kinds: Vec<InputKind>,
) -> CalibrationViewBasis {
    CalibrationViewBasis {
        view_id: Uuid::from_u128(500),
        view_revision: 1,
        plan: CalibrationPlan {
            required_kinds: kinds,
            ..CalibrationPlan::unplanned(Uuid::from_u128(500))
        },
        lights,
        candidates,
        decisions: Vec::new(),
    }
}

#[test]
fn each_requirement_preselects_one_available_compatible_candidate_in_r10_order() {
    let rules = Rules;
    let light_meta = capture("Light");
    let dark = capture("Dark");
    let far = raw_set(20, InputKind::Dark, &dark, Some("2026-09-28@date-loc-noon"));
    let near_b = raw_set(22, InputKind::Dark, &dark, Some("2026-09-17@date-loc-noon"));
    let near_a = raw_set(21, InputKind::Dark, &dark, Some("2026-09-19@date-loc-noon"));
    let unknown_night = raw_set(19, InputKind::Dark, &dark, None);
    let short = raw_set(
        18,
        InputKind::Dark,
        &CaptureMetadata { exposure_seconds: Some(120.0), ..dark.clone() },
        Some("2026-09-18@date-loc-noon"),
    );
    let plan = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![far, near_b, unknown_night, short, near_a],
        vec![InputKind::Dark],
    ));
    assert_eq!((plan.view_id, plan.plan_revision), (Uuid::from_u128(500), 0));
    let [requirement] = plan.requirements.as_slice() else { panic!("{plan:#?}") };
    let order: Vec<Uuid> = requirement.candidates.iter().map(|c| c.candidate.id()).collect();
    assert_eq!(
        order,
        [21, 22, 20, 19, 18].map(Uuid::from_u128),
        "night distance, unknown nights last, list order by ID; incompatible after compatible"
    );
    assert_eq!(requirement.candidates[0].night_distance_days, Some(1));
    assert_eq!(requirement.candidates[3].night_distance_days, None);
    // D-W5: 21 and 22 rank equal (one day each, both raw sets): no single top input.
    assert_eq!(requirement.state, RequirementState::NeedsReview);
    assert_eq!(requirement.reason, Some(UnresolvedReason::RankingTie));
    assert_eq!(requirement.preselected, None);
    assert_eq!(requirement.automatic, None);
    assert!(requirement.candidates.iter().all(|c| !c.preselected));
    assert!(requirement.effective.is_none());
    assert_eq!(plan.handoff().assignments.len(), 0);

    // Without the tie the nearest night is the single top input.
    let single = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![
            raw_set(21, InputKind::Dark, &dark, Some("2026-09-19@date-loc-noon")),
            raw_set(20, InputKind::Dark, &dark, Some("2026-09-28@date-loc-noon")),
        ],
        vec![InputKind::Dark],
    ));
    let requirement = &single.requirements[0];
    assert_eq!(requirement.state, RequirementState::Suggested);
    assert_eq!(
        requirement.preselected,
        Some(CandidateRef::RawSet { session_id: Uuid::from_u128(21), grouping_revision: 1 })
    );
    assert_eq!(requirement.candidates.iter().filter(|c| c.preselected).count(), 1);
    assert!(requirement.effective.is_none(), "a suggestion is never accepted");

    // Ties put adopted masters before raw sets: both nights unknown.
    let tie = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![raw_set(5, InputKind::Dark, &dark, None), master(9, InputKind::Dark, &dark)],
        vec![InputKind::Dark],
    ));
    assert_eq!(tie.requirements[0].candidates[0].candidate.form(), InputForm::Master);
    assert_eq!(tie.requirements[0].preselected.unwrap().id(), Uuid::from_u128(9));
}

#[test]
fn unavailable_and_unadopted_candidates_are_never_preselected() {
    let rules = Rules;
    let light_meta = capture("Light");
    let dark = capture("Dark");
    let mut offline = raw_set(21, InputKind::Dark, &dark, Some("2026-09-18@date-loc-noon"));
    offline.state.availability = Availability::Offline;
    let mut partial = raw_set(22, InputKind::Dark, &dark, Some("2026-09-18@date-loc-noon"));
    partial.state.available_members = 19;
    partial.state.availability = Availability::Missing;
    let candidate = InputCandidate {
        candidate: CandidateRef::Candidate { asset_id: Uuid::from_u128(23) },
        evidence: InputEvidence {
            kind: InputKind::Dark,
            form: InputForm::Candidate,
            capture: evidence(&dark, Some("2026-09-18@date-loc-noon"), None),
        },
        state: available(1),
        master: None,
        origin: None,
    };
    let plan = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![
            offline,
            partial,
            candidate,
            raw_set(30, InputKind::Dark, &dark, Some("2026-10-30@date-loc-noon")),
        ],
        vec![InputKind::Dark],
    ));
    let requirement = &plan.requirements[0];
    assert_eq!(
        requirement.preselected.unwrap().id(),
        Uuid::from_u128(30),
        "the only available one"
    );
    assert_eq!(requirement.unadopted.len(), 1);
    assert_eq!(requirement.unadopted[0].evaluation.verdict, Verdict::Compatible);
    assert!(!requirement.unadopted[0].preselected);
    assert!(requirement.candidates.iter().all(|c| c.candidate.form() != InputForm::Candidate));

    let only_offline = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![{
            let mut c = raw_set(21, InputKind::Dark, &dark, None);
            c.state.availability = Availability::Offline;
            c.state.available_members = 0;
            c
        }],
        vec![InputKind::Dark],
    ));
    assert_eq!(only_offline.requirements[0].state, RequirementState::NeedsReview);
    assert_eq!(only_offline.requirements[0].reason, Some(UnresolvedReason::InputUnavailable));
}

#[test]
fn unresolved_reasons_name_what_blocks_each_requirement() {
    let rules = Rules;
    let light_meta = capture("Light");
    let bare_flat = CaptureMetadata { telescope: None, focal_length_mm: None, ..capture("Flat") };
    let mut unknown_light = light_basis(
        2,
        &CaptureMetadata { image_type: None, ..light_meta.clone() },
        "2026-09-24@date-loc-noon",
    );
    unknown_light.light_type_known = false;
    let mut product = light_basis(3, &light_meta, "2026-09-24@date-loc-noon");
    product.product = true;
    let plan = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-24@date-loc-noon"), unknown_light, product],
        vec![raw_set(40, InputKind::Flat, &bare_flat, Some("2026-09-26@date-loc-noon"))],
        vec![InputKind::Dark, InputKind::Flat],
    ));
    let states: Vec<_> = plan
        .requirements
        .iter()
        .map(|r| (r.light_session_ids[0].as_u128(), r.kind, r.state, r.reason))
        .collect();
    assert_eq!(
        states,
        [
            (
                2,
                InputKind::Dark,
                RequirementState::NeedsReview,
                Some(UnresolvedReason::LightTypeUnknown)
            ),
            (
                2,
                InputKind::Flat,
                RequirementState::NeedsReview,
                Some(UnresolvedReason::LightTypeUnknown)
            ),
            (
                1,
                InputKind::Dark,
                RequirementState::NeedsReview,
                Some(UnresolvedReason::NoCandidate)
            ),
            (
                1,
                InputKind::Flat,
                RequirementState::NeedsReview,
                Some(UnresolvedReason::CriterionUnknown)
            ),
        ],
        "an unknown-type light is its own light group; a product makes no requirement"
    );
    let flat = &plan.requirements[3];
    assert_eq!(flat.preselected, None);
    assert_eq!(flat.candidates[0].evaluation.blocking(), [CriterionId::OpticalTrain]);

    let incompatible = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-24@date-loc-noon")],
        vec![raw_set(
            41,
            InputKind::Flat,
            &CaptureMetadata { filter: Some("OIII".into()), ..capture("Flat") },
            None,
        )],
        vec![InputKind::Flat],
    ));
    assert_eq!(incompatible.requirements[0].reason, Some(UnresolvedReason::CriterionIncompatible));

    let none = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-24@date-loc-noon")],
        Vec::new(),
        Vec::new(),
    ));
    assert!(none.requirements.is_empty(), "an empty required-kinds set makes no requirement");
    assert!(none.handoff().ready);
}

fn decision(
    light: &LightBasis,
    kind: InputKind,
    resolution: Resolution,
    input: InputRef,
    criteria: Vec<CriterionResult>,
    reason: Option<&str>,
) -> CalibrationDecision {
    CalibrationDecision {
        id: Uuid::from_u128(900),
        view_id: Uuid::from_u128(500),
        view_revision: 1,
        light_group: platevault_core::LightGroupKey::of(light),
        light_session_ids: [light.evidence.session_id].into(),
        light_asset_ids: light.included_assets.clone(),
        kind,
        resolution,
        input: Some(input),
        inputs: vec![platevault_core::CalibrationInputFile {
            asset_id: Some(Uuid::from_u128(901)),
            master_id: None,
            location_id: Uuid::from_u128(5),
            relative_path: path("darks/dark_001.fits"),
            fingerprint: fingerprint(),
        }],
        criteria,
        reason: reason.map(str::to_owned),
        plan_revision: 1,
        decided_at: "2026-10-05T10:00:00Z".into(),
    }
}

/// A plan at View revision 2 holding `decision` made at revision 1.
fn at_revision_two(
    lights: Vec<LightBasis>,
    candidates: Vec<InputCandidate>,
    kind: InputKind,
    decision: CalibrationDecision,
) -> platevault_core::CalibrationViewPlan {
    let mut basis = basis(lights, candidates, vec![kind]);
    basis.view_revision = 2;
    basis.decisions = vec![decision];
    Rules.plan(&basis)
}

#[test]
fn decisions_apply_to_a_later_revision_only_while_their_basis_holds() {
    let rules = Rules;
    let light_meta = capture("Light");
    let dark = capture("Dark");
    let lights = vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")];
    let candidate = raw_set(20, InputKind::Dark, &dark, Some("2026-09-18@date-loc-noon"));
    let input = candidate.candidate.input().unwrap();
    let current = rules.evaluate(InputKind::Dark, &lights[0].evidence, &candidate.evidence);
    let at_revision_two = |lights, candidates, decision| {
        at_revision_two(lights, candidates, InputKind::Dark, decision)
    };
    let accepted =
        decision(&lights[0], InputKind::Dark, Resolution::Accepted, input, current.criteria, None);

    let applies = at_revision_two(lights.clone(), vec![candidate.clone()], accepted.clone());
    let requirement = &applies.requirements[0];
    assert_eq!(requirement.state, RequirementState::Accepted);
    let effective = requirement.effective.as_ref().unwrap();
    assert!(effective.applicable);
    assert_eq!(effective.decided_at_revision, 1);
    let handoff = applies.handoff();
    assert!(handoff.ready);
    assert_eq!(handoff.assignments[0].inputs.len(), 1);

    let mut changed = lights.clone();
    changed[0].included_assets.remove(&Uuid::from_u128(1001));
    let membership = at_revision_two(changed, vec![candidate.clone()], accepted.clone());
    assert_eq!(membership.requirements[0].state, RequirementState::NeedsReview);
    assert_eq!(membership.requirements[0].reason, Some(UnresolvedReason::LightMembershipChanged));
    assert!(!membership.requirements[0].effective.as_ref().unwrap().applicable);
    assert!(!membership.handoff().ready);

    let mut drifted = candidate.clone();
    drifted.evidence.capture = evidence(&CaptureMetadata { gain: None, ..dark }, None, None);
    let verdict_changed = at_revision_two(lights.clone(), vec![drifted], accepted.clone());
    assert_eq!(
        verdict_changed.requirements[0].reason,
        Some(UnresolvedReason::InputEvidenceChanged)
    );

    let mut superseded = candidate.clone();
    superseded.state.superseded = true;
    let superseded = at_revision_two(lights.clone(), vec![superseded], accepted.clone());
    assert_eq!(superseded.requirements[0].reason, Some(UnresolvedReason::InputEvidenceChanged));

    let gone = at_revision_two(lights.clone(), Vec::new(), accepted.clone());
    assert_eq!(gone.requirements[0].reason, Some(UnresolvedReason::InputUnavailable));

    // A withdrawal ends the effective decision: the suggestion is back.
    let withdrawn = CalibrationDecision {
        resolution: Resolution::Withdrawn,
        input: None,
        inputs: Vec::new(),
        criteria: Vec::new(),
        ..accepted
    };
    let after = at_revision_two(lights, vec![candidate], withdrawn);
    assert_eq!(after.requirements[0].state, RequirementState::Suggested);
    assert!(after.requirements[0].effective.is_none());
    assert_eq!(after.handoff().unresolved[0].reason, UnresolvedReason::SuggestionUnaccepted);
}

#[test]
fn an_exception_keeps_its_snapshot_criteria_and_reason() {
    let rules = Rules;
    let lights = vec![light_basis(1, &capture("Light"), "2026-09-24@date-loc-noon")];
    let bare_flat = CaptureMetadata { telescope: None, focal_length_mm: None, ..capture("Flat") };
    let flat = raw_set(30, InputKind::Flat, &bare_flat, Some("2026-09-26@date-loc-noon"));
    let flat_eval = rules.evaluate(InputKind::Flat, &lights[0].evidence, &flat.evidence);
    assert_eq!(flat_eval.verdict, Verdict::Unknown);
    let exception = decision(
        &lights[0],
        InputKind::Flat,
        Resolution::Exception,
        flat.candidate.input().unwrap(),
        flat_eval.criteria,
        Some("Same rotation as 26 Sep; train not changed"),
    );
    let excepted = at_revision_two(lights, vec![flat], InputKind::Flat, exception.clone());
    let requirement = &excepted.requirements[0];
    assert_eq!(requirement.state, RequirementState::Excepted);
    let effective = requirement.effective.as_ref().unwrap();
    assert_eq!(effective.decision.criteria, exception.criteria);
    assert_eq!(effective.decision.reason, exception.reason);
    assert_eq!(
        verdicts(&effective.decision.criteria)[&CriterionId::OpticalTrain],
        Verdict::Unknown
    );
    let handoff = excepted.handoff();
    assert!(handoff.ready);
    assert_eq!(
        handoff.assignments[0].reason.as_deref(),
        Some("Same rotation as 26 Sep; train not changed")
    );
}

#[test]
fn availability_and_quality_are_evidence_beside_the_criteria() {
    let rules = Rules;
    let light_meta = capture("Light");
    let mut candidate =
        raw_set(20, InputKind::Dark, &capture("Dark"), Some("2026-09-20@date-loc-noon"));
    candidate.state.excluded_members = 2;
    let plan = rules.plan(&basis(
        vec![light_basis(1, &light_meta, "2026-09-18@date-loc-noon")],
        vec![candidate],
        vec![InputKind::Dark],
    ));
    let rows = &plan.requirements[0].candidates[0].evaluation.evidence;
    let ids: BTreeSet<EvidenceId> = rows.iter().map(|row| row.evidence).collect();
    for id in [EvidenceId::NightDistance, EvidenceId::Availability, EvidenceId::Quality] {
        assert!(ids.contains(&id), "{id:?} in {rows:#?}");
    }
    let night = rows.iter().find(|row| row.evidence == EvidenceId::NightDistance).unwrap();
    assert!(night.note.as_deref().unwrap().contains('2'), "{night:?}");
}
