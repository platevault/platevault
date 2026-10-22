// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Matching a light session's calibration (spec 064 LIB-FR-23 to LIB-FR-26,
//! 068 CAL-FR-02, CAL-FR-19 to CAL-FR-22; D-W102 to D-W104, D-W114). The
//! catalog gathers one light session's facts and every raw set and adopted
//! master of a kind; [`crate::CalibrationRules::match_session`] keeps the
//! inputs that pass the hard checks, best first, each with the cautions that
//! keep it from being pinned automatically. Only a top input with no caution
//! is pinned; any other top input is a suggestion that needs confirmation.
//! Dark flats are never an input (D-W93).

use serde::{Deserialize, Serialize};
use time::Date;
use uuid::Uuid;

use crate::{
    CaptureEvidence, CriterionId, InputKind, InputRef, PinOrigin, PinState, PinTarget, PinnedFile,
    RigVersion,
};

/// Which physical camera one side of a match was taken with (LIB-FR-26).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "camera", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MatchCamera {
    /// One camera of the rigs: confirmed at import, the camera of the
    /// session's rig version, or the only camera of its model.
    Known { camera_id: Uuid },
    /// The rigs hold several cameras of its model and none is linked: the
    /// match waits for the camera to be named.
    Ambiguous,
    /// The rigs hold no camera of its model: only the headers compare.
    Unlinked,
}

/// A light session's confirmed rig, the version it recorded, and every
/// version of that rig, to date the version a flat was taken with.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightRig {
    pub rig_id: Uuid,
    pub version: Option<RigVersion>,
    pub versions: Vec<RigVersion>,
}

/// The light side of a match: one light session as one catalog snapshot
/// reads it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLight {
    pub session_id: Uuid,
    /// The header evidence of the session's representative light.
    pub capture: CaptureEvidence,
    /// The night the lights were taken.
    #[serde(default, with = "crate::iso_date::option")]
    pub night: Option<Date>,
    pub camera: MatchCamera,
    /// `None` until the session's rig is confirmed.
    pub rig: Option<LightRig>,
    /// The session's one rotation (ROTATANG); `None` is unknown.
    pub rotator_deg: Option<f64>,
}

/// The input side of a match: one raw set or adopted master. Superseded raw
/// sets and drifted masters are never inputs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub input: InputRef,
    pub kind: InputKind,
    pub capture: CaptureEvidence,
    /// The capture date its age counts from: a raw set's night, a master's
    /// DATE-OBS date. Never the import date.
    #[serde(default, with = "crate::iso_date::option")]
    pub captured: Option<Date>,
    pub camera: MatchCamera,
    /// The rig version a raw set recorded when its rig was confirmed.
    pub rig_version_id: Option<Uuid>,
    /// The ROTATANG of each frame, or a master's own; `None` where a frame
    /// records none.
    pub rotator_deg: Vec<Option<f64>>,
    /// The files a pin binds, each with its SHA-256.
    pub files: Vec<PinnedFile>,
    /// Every file is readable now.
    pub available: bool,
}

/// Why an offered input is not pinned automatically.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "caution", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum MatchCaution {
    /// Criteria neither side's evidence settles.
    CriterionUnknown { criteria: Vec<CriterionId> },
    /// Taken `days` from the lights, outside the `window` in days (nights
    /// for flats), before or after.
    OutsideWindow { days: u32, window: u32 },
    /// A capture date is unknown on either side.
    AgeUnknown,
    /// The rotation differs by more than the fine angle and no more than the
    /// offered one, in canonical decimal degrees.
    RotationWarning { degrees: String },
    /// A file is not readable now.
    Unavailable,
    /// Another input ranks the same: no single top input.
    RankingTie,
}

/// One input offered for a kind: the target a pin or suggestion records.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchOffer {
    pub target: PinTarget,
    /// Empty when every check passed inside the window.
    pub cautions: Vec<MatchCaution>,
}

impl MatchOffer {
    #[must_use]
    pub fn pinnable(&self) -> bool {
        self.cautions.is_empty()
    }
}

/// Every input offered for one kind of one light session, best first.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindMatch {
    pub kind: InputKind,
    pub offers: Vec<MatchOffer>,
}

impl KindMatch {
    /// The state matching gives the kind: the top offer pinned automatically
    /// when it has no caution, otherwise suggested; unresolved when nothing
    /// is offered.
    #[must_use]
    pub fn state(&self) -> PinState {
        match self.offers.first() {
            None => PinState::Unresolved,
            Some(top) if top.pinnable() => {
                PinState::Pinned { target: top.target.clone(), origin: PinOrigin::Automatic }
            }
            Some(top) => PinState::Suggested { target: top.target.clone() },
        }
    }
}
