// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure checklist evaluation (spec 065) over constructed progress bases: goal
//! items compare Project-accepted integers with their goal on their exact
//! channel; evidence items report each Current linked session or panel; nothing
//! changes the Project.

use std::collections::BTreeMap;

use platevault_core::projects::evaluate_checklist;
use platevault_core::{
    Association, AssociationKind, AssociationState, Availability, CalibrationKind, CaptureKey,
    ChannelProgress, ChecklistBasis, ChecklistEvidence, ChecklistItem, ChecklistKind,
    ChecklistOutcome, EvidenceState, LinkState, LinkedSessionEvidence, Microseconds, Project,
    ProjectPanel, ProjectProgress, ProjectProgressBasis, Provenance, Session, SessionExposure,
    SessionSummary,
};
use uuid::Uuid;

const HOUR: u64 = 3_600_000_000;

fn project(criteria: Vec<ChecklistKind>, panels: Vec<ProjectPanel>) -> Project {
    Project {
        id: Uuid::new_v4(),
        name: "NGC 7000 HOO".into(),
        notes: None,
        revision: 4,
        created_at: "2026-10-05T10:00:00Z".into(),
        updated_at: "2026-10-05T10:05:00Z".into(),
        targets: Vec::new(),
        panels,
        equipment_ids: Vec::new(),
        checklist: criteria
            .into_iter()
            .map(|criterion| ChecklistItem { id: Uuid::new_v4(), criterion })
            .collect(),
        links: Vec::new(),
        rejections: Vec::new(),
    }
}

fn panel(name: &str) -> ProjectPanel {
    ProjectPanel {
        id: Uuid::new_v4(),
        name: name.into(),
        ra_deg: 314.75,
        dec_deg: 44.33,
        width_deg: 2.5,
        height_deg: 1.7,
        position_angle_deg: None,
    }
}

/// One channel row: (captured, usable, accepted) microseconds and frames.
fn row(channel: Option<&str>, seconds: [u64; 3], frames: [u64; 3]) -> ChannelProgress {
    ChannelProgress {
        channel: channel.map(str::to_owned),
        captured_seconds: Microseconds(seconds[0]),
        usable_seconds: Microseconds(seconds[1]),
        accepted_seconds: Microseconds(seconds[2]),
        captured_frames: frames[0],
        usable_frames: frames[1],
        accepted_frames: frames[2],
        ..ChannelProgress::default()
    }
}

fn integration(channel: &str, hours: u64) -> ChecklistKind {
    ChecklistKind::Integration { channel: channel.into(), goal_seconds: hours * 3600 }
}

fn summary(id: Uuid) -> SessionSummary {
    SessionSummary {
        session: Session {
            id,
            key: CaptureKey("capture-v1|type=light".into()),
            grouping_revision: 1,
            decision_revision: 1,
            asset_ids: Vec::new(),
            provisional: Vec::new(),
            date_basis: None,
        },
        location_ids: Vec::new(),
        asset_count: 0,
        capture_count: 0,
        availability: Availability::Available,
        last_observed_at: None,
        provisional: false,
        successors: Vec::new(),
    }
}

fn exposure(channel: &str, seconds: Option<f64>) -> SessionExposure {
    SessionExposure {
        channel: Some(channel.into()),
        exposure_seconds: seconds.and_then(Microseconds::from_seconds),
        frames: 20,
    }
}

/// A Current linked session with these exposures and no equipment association.
fn linked(exposures: Vec<SessionExposure>) -> LinkedSessionEvidence {
    let id = Uuid::new_v4();
    LinkedSessionEvidence {
        session_id: id,
        panel_id: None,
        state: LinkState::Current,
        successors: Vec::new(),
        summary: summary(id),
        capture_sites: Vec::new(),
        unknown_site_frames: 0,
        exposures,
        equipment: None,
    }
}

fn needs_review(mut session: LinkedSessionEvidence) -> LinkedSessionEvidence {
    session.state = LinkState::NeedsReview;
    session.successors = vec![Uuid::new_v4()];
    session
}

fn with_equipment(
    mut session: LinkedSessionEvidence,
    state: AssociationState,
    subject: Uuid,
) -> LinkedSessionEvidence {
    session.equipment = Some(Association {
        session_id: session.session_id,
        kind: AssociationKind::Equipment,
        subject_id: Some(subject),
        state,
        evidence: Vec::new(),
        provenance: Provenance::User,
        observation_basis: BTreeMap::new(),
        decision_revision: 1,
    });
    session
}

fn basis(
    project: &Project,
    channels: Vec<ChannelProgress>,
    unknown_channel: Option<ChannelProgress>,
    sessions: Vec<LinkedSessionEvidence>,
) -> ProjectProgressBasis {
    ProjectProgressBasis {
        project_id: project.id,
        project_revision: project.revision,
        progress: ProjectProgress {
            channels,
            unknown_channel,
            provisional: false,
            covered_location_ids: Vec::new(),
        },
        sessions,
        rejections: Vec::new(),
    }
}

fn seconds_of(outcome: &ChecklistOutcome) -> (u64, u64, u64, u64, bool) {
    match outcome {
        ChecklistOutcome::Seconds { captured, usable, accepted, goal, met } => {
            (captured.0, usable.0, accepted.0, goal.0, *met)
        }
        other => panic!("expected seconds progress, got {other:?}"),
    }
}

fn evidence_of(outcome: &ChecklistOutcome) -> Vec<(Option<Uuid>, EvidenceState, &str)> {
    match outcome {
        ChecklistOutcome::Evidence { evidence } => evidence
            .iter()
            .map(|item| (item.session_id, item.state, item.reason.as_str()))
            .collect(),
        other => panic!("expected evidence, got {other:?}"),
    }
}

#[test]
fn integration_is_met_exactly_when_accepted_microseconds_reach_the_goal() {
    let project = project(vec![integration("Ha", 10)], Vec::new());
    let goal = 10 * HOUR;
    let cases = [
        ([12 * HOUR, 11 * HOUR, goal], true),
        ([12 * HOUR, 11 * HOUR, goal - 1], false),
        ([12 * HOUR, 11 * HOUR, 9 * HOUR], false),
    ];
    for (seconds, met) in cases {
        let basis = basis(&project, vec![row(Some("Ha"), seconds, [0; 3])], None, Vec::new());
        let progress = evaluate_checklist(&project, &basis);
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].basis, ChecklistBasis::AcceptedIntegration);
        assert_eq!(progress[0].item, project.checklist[0]);
        let reported = seconds_of(&progress[0].outcome);
        assert_eq!(reported, (seconds[0], seconds[1], seconds[2], goal, met), "{seconds:?}");
    }
    // No row for the channel: nothing captured, unmet.
    let empty = basis(&project, Vec::new(), None, Vec::new());
    assert_eq!(
        seconds_of(&evaluate_checklist(&project, &empty)[0].outcome),
        (0, 0, 0, goal, false)
    );
}

#[test]
fn frame_count_is_met_on_accepted_frames_only() {
    let goal = ChecklistKind::FrameCount { channel: "OIII".into(), goal_frames: 120 };
    let project = project(vec![goal], Vec::new());
    for (frames, met) in [([130, 125, 120], true), ([130, 125, 119], false), ([200, 150, 0], false)]
    {
        let basis = basis(&project, vec![row(Some("OIII"), [0; 3], frames)], None, Vec::new());
        let progress = evaluate_checklist(&project, &basis);
        assert_eq!(progress[0].basis, ChecklistBasis::AcceptedFrames);
        assert_eq!(
            progress[0].outcome,
            ChecklistOutcome::Frames {
                captured: frames[0],
                usable: frames[1],
                accepted: frames[2],
                goal: 120,
                met
            }
        );
    }
}

#[test]
fn goals_read_only_their_exact_channel_and_never_the_unknown_channel() {
    let project = project(
        vec![
            integration("Ha", 1),
            ChecklistKind::FrameCount { channel: "Ha".into(), goal_frames: 1 },
        ],
        Vec::new(),
    );
    let plenty = [100 * HOUR; 3];
    let channels = vec![row(Some("ha"), plenty, [500; 3]), row(Some("Ha "), plenty, [500; 3])];
    let unknown = row(None, plenty, [500; 3]);
    let basis = basis(&project, channels, Some(unknown), Vec::new());
    let progress = evaluate_checklist(&project, &basis);
    assert_eq!(seconds_of(&progress[0].outcome), (0, 0, 0, HOUR, false));
    assert_eq!(
        progress[1].outcome,
        ChecklistOutcome::Frames { captured: 0, usable: 0, accepted: 0, goal: 1, met: false }
    );
}

#[test]
fn exposure_preference_reports_each_current_session_without_a_total() {
    let preference =
        ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: Some("Ha".into()) };
    let project = project(vec![preference], Vec::new());
    let matches = linked(vec![exposure("Ha", Some(300.0)), exposure("OIII", Some(600.0))]);
    let differs = linked(vec![exposure("Ha", Some(300.0)), exposure("Ha", Some(180.0))]);
    let unknown = linked(vec![exposure("Ha", None), exposure("Ha", Some(300.0))]);
    let other_channel = linked(vec![exposure("OIII", Some(120.0))]);
    let review = needs_review(linked(vec![exposure("Ha", Some(60.0))]));
    let ids = [matches.session_id, differs.session_id, unknown.session_id];
    let sessions = vec![matches, differs, unknown, other_channel, review];
    let progress = evaluate_checklist(&project, &basis(&project, Vec::new(), None, sessions));
    assert_eq!(progress[0].basis, ChecklistBasis::SessionExposure);
    assert_eq!(
        evidence_of(&progress[0].outcome),
        [
            (Some(ids[0]), EvidenceState::Matches, "exposure_matches"),
            (Some(ids[1]), EvidenceState::Differs, "exposure_differs"),
            (Some(ids[2]), EvidenceState::Unknown, "exposure_unknown"),
        ],
        "the session without Ha frames and the NeedsReview link are not evidence"
    );

    // Without a channel every exposure of a session counts.
    let any = ChecklistKind::ExposurePreference { exposure_seconds: 300.0, channel: None };
    let project = self::project(vec![any], Vec::new());
    let mixed = linked(vec![exposure("Ha", Some(300.0)), exposure("OIII", Some(600.0))]);
    let empty = linked(Vec::new());
    let ids = [mixed.session_id, empty.session_id];
    let progress =
        evaluate_checklist(&project, &basis(&project, Vec::new(), None, vec![mixed, empty]));
    assert_eq!(
        evidence_of(&progress[0].outcome),
        [
            (Some(ids[0]), EvidenceState::Differs, "exposure_differs"),
            (Some(ids[1]), EvidenceState::Unknown, "exposure_unknown"),
        ]
    );
}

#[test]
fn equipment_reports_confirmed_suggested_differing_and_unknown_associations() {
    let (redcat, other) = (Uuid::new_v4(), Uuid::new_v4());
    let project = project(vec![ChecklistKind::Equipment { equipment_id: redcat }], Vec::new());
    let sessions = vec![
        with_equipment(linked(Vec::new()), AssociationState::Confirmed, redcat),
        with_equipment(linked(Vec::new()), AssociationState::Suggested, redcat),
        with_equipment(linked(Vec::new()), AssociationState::Confirmed, other),
        with_equipment(linked(Vec::new()), AssociationState::Suggested, other),
        with_equipment(linked(Vec::new()), AssociationState::NeedsReview, redcat),
        linked(Vec::new()),
        needs_review(with_equipment(linked(Vec::new()), AssociationState::Confirmed, redcat)),
    ];
    let ids: Vec<Uuid> = sessions.iter().map(|session| session.session_id).collect();
    let progress = evaluate_checklist(&project, &basis(&project, Vec::new(), None, sessions));
    assert_eq!(progress[0].basis, ChecklistBasis::SessionEquipment);
    assert_eq!(
        evidence_of(&progress[0].outcome),
        [
            (Some(ids[0]), EvidenceState::Matches, "confirmed_equipment"),
            (Some(ids[1]), EvidenceState::SuggestedMatch, "suggested_equipment"),
            (Some(ids[2]), EvidenceState::Differs, "confirmed_other_equipment"),
            (Some(ids[3]), EvidenceState::Unknown, "suggested_other_equipment"),
            (Some(ids[4]), EvidenceState::Unknown, "no_equipment_association"),
            (Some(ids[5]), EvidenceState::Unknown, "no_equipment_association"),
        ]
    );
}

#[test]
fn panel_coverage_lists_assigned_sessions_and_calibration_stays_unknown() {
    let (east, west) = (panel("East"), panel("West"));
    let flats =
        ChecklistKind::MissingCalibration { calibration: CalibrationKind::Flat, channel: None };
    let project =
        project(vec![ChecklistKind::PanelCoverage, flats], vec![east.clone(), west.clone()]);
    let mut first = linked(Vec::new());
    first.panel_id = Some(east.id);
    let mut second = linked(Vec::new());
    second.panel_id = Some(east.id);
    let mut stale = needs_review(linked(Vec::new()));
    stale.panel_id = Some(west.id);
    let assigned = vec![first.session_id, second.session_id];
    let sessions = vec![first, second, stale];
    let progress = evaluate_checklist(&project, &basis(&project, Vec::new(), None, sessions));

    assert_eq!(progress[0].basis, ChecklistBasis::PanelAssignment);
    let expected = vec![
        ChecklistEvidence {
            session_id: None,
            panel_id: Some(east.id),
            session_ids: assigned,
            state: EvidenceState::Matches,
            reason: "linked_sessions_assigned".into(),
        },
        ChecklistEvidence {
            session_id: None,
            panel_id: Some(west.id),
            session_ids: Vec::new(),
            state: EvidenceState::NoLinkedSession,
            reason: "no_linked_session_assigned".into(),
        },
    ];
    assert_eq!(progress[0].outcome, ChecklistOutcome::Evidence { evidence: expected });

    assert_eq!(progress[1].basis, ChecklistBasis::CalibrationMatching);
    assert_eq!(
        evidence_of(&progress[1].outcome),
        [(None, EvidenceState::Unknown, "calibration_matching_unavailable")]
    );
}

#[test]
fn a_fully_met_checklist_is_reported_met_and_changes_no_project_field() {
    let project = project(
        vec![
            integration("Ha", 10),
            integration("OIII", 10),
            ChecklistKind::FrameCount { channel: "Ha".into(), goal_frames: 120 },
        ],
        Vec::new(),
    );
    let before = project.clone();
    let channels = vec![
        row(Some("Ha"), [10 * HOUR; 3], [120; 3]),
        row(Some("OIII"), [11 * HOUR; 3], [132; 3]),
    ];
    let basis = basis(&project, channels, None, vec![linked(Vec::new())]);
    let progress = evaluate_checklist(&project, &basis);
    let met: Vec<bool> = progress
        .iter()
        .map(|item| match item.outcome {
            ChecklistOutcome::Seconds { met, .. } | ChecklistOutcome::Frames { met, .. } => met,
            ChecklistOutcome::Evidence { .. } => panic!("goal items carry a met state"),
        })
        .collect();
    assert_eq!(met, [true, true, true]);
    assert_eq!(project, before, "evaluation changes no Project field or revision");
    assert_eq!(evaluate_checklist(&project, &basis), progress, "pure and repeatable");
}
