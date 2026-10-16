// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Which rig version a night was captured with, and which camera a model
//! names (astro-plan-wmfw6; LIB-FR-26, PLAN-EQ-FR-07/08, D-W104).

use platevault_model::{
    Camera, CameraBasis, CameraLink, CameraResolution, OpticsSignature, RigVersion, RotatorPresence,
};
use time::macros::date;
use time::Date;
use uuid::Uuid;

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn version(n: u128, valid_from: Date) -> RigVersion {
    RigVersion {
        id: id(n),
        rig_id: id(60),
        valid_from,
        optics: OpticsSignature::new(Some(id(70)), Some(250.0), None).unwrap(),
        rotator: RotatorPresence::Absent,
    }
}

fn camera(n: u128, model: &str, alias: Option<&str>) -> Camera {
    Camera {
        id: id(n),
        model: model.into(),
        alias: alias.map(str::to_owned),
        no_darks: false,
        no_bias: false,
        revision: 1,
    }
}

/// PLAN-EQ-AC-08: versions from 1 Oct and 8 Oct; a night reads the latest
/// version starting on or before it.
#[test]
fn a_night_reads_the_latest_version_starting_on_or_before_it() {
    let first = version(1, date!(2026 - 10 - 01));
    let second = version(2, date!(2026 - 10 - 08));
    // Listed out of order on purpose: the rule does not depend on order.
    let versions = [second.clone(), first.clone()];
    let on = |night| RigVersion::for_night(&versions, Some(night)).map(|version| version.id);
    assert_eq!(on(date!(2026 - 10 - 01)), Some(first.id), "a version starts on its own date");
    assert_eq!(on(date!(2026 - 10 - 05)), Some(first.id));
    assert_eq!(on(date!(2026 - 10 - 08)), Some(second.id));
    assert_eq!(on(date!(2026 - 10 - 09)), Some(second.id));
    assert_eq!(
        on(date!(2026 - 09 - 28)),
        Some(first.id),
        "a night before the first version reads the first: it stands for the rig before any edit"
    );
}

#[test]
fn an_unknown_night_reads_only_a_rig_with_one_version() {
    let first = version(1, date!(2026 - 10 - 01));
    let second = version(2, date!(2026 - 10 - 08));
    assert_eq!(
        RigVersion::for_night(std::slice::from_ref(&first), None).map(|version| version.id),
        Some(first.id),
        "every night of a one-version rig reads that version"
    );
    assert!(
        RigVersion::for_night(&[first, second], None).is_none(),
        "with several versions an undated session's version is unknown"
    );
    assert!(RigVersion::for_night(&[], Some(date!(2026 - 10 - 01))).is_none());
}

/// PLAN-EQ-AC-10: one camera of a model matches by model with no question;
/// several make the import ask which.
#[test]
fn a_model_names_a_camera_only_while_the_rigs_hold_one_of_it() {
    let mono = camera(1, "ASI2600MM", None);
    let osc = camera(2, "ASI533MC", None);
    assert_eq!(
        Camera::resolve_model(std::slice::from_ref(&osc), "ASI2600MM"),
        CameraResolution::Unknown
    );
    assert_eq!(
        Camera::resolve_model(&[mono.clone(), osc.clone()], "  "),
        CameraResolution::Unknown
    );

    let one = Camera::resolve_model(&[mono.clone(), osc.clone()], " asi2600mm ");
    assert_eq!(one, CameraResolution::Model { camera_id: mono.id }, "compared by comparison key");
    assert_eq!(one.link(), Some(CameraLink { camera_id: mono.id, basis: CameraBasis::Model }));

    let a = camera(3, "ASI2600MM", Some("2600 A"));
    let b = camera(4, "ASI2600MM", Some("2600 B"));
    let several = Camera::resolve_model(&[b.clone(), osc, a.clone()], "ASI2600MM");
    assert_eq!(several, CameraResolution::Choose { camera_ids: vec![a.id, b.id] });
    assert_eq!(several.link(), None, "several cameras never link by model");
    assert_eq!(CameraResolution::Unknown.link(), None);
}

#[test]
fn a_camera_resolution_round_trips_in_camel_case() {
    let several = CameraResolution::Choose { camera_ids: vec![id(3), id(4)] };
    let json = serde_json::to_value(&several).unwrap();
    assert_eq!(json["resolution"], "choose");
    assert!(json["cameraIds"].is_array(), "{json}");
    assert_eq!(serde_json::from_value::<CameraResolution>(json).unwrap(), several);
}
