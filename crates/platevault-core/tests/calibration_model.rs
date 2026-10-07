// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared calibration model types (spec 068): the stack count a master
//! determination reads, the Calibration reference kind, required kinds, adoption
//! destinations and the PREP handoff projection.

mod support;

use metadata_core::MetadataExtractor;
use platevault_core::{
    CaptureMetadata, FileIdentity, LibraryError, NativePath, ObservationFingerprint, VolumeIdentity,
};
use uuid::Uuid;

#[test]
fn capture_metadata_carries_the_stack_count_and_keeps_an_absent_count_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let cases: [(&str, &[(&str, &str)], Option<u32>); 3] = [
        ("both.fits", &[("IMAGETYP", "'Flat'"), ("STACKCNT", "30"), ("NCOMBINE", "12")], Some(30)),
        ("ncombine.fits", &[("IMAGETYP", "'Flat'"), ("NCOMBINE", "12")], Some(12)),
        ("none.fits", &[("IMAGETYP", "'Flat'")], None),
    ];
    for (name, fields, expected) in cases {
        let path = dir.path().join(name);
        support::fits(&path, fields).unwrap();
        let raw = metadata_fits::FitsExtractor.extract(&path).unwrap().unwrap();
        assert_eq!(CaptureMetadata::from(&raw).stack_count, expected, "{name}");
    }
    let absent = CaptureMetadata::from(&metadata_core::RawFileMetadata::default());
    assert_eq!(absent.stack_count, None, "an absent count is never 0");
    // A capture stored before 068 carries no stackCount field at all.
    let mut stored = serde_json::to_value(&absent).unwrap();
    assert!(stored.as_object_mut().unwrap().remove("stackCount").is_some());
    let read: CaptureMetadata = serde_json::from_value(stored).unwrap();
    assert_eq!(read.stack_count, None);
}

#[test]
fn calibration_references_are_a_new_kind_and_older_kinds_keep_their_wire_names() {
    use platevault_core::ReferenceKind;
    for (kind, wire) in [
        (ReferenceKind::Calibration, "calibration"),
        (ReferenceKind::View, "view"),
        (ReferenceKind::Project, "project"),
        (ReferenceKind::Result, "result"),
    ] {
        let text = serde_json::to_value(kind).unwrap();
        assert_eq!(text, serde_json::json!(wire));
        assert_eq!(serde_json::from_value::<ReferenceKind>(text).unwrap(), kind);
    }
}

fn names_field(error: &LibraryError, field: &str) -> bool {
    matches!(error, LibraryError::InvalidInput(message) if message.contains(field))
}

#[test]
fn required_kinds_are_bias_dark_and_flat_without_duplicates() {
    use platevault_core::{required_kinds, InputKind};
    let error = required_kinds(&[InputKind::Dark, InputKind::Flat, InputKind::Dark]).unwrap_err();
    assert!(names_field(&error, "kinds"), "{error:?}");
    assert_eq!(required_kinds(&[]).unwrap(), Vec::<InputKind>::new());
    assert_eq!(
        required_kinds(&[InputKind::Flat, InputKind::Bias]).unwrap(),
        vec![InputKind::Bias, InputKind::Flat]
    );
    for wire in ["dark_flat", "darkflat", "light", ""] {
        let parsed = serde_json::from_value::<InputKind>(serde_json::json!(wire))
            .map_err(LibraryError::from);
        assert!(matches!(parsed, Err(LibraryError::InvalidInput(_))), "{wire}: {parsed:?}");
    }
    for (kind, wire) in
        [(InputKind::Bias, "bias"), (InputKind::Dark, "dark"), (InputKind::Flat, "flat")]
    {
        assert_eq!(serde_json::to_value(kind).unwrap(), serde_json::json!(wire));
    }
}

#[test]
fn an_adoption_destination_names_a_new_file_below_the_location_root() {
    use platevault_core::AdoptionDestination;
    let destination = |path: &str| AdoptionDestination {
        location_id: Uuid::from_u128(7),
        relative_path: NativePath::UnixBytes(path.as_bytes().to_vec()),
    };
    for refused in
        ["/masters/masterFlat.fit", "../masterFlat.fit", "masters/../../x.fit", "", ".", "masters/"]
    {
        let error = destination(refused).validate().unwrap_err();
        assert!(names_field(&error, "relativePath"), "{refused:?}: {error:?}");
    }
    assert_eq!(
        destination("masters/master_flat_Ha.fit").validate().unwrap(),
        std::path::PathBuf::from("masters/master_flat_Ha.fit")
    );
    #[cfg(unix)]
    {
        let lossy = AdoptionDestination {
            location_id: Uuid::from_u128(7),
            relative_path: NativePath::UnixBytes(b"masters/flat_\xff.fit".to_vec()),
        };
        let path = lossy.validate().unwrap();
        assert_eq!(NativePath::from_path(&path), lossy.relative_path, "non-UTF8 stays lossless");
        let wire = serde_json::to_value(&lossy).unwrap();
        let back: AdoptionDestination = serde_json::from_value(wire).unwrap();
        assert_eq!(back, lossy);
    }
}

#[test]
#[expect(clippy::too_many_lines)]
fn the_handoff_projects_only_accepted_and_excepted_assignments() {
    use platevault_core::{
        CalibrationDecision, CalibrationInputFile, CalibrationViewPlan, EffectiveDecision,
        InputKind, InputRef, Requirement, RequirementState, Resolution, UnresolvedReason,
    };
    let fingerprint = ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("vol".into()),
                file_ids_stable: true,
                case: platevault_core::PathSensitivity::Insensitive,
                normalization: platevault_core::PathSensitivity::Insensitive,
            },
            file_id: Some("41".into()),
        },
        size_bytes: 2880,
        modified_ns: 1,
        content_sha256: Some("ab".repeat(32)),
    };
    let group = |session: u128| platevault_core::LightGroupKey {
        channel: Some(format!("s{session}")),
        light_type_known: true,
        ..platevault_core::LightGroupKey::default()
    };
    let decision = |session: u128, kind, resolution, reason: Option<&str>| CalibrationDecision {
        id: Uuid::from_u128(session * 10),
        view_id: Uuid::from_u128(1),
        view_revision: 1,
        light_group: group(session),
        light_session_ids: [Uuid::from_u128(session)].into(),
        light_asset_ids: [Uuid::from_u128(session + 100)].into(),
        kind,
        resolution,
        input: Some(InputRef::RawSet { session_id: Uuid::from_u128(50), grouping_revision: 2 }),
        inputs: vec![CalibrationInputFile {
            asset_id: Some(Uuid::from_u128(51)),
            master_id: None,
            location_id: Uuid::from_u128(5),
            relative_path: NativePath::UnixBytes(b"darks/dark_300s_001.fits".to_vec()),
            fingerprint: fingerprint.clone(),
        }],
        criteria: Vec::new(),
        reason: reason.map(str::to_owned),
        plan_revision: 2,
        decided_at: "2026-10-05T10:00:00Z".into(),
    };
    let requirement =
        |session: u128, kind, state, reason, effective: Option<CalibrationDecision>| Requirement {
            light_group: group(session),
            light_session_ids: vec![Uuid::from_u128(session)],
            light_asset_ids: [Uuid::from_u128(session + 100)].into(),
            kind,
            state,
            reason,
            preselected: None,
            automatic: None,
            candidates: Vec::new(),
            unadopted: Vec::new(),
            effective: effective.map(|decision| EffectiveDecision {
                decided_at_revision: decision.view_revision,
                decision,
                applicable: true,
            }),
        };
    let accepted = requirement(
        2,
        InputKind::Dark,
        RequirementState::Accepted,
        None,
        Some(decision(2, InputKind::Dark, Resolution::Accepted, None)),
    );
    let excepted = requirement(
        3,
        InputKind::Flat,
        RequirementState::Excepted,
        None,
        Some(decision(3, InputKind::Flat, Resolution::Exception, Some("Same rotation"))),
    );
    let suggested = requirement(4, InputKind::Dark, RequirementState::Suggested, None, None);
    let unknown = requirement(
        4,
        InputKind::Flat,
        RequirementState::NeedsReview,
        Some(UnresolvedReason::CriterionUnknown),
        None,
    );
    let plan = |requirements| CalibrationViewPlan {
        view_id: Uuid::from_u128(1),
        view_revision: 1,
        plan_revision: 2,
        policy: platevault_core::CalibrationPolicy::Automatic,
        required_kinds: vec![InputKind::Dark, InputKind::Flat],
        requirements,
    };
    let open = plan(vec![accepted.clone(), excepted.clone(), suggested, unknown]).handoff();
    assert!(!open.ready);
    let assigned: Vec<_> =
        open.assignments.iter().map(|a| (a.light_session_ids[0], a.kind)).collect();
    assert_eq!(
        assigned,
        [(Uuid::from_u128(2), InputKind::Dark), (Uuid::from_u128(3), InputKind::Flat)]
    );
    assert_eq!(open.assignments[1].reason.as_deref(), Some("Same rotation"));
    assert_eq!(open.assignments[0].inputs.len(), 1);
    assert_eq!(open.assignments[0].decided_at_revision, 1);
    let unresolved: Vec<_> =
        open.unresolved.iter().map(|u| (u.light_session_ids[0], u.kind, u.reason)).collect();
    assert_eq!(
        unresolved,
        [
            (Uuid::from_u128(4), InputKind::Dark, UnresolvedReason::SuggestionUnaccepted),
            (Uuid::from_u128(4), InputKind::Flat, UnresolvedReason::CriterionUnknown),
        ],
        "a suggestion is never an assignment"
    );
    let ready = plan(vec![accepted, excepted]).handoff();
    assert!(ready.ready);
    assert!(ready.unresolved.is_empty());
}
