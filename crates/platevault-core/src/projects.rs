// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure checklist evaluation (spec 065): no I/O, and no Project field changes.
//!
//! Integration and frame-count items compare Project-accepted integers of their
//! exact channel with the goal; the unknown-channel row never satisfies a goal.
//! Every other kind reports evidence or unknown per Current linked session or
//! per panel. `NeedsReview` links contribute to no item. A met item never closes
//! the Project and an unmet one never blocks anything.

use crate::{
    AssociationState, ChannelProgress, ChecklistBasis, ChecklistEvidence, ChecklistKind,
    ChecklistOutcome, ChecklistProgress, EvidenceState, LinkState, LinkedSessionEvidence,
    Microseconds, Project, ProjectPanel, ProjectProgressBasis,
};
use uuid::Uuid;

const EXPOSURE_MATCHES: &str = "exposure_matches";
const EXPOSURE_DIFFERS: &str = "exposure_differs";
const EXPOSURE_UNKNOWN: &str = "exposure_unknown";
const PANEL_ASSIGNED: &str = "linked_sessions_assigned";
const PANEL_EMPTY: &str = "no_linked_session_assigned";
const CONFIRMED_EQUIPMENT: &str = "confirmed_equipment";
const SUGGESTED_EQUIPMENT: &str = "suggested_equipment";
const CONFIRMED_OTHER: &str = "confirmed_other_equipment";
const SUGGESTED_OTHER: &str = "suggested_other_equipment";
const NO_EQUIPMENT: &str = "no_equipment_association";
const CALIBRATION_UNAVAILABLE: &str = "calibration_matching_unavailable";

/// Evaluate every checklist item of `project`, in order, against `basis`.
#[must_use]
pub fn evaluate_checklist(
    project: &Project,
    basis: &ProjectProgressBasis,
) -> Vec<ChecklistProgress> {
    let current: Vec<&LinkedSessionEvidence> =
        basis.sessions.iter().filter(|session| session.state == LinkState::Current).collect();
    project
        .checklist
        .iter()
        .map(|item| {
            let (basis_kind, outcome) = match &item.criterion {
                ChecklistKind::Integration { channel, goal_seconds } => (
                    ChecklistBasis::AcceptedIntegration,
                    integration(row(basis, channel), *goal_seconds),
                ),
                ChecklistKind::FrameCount { channel, goal_frames } => {
                    (ChecklistBasis::AcceptedFrames, frames(row(basis, channel), *goal_frames))
                }
                ChecklistKind::ExposurePreference { exposure_seconds, channel } => (
                    ChecklistBasis::SessionExposure,
                    exposure(&current, *exposure_seconds, channel.as_deref()),
                ),
                ChecklistKind::PanelCoverage => {
                    (ChecklistBasis::PanelAssignment, panels(&project.panels, &current))
                }
                ChecklistKind::Equipment { equipment_id } => {
                    (ChecklistBasis::SessionEquipment, equipment(&current, *equipment_id))
                }
                ChecklistKind::MissingCalibration { .. } => {
                    (ChecklistBasis::CalibrationMatching, calibration())
                }
            };
            ChecklistProgress { item: item.clone(), basis: basis_kind, outcome }
        })
        .collect()
}

/// The row of exactly `channel`; the unknown-channel row is never read.
fn row<'a>(basis: &'a ProjectProgressBasis, channel: &str) -> Option<&'a ChannelProgress> {
    basis.progress.channels.iter().find(|row| row.channel.as_deref() == Some(channel))
}

fn integration(row: Option<&ChannelProgress>, goal_seconds: u64) -> ChecklistOutcome {
    let goal = Microseconds::from_whole_seconds(goal_seconds).unwrap_or(Microseconds(u64::MAX));
    let (captured, usable, accepted) = row.map_or_else(Default::default, |row| {
        (row.captured_seconds, row.usable_seconds, row.accepted_seconds)
    });
    ChecklistOutcome::Seconds { captured, usable, accepted, goal, met: accepted >= goal }
}

fn frames(row: Option<&ChannelProgress>, goal: u64) -> ChecklistOutcome {
    let (captured, usable, accepted) =
        row.map_or((0, 0, 0), |row| (row.captured_frames, row.usable_frames, row.accepted_frames));
    ChecklistOutcome::Frames { captured, usable, accepted, goal, met: accepted >= goal }
}

fn session_evidence(
    session: &LinkedSessionEvidence,
    state: EvidenceState,
    reason: &str,
) -> ChecklistEvidence {
    ChecklistEvidence {
        session_id: Some(session.session_id),
        panel_id: session.panel_id,
        session_ids: Vec::new(),
        state,
        reason: reason.into(),
    }
}

/// Each Current session's effective exposures against the preference. A session
/// without exposures in the item's channel is not evidence.
fn exposure(
    sessions: &[&LinkedSessionEvidence],
    exposure_seconds: f64,
    channel: Option<&str>,
) -> ChecklistOutcome {
    let preference = Microseconds::from_seconds(exposure_seconds);
    let evidence = sessions
        .iter()
        .filter_map(|session| {
            let values: Vec<Option<Microseconds>> = session
                .exposures
                .iter()
                .filter(|item| {
                    channel.is_none_or(|channel| item.channel.as_deref() == Some(channel))
                })
                .map(|item| item.exposure_seconds)
                .collect();
            if channel.is_some() && values.is_empty() {
                return None;
            }
            let (state, reason) = if values.iter().flatten().any(|value| Some(*value) != preference)
            {
                (EvidenceState::Differs, EXPOSURE_DIFFERS)
            } else if values.is_empty() || values.iter().any(Option::is_none) {
                (EvidenceState::Unknown, EXPOSURE_UNKNOWN)
            } else {
                (EvidenceState::Matches, EXPOSURE_MATCHES)
            };
            Some(session_evidence(session, state, reason))
        })
        .collect();
    ChecklistOutcome::Evidence { evidence }
}

/// The Current sessions assigned to each panel, in panel order.
fn panels(panels: &[ProjectPanel], sessions: &[&LinkedSessionEvidence]) -> ChecklistOutcome {
    let evidence = panels
        .iter()
        .map(|panel| {
            let session_ids: Vec<Uuid> = sessions
                .iter()
                .filter(|session| session.panel_id == Some(panel.id))
                .map(|session| session.session_id)
                .collect();
            let (state, reason) = if session_ids.is_empty() {
                (EvidenceState::NoLinkedSession, PANEL_EMPTY)
            } else {
                (EvidenceState::Matches, PANEL_ASSIGNED)
            };
            ChecklistEvidence {
                session_id: None,
                panel_id: Some(panel.id),
                session_ids,
                state,
                reason: reason.into(),
            }
        })
        .collect();
    ChecklistOutcome::Evidence { evidence }
}

/// Each Current session's equipment association against the item's equipment.
/// Only a confirmation proves a difference; another suggestion stays unknown.
fn equipment(sessions: &[&LinkedSessionEvidence], equipment_id: Uuid) -> ChecklistOutcome {
    let evidence = sessions
        .iter()
        .map(|session| {
            let association = session.equipment.as_ref().and_then(|association| {
                association.subject_id.map(|subject| (subject == equipment_id, &association.state))
            });
            let (state, reason) = match association {
                Some((true, AssociationState::Confirmed)) => {
                    (EvidenceState::Matches, CONFIRMED_EQUIPMENT)
                }
                Some((true, AssociationState::Suggested)) => {
                    (EvidenceState::SuggestedMatch, SUGGESTED_EQUIPMENT)
                }
                Some((false, AssociationState::Confirmed)) => {
                    (EvidenceState::Differs, CONFIRMED_OTHER)
                }
                Some((false, AssociationState::Suggested)) => {
                    (EvidenceState::Unknown, SUGGESTED_OTHER)
                }
                _ => (EvidenceState::Unknown, NO_EQUIPMENT),
            };
            session_evidence(session, state, reason)
        })
        .collect();
    ChecklistOutcome::Evidence { evidence }
}

/// Calibration matching belongs to 068; until it exists the item is unknown.
fn calibration() -> ChecklistOutcome {
    ChecklistOutcome::Evidence {
        evidence: vec![ChecklistEvidence {
            session_id: None,
            panel_id: None,
            session_ids: Vec::new(),
            state: EvidenceState::Unknown,
            reason: CALIBRATION_UNAVAILABLE.into(),
        }],
    }
}
