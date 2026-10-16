// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 workflow defaults (D-W95, D-W102, D-W103, D-W114; PRJ-FR-28/29/31,
//! LIB-FR-04, CAL-FR-20/21): the owner-approved starting values for the same
//! framing, mosaic panels, flat rotation and age, the dark and bias age
//! window, the group keyword names and the input mode. All are adjustable in
//! Settings; a catalog that records none reads these defaults.

use serde::{Deserialize, Serialize};

use crate::{GroupKeywords, LibraryError, ViewMode};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

fn require_percent(field: &str, value: f64) -> Result<(), LibraryError> {
    if value.is_finite() && value > 0.0 && value <= 100.0 {
        Ok(())
    } else {
        Err(invalid(format!("{field} {value} must be a percentage in (0, 100]")))
    }
}

fn require_angle(field: &str, value: f64) -> Result<(), LibraryError> {
    if value.is_finite() && (0.0..180.0).contains(&value) {
        Ok(())
    } else {
        Err(invalid(format!("{field} {value} must be an angle in [0, 180) degrees")))
    }
}

/// When two framings are the same and when they are panels of one mosaic
/// (PRJ-FR-29/31). Intake splits sessions with the same centre and rotation
/// margins (LIB-FR-04).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FramingMargins {
    /// Least coverage, in percent, of the same framing.
    pub min_overlap_percent: f64,
    /// Largest centre offset, in percent of the field.
    pub max_centre_offset_percent: f64,
    /// Largest rotation difference in degrees. A meridian flip leaves
    /// ROTATANG unchanged; with only the sky angle known, 180° reads as the
    /// same framing.
    pub max_rotation_deg: f64,
    /// The overlap range, in percent, that offers two framings as panels.
    pub panel_overlap_percent: (f64, f64),
}

impl Default for FramingMargins {
    fn default() -> Self {
        Self {
            min_overlap_percent: 90.0,
            max_centre_offset_percent: 5.0,
            max_rotation_deg: 5.0,
            panel_overlap_percent: (5.0, 40.0),
        }
    }
}

impl FramingMargins {
    /// Percentages in (0, 100], an angle in [0, 180), and a panel range below
    /// the same-framing overlap, so no pair is both one framing and panels.
    ///
    /// # Errors
    /// `InvalidInput` naming the field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        require_percent("minOverlapPercent", self.min_overlap_percent)?;
        require_percent("maxCentreOffsetPercent", self.max_centre_offset_percent)?;
        require_angle("maxRotationDeg", self.max_rotation_deg)?;
        let (low, high) = self.panel_overlap_percent;
        require_percent("panelOverlapPercent", low)?;
        require_percent("panelOverlapPercent", high)?;
        if low >= high {
            return Err(invalid(format!("panel overlap {low}% to {high}% is not a range")));
        }
        if high >= self.min_overlap_percent {
            return Err(invalid(format!(
                "panel overlap up to {high}% reaches the same-framing overlap {}%",
                self.min_overlap_percent
            )));
        }
        Ok(())
    }
}

/// Flat matching thresholds (CAL-FR-20): the rotation that is fine, the
/// rotation still offered with a warning, and the age window in nights
/// between flats and lights, in either direction.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatRules {
    pub fine_within_deg: f64,
    /// Over this a flat is not offered.
    pub offered_within_deg: f64,
    /// 0 is the same night only; the default 1 is the same or the next.
    pub window_nights: u32,
}

impl Default for FlatRules {
    fn default() -> Self {
        Self { fine_within_deg: 2.0, offered_within_deg: 5.0, window_nights: 1 }
    }
}

impl FlatRules {
    /// # Errors
    /// `InvalidInput` when an angle is out of range or the fine angle exceeds
    /// the offered one.
    pub fn validate(&self) -> Result<(), LibraryError> {
        require_angle("fineWithinDeg", self.fine_within_deg)?;
        require_angle("offeredWithinDeg", self.offered_within_deg)?;
        if self.fine_within_deg > self.offered_within_deg {
            return Err(invalid(format!(
                "a flat fine within {}° is never offered beyond {}°",
                self.fine_within_deg, self.offered_within_deg
            )));
        }
        Ok(())
    }
}

/// The dark and bias age window in days from capture time (CAL-FR-21).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DarkBiasRules {
    pub window_days: u32,
}

impl Default for DarkBiasRules {
    fn default() -> Self {
        Self { window_days: 365 }
    }
}

/// The library's F4 workflow settings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSettings {
    pub framing: FramingMargins,
    pub flats: FlatRules,
    pub dark_bias: DarkBiasRules,
    /// The GROUP and PANEL keyword names; a Project may override them.
    pub keywords: GroupKeywords,
    /// The input mode a new Project starts with.
    pub view_mode: ViewMode,
}

impl WorkflowSettings {
    /// # Errors
    /// `InvalidInput` naming the invalid field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.framing.validate()?;
        self.flats.validate()
    }
}
