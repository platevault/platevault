// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 canonical Project model (astro-plan-sb7v7): desired and applied
//! state, groups, explicit capture membership, session calibration pins,
//! admission, Closed snapshots, the View manifest and Apply journal, Output
//! observations, the one-operation record, rig versions and the owner-approved
//! defaults. Every type round-trips through JSON, and every invariant its
//! constructor or `validate` protects refuses the broken shape.

use platevault_model::{
    admit_session, session_blockers, AdmissionBlocker, ApplicableQuality, ApplyJournal,
    ApplyOutcome, ApplyPhase, BasisCapture, BasisGroup, BasisSession, CalibrationHealth,
    CalibrationNeed, Camera, CameraBasis, CameraLink, CaptureInclusion, ChangeSource,
    Classification, ClosePolicy, ClosedSnapshot, CopyBasis, DeclineOrigin, EntryEvidence,
    EntryInput, EntryKind, EntryName, EntryPlacement, EntrySource, Evaluation, ExclusionBasis,
    ExpectedTree, FileIdentity, ForeignItem, ForeignItemState, GroupKeywords, GroupName,
    GroupOrigin, InclusionBasis, InputKind, InputRef, ManifestEntry, ManifestState, MasterBasis,
    MasterEvidence, MasterOfferState, NativePath, ObservationFingerprint, OpticsSignature,
    OutputKind, OutputObservation, OutputOrigin, OutputState, PathSensitivity, PendingChange,
    PinHealth, PinOrigin, PinState, PinTarget, PinnedFile, PreviousItem, PreviousItemReason,
    PreviousItemReview, ProcessingMasterOffer, ProjectBasis, ProjectCapture, ProjectDesired,
    ProjectGroup, ProjectLifecycle, ProjectOperation, ProjectOperationKind, ProjectOperationState,
    ProjectSessionMember, ProjectViewSettings, RigVersion, RotatorPresence, SessionCalibration,
    SessionIntake, SessionPlacement, SessionReadiness, SettledPin, ViewManifest, ViewMode,
    VolumeIdentity, WorkflowSettings, WrapUpOutcome, WrapUpRecord, WrapUpStep,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use uuid::Uuid;

const SHA: &str = "a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";
const DATE: &str = "2026-10-14";

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn round_trip<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(value: &T) {
    let json = serde_json::to_string(value).unwrap();
    let back: T = serde_json::from_str(&json).unwrap();
    assert_eq!(&back, value, "{json}");
}

fn night() -> time::Date {
    time::Date::parse(DATE, time::macros::format_description!("[year]-[month]-[day]")).unwrap()
}

fn fingerprint(file: u32) -> ObservationFingerprint {
    ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("volume".into()),
                file_ids_stable: true,
                case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive,
            },
            file_id: Some(file.to_string()),
        },
        size_bytes: 1024,
        modified_ns: 1_760_000_000_000_000_000,
        content_sha256: Some(SHA.into()),
    }
}

fn copy(asset: u128) -> CopyBasis {
    CopyBasis {
        asset_id: id(asset),
        decision_revision: 1,
        fingerprint: fingerprint(u32::try_from(asset).unwrap()),
    }
}

fn path(text: &str) -> NativePath {
    NativePath::from_path(std::path::Path::new(text))
}

fn master_target() -> PinTarget {
    PinTarget {
        input: InputRef::Master { master_id: id(900), revision: 1 },
        captured: Some(night()),
        files: vec![PinnedFile { asset_id: None, sha256: SHA.into(), fingerprint: fingerprint(9) }],
        evaluation: Evaluation::new(Vec::new(), Vec::new()),
    }
}

fn raw_target() -> PinTarget {
    PinTarget {
        input: InputRef::RawSet { session_id: id(800), grouping_revision: 2 },
        captured: Some(night()),
        files: vec![
            PinnedFile { asset_id: Some(id(801)), sha256: SHA.into(), fingerprint: fingerprint(1) },
            PinnedFile { asset_id: Some(id(802)), sha256: SHA.into(), fingerprint: fingerprint(2) },
        ],
        evaluation: Evaluation::new(Vec::new(), Vec::new()),
    }
}

fn settled_calibration(session: Uuid) -> SessionCalibration {
    SessionCalibration {
        session_id: session,
        generation: 3,
        matching_pending: false,
        dark: PinState::Pinned { target: master_target(), origin: PinOrigin::Automatic },
        flat: PinState::Pinned { target: raw_target(), origin: PinOrigin::Confirmed },
        bias: PinState::Declined { origin: DeclineOrigin::CameraDefault },
    }
}

fn optics() -> OpticsSignature {
    OpticsSignature::new(Some(id(70)), Some(250.0), None).unwrap()
}

fn group(n: u128, name: &str) -> ProjectGroup {
    ProjectGroup {
        id: id(n),
        rig_id: id(60),
        name: GroupName::new(name).unwrap(),
        panel: false,
        origin: GroupOrigin::Framing,
        optics: optics(),
        framing: None,
        position: 0,
    }
}

fn member(session: u128, group: u128) -> ProjectSessionMember {
    ProjectSessionMember {
        session_id: id(session),
        group_id: id(group),
        placement: SessionPlacement::Framing,
        grouping_revision: 1,
        calibration_generation: 3,
        added_at: "2026-10-16T08:00:00Z".into(),
    }
}

fn capture(session: u128, copies: &[u128]) -> ProjectCapture {
    ProjectCapture::new(
        id(session),
        copies.iter().map(|asset| copy(*asset)).collect(),
        CaptureInclusion::Included { basis: InclusionBasis::Usable },
        ApplicableQuality::Usable,
    )
    .unwrap()
}

fn desired() -> ProjectDesired {
    ProjectDesired {
        project_id: id(1),
        revision: 4,
        lifecycle: ProjectLifecycle::Open,
        settings: ProjectViewSettings::default(),
        groups: vec![group(10, "RedCat")],
        sessions: vec![member(20, 10)],
        captures: vec![capture(20, &[31, 30])],
    }
}

fn basis() -> ProjectBasis {
    ProjectBasis {
        mode: ViewMode::Copies,
        keywords: GroupKeywords::default(),
        groups: vec![BasisGroup {
            id: id(10),
            name: GroupName::new("RedCat").unwrap(),
            panel: false,
            rig_id: id(60),
            sessions: vec![BasisSession {
                session_id: id(20),
                night: Some(night()),
                captures: vec![BasisCapture {
                    capture_key: id(30),
                    included: true,
                    copies: vec![copy(30)],
                }],
                calibration: settled_calibration(id(20)).settled().unwrap(),
            }],
        }],
    }
}

fn light_entry(seq: u32, file: &str, placement: EntryPlacement) -> ManifestEntry {
    ManifestEntry {
        seq,
        path: path(file),
        group_id: None,
        night: Some(night()),
        source: EntrySource::Light { capture_key: id(30), asset_id: id(30) },
        placement,
        source_sha256: SHA.into(),
        source_fingerprint: fingerprint(30),
        written: None,
        header_patch: Vec::new(),
    }
}

fn manifest(entries: Vec<ManifestEntry>) -> ViewManifest {
    ViewManifest {
        project_id: id(1),
        generation: 1,
        state: ManifestState::Building,
        operation_id: id(500),
        desired_revision: 4,
        basis: basis(),
        entries,
    }
}

fn journal(phase: ApplyPhase) -> ApplyJournal {
    ApplyJournal {
        operation_id: id(500),
        project_id: id(1),
        generation: 1,
        phase,
        settled_from: None,
        outcome: None,
        expected: ExpectedTree {
            root: path("/Processing/NGC-7000"),
            root_identity: fingerprint(40).identity,
            view: None,
            building: None,
            previous: None,
        },
        error: None,
    }
}

fn ready_intake(session: Uuid) -> SessionIntake {
    SessionIntake {
        session_id: session,
        grouping_revision: 1,
        superseded: false,
        target_confirmed: true,
        rig_id: Some(id(60)),
        review_finished: true,
        unreviewed_frames: 0,
    }
}

// ── Lifecycle and operations ─────────────────────────────────────────────────

#[test]
fn a_project_lifecycle_only_moves_forward_and_only_open_takes_edits() {
    use ProjectLifecycle::{Archived, Closed, Closing, Open};
    assert_eq!(serde_json::to_value(Closing).unwrap(), "closing");
    for (from, to, allowed) in [
        (Open, Closing, true),
        (Open, Closed, true),
        (Closing, Closed, true),
        (Closing, Archived, true),
        (Open, Archived, false),
        (Closed, Open, false),
        (Archived, Open, false),
        (Closed, Archived, false),
        (Closing, Open, false),
    ] {
        assert_eq!(from.can_become(to), allowed, "{from:?} -> {to:?}");
        assert_eq!(from.transition(to).is_ok(), allowed, "{from:?} -> {to:?}");
    }
    assert!(Open.is_open());
    assert!(!Closed.is_open());
}

#[test]
fn only_an_open_project_reserves_operations_and_closing_only_archives() {
    use ProjectOperationKind::{Apply, Archive, CleanUp, CopyToOutput, Trash};
    for kind in [Apply, CopyToOutput, CleanUp, Trash, Archive] {
        assert!(ProjectLifecycle::Open.admits_operation(kind));
        assert_eq!(ProjectLifecycle::Closing.admits_operation(kind), kind == Archive);
        assert!(!ProjectLifecycle::Closed.admits_operation(kind));
        assert!(!ProjectLifecycle::Archived.admits_operation(kind));
    }
    assert_eq!(serde_json::to_value(CopyToOutput).unwrap(), "copy_to_output");
    let active = ProjectOperation {
        id: id(500),
        project_id: id(1),
        kind: Apply,
        state: ProjectOperationState::Active,
        reserved_at: "2026-10-16T08:00:00Z".into(),
        settled_at: None,
    };
    active.validate().unwrap();
    round_trip(&active);
    let unsettled = ProjectOperation { state: ProjectOperationState::Settled, ..active.clone() };
    assert!(unsettled.validate().is_err(), "a settled operation records when");
    let early = ProjectOperation { settled_at: Some("2026-10-16T09:00:00Z".into()), ..active };
    assert!(early.validate().is_err(), "an active operation has not settled");
}

#[test]
fn wrap_up_steps_run_in_order_once_each() {
    let record = |step, outcome| WrapUpRecord {
        step,
        outcome,
        operation_id: None,
        recorded_at: "2026-10-16T08:00:00Z".into(),
    };
    let clean = record(WrapUpStep::CleanUp, WrapUpOutcome::Finished);
    let trash = record(WrapUpStep::Trash, WrapUpOutcome::Skipped);
    let archive = record(WrapUpStep::Archive, WrapUpOutcome::Finished);
    WrapUpRecord::validate_all(&[clean.clone(), trash.clone()]).unwrap();
    assert!(!WrapUpRecord::complete(&[clean.clone(), trash.clone()]));
    assert!(WrapUpRecord::complete(&[clean.clone(), trash.clone(), archive.clone()]));
    let early = WrapUpRecord::validate_all(std::slice::from_ref(&trash));
    assert!(early.is_err(), "Trash follows Clean up");
    assert!(
        WrapUpRecord::validate_all(&[clean.clone(), archive]).is_err(),
        "Archive follows Trash"
    );
    assert!(WrapUpRecord::validate_all(&[clean.clone(), clean]).is_err(), "each step once");
    round_trip(&trash);
}

/// The decision record's provisional close rules live in one policy the owner
/// can change: no Reopen, and Wrap up opens only with nothing pending.
#[test]
fn the_provisional_close_rules_are_one_policy() {
    use ProjectLifecycle::{Archived, Closed, Open};
    let current = ClosePolicy::CURRENT;
    assert!(!current.reopen && current.wrap_up_waits_for_pending);
    assert!(!current.allows(Closed, Open));
    assert!(current.wrap_up_opens(0, false));
    assert!(!current.wrap_up_opens(2, false), "Apply or discard N changes first");
    assert!(!current.wrap_up_opens(0, true), "never while an operation runs");
    let changed = ClosePolicy { reopen: true, wrap_up_waits_for_pending: false };
    assert!(changed.allows(Closed, Open) && changed.allows(Archived, Open));
    assert!(changed.wrap_up_opens(2, false));
    assert!(!changed.allows(Open, Archived), "closing itself is settled");
}

// ── Settings ─────────────────────────────────────────────────────────────────

#[test]
fn workflow_defaults_are_the_owner_approved_starting_values() {
    let settings = WorkflowSettings::default();
    settings.validate().unwrap();
    assert_eq!(
        serde_json::to_value(&settings).unwrap(),
        serde_json::json!({
            "framing": {
                "minOverlapPercent": 90.0,
                "maxCentreOffsetPercent": 5.0,
                "maxRotationDeg": 5.0,
                "panelOverlapPercent": [5.0, 40.0],
            },
            "flats": {"fineWithinDeg": 2.0, "offeredWithinDeg": 5.0, "windowNights": 1},
            "darkBias": {"windowDays": 365},
            "keywords": {"group": "GROUP", "panel": "PANEL"},
            "viewMode": "symlinks",
        })
    );
    round_trip(&settings);

    let mut inverted = WorkflowSettings::default();
    inverted.flats.fine_within_deg = 6.0;
    assert!(inverted.validate().is_err(), "fine within the offered angle");
    let mut panels = WorkflowSettings::default();
    panels.framing.panel_overlap_percent = (40.0, 5.0);
    assert!(panels.validate().is_err(), "panel overlap is a range");
    let mut nan = WorkflowSettings::default();
    nan.framing.max_rotation_deg = f64::NAN;
    assert!(nan.validate().is_err());
}

#[test]
fn group_keywords_are_wbpp_keyword_names_distinct_from_each_other_and_the_reserved_ones() {
    GroupKeywords::new("GROUP", "PANEL").unwrap();
    GroupKeywords::new("SET", "TILE").unwrap();
    for (group, panel) in [
        ("GROUP", "group"),
        ("NIGHT", "PANEL"),
        ("GROUP", "GAIN"),
        ("Offset", "PANEL"),
        ("GR OUP", "PANEL"),
        ("GROUP_A", "PANEL"),
        ("", "PANEL"),
    ] {
        assert!(GroupKeywords::new(group, panel).is_err(), "{group} / {panel}");
    }
    let parsed: Result<GroupKeywords, _> =
        serde_json::from_str(r#"{"group":"NIGHT","panel":"PANEL"}"#);
    assert!(parsed.is_err(), "deserializing validates too");
    round_trip(&GroupKeywords::default());
    round_trip(&ProjectViewSettings {
        mode: ViewMode::Copies,
        keywords: Some(GroupKeywords::new("SET", "TILE").unwrap()),
        profile_id: Some(id(3)),
        parent: Some(path("/Processing")),
    });
}

// ── Groups, membership and the desired state ─────────────────────────────────

#[test]
fn group_names_are_trimmed_display_text_compared_by_their_key() {
    let name = GroupName::new("  RedCat · Framing 2 ").unwrap();
    assert_eq!(name.as_str(), "RedCat · Framing 2");
    assert_eq!(name.key(), GroupName::new("redcat · framing 2").unwrap().key());
    for bad in ["", "   ", "Red\u{7}Cat", "Red\nCat"] {
        assert!(GroupName::new(bad).is_err(), "{bad:?}");
    }
    let parsed: Result<GroupName, _> = serde_json::from_str(r#""  ""#);
    assert!(parsed.is_err());
    round_trip(&group(10, "RedCat"));
}

#[test]
fn a_capture_is_keyed_by_its_smallest_copy_and_holds_each_copy_once() {
    let held = capture(20, &[31, 30]);
    assert_eq!(held.capture_key, id(30));
    assert_eq!(held.copies.iter().map(|copy| copy.asset_id).collect::<Vec<_>>(), [id(30), id(31)]);
    round_trip(&held);
    let empty = ProjectCapture::new(
        id(20),
        Vec::new(),
        CaptureInclusion::Included { basis: InclusionBasis::Usable },
        ApplicableQuality::Usable,
    );
    assert!(empty.is_err());
    let twice = ProjectCapture::new(
        id(20),
        vec![copy(30), copy(30)],
        CaptureInclusion::Excluded { basis: ExclusionBasis::User },
        ApplicableQuality::Usable,
    );
    assert!(twice.is_err());
    let mut rekeyed = capture(20, &[30, 31]);
    rekeyed.capture_key = id(31);
    assert!(rekeyed.validate().is_err(), "the key is the smallest copy");
}

#[test]
fn the_desired_state_holds_whole_sessions_in_groups_and_each_capture_once() {
    let ok = desired();
    ok.validate().unwrap();
    round_trip(&ok);

    let mut orphan = desired();
    orphan.sessions.push(member(21, 99));
    assert!(orphan.validate().is_err(), "a session sits in one of the Project's groups");

    let mut unheld = desired();
    unheld.captures.push(capture(22, &[40]));
    assert!(unheld.validate().is_err(), "a capture belongs to a held session");

    let mut twice = desired();
    twice.sessions.push(member(21, 10));
    twice.captures.push(capture(21, &[31]));
    assert!(twice.validate().is_err(), "a copy is allocated once per Project");

    let mut same_name = desired();
    same_name.groups.push(group(11, "redcat"));
    assert!(same_name.validate().is_err(), "two groups never share a name");

    let mut held_twice = desired();
    held_twice.groups.push(group(11, "RedCat · 2"));
    held_twice.sessions.push(member(20, 11));
    assert!(held_twice.validate().is_err(), "a session is held once");

    let mut other_rig = desired();
    let mut panel = group(11, "Panel 1");
    panel.rig_id = id(61);
    other_rig.groups.push(panel);
    other_rig.validate().unwrap();
}

#[test]
fn pending_changes_name_their_source_and_only_project_edits_are_discardable() {
    let own = [
        PendingChange::SessionAdded { session_id: id(20), group_id: id(10) },
        PendingChange::SessionMoved { session_id: id(20), from_group: id(10), to_group: id(11) },
        PendingChange::FramesExcluded { session_id: id(20), capture_keys: vec![id(30)] },
        PendingChange::GroupRenamed {
            group_id: id(10),
            from: GroupName::new("RedCat").unwrap(),
            to: GroupName::new("RedCat · 2").unwrap(),
        },
        PendingChange::ModeSwitched { from: ViewMode::Symlinks, to: ViewMode::Copies },
    ];
    for change in &own {
        assert_eq!(change.source(), ChangeSource::Project, "{change:?}");
        assert!(change.discardable());
        round_trip(change);
    }
    let library = [
        PendingChange::LibraryRejected { session_id: id(20), capture_keys: vec![id(30)] },
        PendingChange::LibraryRestored { session_id: id(20), capture_keys: vec![id(30)] },
        PendingChange::CalibrationChanged {
            session_id: id(20),
            kind: InputKind::Flat,
            from: SettledPin::Declined,
            to: Some(SettledPin::Pinned { target: raw_target() }),
        },
    ];
    for change in &library {
        assert_eq!(change.source(), ChangeSource::Library, "{change:?}");
        assert!(!change.discardable());
        round_trip(change);
    }
}

// ── Calibration pins and admission ───────────────────────────────────────────

#[test]
fn calibration_is_settled_only_when_every_kind_is_pinned_or_declined() {
    let settled = settled_calibration(id(20));
    settled.validate().unwrap();
    assert_eq!(settled.unsettled_kinds(), Vec::<InputKind>::new());
    assert!(settled.settled().is_some());
    round_trip(&settled);
    assert_eq!(
        serde_json::to_value(&settled.bias).unwrap(),
        serde_json::json!({"state": "declined", "origin": "camera_default"})
    );

    let mut suggested = settled_calibration(id(20));
    suggested.flat = PinState::Suggested { target: raw_target() };
    assert_eq!(suggested.unsettled_kinds(), [InputKind::Flat], "a suggestion is never settled");
    assert!(suggested.settled().is_none());

    let fresh = SessionCalibration::unresolved(id(20));
    assert_eq!(fresh.generation, 0);
    assert_eq!(fresh.unsettled_kinds(), [InputKind::Bias, InputKind::Dark, InputKind::Flat]);
}

/// LIB-FR-17, decision record §9: Needs calibration holds a session with a
/// kind not settled, or with a pin whose file changed or went missing; the
/// pin itself stays.
#[test]
fn needs_calibration_names_unsettled_kinds_and_drifted_pins() {
    let mut calibration = settled_calibration(id(20));
    assert_eq!(calibration.needs(|_| PinHealth::Intact), Vec::<CalibrationNeed>::new());
    let drifted = calibration.needs(|kind| {
        if kind == InputKind::Dark {
            PinHealth::Missing
        } else {
            PinHealth::Intact
        }
    });
    assert_eq!(
        drifted,
        [CalibrationNeed::PinDrift { kind: InputKind::Dark, health: PinHealth::Missing }]
    );
    assert!(calibration.settled().is_some(), "a drifted pin stays pinned");
    calibration.flat = PinState::Suggested { target: raw_target() };
    assert_eq!(
        calibration.needs(|_| PinHealth::Changed),
        [
            CalibrationNeed::PinDrift { kind: InputKind::Dark, health: PinHealth::Changed },
            CalibrationNeed::Unsettled { kind: InputKind::Flat },
        ],
        "a declined kind needs nothing"
    );
    round_trip(&drifted[0]);
}

#[test]
fn a_pin_names_its_exact_files_and_digests() {
    master_target().validate().unwrap();
    raw_target().validate().unwrap();
    let mut master_with_frames = master_target();
    master_with_frames.files.push(master_with_frames.files[0].clone());
    assert!(master_with_frames.validate().is_err(), "a master is one file");
    let mut raw_without_ids = raw_target();
    raw_without_ids.files[0].asset_id = None;
    assert!(raw_without_ids.validate().is_err(), "a raw set names its frames");
    let mut no_files = raw_target();
    no_files.files.clear();
    assert!(no_files.validate().is_err());
    let mut short = master_target();
    short.files[0].sha256 = "abc".into();
    assert!(short.validate().is_err(), "a pinned digest is SHA-256 hex");
    let mut own = settled_calibration(id(800));
    own.validate().expect_err("a session never calibrates itself");
    own.flat = PinState::Unresolved;
    own.validate().unwrap();
}

#[test]
fn readiness_follows_the_intake_flow_target_then_rig_then_review() {
    let ready = ready_intake(id(20));
    assert_eq!(ready.readiness(), SessionReadiness::Ready);
    let mut intake = ready.clone();
    intake.unreviewed_frames = 1;
    assert_eq!(intake.readiness(), SessionReadiness::NeedsReview, "no Unreviewed frame left");
    intake.review_finished = false;
    intake.unreviewed_frames = 0;
    assert_eq!(intake.readiness(), SessionReadiness::NeedsReview);
    intake.rig_id = None;
    assert_eq!(intake.readiness(), SessionReadiness::NeedsRig);
    intake.target_confirmed = false;
    assert_eq!(intake.readiness(), SessionReadiness::NeedsTarget);
    round_trip(&ready);
}

#[test]
fn only_a_ready_settled_current_session_on_the_groups_rig_joins_an_open_project() {
    let session = id(20);
    let calibration = settled_calibration(session);
    let intact = CalibrationHealth::INTACT;
    let basis = admit_session(
        ProjectLifecycle::Open,
        id(60),
        &ready_intake(session),
        &calibration,
        &intact,
    )
    .unwrap();
    assert_eq!((basis.grouping_revision, basis.calibration_generation), (1, 3));

    let mut unsettled = calibration;
    unsettled.dark = PinState::Unresolved;
    assert_eq!(
        session_blockers(&ready_intake(session), &unsettled, &intact),
        [AdmissionBlocker::CalibrationUnsettled { kinds: vec![InputKind::Dark] }]
    );

    let mut needs_review = ready_intake(session);
    needs_review.review_finished = false;
    needs_review.superseded = true;
    let refusal =
        admit_session(ProjectLifecycle::Closed, id(61), &needs_review, &unsettled, &intact)
            .unwrap_err();
    assert_eq!(
        refusal.blockers,
        [
            AdmissionBlocker::ProjectLocked { lifecycle: ProjectLifecycle::Closed },
            AdmissionBlocker::Superseded,
            AdmissionBlocker::NotReady { readiness: SessionReadiness::NeedsReview },
            AdmissionBlocker::RigMismatch { session_rig: Some(id(60)), group_rig: id(61) },
            AdmissionBlocker::CalibrationUnsettled { kinds: vec![InputKind::Dark] },
        ]
    );
    assert_eq!(refusal.session_id, session);
    let error = platevault_model::LibraryError::from(refusal.clone());
    assert_eq!(error.response(None, None).kind, "invalid_input", "{error}");
    round_trip(&refusal);
}

/// Provisional (decision record §9, lead default 2026-10-16): a drifted pin
/// keeps the session out of new joins; the pin stays settled.
#[test]
fn a_drifted_pin_keeps_a_session_out_of_new_joins() {
    let session = id(20);
    let calibration = settled_calibration(session);
    let drifted = CalibrationHealth { flat: PinHealth::Changed, ..CalibrationHealth::INTACT };
    assert!(calibration.settled().is_some(), "the drifted pin stays pinned");
    assert_eq!(
        session_blockers(&ready_intake(session), &calibration, &drifted),
        [AdmissionBlocker::CalibrationDrifted { kinds: vec![InputKind::Flat] }]
    );
    let refusal = admit_session(
        ProjectLifecycle::Open,
        id(60),
        &ready_intake(session),
        &calibration,
        &drifted,
    )
    .unwrap_err();
    assert_eq!(
        refusal.blockers,
        [AdmissionBlocker::CalibrationDrifted { kinds: vec![InputKind::Flat] }]
    );
    assert!(refusal.to_string().contains("flat changed or went missing"), "{refusal}");
    round_trip(&refusal);
}

#[test]
fn a_reassignment_reads_as_a_calibration_change_since_the_applied_view() {
    let session = id(20);
    let applied = settled_calibration(session).settled().unwrap();
    let mut current = settled_calibration(session);
    assert_eq!(current.changes_since(&applied), []);
    current.flat = PinState::Declined { origin: DeclineOrigin::User };
    current.dark = PinState::Unresolved;
    assert_eq!(
        current.changes_since(&applied),
        [
            PendingChange::CalibrationChanged {
                session_id: session,
                kind: InputKind::Dark,
                from: applied.dark.clone(),
                to: None,
            },
            PendingChange::CalibrationChanged {
                session_id: session,
                kind: InputKind::Flat,
                from: applied.flat.clone(),
                to: Some(SettledPin::Declined),
            },
        ]
    );
}

// ── Rigs ─────────────────────────────────────────────────────────────────────

#[test]
fn cameras_need_unique_aliases_once_two_share_a_model() {
    let camera = |n, model: &str, alias: Option<&str>| Camera {
        id: id(n),
        model: model.into(),
        alias: alias.map(Into::into),
        no_darks: false,
        no_bias: false,
        revision: 1,
    };
    Camera::validate_all(&[camera(1, "ASI2600MM", None), camera(2, "ASI533MC", None)]).unwrap();
    let unaliased = [camera(1, "ASI2600MM", Some("Mono A")), camera(2, "asi2600mm ", None)];
    assert!(Camera::validate_all(&unaliased).is_err(), "two of a model need aliases");
    let clash = [camera(1, "ASI2600MM", Some("Mono")), camera(2, "ASI2600MM", Some("mono"))];
    assert!(Camera::validate_all(&clash).is_err(), "aliases are unique");
    Camera::validate_all(&[camera(1, "ASI2600MM", Some("A")), camera(2, "ASI2600MM", Some("B"))])
        .unwrap();
    assert!(camera(1, " ", None).validate().is_err());
    round_trip(&camera(1, "ASI2600MM", Some("A")));
    round_trip(&CameraLink { camera_id: id(1), basis: CameraBasis::Confirmed });
}

#[test]
fn a_new_rig_version_starts_a_new_group_only_when_the_optics_change() {
    let version = |n, optics: OpticsSignature| RigVersion {
        id: id(n),
        rig_id: id(60),
        valid_from: night(),
        optics,
        rotator: RotatorPresence::Absent,
    };
    let first = version(1, optics());
    let remount = version(2, OpticsSignature::new(Some(id(70)), Some(250.0), None).unwrap());
    let reducer =
        version(3, OpticsSignature::new(Some(id(70)), Some(250.0), Some(" 0.8x ")).unwrap());
    assert!(!remount.starts_new_group(&first), "a remount keeps the optics");
    assert!(reducer.starts_new_group(&first));
    assert_eq!(reducer.optics.reducer.as_deref(), Some("0.8x"));
    assert!(OpticsSignature::new(None, Some(-1.0), None).is_err());
    assert!(OpticsSignature::new(None, None, Some("  ")).is_err());
    round_trip(&reducer);
}

// ── Applied state: basis, manifest, names, journal ───────────────────────────

#[test]
fn the_applied_basis_holds_each_session_and_capture_once_with_settled_calibration() {
    let ok = basis();
    ok.validate().unwrap();
    assert!(!ok.has_group_folders(), "a one-group Project has no group folder");
    round_trip(&ok);
    let mut twice = basis();
    let mut second = twice.groups[0].clone();
    second.id = id(11);
    second.name = GroupName::new("Panel 1").unwrap();
    twice.groups.push(second);
    assert!(twice.has_group_folders());
    assert!(twice.validate().is_err(), "a session sits in one group");
}

/// D-W81, 063 FR-005: every Copies entry is its own file, so no placement
/// is a hard link, to an original or between the View's own copies.
#[test]
fn a_manifest_places_each_path_once_in_its_mode_and_never_as_a_hard_link() {
    let copies = manifest(vec![
        light_entry(0, "NIGHT_2026-10-14/Lights/Ha/a.fits", EntryPlacement::Copy),
        light_entry(1, "NIGHT_2026-10-15/Lights/Ha/a.fits", EntryPlacement::Clone),
    ]);
    copies.validate().unwrap();
    round_trip(&copies);

    let mut symlinked = copies.clone();
    symlinked.basis.mode = ViewMode::Symlinks;
    assert!(symlinked.validate().is_err(), "Symlinks mode places only links");

    let clash = manifest(vec![
        light_entry(0, "NIGHT_2026-10-14/Lights/Ha/a.fits", EntryPlacement::Copy),
        light_entry(1, "NIGHT_2026-10-14/Lights/Ha/a.fits", EntryPlacement::Clone),
    ]);
    assert!(clash.validate().is_err(), "a path is placed once");

    let hard_link = serde_json::json!({"kind": "hardlink", "of": 0});
    assert!(
        serde_json::from_value::<EntryPlacement>(hard_link.clone()).is_err(),
        "no placement is a hard link"
    );
    let mut linked = serde_json::to_value(&copies).unwrap();
    linked["entries"][1]["placement"] = hard_link;
    assert!(
        serde_json::from_value::<ViewManifest>(linked).is_err(),
        "a manifest holding a hard-link entry is refused"
    );

    let mut unheld = copies;
    unheld.entries[0].source = EntrySource::Light { capture_key: id(99), asset_id: id(99) };
    assert!(unheld.validate().is_err(), "a light entry places an included capture");
}

#[test]
fn manifest_states_move_from_building_to_installed_previous_and_retired() {
    use ManifestState::{Building, Discarded, Installed, Previous, Retired};
    for (from, to, allowed) in [
        (Building, Installed, true),
        (Building, Discarded, true),
        (Installed, Previous, true),
        (Installed, Retired, true),
        (Previous, Retired, true),
        (Building, Previous, false),
        (Previous, Installed, false),
        (Retired, Installed, false),
        (Discarded, Building, false),
    ] {
        assert_eq!(from.can_become(to), allowed, "{from:?} -> {to:?}");
    }
}

#[test]
fn entry_names_are_plain_basenames() {
    let name = EntryName::new(EntryInput::Capture { capture_key: id(30) }, "Ha_001.fits").unwrap();
    round_trip(&name);
    for bad in ["", ".", "..", "a/b.fits", "a\\b.fits", "a\u{0}b"] {
        assert!(EntryName::new(EntryInput::Master { master_id: id(900) }, bad).is_err(), "{bad:?}");
    }
}

#[test]
fn the_apply_journal_moves_forward_and_settles_only_where_its_outcome_is_true() {
    let order = ApplyPhase::ORDER;
    assert_eq!(order.first(), Some(&ApplyPhase::Reserved));
    assert_eq!(order.last(), Some(&ApplyPhase::Settled));
    assert!(order.windows(2).all(|pair| pair[0].can_advance_to(pair[1])));
    assert!(!ApplyPhase::OldMoved.can_advance_to(ApplyPhase::Building));
    assert!(ApplyPhase::Reserved.can_advance_to(ApplyPhase::NewInstalled), "phases may be skipped");
    assert_eq!(serde_json::to_value(ApplyPhase::WaitingForRelease).unwrap(), "waiting_for_release");

    let mut canceled = journal(ApplyPhase::OldMoved);
    canceled.settle(ApplyOutcome::Canceled).unwrap();
    assert_eq!(
        (canceled.phase, canceled.settled_from, canceled.outcome),
        (ApplyPhase::Settled, Some(ApplyPhase::OldMoved), Some(ApplyOutcome::Canceled))
    );
    canceled.validate().unwrap();
    round_trip(&canceled);
    assert!(canceled.clone().settle(ApplyOutcome::Applied).is_err(), "settled once");

    assert!(journal(ApplyPhase::NewInstalled).settle(ApplyOutcome::Canceled).is_err());
    assert!(journal(ApplyPhase::ManifestCommitted).settle(ApplyOutcome::Failed).is_err());
    assert!(journal(ApplyPhase::BuildVerified).settle(ApplyOutcome::Applied).is_err());
    journal(ApplyPhase::ForeignTransferred).settle(ApplyOutcome::Applied).unwrap();

    let mut forward = journal(ApplyPhase::Building);
    forward.advance(ApplyPhase::BuildVerified).unwrap();
    assert!(forward.advance(ApplyPhase::Building).is_err());
    assert!(forward.advance(ApplyPhase::Settled).is_err(), "settle names an outcome");

    let mut broken = journal(ApplyPhase::Settled);
    assert!(broken.validate().is_err(), "a settled journal has its outcome");
    broken.phase = ApplyPhase::Building;
    broken.outcome = Some(ApplyOutcome::Applied);
    assert!(broken.validate().is_err());
}

// ── Closed snapshot ──────────────────────────────────────────────────────────

#[test]
fn a_closed_snapshot_freezes_the_applied_or_never_applied_basis() {
    let applied = ClosedSnapshot {
        project_id: id(1),
        taken_at: "2026-10-16T08:00:00Z".into(),
        applied_generation: Some(1),
        basis: basis(),
        goals: Vec::new(),
    };
    applied.validate().unwrap();
    assert!(!applied.never_applied());
    round_trip(&applied);
    let never = ClosedSnapshot { applied_generation: None, ..applied.clone() };
    assert!(never.never_applied());
    let mut broken = applied;
    let twice = broken.basis.groups[0].sessions[0].clone();
    broken.basis.groups[0].sessions.push(twice);
    assert!(broken.validate().is_err());
}

// ── Output ───────────────────────────────────────────────────────────────────

#[test]
fn output_observations_infer_a_panel_only_from_output_panels_and_copies_carry_their_digest() {
    let observed = OutputObservation {
        path: path("Panels/Panel-1/NGC7000_Ha.xisf"),
        kind: Some(OutputKind::FinalImage),
        channel: Some("Ha".into()),
        panel_group_id: Some(id(11)),
        state: OutputState::Settled,
        size_bytes: 2048,
        fingerprint: Some(fingerprint(50)),
        sha256: None,
        origin: OutputOrigin::Observed,
    };
    observed.validate().unwrap();
    round_trip(&observed);
    let outside = OutputObservation { path: path("NGC7000_Ha.xisf"), ..observed.clone() };
    assert!(outside.validate().is_err(), "a panel comes from Output/Panels/ only");
    let copied = OutputObservation {
        panel_group_id: None,
        origin: OutputOrigin::Copied,
        ..observed.clone()
    };
    assert!(copied.validate().is_err(), "Copy to Output records the verified digest");
    OutputObservation { sha256: Some(SHA.into()), ..copied }.validate().unwrap();
    let escaping = OutputObservation { path: path("../View/a.fits"), ..observed };
    assert!(escaping.validate().is_err(), "an observation stays inside Output/");
    round_trip(&OutputKind::CalibrationMaster { input: InputKind::Flat });
}

#[test]
fn a_processing_master_is_offered_as_a_master_with_its_digest() {
    let offer = ProcessingMasterOffer {
        id: id(700),
        project_id: id(1),
        path: path("WBPP/master/masterFlat_Ha.xisf"),
        sha256: SHA.into(),
        classification: Classification {
            kind: InputKind::Flat,
            master: Some(MasterEvidence {
                basis: MasterBasis::HeaderStackCount,
                stack_count: Some(30),
                detector: "calibration_master_detect".into(),
            }),
        },
        state: MasterOfferState::Offered,
        offered_at: "2026-10-16T08:00:00Z".into(),
        decided_at: None,
    };
    offer.validate().unwrap();
    round_trip(&offer);
    let raw = ProcessingMasterOffer {
        classification: Classification { kind: InputKind::Flat, master: None },
        ..offer.clone()
    };
    assert!(raw.validate().is_err(), "only a master is offered");
    let undecided = ProcessingMasterOffer { state: MasterOfferState::Dismissed, ..offer };
    assert!(undecided.validate().is_err(), "a decision records when");
}

// ── Foreign files and leftovers ──────────────────────────────────────────────

fn evidence(file: &str) -> EntryEvidence {
    EntryEvidence {
        path: path(file),
        kind: EntryKind::File,
        fingerprint: fingerprint(60),
        sha256: Some(SHA.into()),
    }
}

#[test]
fn only_ticked_foreign_files_move_and_unreviewed_and_kept_leftovers_stay_settled() {
    use PreviousItemReview::{Kept, Moved, Pending, Trashed};
    let item = ForeignItem {
        seq: 0,
        path: path("NIGHT_2026-10-14/Lights/Ha/a.Info.txt"),
        evidence: evidence("/View/NIGHT_2026-10-14/Lights/Ha/a.Info.txt"),
        ticked: true,
        state: ForeignItemState::Moved,
        reason: None,
    };
    item.validate().unwrap();
    round_trip(&item);
    assert!(ForeignItem { ticked: false, ..item.clone() }.validate().is_err());
    assert!(ForeignItem { state: ForeignItemState::Failed, ..item }.validate().is_err());

    let leftover = |review| PreviousItem {
        path: path("View (previous)/notes.txt"),
        reason: PreviousItemReason::UntickedFile,
        evidence: evidence("/View (previous)/notes.txt"),
        review,
    };
    round_trip(&leftover(Kept));
    assert!(PreviousItem::blocks_apply(&[leftover(Pending)]));
    assert!(!PreviousItem::blocks_apply(&[leftover(Kept), leftover(Trashed)]));
    assert!(Pending.can_become(Kept) && Kept.can_become(Trashed) && Kept.can_become(Moved));
    assert!(!Kept.can_become(Pending), "a kept file is not asked about again");
    assert!(!Trashed.can_become(Kept) && !Moved.can_become(Pending));
}
