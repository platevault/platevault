// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session readiness and the Project admission rule (spec 064 LIB-FR-17,
//! LIB-FR-20, LIB-FR-23; 065 PRJ-FR-08/09; D-W78, D-W105, D-W107).
//!
//! A session's intake flow is Target, then Rig, then Review; Finish review is
//! gated on no Unreviewed frame being left, and the session is then Ready.
//! Only a current Ready session whose calibration is settled joins a Project,
//! and only into a group on its own rig of a Project that is still open.
//! [`admit_session`] is the one statement of that rule; persistence applies
//! it inside every membership-add transaction, compares the returned
//! [`AdmissionBasis`] against the one the caller reviewed, and SQL refuses the
//! same rows. Suggestions show the blockers [`session_blockers`] names, such as
//! "Choose its flats first".

use std::fmt;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    CalibrationHealth, InputKind, LibraryError, ProjectLifecycle, Revision, SessionCalibration,
};

/// Where a session stands in its intake flow.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum SessionReadiness {
    NeedsTarget,
    NeedsRig,
    NeedsReview,
    Ready,
}

impl fmt::Display for SessionReadiness {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NeedsTarget => "needs a Target",
            Self::NeedsRig => "needs its rig",
            Self::NeedsReview => "needs its review finished",
            Self::Ready => "is Ready",
        })
    }
}

/// The facts readiness is computed from, read in one catalog snapshot.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionIntake {
    pub session_id: Uuid,
    pub grouping_revision: Revision,
    /// A regroup replaced the session; its successors are current.
    pub superseded: bool,
    pub target_confirmed: bool,
    /// The confirmed rig.
    pub rig_id: Option<Uuid>,
    /// Finish review was recorded at the session's current grouping revision.
    pub review_finished: bool,
    /// Live logical captures whose applicable quality is Unreviewed.
    pub unreviewed_frames: u64,
}

impl SessionIntake {
    #[must_use]
    pub const fn readiness(&self) -> SessionReadiness {
        if !self.target_confirmed {
            SessionReadiness::NeedsTarget
        } else if self.rig_id.is_none() {
            SessionReadiness::NeedsRig
        } else if !self.review_finished || self.unreviewed_frames > 0 {
            SessionReadiness::NeedsReview
        } else {
            SessionReadiness::Ready
        }
    }
}

/// The session state an admission was decided on. A membership write
/// records it, and a stale one is refused as a conflict.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct AdmissionBasis {
    pub grouping_revision: Revision,
    pub calibration_generation: Revision,
}

/// One reason a session can't join a Project, in the order they are named.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "blocker", rename_all = "snake_case", rename_all_fields = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub enum AdmissionBlocker {
    /// A Closing, Closed or Archived Project takes no session.
    ProjectLocked {
        lifecycle: ProjectLifecycle,
    },
    Superseded,
    NotReady {
        readiness: SessionReadiness,
    },
    /// A group holds sessions of its own rig only.
    RigMismatch {
        session_rig: Option<Uuid>,
        group_rig: Uuid,
    },
    /// The kinds neither pinned nor No.
    CalibrationUnsettled {
        kinds: Vec<InputKind>,
    },
    /// Provisional (lead default 2026-10-16, decision record §9; to confirm
    /// with the owner): pinned kinds whose files changed or went missing.
    /// The session waits in Needs calibration until they are reassigned or
    /// their bytes return; Projects that already hold it keep it.
    CalibrationDrifted {
        kinds: Vec<InputKind>,
    },
}

impl fmt::Display for AdmissionBlocker {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ProjectLocked { lifecycle } => write!(f, "the Project is {lifecycle}"),
            Self::Superseded => f.write_str("the session was regrouped; add its successor"),
            Self::NotReady { readiness } => write!(f, "the session {readiness}"),
            Self::RigMismatch { session_rig: Some(rig), group_rig } => {
                write!(f, "the session's rig {rig} is not the group's rig {group_rig}")
            }
            Self::RigMismatch { session_rig: None, group_rig } => {
                write!(f, "the session has no confirmed rig; the group's rig is {group_rig}")
            }
            Self::CalibrationUnsettled { kinds } => {
                let kinds: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
                write!(f, "its calibration is not settled: choose its {} first", kinds.join(", "))
            }
            Self::CalibrationDrifted { kinds } => {
                let kinds: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();
                write!(
                    f,
                    "its pinned {} changed or went missing: reassign them first",
                    kinds.join(", ")
                )
            }
        }
    }
}

/// Why one session can't join a Project: every blocker at once.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionRefusal {
    pub session_id: Uuid,
    pub blockers: Vec<AdmissionBlocker>,
}

impl fmt::Display for AdmissionRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let blockers: Vec<String> = self.blockers.iter().map(ToString::to_string).collect();
        write!(f, "session {} can't join the Project: {}", self.session_id, blockers.join("; "))
    }
}

impl From<AdmissionRefusal> for LibraryError {
    fn from(refusal: AdmissionRefusal) -> Self {
        Self::InvalidInput(refusal.to_string())
    }
}

/// A session's readiness and calibration as admission reads them, with each
/// pin's health and the blockers that keep it from any Project.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionAdmission {
    pub intake: SessionIntake,
    pub calibration: SessionCalibration,
    pub health: CalibrationHealth,
    pub blockers: Vec<AdmissionBlocker>,
}

fn readiness_blockers(intake: &SessionIntake) -> impl Iterator<Item = AdmissionBlocker> {
    let readiness = intake.readiness();
    let superseded = intake.superseded.then_some(AdmissionBlocker::Superseded);
    let not_ready =
        (readiness != SessionReadiness::Ready).then_some(AdmissionBlocker::NotReady { readiness });
    superseded.into_iter().chain(not_ready)
}

/// The calibration blockers on joining: kinds neither pinned nor No, and,
/// provisionally (decision record §9, lead default 2026-10-16, to confirm
/// with the owner), pinned kinds whose files drifted. This is the one place
/// that decides what drift means for joining; Apply's refusal of a held
/// session's drifted pin is separate and stands either way (D-W113).
fn calibration_blockers(
    calibration: &SessionCalibration,
    health: CalibrationHealth,
) -> impl Iterator<Item = AdmissionBlocker> {
    let unsettled = calibration.unsettled_kinds();
    let unsettled = (!unsettled.is_empty())
        .then_some(AdmissionBlocker::CalibrationUnsettled { kinds: unsettled });
    let drifted: Vec<InputKind> = health
        .drifted_kinds()
        .into_iter()
        .filter(|kind| calibration.kind(*kind).is_settled())
        .collect();
    let drifted =
        (!drifted.is_empty()).then_some(AdmissionBlocker::CalibrationDrifted { kinds: drifted });
    unsettled.into_iter().chain(drifted)
}

/// What keeps a session from every Project: superseded, not Ready, or
/// calibration not settled or drifted. Empty for a session any open Project
/// may add.
#[must_use]
pub fn session_blockers(
    intake: &SessionIntake,
    calibration: &SessionCalibration,
    health: &CalibrationHealth,
) -> Vec<AdmissionBlocker> {
    readiness_blockers(intake).chain(calibration_blockers(calibration, *health)).collect()
}

/// The admission rule for adding a session to a group on `group_rig` of a
/// Project in `lifecycle`, with the health of the session's pins.
///
/// # Errors
/// [`AdmissionRefusal`] naming every blocker.
pub fn admit_session(
    lifecycle: ProjectLifecycle,
    group_rig: Uuid,
    intake: &SessionIntake,
    calibration: &SessionCalibration,
    health: &CalibrationHealth,
) -> Result<AdmissionBasis, AdmissionRefusal> {
    let locked = (!lifecycle.is_open()).then_some(AdmissionBlocker::ProjectLocked { lifecycle });
    let rig = (intake.rig_id != Some(group_rig))
        .then_some(AdmissionBlocker::RigMismatch { session_rig: intake.rig_id, group_rig });
    let blockers: Vec<AdmissionBlocker> = locked
        .into_iter()
        .chain(readiness_blockers(intake))
        .chain(rig)
        .chain(calibration_blockers(calibration, *health))
        .collect();
    if blockers.is_empty() {
        Ok(AdmissionBasis {
            grouping_revision: intake.grouping_revision,
            calibration_generation: calibration.generation,
        })
    } else {
        Err(AdmissionRefusal { session_id: intake.session_id, blockers })
    }
}
