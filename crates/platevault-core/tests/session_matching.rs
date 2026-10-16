// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 session matching rules (068 CAL-FR-19 to CAL-FR-22; D-W102 to
//! D-W104, D-W114) over hand-built facts: flats need every hard check, the
//! same rig version, a rotation within the thresholds and the same or next
//! night; darks and bias take the version closest to the lights inside 365
//! days and only suggest one outside it; a master beats a raw set; anything
//! short of every check is a suggestion with its cautions.

use std::collections::BTreeSet;

use platevault_core::calibration::Rules;
use platevault_core::{
    CalibrationRules, CaptureEvidence, CaptureMetadata, CriterionId, DarkBiasRules, FileIdentity,
    FlatRules, InputKind, InputRef, KindMatch, LightRig, MatchCamera, MatchCaution,
    ObservationFingerprint, OpticsSignature, PathSensitivity, PinOrigin, PinState, PinnedFile,
    RigVersion, RotatorPresence, SessionInput, SessionLight, Verdict, VolumeIdentity,
    WorkflowSettings,
};
use time::macros::date;
use time::Date;
use uuid::Uuid;

const SHA: &str = "a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

/// ASI2600MM, gain 100, offset 50, 6248 x 4176, binning 1, -10 C, `RedCat`
/// 51 at 250 mm.
fn metadata(image_type: &str, filter: Option<&str>, exposure: f64) -> CaptureMetadata {
    CaptureMetadata {
        image_type: Some(image_type.into()),
        filter: filter.map(str::to_owned),
        exposure_seconds: Some(exposure),
        camera: Some("ASI2600MM".into()),
        gain: Some(100.0),
        offset: Some(50),
        width: Some(6248),
        height: Some(4176),
        binning_x: Some(1),
        binning_y: Some(1),
        set_temperature_c: Some(-10.0),
        telescope: Some("RedCat 51".into()),
        focal_length_mm: Some(250.0),
        ..CaptureMetadata::default()
    }
}

fn evidence(meta: &CaptureMetadata) -> CaptureEvidence {
    CaptureEvidence::from_metadata(meta, &BTreeSet::new(), None, None)
}

fn version(n: u128, valid_from: Date, rotator: RotatorPresence) -> RigVersion {
    RigVersion {
        id: id(n),
        rig_id: id(500),
        valid_from,
        optics: OpticsSignature::new(Some(id(400)), Some(250.0), None).unwrap(),
        rotator,
    }
}

/// 300 s Ha lights on 1 Oct 2026 at ROTATANG 10°, on camera 400 and the
/// `RedCat`'s version from 1 Jan 2026 with a rotator.
fn light() -> SessionLight {
    let only = version(600, date!(2026 - 01 - 01), RotatorPresence::Present);
    SessionLight {
        session_id: id(1),
        capture: evidence(&metadata("LIGHT", Some("Ha"), 300.0)),
        night: Some(date!(2026 - 10 - 01)),
        camera: MatchCamera::Known { camera_id: id(400) },
        rig: Some(LightRig { rig_id: id(500), version: Some(only.clone()), versions: vec![only] }),
        rotator_deg: Some(10.0),
    }
}

fn file(n: u128) -> PinnedFile {
    PinnedFile {
        asset_id: Some(id(n)),
        sha256: SHA.into(),
        fingerprint: ObservationFingerprint {
            identity: FileIdentity {
                volume: VolumeIdentity {
                    filesystem: "apfs".into(),
                    stable_id: Some("volume".into()),
                    file_ids_stable: true,
                    case: PathSensitivity::Sensitive,
                    normalization: PathSensitivity::Sensitive,
                },
                file_id: Some(n.to_string()),
            },
            size_bytes: 64,
            modified_ns: 1,
            content_sha256: Some(SHA.into()),
        },
    }
}

/// A raw set of `kind` from camera 400, taken on `captured`.
fn raw(n: u128, kind: InputKind, meta: &CaptureMetadata, captured: Date) -> SessionInput {
    SessionInput {
        input: InputRef::RawSet { session_id: id(n), grouping_revision: 1 },
        kind,
        capture: evidence(meta),
        captured: Some(captured),
        camera: MatchCamera::Known { camera_id: id(400) },
        rig_version_id: None,
        rotator_deg: vec![Some(10.0), Some(10.0)],
        files: vec![file(n * 10), file(n * 10 + 1)],
        available: true,
    }
}

/// An adopted master of `kind`, taken on `captured`.
fn master(n: u128, kind: InputKind, meta: &CaptureMetadata, captured: Date) -> SessionInput {
    SessionInput {
        input: InputRef::Master { master_id: id(n), revision: 1 },
        files: vec![PinnedFile { asset_id: None, ..file(n * 10) }],
        rotator_deg: vec![Some(10.0)],
        ..raw(n, kind, meta, captured)
    }
}

fn flat(n: u128, captured: Date) -> SessionInput {
    raw(n, InputKind::Flat, &metadata("FLAT", Some("Ha"), 2.0), captured)
}

fn dark(n: u128, captured: Date) -> SessionInput {
    raw(n, InputKind::Dark, &metadata("DARK", None, 300.0), captured)
}

fn matched(kind: InputKind, light: &SessionLight, inputs: &[SessionInput]) -> KindMatch {
    Rules.match_session(kind, light, inputs, &WorkflowSettings::default())
}

fn pinned_input(state: &PinState) -> Option<InputRef> {
    match state {
        PinState::Pinned { target, origin: PinOrigin::Automatic } => Some(target.input),
        _ => None,
    }
}

fn suggested_input(state: &PinState) -> Option<InputRef> {
    match state {
        PinState::Suggested { target } => Some(target.input),
        _ => None,
    }
}

fn verdict(found: &KindMatch, criterion: CriterionId) -> Verdict {
    found.offers[0]
        .target
        .evaluation
        .criteria
        .iter()
        .find(|row| row.criterion == criterion)
        .map(|row| row.verdict)
        .expect("the criterion is evaluated")
}

#[test]
fn a_same_night_flat_on_the_lights_rig_version_is_pinned_with_its_evidence() {
    let found = matched(InputKind::Flat, &light(), &[flat(10, date!(2026 - 10 - 01))]);
    assert_eq!(pinned_input(&found.state()), Some(flat(10, date!(2026 - 10 - 01)).input));
    assert_eq!(found.offers[0].cautions, []);
    for criterion in [CriterionId::RigVersion, CriterionId::Rotation, CriterionId::OpticalTrain] {
        assert_eq!(verdict(&found, criterion), Verdict::Compatible, "{criterion:?}");
    }
    let evaluation = &found.offers[0].target.evaluation;
    assert!(
        !evaluation.criteria.iter().any(|row| row.criterion == CriterionId::Gain),
        "flats are not matched by gain (CAL-FR-19)"
    );
    let age = evaluation.evidence.last().expect("the dates of both sides");
    assert_eq!(
        (age.light_value.as_deref(), age.input_value.as_deref()),
        (Some("2026-10-01"), Some("2026-10-01"))
    );
}

#[test]
fn flats_within_two_degrees_pin_up_to_five_warn_and_beyond_are_not_offered() {
    let at = |degrees: f64| SessionInput {
        rotator_deg: vec![Some(10.0 + degrees)],
        ..flat(10, date!(2026 - 10 - 01))
    };
    assert!(pinned_input(&matched(InputKind::Flat, &light(), &[at(1.0)]).state()).is_some());
    let warned = matched(InputKind::Flat, &light(), &[at(4.0)]);
    assert!(suggested_input(&warned.state()).is_some(), "4° is suggested");
    assert_eq!(warned.offers[0].cautions, [MatchCaution::RotationWarning { degrees: "4".into() }]);
    assert!(matched(InputKind::Flat, &light(), &[at(7.0)]).offers.is_empty(), "7° isn't offered");
    let ranked = matched(InputKind::Flat, &light(), &[at(4.0), at(1.0)]);
    assert_eq!(ranked.offers.len(), 2);
    assert!(pinned_input(&ranked.state()).is_some(), "the 1° set ranks first");
    let wrapped = matched(
        InputKind::Flat,
        &SessionLight { rotator_deg: Some(359.0), ..light() },
        &[at(-9.0)],
    );
    assert!(pinned_input(&wrapped.state()).is_some(), "359° and 1° are 2° apart");
}

#[test]
fn a_missing_angle_is_unknown_on_a_rotator_rig_and_no_blocker_without_one() {
    let unknown =
        SessionInput { rotator_deg: vec![Some(10.0), None], ..flat(10, date!(2026 - 10 - 01)) };
    let found = matched(InputKind::Flat, &light(), std::slice::from_ref(&unknown));
    assert!(suggested_input(&found.state()).is_some());
    assert_eq!(verdict(&found, CriterionId::Rotation), Verdict::Unknown);
    assert_eq!(
        found.offers[0].cautions,
        [MatchCaution::CriterionUnknown { criteria: vec![CriterionId::Rotation] }]
    );
    let fixed = version(600, date!(2026 - 01 - 01), RotatorPresence::Absent);
    let no_rotator = SessionLight {
        rig: Some(LightRig {
            rig_id: id(500),
            version: Some(fixed.clone()),
            versions: vec![fixed],
        }),
        rotator_deg: None,
        ..light()
    };
    assert!(pinned_input(&matched(InputKind::Flat, &no_rotator, &[unknown]).state()).is_some());
}

#[test]
fn flats_from_another_rig_version_are_never_offered_and_an_unconfirmed_rig_suggests() {
    let before = version(600, date!(2026 - 01 - 01), RotatorPresence::Present);
    let remount = version(601, date!(2026 - 09 - 25), RotatorPresence::Present);
    let remounted = SessionLight {
        rig: Some(LightRig {
            rig_id: id(500),
            version: Some(remount.clone()),
            versions: vec![before, remount],
        }),
        ..light()
    };
    let old = flat(10, date!(2026 - 09 - 24));
    let wide = WorkflowSettings {
        flats: FlatRules { window_nights: 30, ..FlatRules::default() },
        ..WorkflowSettings::default()
    };
    assert!(
        Rules
            .match_session(InputKind::Flat, &remounted, std::slice::from_ref(&old), &wide)
            .offers
            .is_empty(),
        "a remount makes earlier flats incompatible"
    );
    let recorded = SessionInput { rig_version_id: Some(id(601)), ..old };
    assert!(pinned_input(
        &Rules.match_session(InputKind::Flat, &remounted, &[recorded], &wide).state()
    )
    .is_some());
    let unconfirmed = SessionLight { rig: None, ..light() };
    let found = matched(InputKind::Flat, &unconfirmed, &[flat(10, date!(2026 - 10 - 01))]);
    assert!(suggested_input(&found.state()).is_some(), "the rig version is unknown");
    assert_eq!(verdict(&found, CriterionId::RigVersion), Verdict::Unknown);
}

#[test]
fn the_flat_window_counts_nights_either_way_and_is_a_setting() {
    let late = flat(10, date!(2026 - 10 - 13));
    let found = matched(InputKind::Flat, &light(), std::slice::from_ref(&late));
    assert_eq!(found.offers[0].cautions, [MatchCaution::OutsideWindow { days: 12, window: 1 }]);
    assert!(suggested_input(&found.state()).is_some(), "the default window suggests it");
    let next_night = matched(InputKind::Flat, &light(), &[flat(11, date!(2026 - 09 - 30))]);
    assert!(pinned_input(&next_night.state()).is_some(), "the night before is inside one night");
    let fixed_setup = WorkflowSettings {
        flats: FlatRules { window_nights: 30, ..FlatRules::default() },
        ..WorkflowSettings::default()
    };
    let wide = Rules.match_session(InputKind::Flat, &light(), &[late], &fixed_setup);
    assert!(pinned_input(&wide.state()).is_some(), "a 30-night window pins it (CAL-AC-24)");
}

#[test]
fn darks_pin_the_closest_version_inside_365_days_and_only_suggest_outside() {
    let older = dark(10, date!(2025 - 09 - 10));
    let newer = dark(11, date!(2026 - 09 - 20));
    let found = matched(InputKind::Dark, &light(), &[older.clone(), newer.clone()]);
    assert_eq!(pinned_input(&found.state()), Some(newer.input), "CAL-AC-23");
    let alone = matched(InputKind::Dark, &light(), std::slice::from_ref(&older));
    assert_eq!(suggested_input(&alone.state()), Some(older.input));
    assert_eq!(alone.offers[0].cautions, [MatchCaution::OutsideWindow { days: 386, window: 365 }]);
    let age = alone.offers[0].target.evaluation.evidence.last().unwrap();
    assert_eq!(
        (age.light_value.as_deref(), age.input_value.as_deref()),
        (Some("2026-10-01"), Some("2025-09-10")),
        "both capture dates are shown"
    );
    let after = dark(12, date!(2026 - 10 - 05));
    let closest = matched(InputKind::Dark, &light(), &[newer, after.clone()]);
    assert_eq!(pinned_input(&closest.state()), Some(after.input), "4 days after beats 11 before");
    let narrow = WorkflowSettings {
        dark_bias: DarkBiasRules { window_days: 3 },
        ..WorkflowSettings::default()
    };
    let outside =
        Rules.match_session(InputKind::Dark, &light(), &[dark(13, date!(2026 - 10 - 05))], &narrow);
    assert!(suggested_input(&outside.state()).is_some(), "after the lights also counts");
}

#[test]
fn a_bias_ignores_exposure_and_a_dark_needs_it() {
    let bias = raw(10, InputKind::Bias, &metadata("BIAS", None, 0.001), date!(2026 - 09 - 20));
    assert!(
        pinned_input(&matched(InputKind::Bias, &light(), &[bias]).state()).is_some(),
        "CAL-AC-30"
    );
    let short = raw(11, InputKind::Dark, &metadata("DARK", None, 120.0), date!(2026 - 09 - 20));
    assert_eq!(matched(InputKind::Dark, &light(), &[short]).offers, []);
}

#[test]
fn another_camera_is_never_offered_and_an_unnamed_one_of_several_is_suggested() {
    let other = SessionInput {
        camera: MatchCamera::Known { camera_id: id(401) },
        ..dark(10, date!(2026 - 09 - 20))
    };
    assert!(matched(InputKind::Dark, &light(), &[other]).offers.is_empty(), "CAL-AC-14");
    let unnamed =
        SessionInput { camera: MatchCamera::Ambiguous, ..dark(11, date!(2026 - 09 - 20)) };
    let found = matched(InputKind::Dark, &light(), &[unnamed]);
    assert!(suggested_input(&found.state()).is_some());
    assert_eq!(verdict(&found, CriterionId::Camera), Verdict::Unknown);
}

#[test]
fn a_master_beats_a_raw_set_and_a_tie_is_only_suggested() {
    let raw_flats = flat(10, date!(2026 - 10 - 01));
    let master_flat = master(
        20,
        InputKind::Flat,
        &metadata("MASTERFLAT", Some("Ha"), 2.0),
        date!(2026 - 09 - 30),
    );
    let found = matched(InputKind::Flat, &light(), &[raw_flats.clone(), master_flat.clone()]);
    assert_eq!(pinned_input(&found.state()), Some(master_flat.input), "CAL-AC-21");
    let twin = flat(11, date!(2026 - 10 - 01));
    let tied = matched(InputKind::Flat, &light(), &[raw_flats, twin]);
    assert!(suggested_input(&tied.state()).is_some());
    assert_eq!(tied.offers[0].cautions, [MatchCaution::RankingTie]);
}

#[test]
fn an_unreadable_input_is_suggested_and_nothing_offered_is_unresolved() {
    let offline = SessionInput { available: false, ..dark(10, date!(2026 - 09 - 20)) };
    let found = matched(InputKind::Dark, &light(), &[offline]);
    assert_eq!(found.offers[0].cautions, [MatchCaution::Unavailable]);
    assert_eq!(matched(InputKind::Bias, &light(), &[]).state(), PinState::Unresolved);
}
