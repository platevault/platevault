// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Per-frame-type grouping configuration.

use metadata_core::FrameType;

use super::dimension::Dimension;

/// Sentinel rendered for an enabled dimension that has no value (R-11).
pub const SENTINEL_MISSING: &str = "∅";

/// Per-frame-type grouping configuration: which identity dimensions are enabled
/// plus the bucket sizes / tolerances for continuous dimensions.
///
/// Built-in defaults come from the R-9 recipe table ([`GroupingConfig::default_for`]).
/// Every dimension is individually toggleable (FR-035) and every continuous
/// bucket size is configurable (FR-036).
#[derive(Clone, Debug, PartialEq)]
pub struct GroupingConfig {
    /// The frame type this config applies to.
    pub frame_type: FrameType,
    /// Enabled dimensions, in canonical order. Disabled dims are simply absent.
    dimensions: Vec<Dimension>,

    /// Exposure bucket size in seconds (continuous → canonical seconds). Values
    /// are rounded to the nearest multiple of this. `0` ⇒ no bucketing.
    pub exposure_bucket_s: f64,
    /// Set-temperature bucket size in °C (FR-037, default 2 °C).
    pub set_temp_tolerance_c: f64,
    /// Source for the temperature dimension (R-9 / FR-037).
    pub temp_source: TempSource,
    /// `CCD-TEMP`-vs-`SET-TEMP` deviation threshold for the quality warning
    /// (FR-037, default 2 °C). Exceeding it warns but does NOT split.
    pub temp_deviation_warn_c: f64,
    /// Pointing tolerance in degrees (FR-038); RA/Dec snapped to this grid.
    pub pointing_tolerance_deg: f64,
    /// Light rotation tolerance in degrees (FR-040); ROTATANG snapped to this
    /// grid for *grouping* (the flat↔light applicability check is separate).
    pub rotation_tolerance_deg: f64,
    /// When `ROTATANG` is absent on a flat, whether rotation is required
    /// (FR-040, default OFF — missing rotation does not exclude).
    pub flat_rotation_required: bool,
}

/// Which header drives the temperature grouping dimension (R-9 / FR-037).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TempSource {
    /// `SET-TEMP` (the setpoint governs the group — default).
    SetTemp,
    /// `CCD-TEMP` (toggle).
    CcdTemp,
}

impl GroupingConfig {
    /// Built-in default recipe for a frame type, exactly per the R-9 table.
    ///
    /// - **light**: optic-train + filter + exposure + gain + offset + binning +
    ///   pointing + rotation + observing-night. **No temperature** (R-9).
    /// - **dark**: camera + exposure + gain + offset + set-temp + binning;
    ///   readout optional (OFF); night OFF (darks span nights).
    /// - **bias**: camera + gain + offset + binning + night; readout optional;
    ///   exposure excluded (≈0).
    /// - **flat**: camera + optic-train + filter + gain + offset + binning +
    ///   rotation + night; readout optional; exposure excluded; filter required.
    /// - **dark_flat**: treated like a dark (set-temp + exposure key), no optics.
    #[must_use]
    pub fn default_for(frame_type: FrameType) -> Self {
        use Dimension::{
            Binning, Camera, Exposure, Filter, Gain, ObservingNight, Offset, OpticTrain, Pointing,
            Rotation, SetTemp,
        };
        let dimensions = match frame_type {
            FrameType::Light => vec![
                OpticTrain,
                Filter,
                Exposure,
                Gain,
                Offset,
                Binning,
                Pointing,
                Rotation,
                ObservingNight,
            ],
            FrameType::Dark | FrameType::DarkFlat => {
                vec![Camera, Exposure, Gain, Offset, SetTemp, Binning]
            }
            FrameType::Bias => vec![Camera, Gain, Offset, Binning, ObservingNight],
            FrameType::Flat => {
                vec![Camera, OpticTrain, Filter, Gain, Offset, Binning, Rotation, ObservingNight]
            }
        };
        Self {
            frame_type,
            dimensions: sorted_unique(dimensions),
            exposure_bucket_s: 1.0,
            set_temp_tolerance_c: 2.0,
            temp_source: TempSource::SetTemp,
            temp_deviation_warn_c: 2.0,
            pointing_tolerance_deg: 0.5,
            rotation_tolerance_deg: 1.0,
            flat_rotation_required: false,
        }
    }

    /// Whether a dimension is currently enabled.
    #[must_use]
    pub fn has(&self, dim: Dimension) -> bool {
        self.dimensions.contains(&dim)
    }

    /// Enable a dimension (idempotent; keeps canonical order). FR-035 toggle.
    pub fn enable(&mut self, dim: Dimension) {
        if !self.dimensions.contains(&dim) {
            self.dimensions.push(dim);
            self.dimensions = sorted_unique(std::mem::take(&mut self.dimensions));
        }
    }

    /// Disable a dimension (idempotent). FR-035 toggle.
    pub fn disable(&mut self, dim: Dimension) {
        self.dimensions.retain(|d| *d != dim);
    }

    /// The enabled dimensions in canonical order (read-only).
    #[must_use]
    pub fn dimensions(&self) -> &[Dimension] {
        &self.dimensions
    }
}

/// Sort dimensions by canonical order and drop duplicates.
fn sorted_unique(mut dims: Vec<Dimension>) -> Vec<Dimension> {
    dims.sort_by_key(|d| d.order());
    dims.dedup();
    dims
}
