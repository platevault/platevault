// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A session's framing (D-W107, LIB-FR-04): intake splits a night's lights
//! by framing, so each session has one pointing and one rotation. The framing
//! joins the session's identity beside its exact [`crate::CaptureKey`]: the
//! sessions of one night and key are told apart by their framing, which a
//! regroup matches by membership, so a session keeps its id while its frames
//! stay together.
//!
//! The framing is that of the session's anchor frame: the first of its frames
//! in capture order that has pointing when intake split it. Every other frame
//! lies within the framing's split limits of the anchor, or the user put it
//! there with a framing label (a merge or split in import review, recorded as
//! a correction).
//!
//! The split limits are those in force when intake formed the session, and
//! they stay the session's (D-W107, owner 2026-10-15/16/20): a later frame
//! joins the session when it lies within them of the anchor, and a later
//! change of the Settings limits re-splits no session.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{FieldOfView, LibraryError, SplitLimits};

/// The correctable capture field that holds the user's framing label.
pub const FRAMING_LABEL_FIELD: &str = "framingLabel";

/// The framing a session was split by at intake.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SessionFraming {
    /// 1 for the first framing of the night and key in capture order, 2 for
    /// the one a default name calls "framing 2", and so on.
    pub ordinal: u32,
    /// The frame whose pointing and rotation the framing has.
    pub anchor_asset_id: Uuid,
    /// The anchor's centre: its plate-solved centre, else its header RA/DEC.
    pub ra_deg: f64,
    pub dec_deg: f64,
    /// The anchor's mechanical rotator angle (ROTATANG); a meridian flip
    /// leaves it unchanged. `None` is unknown, never zero.
    #[serde(default)]
    pub rotator_deg: Option<f64>,
    /// The anchor's sky position angle; with only this known, 180° apart is
    /// the same framing.
    #[serde(default)]
    pub sky_angle_deg: Option<f64>,
    /// The anchor's field from its header optics, for the overlap of two
    /// framings; the centre limit is an angle and never reads it. `None`
    /// when the header cannot give it.
    #[serde(default)]
    pub field: Option<FieldOfView>,
    /// The user's framing label when the user merged or split the framing.
    #[serde(default)]
    pub label: Option<String>,
    /// The centre and rotation limits intake split the session with: a
    /// frame indexed later joins it within these of the anchor.
    pub split_limits: SplitLimits,
}

impl SessionFraming {
    /// # Errors
    /// `InvalidInput` for an ordinal of 0, a centre or angle outside its
    /// range, a field that is not positive, a blank label or split limits
    /// that are not valid.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let invalid = |message: String| Err(LibraryError::InvalidInput(message));
        if self.ordinal == 0 {
            return invalid("a framing ordinal starts at 1".into());
        }
        let (ra, dec) = (self.ra_deg, self.dec_deg);
        if !(ra.is_finite() && (0.0..360.0).contains(&ra)) {
            return invalid(format!("framing raDeg {ra} must be in [0, 360)"));
        }
        if !(dec.is_finite() && (-90.0..=90.0).contains(&dec)) {
            return invalid(format!("framing decDeg {dec} must be in [-90, 90]"));
        }
        for (field, angle) in
            [("rotatorDeg", self.rotator_deg), ("skyAngleDeg", self.sky_angle_deg)]
        {
            if let Some(angle) = angle {
                if !(angle.is_finite() && (0.0..360.0).contains(&angle)) {
                    return invalid(format!("framing {field} {angle} must be in [0, 360)"));
                }
            }
        }
        if let Some(field) = self.field {
            let positive = |value: f64| value.is_finite() && value > 0.0;
            if !positive(field.width_deg) || !positive(field.height_deg) {
                return invalid("a framing field must be positive".into());
            }
        }
        if self.label.as_deref().is_some_and(|label| label.trim().is_empty()) {
            return invalid("a framing label is not blank".into());
        }
        self.split_limits.validate()
    }
}
