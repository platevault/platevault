// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 workflow defaults (D-W95, D-W102, D-W103, D-W114; PRJ-FR-28/29/31,
//! LIB-FR-04, CAL-FR-15/20/21, J36 S8, PLAN-FR-02): the owner-approved
//! starting values for the same framing, mosaic panels, flat rotation and
//! age, the dark and bias age window, the group keyword names, the input
//! mode, whether raw calibration frames are kept, the old-master badge age
//! and the Moon-avoidance curve of each band. All are adjustable in Settings;
//! a catalog that records none reads these defaults.

use serde::{Deserialize, Serialize};

use crate::{Band, GroupKeywords, LibraryError, Revision, ViewMode};

fn require_percent(field: &str, value: f64) -> Result<(), LibraryError> {
    if value.is_finite() && value > 0.0 && value <= 100.0 {
        Ok(())
    } else {
        Err(LibraryError::invalid_field(
            field,
            format!("{field} {value} must be a percentage in (0, 100]"),
        ))
    }
}

fn require_angle(field: &str, value: f64) -> Result<(), LibraryError> {
    if value.is_finite() && (0.0..180.0).contains(&value) {
        Ok(())
    } else {
        Err(LibraryError::invalid_field(
            field,
            format!("{field} {value} must be an angle in [0, 180) degrees"),
        ))
    }
}

/// When two frames are one framing (LIB-FR-04, PRJ-FR-31, D-W107; CF2,
/// owner 2026-10-20): their centres within an angle on the sky, so the limit
/// is the same whatever the field, and their rotation within an angle. The
/// Settings default is 5′ and 5°; an import may carry its own.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct SplitLimits {
    /// Largest centre offset, in arcminutes.
    pub max_centre_offset_arcmin: f64,
    /// Largest rotation difference in degrees. A meridian flip leaves
    /// ROTATANG unchanged; with only the sky angle known, 180° reads as the
    /// same framing.
    pub max_rotation_deg: f64,
}

impl Default for SplitLimits {
    fn default() -> Self {
        Self { max_centre_offset_arcmin: 5.0, max_rotation_deg: 5.0 }
    }
}

impl SplitLimits {
    /// A centre offset in (0, 10 800) arcminutes and a rotation in [0, 180)
    /// degrees.
    ///
    /// # Errors
    /// `InvalidInput` naming the field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        let centre = self.max_centre_offset_arcmin;
        if !(centre.is_finite() && centre > 0.0 && centre < 10_800.0) {
            return Err(LibraryError::invalid_field(
                "maxCentreOffsetArcmin",
                format!("maxCentreOffsetArcmin {centre} must be an angle in (0, 10800) arcminutes"),
            ));
        }
        require_angle("maxRotationDeg", self.max_rotation_deg)
    }
}

/// When two framings are the same and when they are panels of one mosaic
/// (PRJ-FR-29/31). Intake splits sessions with the same centre and rotation
/// limits (LIB-FR-04).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct FramingMargins {
    /// Least coverage, in percent, of the same framing.
    pub min_overlap_percent: f64,
    /// The centre and rotation limits of one framing.
    #[serde(flatten)]
    pub split: SplitLimits,
    /// The overlap range, in percent, that offers two framings as panels.
    pub panel_overlap_percent: (f64, f64),
}

impl Default for FramingMargins {
    fn default() -> Self {
        Self {
            min_overlap_percent: 90.0,
            split: SplitLimits::default(),
            panel_overlap_percent: (5.0, 40.0),
        }
    }
}

impl FramingMargins {
    /// Percentages in (0, 100], the split limits, and a panel range below
    /// the same-framing overlap, so no pair is both one framing and panels.
    ///
    /// # Errors
    /// `InvalidInput` naming the field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        require_percent("minOverlapPercent", self.min_overlap_percent)?;
        self.split.validate()?;
        let (low, high) = self.panel_overlap_percent;
        require_percent("panelOverlapPercent", low)?;
        require_percent("panelOverlapPercent", high)?;
        if low >= high {
            return Err(LibraryError::invalid_field(
                "panelOverlapPercent",
                format!("panel overlap {low}% to {high}% is not a range"),
            ));
        }
        if high >= self.min_overlap_percent {
            return Err(LibraryError::invalid_field(
                "panelOverlapPercent",
                format!(
                    "panel overlap up to {high}% reaches the same-framing overlap {}%",
                    self.min_overlap_percent
                ),
            ));
        }
        Ok(())
    }
}

/// Flat matching thresholds (CAL-FR-20): the rotation that is fine, the
/// rotation still offered with a warning, and the age window in nights
/// between flats and lights, in either direction.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
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
            return Err(LibraryError::invalid_field(
                "fineWithinDeg",
                format!(
                    "a flat fine within {}° is never offered beyond {}°",
                    self.fine_within_deg, self.offered_within_deg
                ),
            ));
        }
        Ok(())
    }
}

/// The dark and bias age window in days from capture time (CAL-FR-21).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct DarkBiasRules {
    pub window_days: u32,
}

impl Default for DarkBiasRules {
    fn default() -> Self {
        Self { window_days: 365 }
    }
}

/// The Settings › Calibration values that are not matching thresholds.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct CalibrationSettings {
    /// Keep a raw calibration set where it is once its master registers;
    /// off, the default, moves the raws to the OS Trash (J36 P1/S8, P-CAL3).
    pub keep_raw_frames: bool,
    /// A dark or bias master whose newest version is older than this many
    /// days carries the "Old · {n} d" badge; flats are exempt (CAL-FR-15,
    /// D-W103). It decides only the badge, not the matching window of
    /// [`DarkBiasRules`].
    pub old_master_after_days: u32,
}

impl Default for CalibrationSettings {
    fn default() -> Self {
        Self { keep_raw_frames: false, old_master_after_days: 90 }
    }
}

impl CalibrationSettings {
    /// # Errors
    /// `InvalidInput` for an old-master age under one day.
    pub fn validate(&self) -> Result<(), LibraryError> {
        if self.old_master_after_days == 0 {
            return Err(LibraryError::invalid_field(
                "oldMasterAfterDays",
                "oldMasterAfterDays must be at least 1 day",
            ));
        }
        Ok(())
    }
}

/// One band's Moon-avoidance curve (PLAN-FR-02, D-W88): the Lorentzian of
/// ACP and Target Scheduler, so the separation it requires from the Moon is
/// `distance` at full Moon and shrinks with `width` as the Moon dims.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct MoonAvoidanceCurve {
    /// The separation required at full Moon, in [0, 180] degrees.
    pub distance_deg: f64,
    /// The half width in days from full Moon, in [0.5, 30].
    pub width_days: f64,
}

impl MoonAvoidanceCurve {
    /// The least separation from the Moon, `distance / (1 + (age / width)^2)`,
    /// at `moon_age_days` from full Moon; a negative age reads as full.
    #[must_use]
    pub fn min_separation_deg(&self, moon_age_days: f64) -> f64 {
        let ratio = moon_age_days.max(0.0) / self.width_days;
        self.distance_deg / ratio.mul_add(ratio, 1.0)
    }

    fn validate(&self, band: &str) -> Result<(), LibraryError> {
        let Self { distance_deg, width_days } = *self;
        if !(0.0..=180.0).contains(&distance_deg) {
            return Err(LibraryError::invalid_field(
                "distanceDeg",
                format!("{band} Moon distance {distance_deg} must be in [0, 180] degrees"),
            )
            .within_field(band));
        }
        if !(0.5..=30.0).contains(&width_days) {
            return Err(LibraryError::invalid_field(
                "widthDays",
                format!("{band} Moon width {width_days} must be in [0.5, 30] days"),
            )
            .within_field(band));
        }
        Ok(())
    }
}

/// The Moon-avoidance curve of every band the Filters strip grades
/// (PLAN-FR-02, PLAN-TGT-FR-06), keyed by the band's wire name. The
/// defaults are spec 047 D4's: LRGB 120°/14 d, Ha and SII 60°/7 d, OIII
/// 110°/10 d.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct MoonAvoidance {
    #[serde(rename = "L")]
    l: MoonAvoidanceCurve,
    #[serde(rename = "R")]
    r: MoonAvoidanceCurve,
    #[serde(rename = "G")]
    g: MoonAvoidanceCurve,
    #[serde(rename = "B")]
    b: MoonAvoidanceCurve,
    #[serde(rename = "Ha")]
    ha: MoonAvoidanceCurve,
    #[serde(rename = "SII")]
    sii: MoonAvoidanceCurve,
    #[serde(rename = "OIII")]
    oiii: MoonAvoidanceCurve,
}

impl Default for MoonAvoidance {
    fn default() -> Self {
        let broadband = MoonAvoidanceCurve { distance_deg: 120.0, width_days: 14.0 };
        let narrow = MoonAvoidanceCurve { distance_deg: 60.0, width_days: 7.0 };
        Self {
            l: broadband,
            r: broadband,
            g: broadband,
            b: broadband,
            ha: narrow,
            sii: narrow,
            oiii: MoonAvoidanceCurve { distance_deg: 110.0, width_days: 10.0 },
        }
    }
}

impl MoonAvoidance {
    /// The curve `band` is graded under.
    #[must_use]
    pub const fn curve(&self, band: Band) -> MoonAvoidanceCurve {
        match band {
            Band::L => self.l,
            Band::R => self.r,
            Band::G => self.g,
            Band::B => self.b,
            Band::Ha => self.ha,
            Band::Sii => self.sii,
            Band::Oiii => self.oiii,
        }
    }

    /// Replace `band`'s curve; [`Self::validate`] checks it.
    pub fn set(&mut self, band: Band, curve: MoonAvoidanceCurve) {
        *match band {
            Band::L => &mut self.l,
            Band::R => &mut self.r,
            Band::G => &mut self.g,
            Band::B => &mut self.b,
            Band::Ha => &mut self.ha,
            Band::Sii => &mut self.sii,
            Band::Oiii => &mut self.oiii,
        } = curve;
    }

    /// # Errors
    /// `InvalidInput` naming the first band whose curve is out of range.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.l.validate("L")?;
        self.r.validate("R")?;
        self.g.validate("G")?;
        self.b.validate("B")?;
        self.ha.validate("Ha")?;
        self.sii.validate("SII")?;
        self.oiii.validate("OIII")
    }
}

/// The library's F4 workflow settings: one document under one revision.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct WorkflowSettings {
    pub framing: FramingMargins,
    pub flats: FlatRules,
    pub dark_bias: DarkBiasRules,
    /// The GROUP and PANEL keyword names; a Project may override them.
    pub keywords: GroupKeywords,
    /// The input mode a new Project starts with.
    pub view_mode: ViewMode,
    pub calibration: CalibrationSettings,
    pub moon_avoidance: MoonAvoidance,
}

impl WorkflowSettings {
    /// # Errors
    /// `InvalidInput` naming the invalid field.
    pub fn validate(&self) -> Result<(), LibraryError> {
        self.framing.validate().map_err(|error| error.within_field("framing"))?;
        self.flats.validate().map_err(|error| error.within_field("flats"))?;
        self.calibration.validate().map_err(|error| error.within_field("calibration"))?;
        self.moon_avoidance.validate().map_err(|error| error.within_field("moonAvoidance"))
    }
}

/// The workflow settings at their revision, 0 while none are recorded; a
/// save names the revision it replaces.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "wire", derive(specta::Type, schemars::JsonSchema))]
pub struct WorkflowSettingsRecord {
    pub settings: WorkflowSettings,
    pub revision: Revision,
}
